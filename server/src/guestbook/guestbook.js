// 방명록: 고객이 태블릿으로 입력(guest.submit)하고, 데스크가 보고 고쳐서 담당 본부/팀/직원을 지정한 뒤 호출한다.
//  - 담당 본부/팀이 없으면 '워킹', 고객이 입력해 아직 데스크가 확인하지 않은 건은 '확인 필요'
//  - 통계: 방문팀수 = 건수, 방문객수 = 건마다 (1 + companions) 의 합
//  - 방명록·데스크 계정은 현장 1개에 고정되어 있어 ctx.projectId 가 그 현장이다.
import { AppError, s, all, first, run, todayStr, nowStr, newId, orgNameMap, writeLog } from '../core/util.js';
import { sendCallMessage, hhmm } from '../telegram/telegram.js';
import { formatPhone, visitStatus } from '../visit/visit.js';
import { computeMatches } from '../visit/matching.js';

function cleanName(v) {
  const n = s(v).trim();
  if (!n || n.length > 20) throw new AppError('성명을 입력해 주세요. (20자 이내)');
  return n;
}

function cleanPhone(v) {
  const d = s(v).replace(/\D/g, '');
  if (!/^0\d{8,10}$/.test(d)) throw new AppError('전화번호를 확인해 주세요.');
  return d;
}

function cleanGender(v, required) {
  const g = s(v).trim();
  if (g !== '남' && g !== '여' && (g !== '' || required)) throw new AppError('성별을 선택해 주세요.');
  return g;
}

// 동반인 수 (본인 제외). 0 이면 단독
function cleanCompanions(v) {
  const n = Number(v === undefined || v === '' ? 0 : v);
  if (!Number.isInteger(n) || n < 0 || n > 30) throw new AppError('동반인 수는 0~30 사이 숫자로 입력해 주세요.');
  return n;
}

// ---------- 고객 태블릿 ----------

export async function guestSubmit(env, data, ctx) {
  const pid = ctx.projectId;
  const name = cleanName(data.name);
  const phone = cleanPhone(data.phone);
  const companions = cleanCompanions(data.companions);
  if (data.consent !== true) throw new AppError('개인정보 제공에 동의해 주세요.');

  // 같은 사람이 제출 버튼을 두 번 눌러도 한 건만 남긴다
  const dup = await first(env,
    `SELECT id FROM guestbook WHERE project_id = ? AND phone = ? AND name = ? AND source = '고객' AND created_at >= ?`,
    pid, phone, name, new Date(Date.now() + 9 * 3600e3 - 3 * 60e3).toISOString().slice(0, 19).replace('T', ' '));
  if (dup) return {};

  const now = nowStr();
  const id = newId('G');
  await run(env,
    `INSERT INTO guestbook (id, project_id, created_at, visit_date, name, phone, last5, gender, companions, consent, consent_at, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, '고객')`,
    id, pid, now, todayStr(), name, phone, phone.slice(-5), '', companions, now); // 성별은 고객이 아니라 데스크 안내직원이 입력한다

  // 예약이나 방문이력이 있으면 담당 본부/팀/담당자를 미리 채워 둔다. 상태는 '확인 필요' 그대로라 데스크가 확인·수정한다.
  // 이 단계가 실패해도 고객의 제출은 성공으로 처리한다.
  try {
    const m = (await computeMatches(env, pid, [{ key: 'k', phone, last5: phone.slice(-5), gender: '', createdAt: now, excludeId: id }], todayStr())).k;
    if (m.suggest) {
      await run(env, 'UPDATE guestbook SET head_id = ?, team_id = ?, staff_id = ?, auto_source = ?, reservation_id = ? WHERE id = ? AND project_id = ?',
        m.suggest.headId, m.suggest.teamId, m.suggest.staffId, m.suggest.source, m.suggest.source === '예약' ? m.reservation.id : '', id, pid);
    }
  } catch (e) {
    console.error('guest auto-assign', e && e.stack ? e.stack : String(e));
  }
  return {};
}

