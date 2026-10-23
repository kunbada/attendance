// 계약관리 연동: 계약앱(분양계약관리)의 동기화 서버.
// 계약앱이 예전에 Apps Script 와 주고받던 규칙을 그대로 지킨다:
//  · 변경은 "바뀐 필드만(patch)" 또는 전체 레코드로 오고, 서버가 필드 단위로 병합한다
//  · 같은 동호에 해약이 아닌 계약이 둘이거나, 같은 입금내역이 두 번 올라오면 거절(rejected)하고 서버 최신 상태를 돌려준다
//  · 앱은 poll(rev 만 조회)로 바뀐 게 있는지 보고, 있을 때만 sync 한다
// 큰 동기화(양주역 첫 업로드 수천 건)에서도 D1 질의 수가 늘지 않도록, 쓰기는 json_each 로 한 문장에 여러 건을 넣는다.
import { AppError, s, all, first, stmt, writeLog } from '../core/util.js';

export const COLS = ['units', 'contracts', 'pre', 'resv', 'locks', 'deposits', 'settings', 'templates', 'notes'];
const MAX_CHANGES = 1000;       // 한 번의 sync 로 받는 변경 수 (계약앱은 300건씩 보낸다)
const READ_CHUNK = 80;          // IN (...) 에 넣는 값 수 (D1 은 질의당 변수 100개 제한)
const WRITE_CHUNK = 150;        // 한 문장으로 쓰는 레코드 수
const WRITE_BYTES = 600000;     // 한 문장에 싣는 데이터 크기 (D1 문자열 값 2MB 제한 안쪽)
const MAX_REC_BYTES = 300000;   // 레코드 하나의 최대 크기
const PAGE = 1500;              // 한 번에 돌려주는 변경 레코드 수 (넘으면 more=true 로 나눠 받는다)

// 통합 서버 역할 → 계약앱 권한 (관리자·보조관리자 = admin, 계약담당 = write, 열람 = read)
export const appRole = (ctx) => (ctx.role === 'viewer' ? 'read' : ctx.role === 'contract' ? 'write' : 'admin');

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};
export const kstIso = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 23); // 계약앱의 updatedAt 형식 (YYYY-MM-DDTHH:MM:SS.mmm, 한국 시간)
const parse = (text) => { try { return JSON.parse(text) || {}; } catch (e) { return {}; } };
const isActiveContract = (r) => !!r && !r.deleted && r.status !== '해약' && !!r.dongho;
export const currentRev = async (env, pid) => ((await first(env, 'SELECT rev FROM ct_rev WHERE project_id = ?', pid)) || {}).rev || 0;

// 앱이 5초마다 부르는 가벼운 확인: 서버 rev 만 돌려준다
export async function contractPoll(env, data, ctx) {
  return { rev: await currentRev(env, ctx.projectId), role: appRole(ctx), name: ctx.account.name };
}

// ---------- 쓰기 SQL ----------
// 변경 번호(rev)는 레코드를 쓰는 것과 같은 트랜잭션(DB.batch)에서 올린다.
// 그래서 어떤 앱이 "rev 가 20이다"라고 읽었다면 rev 20 이하의 레코드는 이미 모두 보이는 상태다 (놓치는 변경이 없다).
const BUMP_SQL = `INSERT INTO ct_rev (project_id, rev) VALUES (?1, ?2) ON CONFLICT(project_id) DO UPDATE SET rev = rev + ?2`;
const REV_EXPR = `(SELECT rev FROM ct_rev WHERE project_id = ?1) - ?3`;
// 이미 있는 레코드: 읽었을 때의 rev(base)와 같을 때만 덮어쓴다 (그 사이 다른 사용자가 고쳤으면 건너뛰고 다시 병합)
const UPDATE_SQL = `WITH v AS MATERIALIZED (SELECT json_extract(value, '$.c') AS c, json_extract(value, '$.id') AS id, json_extract(value, '$.idx') AS idx,
               json_extract(value, '$.base') AS base, json_extract(value, '$.ua') AS ua, json_extract(value, '$.ub') AS ub,
               json_extract(value, '$.del') AS del, json_extract(value, '$.js') AS js
        FROM json_each(?2) WHERE json_extract(value, '$.base') IS NOT NULL)
  UPDATE ct_records
  SET rev = ${REV_EXPR} + v.idx + 1, updated_at = v.ua, updated_by = v.ub, deleted = v.del,
      json = json_set(v.js, '$._rv', ${REV_EXPR} + v.idx + 1)
  FROM v
  WHERE ct_records.project_id = ?1 AND ct_records.col = v.c AND ct_records.id = v.id AND ct_records.rev = v.base
  RETURNING ct_records.col AS c, ct_records.id AS id`;
