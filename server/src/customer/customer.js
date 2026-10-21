// 고객 통합(고객관리 > 데이터통합관리): 같은 전화번호 해시를 가진 설문 응답·방명록(방문)을 한 고객으로 묶어 보여 준다.
// 개인정보에 동의한 건만 묶는다 (설문: 개인정보 동의 응답, 방명록: 개인정보 제공 동의 건). 전화번호 원문은 화면에 보내지 않고 마스킹만 한다.
// 계약·TM·상담 데이터는 해당 기능이 생기면 같은 해시로 이어 붙인다.
import { AppError, s, all, first, run, stmt, decryptText, phoneHash, nowStr, writeLog } from '../core/util.js';
import { GRADES, classify } from './grade.js';

const maskPhone = (d) => (d && d.length >= 7 ? d.slice(0, 3) + '-****-' + d.slice(-4) : '');

// 방명록 옛 행(해시 도입 전)은 목록을 열 때 한 번에 채운다. 한 번에 최대 300건씩.
async function backfillGuestHash(env, pid) {
  const miss = await all(env, `SELECT id, phone FROM guestbook WHERE project_id = ? AND consent = 1 AND phone_hash = '' LIMIT 300`, pid);
  if (!miss.length) return 0;
  const list = [];
  for (const g of miss) list.push({ id: g.id, h: await phoneHash(env, g.phone) });
  const json = JSON.stringify(list);
  await env.DB.batch([stmt(env,
    `UPDATE guestbook SET phone_hash = (SELECT json_extract(value, '$.h') FROM json_each(?) WHERE json_extract(value, '$.id') = guestbook.id)
     WHERE project_id = ? AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`, json, pid, json)]);
  return miss.length;
}

export async function customerList(env, data, ctx) {
  const pid = ctx.projectId;
  const q = s(data.q).trim().toLowerCase();
  const qd = q.replace(/\D/g, '');
  await backfillGuestHash(env, pid);

  const map = {};
  const cust = (h) => (map[h] = map[h] || { hash: h, name: '', phone: '', phoneEnc: '', surveys: 0, lastSurveyAt: '', intent: '', subscr: '', visits: 0, lastVisit: '', people: 0 });

  const sv = await all(env,
    `SELECT r.phone_hash, r.submitted_at, p.name, p.phone_enc,
            (SELECT a.value_code FROM response_answers a WHERE a.response_id = r.id AND a.q_key = 'STD_INTENT' LIMIT 1) AS intent,
            (SELECT a.value_code FROM response_answers a WHERE a.response_id = r.id AND a.q_key = 'STD_SUBSCR' LIMIT 1) AS subscr
     FROM responses r LEFT JOIN response_pii p ON p.response_id = r.id AND p.project_id = r.project_id
     WHERE r.project_id = ? AND r.phone_hash <> '' ORDER BY r.submitted_at`, pid);
  sv.forEach((r) => {
    const c = cust(r.phone_hash);
    c.surveys++; c.lastSurveyAt = r.submitted_at; if (r.intent) { c.intent = r.intent; c.subscr = r.subscr || ''; }
    if (r.name && !c.name) c.name = r.name;
    if (r.phone_enc) c.phoneEnc = r.phone_enc;
  });
  const gb = await all(env, `SELECT phone_hash, phone, name, visit_date, companions FROM guestbook WHERE project_id = ? AND phone_hash <> '' ORDER BY visit_date, created_at`, pid);
  gb.forEach((g) => {
    const c = cust(g.phone_hash);
    c.visits++; c.lastVisit = g.visit_date; c.people += 1 + g.companions;
    if (g.name) c.name = g.name; // 방문 때 직접 쓴 이름이 더 정확하다
    c.phone = g.phone;
  });

  const manual = {};
  (await all(env, 'SELECT phone_hash, grade, memo FROM customer_grades WHERE project_id = ?', pid)).forEach((g) => { manual[g.phone_hash] = g; });
  let rows = Object.values(map);
  rows.forEach((c) => { const m = manual[c.hash]; Object.assign(c, classify(c, m ? m.grade : ''), { memo: m ? m.memo : '' }); });
  for (const c of rows) {
    if (!c.phone && c.phoneEnc) c.phone = await decryptText(env, c.phoneEnc);
  }
  const total = rows.length;
  const both = rows.filter((c) => c.surveys && c.visits).length;
  // 퍼널: 설문에서 의향이 높은(4~5) 고객 중 실제로 방문한 고객
  const high = rows.filter((c) => Number(c.intent) >= 4);
  const funnel = {
    surveyCustomers: rows.filter((c) => c.surveys).length, visitCustomers: rows.filter((c) => c.visits).length, both,
    highIntent: high.length, highIntentVisited: high.filter((c) => c.visits).length,
    grades: Object.fromEntries(GRADES.map((g) => [g, rows.filter((c) => c.grade === g).length]))
  };

  if (q) rows = rows.filter((c) => (c.name || '').toLowerCase().includes(q) || (qd.length >= 3 && c.phone.includes(qd)));
  const stage = s(data.stage);
  if (stage === '설문+방문') rows = rows.filter((c) => c.surveys && c.visits);
  else if (stage === '설문만') rows = rows.filter((c) => c.surveys && !c.visits);
  else if (stage === '방문만') rows = rows.filter((c) => !c.surveys && c.visits);
  else if (stage && stage !== '전체') throw new AppError('구분 값이 올바르지 않습니다.');
  const gradeQ = s(data.grade);
  if (gradeQ) { if (!GRADES.includes(gradeQ)) throw new AppError('등급 값이 올바르지 않습니다.'); rows = rows.filter((c) => c.grade === gradeQ); }
  rows.sort((a, b) => (b.lastVisit || b.lastSurveyAt.slice(0, 10)).localeCompare(a.lastVisit || a.lastSurveyAt.slice(0, 10)));
  return {
    funnel, total, shown: Math.min(rows.length, 500),
    customers: rows.slice(0, 500).map((c) => ({
      id: c.hash.slice(0, 12), name: c.name, phone: maskPhone(c.phone), surveys: c.surveys, lastSurveyAt: c.lastSurveyAt, intent: c.intent,
      visits: c.visits, lastVisit: c.lastVisit, people: c.people, grade: c.grade, gradeSource: c.source, memo: c.memo, stage: c.surveys && c.visits ? '설문+방문' : c.surveys ? '설문만' : '방문만'
    }))
  };
}

