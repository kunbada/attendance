// 수수료 원장 관리: 현장 수수료 설정, 해약 감지 → 환수 줄 만들기, 재판매 대체 판단, 해약·환수 화면.
// 원장(fee_ledger)에는 "확정된 정산"의 줄만 쌓인다. 정산을 만드는 중(작성·검토)에는 계산 결과가 pay_items 에만 있다.
import { AppError, s, all, first, run, stmt, nowStr, todayStr, newId, writeLog } from '../core/util.js';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

// 현장 설정(project_settings)에 저장하는 수수료 관련 값
export const FEE_AFTER = ['계약금전체', '계약금1차'];        // 수수료를 지급하는 시점: 계약금 회차를 모두 낸 뒤 / 1차만 낸 뒤
export const FEE_MISSING = ['보류', '건너뜀'];                // 팀장·본부장이 없을 때: 그 계약을 보류 / 그 몫만 건너뜀
const K = { after: '수수료지급기준', start: '수수료정산시작일', months: '재판매대기개월', missing: '수수료상위자없음' };
const DEFAULTS = { after: '계약금전체', start: '', months: '3', missing: '보류' };

export async function loadFeeSettings(env, pid) {
  const map = {};
  (await all(env, `SELECT key, value FROM project_settings WHERE project_id = ? AND key IN (?, ?, ?, ?)`, pid, K.after, K.start, K.months, K.missing)).forEach((r) => { map[r.key] = r.value; });
  const months = Number(map[K.months] || DEFAULTS.months);
  return {
    after: FEE_AFTER.includes(map[K.after]) ? map[K.after] : DEFAULTS.after,
    start: isDate(map[K.start] || '') ? map[K.start] : '',
    months: Number.isInteger(months) && months >= 0 && months <= 36 ? months : 3,
    missing: FEE_MISSING.includes(map[K.missing]) ? map[K.missing] : DEFAULTS.missing
  };
}

export async function feeSettingsGet(env, data, ctx) {
  return { settings: await loadFeeSettings(env, ctx.projectId) };
}

export async function saveFeeSetting(env, pid, key, value) {
  await run(env, 'INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value', pid, key, value);
}

export async function feeSettingsSave(env, data, ctx) {
  const pid = ctx.projectId;
  const after = s(data.after), start = s(data.start), missing = s(data.missing);
  const months = Number(data.months);
  if (!FEE_AFTER.includes(after)) throw new AppError('지급 시점은 "계약금 모두 납부 후" 또는 "계약금 1차 납부 후" 중에서 선택해 주세요.');
  if (start && !isDate(start)) throw new AppError('정산 시작일 형식이 올바르지 않습니다.');
  if (!Number.isInteger(months) || months < 0 || months > 36) throw new AppError('재판매 대기 기간은 0~36개월 사이의 정수로 입력해 주세요.');
  if (!FEE_MISSING.includes(missing)) throw new AppError('팀장·본부장이 없을 때의 처리를 선택해 주세요.');
  await env.DB.batch([
    stmt(env, 'INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value', pid, K.after, after),
    stmt(env, 'INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value', pid, K.start, start),
    stmt(env, 'INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value', pid, K.months, String(months)),
    stmt(env, 'INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value', pid, K.missing, missing)
  ]);
  await writeLog(env, ctx.account.login_id, '수수료설정', pid, '지급 시점 ' + after + ' / 시작일 ' + (start || '-') + ' / 재판매 대기 ' + months + '개월 / 상위자 없음 ' + missing, pid);
  return {};
}

// 날짜에 개월 수를 더한다 (말일을 넘으면 그 달 말일로)
export function addMonths(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return t.getUTCFullYear() + '-' + String(t.getUTCMonth() + 1).padStart(2, '0') + '-' + String(Math.min(d, last)).padStart(2, '0');
}

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const parse = (text) => { try { return JSON.parse(text) || {}; } catch (e) { return {}; } };

// 계약앱 계약 여러 건의 현재 값 { id: { deleted, rec } }  (기본키로 찾는다)
export async function contractsById(env, pid, ids) {
  const map = new Map();
  for (const part of chunk([...new Set(ids)], 80)) {
    (await all(env, `SELECT id, deleted, json FROM ct_records WHERE project_id = ? AND col = 'contracts' AND id IN (${part.map(() => '?').join(',')})`, pid, ...part))
      .forEach((r) => map.set(r.id, { deleted: !!r.deleted, rec: parse(r.json) }));
  }
  return map;
}
const isCancelled = (c) => !c || c.deleted || c.rec.status === '해약';

// 다른 현장으로 옮긴 직원의 이름도 보여야 해서 현장 조건 없이 이름만 읽는다 (check-scope 의 예외로 등록)
export async function staffNames(env, ids) {
  const map = {};
  for (const part of chunk([...new Set(ids.filter(Boolean))], 80)) {
    (await all(env, `SELECT id, name FROM staff WHERE id IN (${part.map(() => '?').join(',')})`, ...part)).forEach((r) => { map[r.id] = r.name; });
  }
  return map;
}