// 새 레코드: 그 사이 같은 id 가 생겼으면 건너뛰고 다시 병합
const INSERT_SQL = `INSERT INTO ct_records (project_id, col, id, rev, updated_at, updated_by, deleted, json)
  SELECT ?1, json_extract(value, '$.c'), json_extract(value, '$.id'), ${REV_EXPR} + json_extract(value, '$.idx') + 1,
         json_extract(value, '$.ua'), json_extract(value, '$.ub'), json_extract(value, '$.del'),
         json_set(json_extract(value, '$.js'), '$._rv', ${REV_EXPR} + json_extract(value, '$.idx') + 1)
  FROM json_each(?2) WHERE json_extract(value, '$.base') IS NULL
  ON CONFLICT(project_id, col, id) DO NOTHING
  RETURNING col AS c, id AS id`;

// 반환: { retry: 반영 못 한 항목(동시 수정으로 다시 병합 필요), rejected: [{item, msg}] }
async function writeChunk(env, pid, items) {
  const payload = JSON.stringify(items.map((it, i) => ({
    c: it.c, id: it.id, idx: i, base: it.base, ua: s(it.rec.updatedAt), ub: s(it.rec.updatedBy), del: it.rec.deleted ? 1 : 0, js: it.js
  })));
  try {
    const res = await env.DB.batch([stmt(env, BUMP_SQL, pid, items.length), stmt(env, UPDATE_SQL, pid, payload, items.length), stmt(env, INSERT_SQL, pid, payload, items.length)]);
    const done = new Set([...(res[1].results || []), ...(res[2].results || [])].map((r) => r.c + '|' + r.id));
    return { retry: items.filter((it) => !done.has(it.c + '|' + it.id)), rejected: [] };
  } catch (e) {
    if (!/UNIQUE|constraint/i.test(String(e && e.message))) throw e;
    if (items.length === 1) return { retry: [], rejected: [{ item: items[0], msg: await explainUnique(env, pid, items[0]) }] };
    // 동시에 같은 동호·입금내역이 들어와 사전 검사를 빠져나간 드문 경우: 한 건씩 처리해 문제 건만 가려낸다
    const out = { retry: [], rejected: [] };
    for (const it of items) {
      const r = await writeChunk(env, pid, [it]);
      out.retry.push(...r.retry);
      out.rejected.push(...r.rejected);
    }
    return out;
  }
}

async function explainUnique(env, pid, it) {
  if (it.c === 'contracts' && it.rec.dongho) {
    const h = await first(env,
      `SELECT json_extract(json, '$.name') AS name FROM ct_records WHERE project_id = ? AND col = 'contracts' AND deleted = 0 AND COALESCE(status_g, '') <> '해약' AND COALESCE(dongho_g, '') <> '' AND dongho_g = ? AND id <> ? LIMIT 1`,
      pid, s(it.rec.dongho), it.id);
    return '동호 ' + it.rec.dongho + '는 이미 ' + ((h && h.name) || '다른 고객') + ' 님으로 계약되어 있습니다 (다른 사용자가 먼저 등록)';
  }
  if (it.c === 'deposits') return '이미 등록된 입금내역입니다 (중복)';
  return '서버가 이 변경을 거절했습니다 (중복된 값)';
}

// 레코드들을 한 번에 쓴다. 동시 수정으로 못 쓴 항목과 거절된 항목을 돌려준다
export async function writeAll(env, pid, items) {
  const retry = [], rejected = [];
  let cur = [], bytes = 0;
  const flush = async () => {
    if (!cur.length) return;
    const r = await writeChunk(env, pid, cur);
    retry.push(...r.retry);
    rejected.push(...r.rejected);
    cur = []; bytes = 0;
  };
  for (const it of items) {
    if (cur.length >= WRITE_CHUNK || bytes + it.js.length > WRITE_BYTES) await flush();
    cur.push(it);
    bytes += it.js.length;
  }
  await flush();
  return { retry, rejected };
}

// ---------- 읽기: 변경된 레코드의 현재 값 ----------
async function loadExisting(env, pid, changes) {
  const map = new Map();
  const byCol = new Map();
  changes.forEach((c) => { if (!byCol.has(c.c)) byCol.set(c.c, new Set()); byCol.get(c.c).add(c.id); });
  for (const [col, idSet] of byCol) {
    for (const ids of chunk([...idSet], READ_CHUNK)) {
      const rows = await all(env,
        `SELECT col, id, rev, updated_at, json FROM ct_records WHERE project_id = ? AND col = ? AND id IN (${ids.map(() => '?').join(',')})`, pid, col, ...ids);
      rows.forEach((r) => map.set(r.col + '|' + r.id, r));
    }
  }
  return map;
}