// 등급 직접 입력(TM 상담 결과 등). grade 가 비어 있으면 수동 지정을 지우고 자동 분류로 돌아간다.
// id 는 고객 목록의 id(해시 앞 12자). 이 현장의 설문·방명록에 있는 고객만 지정할 수 있다.
export async function customerGradeSave(env, data, ctx) {
  const pid = ctx.projectId;
  const id = s(data.id).trim();
  const grade = s(data.grade).trim().toUpperCase();
  if (!/^[0-9a-f]{12}$/.test(id)) throw new AppError('고객 정보가 올바르지 않습니다.');
  if (grade && !GRADES.includes(grade)) throw new AppError('등급은 A, B, C, D 중에서 골라 주세요.');
  const memo = s(data.memo).trim().slice(0, 200);
  const hit = await first(env,
    `SELECT phone_hash FROM responses WHERE project_id = ? AND phone_hash LIKE ? || '%'
     UNION SELECT phone_hash FROM guestbook WHERE project_id = ? AND phone_hash LIKE ? || '%' LIMIT 1`, pid, id, pid, id);
  if (!hit) throw new AppError('이 현장에서 고객을 찾을 수 없습니다.');
  if (!grade) await run(env, 'DELETE FROM customer_grades WHERE project_id = ? AND phone_hash = ?', pid, hit.phone_hash);
  else {
    await run(env,
      `INSERT INTO customer_grades (project_id, phone_hash, grade, memo, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, phone_hash) DO UPDATE SET grade = excluded.grade, memo = excluded.memo, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      pid, hit.phone_hash, grade, memo, nowStr(), ctx.account.login_id);
  }
  await writeLog(env, ctx.account.login_id, '고객등급', id, grade || '수동 해제', pid);
  return { ok: true };
}