const LINE_COLS = ['id', 'project_id', 'contract_id', 'dongho', 'contract_date', 'staff_id', 'role', 'kind', 'amount', 'state', 'run_id', 'ref_id', 'owner_staff_id', 'decision', 'resale_until', 'cancel_date', 'note', 'created_at'];
// 원장 줄 여러 개를 한 문장으로 넣는다. 이미 있는 (계약, 몫)은 건너뛴다
export function insertLines(env, lines) {
  if (!lines.length) return null;
  return stmt(env,
    `INSERT OR IGNORE INTO fee_ledger (${LINE_COLS.join(', ')}) SELECT ${LINE_COLS.map((c) => `json_extract(value, '$.${c}')`).join(', ')} FROM json_each(?)`, JSON.stringify(lines));
}
const lineOf = (o) => Object.assign({ id: newId('FL'), contract_date: '', run_id: '', ref_id: '', owner_staff_id: '', decision: '', resale_until: '', cancel_date: '', note: '', created_at: nowStr() }, o);

// 해약된 계약의 지급 줄에 환수 줄(대기)을 만들고, 해약이 취소된 계약의 환수 줄은 거둬들이며, 재판매 대기를 판단한다.
// 정산을 만들거나 확정하기 전, 그리고 해약·환수 화면을 열 때 부른다 (몇 번 불러도 같은 결과)
export async function feeSync(env, pid) {
  const today = todayStr();
  const st = await loadFeeSettings(env, pid);
  const pays = await all(env,
    `SELECT l.* FROM fee_ledger l WHERE l.project_id = ? AND l.kind = '지급' AND l.state = '확정'
       AND NOT EXISTS (SELECT 1 FROM fee_ledger r WHERE r.project_id = l.project_id AND r.ref_id = l.id AND r.kind = '환수' AND r.state <> '취소')`, pid);
  const refunds = await all(env, `SELECT * FROM fee_ledger WHERE project_id = ? AND kind = '환수' AND state = '대기' AND run_id = ''`, pid);
  if (!pays.length && !refunds.length) return;
  const cur = await contractsById(env, pid, pays.map((l) => l.contract_id).concat(refunds.map((l) => l.contract_id)));

  const newLines = [], cancelIds = new Set(), decideEnv = []; // decideEnv: [{ ids, decision, note }]
  // 1) 해약(또는 삭제)된 계약 → 환수 줄
  pays.forEach((l) => {
    const c = cur.get(l.contract_id);
    if (!isCancelled(c)) return;
    const cancelDate = c && c.rec.updatedAt && isDate(String(c.rec.updatedAt).slice(0, 10)) ? String(c.rec.updatedAt).slice(0, 10) : today;
    newLines.push(lineOf({ project_id: pid, contract_id: l.contract_id, dongho: l.dongho, contract_date: l.contract_date, staff_id: l.staff_id, role: l.role, kind: '환수', amount: -l.amount, state: '대기', ref_id: l.id, owner_staff_id: l.owner_staff_id, cancel_date: cancelDate, note: '계약 해약' }));
  });
  // 2) 해약이 취소된 계약 → 아직 차감하지 않은 환수 줄 취소
  refunds.forEach((l) => { if (!isCancelled(cur.get(l.contract_id))) cancelIds.add(l.id); });

  // 3) 재판매 대기 중인 환수 줄 판단
  const waiting = refunds.filter((l) => l.decision === '재판매대기' && !cancelIds.has(l.id));
  const markers = [];
  if (waiting.length) {
    const holders = new Map();
    for (const part of chunk([...new Set(waiting.map((l) => l.dongho).filter(Boolean))], 80)) {
      (await all(env,
        `SELECT id, dongho_g AS dongho, json_extract(json, '$.staffId') AS sid FROM ct_records
         WHERE project_id = ? AND col = 'contracts' AND deleted = 0 AND COALESCE(status_g, '') <> '해약' AND COALESCE(dongho_g, '') <> '' AND dongho_g IN (${part.map(() => '?').join(',')})`, pid, ...part))
        .forEach((r) => holders.set(r.dongho, { id: r.id, sid: s(r.sid) }));
    }
    // 새 계약이 이미 수수료를 받았으면 원 담당자는 환수 (이중 지급 방지)
    const paidNew = new Set();
    const newIds = [...holders.values()].map((h) => h.id);
    for (const part of chunk(newIds, 80)) {
      (await all(env, `SELECT DISTINCT contract_id FROM fee_ledger WHERE project_id = ? AND kind = '지급' AND state <> '취소' AND contract_id IN (${part.map(() => '?').join(',')})`, pid, ...part))
        .forEach((r) => paidNew.add(r.contract_id));
    }
    const toRefund = new Map(); // 환수로 바꿀 줄 id → 사유
    waiting.forEach((l) => {
      const h = holders.get(l.dongho);
      if (h && h.id !== l.contract_id) {
        if (paidNew.has(h.id)) toRefund.set(l.id, '새 계약이 이미 수수료를 받았음');
        else if (h.sid && h.sid === l.owner_staff_id) {
          cancelIds.add(l.id);
          markers.push(lineOf({ project_id: pid, contract_id: h.id, dongho: l.dongho, staff_id: l.owner_staff_id, role: '대체', kind: '대체', amount: 0, state: '확정', owner_staff_id: l.owner_staff_id, note: '원 담당자 재판매로 대체 (원 계약 ' + l.contract_id + ')' }));
        } else if (h.sid) toRefund.set(l.id, '다른 직원이 재판매');
      } else if (l.resale_until && today > l.resale_until) toRefund.set(l.id, '재판매 대기 기한 경과');
    });
    toRefund.forEach((note, id) => decideEnv.push({ id, note }));
  }

  const writes = [];
  const ins = insertLines(env, newLines.concat(markers));
  if (ins) writes.push(ins);
  if (cancelIds.size) writes.push(stmt(env, `UPDATE fee_ledger SET state = '취소', note = note || ' / 취소(해약 취소 또는 재판매 대체)' WHERE project_id = ? AND state = '대기' AND id IN (SELECT value FROM json_each(?))`, pid, JSON.stringify([...cancelIds])));
  if (decideEnv.length) writes.push(stmt(env,
    `UPDATE fee_ledger SET decision = '환수', note = note || ' / ' || (SELECT json_extract(value, '$.note') FROM json_each(?2) WHERE json_extract(value, '$.id') = fee_ledger.id)
     WHERE project_id = ?1 AND state = '대기' AND run_id = '' AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?2))`, pid, JSON.stringify(decideEnv)));
  if (writes.length) await env.DB.batch(writes);
}