// 동시 등록을 미리 알아내기 위한 조회: 이미 계약된 동호 / 이미 올라온 입금내역 키
async function loadHolders(env, pid, doghos) {
  const byDongho = new Map();
  for (const part of chunk([...new Set(doghos)], READ_CHUNK)) {
    (await all(env,
      `SELECT id, dongho_g AS dongho, json_extract(json, '$.name') AS name FROM ct_records
       WHERE project_id = ? AND col = 'contracts' AND deleted = 0 AND COALESCE(status_g, '') <> '해약' AND COALESCE(dongho_g, '') <> '' AND dongho_g IN (${part.map(() => '?').join(',')})`, pid, ...part))
      .forEach((r) => byDongho.set(r.dongho, { id: r.id, name: r.name }));
  }
  return byDongho;
}
async function loadDepositKeys(env, pid, keys) {
  const found = new Set();
  for (const part of chunk([...new Set(keys)], READ_CHUNK)) {
    (await all(env,
      `SELECT dep_key_g AS k FROM ct_records WHERE project_id = ? AND col = 'deposits' AND deleted = 0 AND COALESCE(dep_key_g, '') <> '' AND dep_key_g IN (${part.map(() => '?').join(',')})`, pid, ...part))
      .forEach((r) => found.add(r.k));
  }
  return found;
}

// 병합 + 검증. accepted: 쓸 항목, rejected: 거절(서버 최신 상태 포함), extra: 서버가 더 최신이라 돌려줄 레코드
async function decide(env, pid, changes, existing, userName) {
  const accepted = [], rejected = [], extra = [];
  // 1) 병합 결과(rec)를 먼저 만든다
  const merged = [];
  for (const ch of changes) {
    const cur = existing.get(ch.c + '|' + ch.id);
    const curObj = cur ? parse(cur.json) : null;
    let rec;
    if (cur) {
      if (ch.p) rec = Object.assign({}, curObj, ch.p);
      else {
        if (s(cur.updated_at) > s(ch.r.updatedAt)) { extra.push({ c: ch.c, r: curObj }); continue; } // 서버가 더 최신
        rec = Object.assign({}, ch.r);
      }
    } else rec = ch.p ? Object.assign({ id: ch.id }, ch.p) : Object.assign({}, ch.r);
    rec.id = ch.id;
    delete rec._rv;
    rec.updatedBy = userName || rec.updatedBy || '';
    const js = JSON.stringify(rec);
    if (js.length > MAX_REC_BYTES) { rejected.push({ c: ch.c, id: ch.id, msg: '레코드가 너무 큽니다', r: curObj }); continue; }
    merged.push({ ch, cur, curObj, rec, js });
  }
  // 2) 동시 등록 검사에 필요한 값을 한꺼번에 조회
  const byDongho = await loadHolders(env, pid, merged.filter((m) => m.ch.c === 'contracts' && isActiveContract(m.rec)).map((m) => s(m.rec.dongho)));
  const holderOfId = new Map();
  byDongho.forEach((h, d) => holderOfId.set(h.id, d));
  const newKeys = merged.filter((m) => m.ch.c === 'deposits' && !m.cur && !m.rec.deleted && m.rec.k).map((m) => s(m.rec.k));
  const takenKeys = await loadDepositKeys(env, pid, newKeys);
  // 3) 차례로 검사 (같은 요청 안에서 먼저 처리된 변경도 반영)
  for (const m of merged) {
    const { ch, cur, curObj, rec, js } = m;
    if (ch.c === 'contracts') {
      const d = s(rec.dongho);
      if (isActiveContract(rec)) {
        const h = byDongho.get(d);
        if (h && h.id !== ch.id) {
          rejected.push({ c: ch.c, id: ch.id, msg: '동호 ' + d + '는 이미 ' + (h.name || '다른 고객') + ' 님으로 계약되어 있습니다 (다른 사용자가 먼저 등록)', r: curObj });
          continue;
        }
      }
      // 이 레코드가 이전에 차지하던 동호를 놓아 주고, 지금 상태로 새로 차지한다
      if (holderOfId.has(ch.id)) { byDongho.delete(holderOfId.get(ch.id)); holderOfId.delete(ch.id); }
      if (isActiveContract(rec)) { byDongho.set(d, { id: ch.id, name: rec.name }); holderOfId.set(ch.id, d); }
    }
    if (ch.c === 'deposits' && !cur && !rec.deleted && rec.k) {
      if (takenKeys.has(s(rec.k))) { rejected.push({ c: ch.c, id: ch.id, msg: '이미 등록된 입금내역입니다 (중복)', r: null }); continue; }
      takenKeys.add(s(rec.k));
    }
    accepted.push({ c: ch.c, id: ch.id, rec, js, base: cur ? cur.rev : null, change: ch, curObj });
  }
  return { accepted, rejected, extra };
}

