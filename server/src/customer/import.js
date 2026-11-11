// 외부 데이터 업로드: 고객 명단 / 관심고객 등록 / 상담·TM 결과를 고객 DB 에 넣는다.
//  - 화면이 파일을 읽어 줄 단위로 나눠 보낸다 (한 번에 최대 200줄, 첫 호출이 업로드 기록을 만들고 이후 호출은 importId 로 이어 붙인다)
//  - 같은 전화번호의 고객이 이미 있으면 새로 만들지 않고 빈 항목만 채운다. 동의는 "동의"가 한 번이라도 확인되면 동의로 남는다
//  - 전화번호 원문은 암호화해 저장한다. 올릴 때 고른 출처와 동의 여부를 고객마다 기록한다
import { AppError, s, all, first, run, stmt, encryptText, phoneHash, nowStr, todayStr, newId, writeLog } from '../core/util.js';
import { GRADES } from './grade.js';
import { STATUSES, NOTE_KINDS, normalizePhoneLoose } from './customer.js';

export const IMPORT_KINDS = ['명단', '관심고객', '상담결과'];
const CONSENTS = ['동의', '미확인'];
const MAX_ROWS = 200;

// 날짜·일시 정리: 2026.11.3 / 2026-11-03 14:05 / 엑셀 날짜 번호 → 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:MM'. 알 수 없으면 ''
function normalizeAt(v) {
  const t = s(v).trim();
  if (!t) return '';
  if (/^\d{5}(\.\d+)?$/.test(t)) { // 엑셀 날짜 번호
    const d = new Date(Math.round((Number(t) - 25569) * 86400000));
    return isNaN(d) ? '' : d.toISOString().slice(0, 10);
  }
  const m = t.match(/^(\d{4})[.\-\/년]\s*(\d{1,2})[.\-\/월]\s*(\d{1,2})일?\.?(?:\s+(\d{1,2}):(\d{2}))?/);
  if (!m) return '';
  const p = (x) => String(x).padStart(2, '0');
  if (+m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) return '';
  return m[1] + '-' + p(m[2]) + '-' + p(m[3]) + (m[4] !== undefined ? ' ' + p(m[4]) + ':' + m[5] : '');
}