// ---------- 해약·환수 화면 ----------

export async function feeCancelList(env, data, ctx) {
  const pid = ctx.projectId;
  await feeSync(env, pid);
  const st = await loadFeeSettings(env, pid);
  const lines = await all(env, `SELECT * FROM fee_ledger WHERE project_id = ? AND kind = '환수' ORDER BY created_at DESC, id LIMIT 800`, pid);
  const cur = await contractsById(env, pid, lines.map((l) => l.contract_id));
  const names = await staffNames(env, lines.map((l) => l.staff_id).concat(lines.map((l) => l.owner_staff_id)));
  const open = new Map();
  lines.filter((l) => l.state === '대기').forEach((l) => {
    const g = open.get(l.contract_id) || {
      contractId: l.contract_id, dongho: l.dongho, customer: (cur.get(l.contract_id) ? s(cur.get(l.contract_id).rec.name) : ''), owner: names[l.owner_staff_id] || '', cancelDate: l.cancel_date,
      decision: l.decision, resaleUntil: l.resale_until, deducted: l.run_id !== '', lines: [], total: 0, notes: l.note
    };
    g.lines.push({ id: l.id, role: l.role, staffName: names[l.staff_id] || '(알 수 없음)', amount: l.amount });
    g.total += l.amount;
    open.set(l.contract_id, g);
  });
  return {
    pending: [...open.values()].sort((a, b) => b.cancelDate.localeCompare(a.cancelDate)),
    history: lines.filter((l) => l.state !== '대기').slice(0, 80).map((l) => ({ dongho: l.dongho, staffName: names[l.staff_id] || '', role: l.role, amount: l.amount, state: l.state, note: l.note, runId: l.run_id, cancelDate: l.cancel_date })),
    months: st.months
  };
}

// 해약된 계약의 환수 처리 결정: 지금 환수 / 재판매 대기(기한 안에 원 담당자가 다시 계약하면 대체)
export async function feeCancelDecide(env, data, ctx) {
  const pid = ctx.projectId;
  const contractId = s(data.contractId), decision = s(data.decision);
  if (!['환수', '재판매대기'].includes(decision)) throw new AppError('처리 방법은 환수 / 재판매 대기 중에서 선택해 주세요.');
  const lines = await all(env, `SELECT * FROM fee_ledger WHERE project_id = ? AND contract_id = ? AND kind = '환수' AND state = '대기' AND run_id = ''`, pid, contractId);
  if (!lines.length) throw new AppError('처리할 환수 건이 없습니다. (이미 정산에 반영되었거나 해약이 취소되었을 수 있습니다)');
  let until = '';
  if (decision === '재판매대기') {
    const st = await loadFeeSettings(env, pid);
    until = addMonths(lines[0].cancel_date || todayStr(), st.months);
  }
  await run(env, `UPDATE fee_ledger SET decision = ?, resale_until = ? WHERE project_id = ? AND contract_id = ? AND kind = '환수' AND state = '대기' AND run_id = ''`, decision, until, pid, contractId);
  await writeLog(env, ctx.account.login_id, '수수료환수결정', contractId, lines[0].dongho + ' / ' + decision + (until ? ' / 기한 ' + until : ''), pid);
  if (decision === '재판매대기') await feeSync(env, pid); // 이미 재계약이 있으면 바로 판단
  return { resaleUntil: until };
}