export async function contractSync(env, data, ctx) {
  const pid = ctx.projectId;
  const raw = Array.isArray(data.changes) ? data.changes : [];
  if (raw.length > MAX_CHANGES) throw new AppError('한 번에 보낼 수 있는 변경이 너무 많습니다.');
  if (raw.length && ctx.role === 'viewer') throw new AppError('읽기 전용 계정은 저장할 수 없습니다.', 'READONLY');
  const since = Math.max(0, Number(data.since) || 0);
  const userName = s(ctx.account.name);

  // 입력 정리: 잘못된 항목은 버리고, 같은 (컬렉션, id)는 마지막 것만 쓴다
  const wanted = new Map();
  raw.forEach((ch) => {
    if (!ch || !COLS.includes(ch.c)) return;
    const id = s(ch.id || (ch.r && ch.r.id));
    if (!id || id.length > 100) return;
    const p = ch.p && typeof ch.p === 'object' ? ch.p : null;
    const r = !p && ch.r && typeof ch.r === 'object' ? ch.r : null;
    if (!p && !r) return;
    wanted.set(ch.c + '|' + id, { c: ch.c, id, p, r });
  });

  const rejected = [], extra = [];
  let pending = [...wanted.values()];
  // 그 사이 다른 사용자가 같은 레코드를 고쳐서 못 쓴 항목은 최신 값 위에 다시 병합해서 시도한다 (최대 3번)
  for (let attempt = 0; attempt < 3 && pending.length; attempt++) {
    const existing = await loadExisting(env, pid, pending);
    const d = await decide(env, pid, pending, existing, userName);
    rejected.push(...d.rejected);
    extra.push(...d.extra);
    const w = await writeAll(env, pid, d.accepted);
    w.rejected.forEach((x) => rejected.push({ c: x.item.c, id: x.item.id, msg: x.msg, r: x.item.curObj }));
    pending = w.retry.map((it) => it.change);
  }
  pending.forEach((ch) => rejected.push({ c: ch.c, id: ch.id, msg: '다른 사용자가 동시에 수정하고 있어 반영하지 못했습니다. 잠시 후 다시 시도해 주세요.', r: null }));

  // 응답: 내가 모르는 최신 레코드들. rev 를 먼저 읽고 그 이하만 읽으므로 놓치는 변경이 없다
  const counter = await currentRev(env, pid);
  const rows = await all(env, 'SELECT col, rev, json FROM ct_records WHERE project_id = ? AND rev > ? AND rev <= ? ORDER BY rev LIMIT ?', pid, since, counter, PAGE + 1);
  const more = rows.length > PAGE;
  const page = more ? rows.slice(0, PAGE) : rows;
  const changes = extra.concat(page.map((r) => ({ c: r.col, r: parse(r.json) })));
  return { rev: more ? page[page.length - 1].rev : counter, more, changes, rejected, role: appRole(ctx), name: userName };
}

// 이 현장의 서버 데이터를 전부 '삭제됨' 처리 (백업 복원·초기데이터 덮어쓰기 전에 사용). 삭제 사실은 다른 PC 에도 전파된다
export async function contractWipe(env, data, ctx) {
  const pid = ctx.projectId;
  const res = await env.DB.batch([
    stmt(env, `INSERT INTO ct_rev (project_id, rev) VALUES (?1, (SELECT COUNT(*) FROM ct_records WHERE project_id = ?1 AND deleted = 0))
               ON CONFLICT(project_id) DO UPDATE SET rev = rev + (SELECT COUNT(*) FROM ct_records WHERE project_id = ?1 AND deleted = 0)`, pid),
    // 위에서 올린 번호 구간 안에서 레코드마다 새 rev 를 준다
    stmt(env, `UPDATE ct_records SET deleted = 1, rev = r.nr, json = json_set(ct_records.json, '$.deleted', json('true'), '$._rv', r.nr)
               FROM (SELECT rowid AS rid, (SELECT rev FROM ct_rev WHERE project_id = ?1) - (SELECT COUNT(*) FROM ct_records WHERE project_id = ?1 AND deleted = 0) + ROW_NUMBER() OVER (ORDER BY rowid) AS nr
                     FROM ct_records WHERE project_id = ?1 AND deleted = 0) AS r
               WHERE ct_records.rowid = r.rid AND ct_records.project_id = ?1
               RETURNING ct_records.id AS id`, pid)
  ]);
  const wiped = (res[1].results || []).length;
  await writeLog(env, ctx.account.login_id, '계약데이터초기화', pid, wiped + '건 삭제 표시', pid);
  return { wiped, rev: await currentRev(env, pid) };
}