export async function customerImport(env, data, ctx) {
  const pid = ctx.projectId;
  const direct = data.direct === true; // 화면에서 고객 한 명을 직접 등록 (업로드 기록을 만들지 않는다)
  const kind = s(data.kind), source = s(data.source).trim(), consent = s(data.consent);
  if (!IMPORT_KINDS.includes(kind)) throw new AppError('자료 종류는 고객 명단 / 관심고객 / 상담·TM 결과 중에서 선택해 주세요.');
  if (!source || source.length > 30) throw new AppError('출처를 입력해 주세요. (30자 이내, 예: TM업체A, 홈페이지 관심등록)');
  if (!CONSENTS.includes(consent)) throw new AppError('개인정보 동의 여부를 선택해 주세요.');
  const rows = Array.isArray(data.rows) ? data.rows : [];
  if (!rows.length) throw new AppError('올릴 내용이 없습니다.');
  if (rows.length > MAX_ROWS) throw new AppError('한 번에 ' + MAX_ROWS + '줄까지 올릴 수 있습니다.');

  let importId = s(data.importId);
  if (importId) {
    const b = await first(env, `SELECT kind, source, consent FROM customer_imports WHERE id = ? AND project_id = ? AND status = '완료'`, importId, pid);
    if (!b || b.kind !== kind || b.source !== source || b.consent !== consent) throw new AppError('업로드 기록을 찾을 수 없습니다. 처음부터 다시 올려 주세요.');
  }

  const now = nowStr(), who = ctx.account.login_id;
  const errors = [], custs = new Map(), notes = [], grades = new Map();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i] || {};
    const line = Number(r.line) || i + 1;
    const phone = normalizePhoneLoose(r.phone);
    if (!phone) { errors.push({ line, reason: '전화번호가 없거나 형식이 올바르지 않습니다' }); continue; }
    const hash = await phoneHash(env, phone);
    const name = s(r.name).trim().slice(0, 30);
    const grade = s(r.grade).trim().toUpperCase().replace(/등급$/, '');
    if (grade && !GRADES.includes(grade)) { errors.push({ line, reason: '등급은 A, B, C, D 만 쓸 수 있습니다 (' + grade + ')' }); continue; }
    const status = s(r.status).trim();
    if (status && !STATUSES.includes(status)) { errors.push({ line, reason: '진행 상태 값이 올바르지 않습니다 (' + status + ')' }); continue; }
    if (!custs.has(hash)) {
      custs.set(hash, {
        h: hash, name, enc: await encryptText(env, phone), tail: phone.slice(-4), memo: kind === '상담결과' ? '' : s(r.memo).trim().slice(0, 500),
        region: s(r.region).trim().slice(0, 40), interest: s(r.interest).trim().slice(0, 40), status
      });
    }
    if (grade) grades.set(hash, grade);
    if (kind === '상담결과') {
      const noteKind = NOTE_KINDS.includes(s(r.kind).trim()) ? s(r.kind).trim() : 'TM';
      const result = s(r.result).trim().slice(0, 30), content = s(r.memo).trim().slice(0, 1000);
      if (!result && !content && !grade && !status) { errors.push({ line, reason: '상담 결과·내용·등급 중 하나는 있어야 합니다' }); continue; }
      if (result || content) notes.push({ id: newId('CN'), h: hash, at: normalizeAt(r.at) || todayStr(), kind: noteKind, result, content });
    }
  }
  const list = [...custs.values()];
  if (!list.length) return { importId, added: 0, updated: 0, notes: 0, skipped: errors.length, errors };

  // 이미 아는 고객(외부 자료·설문·방명록)인지: 새 고객 수를 세는 데만 쓴다
  const hashes = JSON.stringify(list.map((c) => c.h));
  const known = new Set();
  (await all(env,
    `SELECT phone_hash FROM customers WHERE project_id = ?1 AND source_kind <> '' AND phone_hash IN (SELECT value FROM json_each(?2))
     UNION SELECT phone_hash FROM responses WHERE project_id = ?1 AND phone_hash IN (SELECT value FROM json_each(?2))
     UNION SELECT phone_hash FROM guestbook WHERE project_id = ?1 AND phone_hash IN (SELECT value FROM json_each(?2))`, pid, hashes)).forEach((r) => known.add(r.phone_hash));
  const added = list.filter((c) => !known.has(c.h)).length;

  const writes = [];
  if (!importId && !direct) {
    importId = newId('CI');
    writes.push(stmt(env, `INSERT INTO customer_imports (id, project_id, kind, source, consent, file_name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      importId, pid, kind, source, consent, s(data.fileName).trim().slice(0, 80), who, now));
  }
  // 새 고객은 만들고, 이미 있는 고객은 빈 항목만 채운다. 설문·방명록 고객에 덧붙여 둔 행(source_kind '')이면 출처를 채워 외부 자료 고객으로도 표시한다
  writes.push(stmt(env,
    `INSERT INTO customers (project_id, phone_hash, name, phone_enc, phone_tail, source, source_kind, consent, status, memo, region, interest, import_id, created_at, updated_at, updated_by)
     SELECT ?1, json_extract(value, '$.h'), json_extract(value, '$.name'), json_extract(value, '$.enc'), json_extract(value, '$.tail'), ?3, ?4, ?5,
            json_extract(value, '$.status'), json_extract(value, '$.memo'), json_extract(value, '$.region'), json_extract(value, '$.interest'), ?6, ?7, ?7, ?8
     FROM json_each(?2) WHERE 1
     ON CONFLICT(project_id, phone_hash) DO UPDATE SET
       name = CASE WHEN customers.name = '' THEN excluded.name ELSE customers.name END,
       phone_enc = CASE WHEN customers.phone_enc = '' THEN excluded.phone_enc ELSE customers.phone_enc END,
       phone_tail = CASE WHEN customers.phone_tail = '' THEN excluded.phone_tail ELSE customers.phone_tail END,
       import_id = CASE WHEN customers.source_kind = '' THEN excluded.import_id ELSE customers.import_id END,
       source = CASE WHEN customers.source_kind = '' THEN excluded.source ELSE customers.source END,
       source_kind = CASE WHEN customers.source_kind = '' THEN excluded.source_kind ELSE customers.source_kind END,
       consent = CASE WHEN excluded.consent = '동의' OR customers.consent = '' THEN excluded.consent ELSE customers.consent END,
       status = CASE WHEN excluded.status <> '' THEN excluded.status ELSE customers.status END,
       memo = CASE WHEN customers.memo = '' THEN excluded.memo ELSE customers.memo END,
       region = CASE WHEN customers.region = '' THEN excluded.region ELSE customers.region END,
       interest = CASE WHEN customers.interest = '' THEN excluded.interest ELSE customers.interest END,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    pid, JSON.stringify(list), source, kind, consent, importId, now, who));
  if (notes.length) {
    writes.push(stmt(env,
      `INSERT INTO customer_notes (id, project_id, phone_hash, at, kind, result, content, import_id, created_by, created_at)
       SELECT json_extract(value, '$.id'), ?1, json_extract(value, '$.h'), json_extract(value, '$.at'), json_extract(value, '$.kind'), json_extract(value, '$.result'), json_extract(value, '$.content'), ?3, ?4, ?5
       FROM json_each(?2)`, pid, JSON.stringify(notes), importId, who, now));
  }
  if (grades.size) {
    // 상담 결과의 등급은 직접 정한 등급으로 덮어쓰고, 명단의 등급은 직접 정한 등급이 없을 때만 넣는다
    const conflict = kind === '상담결과'
      ? `DO UPDATE SET grade = excluded.grade, memo = excluded.memo, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
      : 'DO NOTHING';
    writes.push(stmt(env,
      `INSERT INTO customer_grades (project_id, phone_hash, grade, memo, updated_at, updated_by)
       SELECT ?1, json_extract(value, '$.h'), json_extract(value, '$.g'), ?3, ?4, ?5 FROM json_each(?2) WHERE 1
       ON CONFLICT(project_id, phone_hash) ${conflict}`, pid, JSON.stringify([...grades].map(([h, g]) => ({ h, g }))), '업로드: ' + source, now, who));
  }
  if (importId) {
    writes.push(stmt(env, `UPDATE customer_imports SET total = total + ?, added = added + ?, updated = updated + ?, notes = notes + ?, skipped = skipped + ? WHERE id = ? AND project_id = ?`,
      rows.length, added, list.length - added, notes.length, errors.length, importId, pid));
  }
  await env.DB.batch(writes);
  if (direct || !s(data.importId)) await writeLog(env, who, direct ? '고객등록' : '고객업로드', importId || list[0].h.slice(0, 12), kind + ' / 출처 ' + source + ' / 동의 ' + consent, pid);
  return { importId, added, updated: list.length - added, notes: notes.length, skipped: errors.length, errors };
}

export async function customerImportList(env, data, ctx) {
  const rows = await all(env, 'SELECT * FROM customer_imports WHERE project_id = ? ORDER BY created_at DESC LIMIT 100', ctx.projectId);
  return {
    imports: rows.map((r) => ({
      id: r.id, kind: r.kind, source: r.source, consent: r.consent, fileName: r.file_name, total: r.total, added: r.added, updated: r.updated, notes: r.notes, skipped: r.skipped,
      status: r.status, createdBy: r.created_by, createdAt: r.created_at
    }))
  };
}

// 업로드 취소: 이 업로드로 처음 생긴 고객과 이 업로드가 넣은 상담 기록을 지운다.
// 설문·방명록에도 있는 고객은 그쪽 자료가 남아 있으므로 고객 DB 에서 사라지지 않는다 (외부 출처 표시만 없어진다)
export async function customerImportDelete(env, data, ctx) {
  const pid = ctx.projectId;
  const id = s(data.importId);
  const b = await first(env, `SELECT * FROM customer_imports WHERE id = ? AND project_id = ?`, id, pid);
  if (!b) throw new AppError('업로드 기록을 찾을 수 없습니다.');
  if (b.status !== '완료') throw new AppError('이미 취소된 업로드입니다.');
  const res = await env.DB.batch([
    stmt(env, 'DELETE FROM customer_notes WHERE project_id = ? AND import_id = ?', pid, id),
    stmt(env, `DELETE FROM customers WHERE project_id = ?1 AND import_id = ?2
                 AND NOT EXISTS (SELECT 1 FROM responses r WHERE r.project_id = ?1 AND r.phone_hash = customers.phone_hash)
                 AND NOT EXISTS (SELECT 1 FROM guestbook g WHERE g.project_id = ?1 AND g.phone_hash = customers.phone_hash)`, pid, id),
    // 설문·방명록에도 있는 고객은 관리 정보(상태·담당·메모)를 남기고 외부 출처 표시만 지운다
    stmt(env, `UPDATE customers SET source = '', source_kind = '', consent = '', import_id = '' WHERE project_id = ? AND import_id = ?`, pid, id),
    stmt(env, `UPDATE customer_imports SET status = '취소' WHERE id = ? AND project_id = ?`, id, pid)
  ]);
  await writeLog(env, ctx.account.login_id, '고객업로드취소', id, b.source + ' / 고객 ' + res[1].meta.changes + '명 / 기록 ' + res[0].meta.changes + '건', pid);
  return { customers: res[1].meta.changes, notes: res[0].meta.changes };
}