// ---------- 데스크 ----------

function category(g) {
  if (!g.reviewed) return '확인 필요';
  return g.head_id ? '분양' : '워킹';
}

export async function deskGuestList(env, data, ctx) {
  const pid = ctx.projectId;
  const date = s(data.date) || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('날짜 형식이 올바르지 않습니다.');
  const names = await orgNameMap(env, pid);
  const rows = await all(env,
    `SELECT g.*, s.name AS s_name, s.nickname AS s_nick, s.status AS s_status, s.project_id AS s_project, s.id AS s_id,
            v.called_at AS v_called, v.acked_at AS v_acked, v.staff_id AS v_staff
     FROM guestbook g LEFT JOIN staff s ON s.id = g.staff_id LEFT JOIN visits v ON v.id = g.visit_id
     WHERE g.project_id = ? AND g.visit_date = ? ORDER BY g.created_at DESC LIMIT 1000`, pid, date);
  // 예약 있음 / 방문이력 있음 / 추천 담당자 (목록 전체를 한 번에 계산)
  const matches = await computeMatches(env, pid, rows.map((g) => ({ key: g.id, phone: g.phone, last5: g.last5, gender: g.gender, createdAt: g.created_at, excludeId: g.id })), date);
  return {
    date,
    guests: rows.map((g) => {
      const m = matches[g.id];
      // 지정된 담당자에게 이미 호출했는지 (담당자를 바꿨다면 새로 호출해야 한다)
      const calledForCurrent = g.visit_id && g.v_staff === g.staff_id;
      return {
        id: g.id, time: hhmm(g.created_at), name: g.name, phone: formatPhone(g.phone), gender: g.gender,
        companions: g.companions, party: g.companions > 0 ? '동반 ' + g.companions + '명' : '단독',
        category: category(g), source: g.source, consent: !!g.consent, reviewed: !!g.reviewed,
        headId: g.head_id, teamId: g.team_id, headName: names[g.head_id] || '', teamName: names[g.team_id] || '',
        staffId: g.staff_id, staffNone: !!g.staff_none, staffName: g.s_id ? g.s_name + (g.s_nick ? ' (' + g.s_nick + ')' : '') : '',
        canCall: !!g.s_id && g.s_status === '활동' && g.s_project === pid, // 다른 현장으로 이동한 직원은 호출할 수 없다
        reservation: m.reservation && { date: m.reservation.date, status: m.reservation.status, count: m.reservation.count, staffName: m.reservation.staffName },
        history: m.history,
        suggest: m.suggest,
        autoSource: g.reviewed ? '' : g.auto_source,
        callStatus: calledForCurrent ? visitStatus({ called_at: g.v_called, acked_at: g.v_acked }, true) : ''
      };
    })
  };
}

// 본부/팀을 고른 뒤 담당자 선택 목록. 팀을 고르면 그 팀 직원과 본부장, 본부만 고르면 본부 전체
export async function deskStaffByOrg(env, data, ctx) {
  const pid = ctx.projectId;
  const headId = s(data.headId), teamId = s(data.teamId);
  if (!headId) return { staff: [] };
  const rows = teamId
    ? await all(env, `SELECT * FROM staff WHERE project_id = ? AND status = '활동' AND (team_id = ? OR (grade = '본부장' AND head_id = ?)) ORDER BY grade DESC, name`, pid, teamId, headId)
    : await all(env, `SELECT * FROM staff WHERE project_id = ? AND status = '활동' AND head_id = ? ORDER BY grade DESC, name`, pid, headId);
  return { staff: rows.map((r) => ({ id: r.id, name: r.name, nickname: r.nickname, grade: r.grade, job: r.job, telegramLinked: !!r.telegram_id })) };
}

async function resolveAssignment(env, pid, data) {
  const headId = s(data.headId), teamId = s(data.teamId);
  if (!headId) {
    if (teamId) throw new AppError('본부를 먼저 선택해 주세요.');
    return { headId: '', teamId: '', staffId: '', staffNone: 0 }; // 본부/팀이 없으면 워킹
  }
  if (!(await first(env, `SELECT 1 FROM orgs WHERE id = ? AND project_id = ? AND kind = '본부' AND active = 1`, headId, pid))) throw new AppError('본부를 확인해 주세요.');
  if (teamId && !(await first(env, `SELECT 1 FROM orgs WHERE id = ? AND project_id = ? AND kind = '팀' AND parent_id = ? AND active = 1`, teamId, pid, headId))) {
    throw new AppError('팀을 확인해 주세요.');
  }
  if (data.staffNone === true) return { headId, teamId, staffId: '', staffNone: 1 };
  const staffId = s(data.staffId);
  if (!staffId) throw new AppError('담당자를 선택하거나 "없음"을 선택해 주세요.');
  const st = await first(env, `SELECT id, head_id, team_id, grade FROM staff WHERE id = ? AND project_id = ? AND status = '활동'`, staffId, pid);
  const fits = st && (teamId ? st.team_id === teamId || (st.grade === '본부장' && st.head_id === headId) : st.head_id === headId);
  if (!fits) throw new AppError('선택한 본부/팀의 담당자가 아닙니다.');
  return { headId, teamId, staffId, staffNone: 0 };
}

// 데스크가 새로 입력하거나(id 없음) 고객 입력분을 고친다(id 있음). 저장하면 '확인함' 처리된다.
export async function deskGuestSave(env, data, ctx) {
  const pid = ctx.projectId;
  const id = s(data.id);
  const existing = id ? await first(env, 'SELECT * FROM guestbook WHERE id = ? AND project_id = ?', id, pid) : null;
  if (id && !existing) throw new AppError('방명록 기록을 찾을 수 없습니다.');
  const name = cleanName(data.name);
  const phone = cleanPhone(data.phone);
  const gender = cleanGender(data.gender, false);
  const companions = cleanCompanions(data.companions);
  const a = await resolveAssignment(env, pid, data);
  const consent = data.consent === true ? 1 : 0;
  const now = nowStr();
  const who = ctx.account.login_id;

  if (existing) {
    const consentAt = consent ? (existing.consent ? existing.consent_at : now) : '';
    await run(env,
      `UPDATE guestbook SET name = ?, phone = ?, last5 = ?, gender = ?, companions = ?, head_id = ?, team_id = ?, staff_id = ?, staff_none = ?,
         consent = ?, consent_at = ?, reviewed = 1, auto_source = '', updated_at = ?, updated_by = ? WHERE id = ? AND project_id = ?`,
      name, phone, phone.slice(-5), gender, companions, a.headId, a.teamId, a.staffId, a.staffNone, consent, consentAt, now, who, id, pid);
    await writeLog(env, who, '방명록수정', id, name, pid);
    return { id };
  }
  const newGuest = newId('G');
  await run(env,
    `INSERT INTO guestbook (id, project_id, created_at, visit_date, name, phone, last5, gender, companions, head_id, team_id, staff_id, staff_none,
       consent, consent_at, source, reviewed, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '데스크', 1, ?, ?)`,
    newGuest, pid, now, todayStr(), name, phone, phone.slice(-5), gender, companions, a.headId, a.teamId, a.staffId, a.staffNone,
    consent, consent ? now : '', now, who);
  await writeLog(env, who, '방명록등록', newGuest, name, pid);
  return { id: newGuest };
}

export async function deskGuestDelete(env, data, ctx) {
  const g = await first(env, 'SELECT * FROM guestbook WHERE id = ? AND project_id = ?', s(data.id), ctx.projectId);
  if (!g) throw new AppError('방명록 기록을 찾을 수 없습니다.');
  await run(env, 'DELETE FROM guestbook WHERE id = ? AND project_id = ?', g.id, ctx.projectId);
  await writeLog(env, ctx.account.login_id, '방명록삭제', g.id, g.name, ctx.projectId);
  return {};
}

// 방명록 옆 [호출]: 처음 호출이면 방문 기록을 만들고 담당 팀장·본부장에게도 알린다. 이미 호출한 건은 재호출.
export async function deskGuestCall(env, data, ctx) {
  const pid = ctx.projectId;
  const g = await first(env, 'SELECT * FROM guestbook WHERE id = ? AND project_id = ?', s(data.id), pid);
  if (!g) throw new AppError('방명록 기록을 찾을 수 없습니다.');
  if (!g.staff_id) throw new AppError('담당자가 지정되지 않았습니다. [수정]에서 담당자를 선택해 주세요.');
  const staff = await first(env, 'SELECT * FROM staff WHERE id = ? AND project_id = ?', g.staff_id, pid);
  if (!staff || staff.status !== '활동') throw new AppError('담당 직원이 활동 중이 아닙니다. 담당자를 다시 선택해 주세요.');

  const visit = g.visit_id ? await first(env, 'SELECT * FROM visits WHERE id = ? AND project_id = ?', g.visit_id, pid) : null;
  if (visit && visit.staff_id === staff.id) {
    if (visit.acked_at) throw new AppError('이미 확인된 호출입니다.');
    const ok = await sendCallMessage(env, staff, visit.id, g.last5);
    if (ok) await run(env, 'UPDATE visits SET called_at = ? WHERE id = ? AND project_id = ?', nowStr(), visit.id, pid);
    return callResult(staff, visit.id, ok);
  }

  // 오늘 예약이 있고 그 담당자를 호출하는 거라면 그 예약을 '방문'으로 처리한다 (다른 담당자를 부르면 예약은 그대로 둔다)
  let reservationId = '';
  if (g.visit_date === todayStr()) {
    const m = (await computeMatches(env, pid, [{ key: 'k', phone: g.phone, last5: g.last5, gender: g.gender, createdAt: g.created_at, excludeId: g.id }], g.visit_date)).k;
    const r = m.reservation;
    if (r && r.staffId === staff.id && r.date === g.visit_date && r.status === '예정') {
      const claim = await run(env, `UPDATE reservations SET status = '방문' WHERE id = ? AND project_id = ? AND status = '예정'`, r.id, pid);
      if (claim.meta.changes > 0) reservationId = r.id;
    }
  }

  const visitId = newId('V');
  const now = nowStr();
  await run(env,
    `INSERT INTO visits (id, project_id, visited_at, last5, gender, reservation_id, staff_id, kind, desk_account_id) VALUES (?, ?, ?, ?, ?, ?, ?, '방명록', ?)`,
    visitId, pid, now, g.last5, g.gender, reservationId, staff.id, ctx.account.id);
  await run(env, 'UPDATE guestbook SET visit_id = ?, reservation_id = ? WHERE id = ? AND project_id = ?', visitId, reservationId || g.reservation_id, g.id, pid);
  const ok = await sendCallMessage(env, staff, visitId, g.last5, true);
  if (ok) await run(env, 'UPDATE visits SET called_at = ? WHERE id = ? AND project_id = ?', now, visitId, pid);
  return callResult(staff, visitId, ok);
}

function callResult(staff, visitId, called) {
  return {
    visitId, kind: '방명록', called, staffName: staff.name,
    phone: called ? '' : formatPhone(staff.phone), notLinked: !staff.telegram_id
  };
}

// 방명록 입력 창에서 전화번호를 넣으면 예약·방문이력·추천 담당자를 바로 보여 준다
export async function deskGuestSuggest(env, data, ctx) {
  const digits = s(data.phone).replace(/\D/g, '');
  if (digits.length < 5) return { reservation: null, history: null, suggest: null };
  const m = (await computeMatches(env, ctx.projectId, [{ key: 'k', phone: digits, last5: digits.slice(-5), gender: cleanGender(data.gender, false), excludeId: s(data.id) }], todayStr())).k;
  return { reservation: m.reservation, history: m.history, suggest: m.suggest };
}
