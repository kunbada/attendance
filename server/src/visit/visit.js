// 방문 접수·호출·현황 (안내데스크용) + 관리자 예약·방문 현황. 모두 ctx.projectId 현장 안에서만 다룬다.
import { AppError, s, all, first, run, todayStr, nowStr, newId, parseKst, orgNameMap, staffBrief } from '../core/util.js';
import { requireLast5, normGender, effectiveStatus } from './reservation.js';
import { sendCallMessage, hhmm } from '../telegram/telegram.js';

const UNCONFIRMED_MIN = 3; // 호출 후 이 시간이 지나도 확인이 없으면 화면에서 빨간색

export function formatPhone(d) {
  d = s(d);
  return d.length === 11 ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7) : d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
}

// 데스크 화면에 보여줄 직원 요약. 데스크는 직원에게 직접 연락할 수 있도록 휴대폰 번호를 항상 본다.
function deskStaffView(r, names) {
  return {
    id: r.id, name: r.name, nickname: r.nickname, job: r.job, grade: r.grade,
    headName: names[r.head_id] || '', teamName: names[r.team_id] || '',
    telegramLinked: !!r.telegram_id, phone: formatPhone(r.phone)
  };
}

// 다른 현장으로 이동한 직원: 이름만 보여 준다
const movedStaffView = (r) => ({ id: r.id, name: r.name + ' (타 현장 이전)', nickname: '', job: '', grade: '', headName: '', teamName: '', telegramLinked: false, phone: '', moved: true });

export async function deskLookup(env, data, ctx) {
  const pid = ctx.projectId;
  const last5 = requireLast5(data.last5);
  const gender = normGender(data.gender);
  const names = await orgNameMap(env, pid);
  const rows = await all(env,
    `SELECT id, gender, status, staff_id FROM reservations WHERE project_id = ? AND last5 = ? AND visit_date = ? AND status IN ('예정', '방문')`, pid, last5, todayStr());
  const out = [];
  for (const r of rows) {
    if (gender && r.gender && r.gender !== gender) continue;
    const st = await first(env, 'SELECT * FROM staff WHERE id = ? AND project_id = ?', r.staff_id, pid);
    out.push({
      id: r.id, last5, gender: r.gender, status: r.status,
      staff: st ? deskStaffView(st, names) : null, staffActive: !!st && st.status === '활동'
    });
  }
  return { reservations: out };
}

// 직원 검색: 이름·예명·전화번호 일부·본부/팀 이름. 검색어가 비어 있으면 전체 목록 (본부 → 팀 → 이름 순)
export async function deskSearchStaff(env, data, ctx) {
  const pid = ctx.projectId;
  const q = s(data.q).trim().toLowerCase().replace(/[^0-9a-z가-힣 ]/g, '');
  if (!q) return { staff: [] }; // 검색어 없이는 아무도 보여 주지 않는다 (전체 명단 노출·속도 문제 방지)
  const names = await orgNameMap(env, pid);
  const conds = [`s.project_id = ?`, `s.status = '활동'`];
  const params = [pid];
  if (q) {
    const like = '%' + q + '%';
    const digits = q.replace(/[^0-9]/g, '');
    let c = 'lower(s.name) LIKE ? OR lower(s.nickname) LIKE ? OR lower(h.name) LIKE ? OR lower(t.name) LIKE ?';
    params.push(like, like, like, like);
    if (digits.length >= 2) { c += ' OR s.phone LIKE ?'; params.push('%' + digits + '%'); }
    conds.push('(' + c + ')');
  }
  const rows = await all(env,
    `SELECT s.* FROM staff s LEFT JOIN orgs h ON h.id = s.head_id LEFT JOIN orgs t ON t.id = s.team_id
     WHERE ${conds.join(' AND ')}
     ORDER BY COALESCE(h.sort_order, 9999), h.name, COALESCE(t.sort_order, 9999), t.name, s.name LIMIT 500`, ...params);
  return { staff: rows.map((r) => deskStaffView(r, names)) };
}

// 날짜별 예약명단 (본부 → 팀 → 직원 순). 오늘의 '예정' 건은 바로 호출할 수 있다.
export async function deskReservationList(env, data, ctx) {
  const pid = ctx.projectId;
  const date = s(data.date) || todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('날짜 형식이 올바르지 않습니다.');
  const names = await orgNameMap(env, pid);
  const rows = await all(env,
    `SELECT r.id AS rid, r.last5, r.gender, r.visit_date, r.status AS rstatus, r.memo, s.*
     FROM reservations r LEFT JOIN staff s ON s.id = r.staff_id
       LEFT JOIN orgs h ON h.id = s.head_id LEFT JOIN orgs t ON t.id = s.team_id
     WHERE r.project_id = ? AND r.visit_date = ?
     ORDER BY COALESCE(h.sort_order, 9999), h.name, COALESCE(t.sort_order, 9999), t.name, s.name, r.created_at LIMIT 1000`, pid, date);
  return {
    date,
    reservations: rows.map((r) => {
      const status = effectiveStatus({ status: r.rstatus, visit_date: r.visit_date });
      // 담당 직원이 다른 현장으로 이동했으면 이름만 남기고 전화번호·호출은 숨긴다 (지난 기록 확인용)
      const here = !!r.id && r.project_id === pid;
      return {
        id: r.rid, last5: r.last5, gender: r.gender, memo: r.memo, status,
        staff: here ? deskStaffView(r, names) : r.id ? movedStaffView(r) : null,
        callable: here && status === '예정' && date === todayStr() && r.status === '활동'
      };
    })
  };
}

export async function deskRegisterVisit(env, data, ctx) {
  const pid = ctx.projectId;
  const kind = s(data.kind);
  // 직원을 지명해 부를 때는 고객 번호 없이도 호출할 수 있다 (번호를 입력했다면 형식은 확인)
  let last5 = kind === '지명' && !s(data.last5).trim() ? '' : requireLast5(data.last5);
  let gender = normGender(data.gender);
  let staff = null;
  let reservation = null;

  if (kind === '예약') {
    reservation = await first(env, 'SELECT * FROM reservations WHERE id = ? AND project_id = ?', s(data.reservationId), pid);
    if (!reservation || reservation.visit_date !== todayStr()) throw new AppError('오늘 예약을 찾을 수 없습니다.');
    if (reservation.status !== '예정') throw new AppError('이미 방문 처리된 예약입니다. 다시 부르려면 아래 방문 목록의 [재호출]을 누르세요.');
    staff = await first(env, 'SELECT * FROM staff WHERE id = ? AND project_id = ?', reservation.staff_id, pid);
    last5 = reservation.last5;
    gender = reservation.gender;
  } else if (kind === '지명') {
    staff = await first(env, 'SELECT * FROM staff WHERE id = ? AND project_id = ?', s(data.staffId), pid);
  } else if (kind !== '담당없음') {
    throw new AppError('방문 구분이 올바르지 않습니다.');
  }
  if (kind !== '담당없음' && (!staff || staff.status !== '활동')) {
    throw new AppError('담당 직원이 활동 중이 아닙니다. [담당 없음으로 기록]을 사용해 주세요.');
  }

  // 예약을 '방문'으로 먼저 확정한다 (두 데스크가 동시에 눌러도 한 번만 호출되도록)
  if (reservation) {
    const claim = await run(env, `UPDATE reservations SET status = '방문' WHERE id = ? AND project_id = ? AND status = '예정'`, reservation.id, pid);
    if (claim.meta.changes === 0) throw new AppError('이미 방문 처리된 예약입니다. 다시 부르려면 아래 방문 목록의 [재호출]을 누르세요.');
  }
  const visitId = newId('V');
  const now = nowStr();
  await run(env,
    `INSERT INTO visits (id, project_id, visited_at, last5, gender, reservation_id, staff_id, kind, desk_account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    visitId, pid, now, last5, gender, reservation ? reservation.id : '', staff ? staff.id : '', kind, ctx.account.id);

  const called = staff ? await sendCallMessage(env, staff, visitId, last5, true) : false;
  if (called) await run(env, 'UPDATE visits SET called_at = ? WHERE id = ? AND project_id = ?', now, visitId, pid);

  return {
    visitId, kind, called,
    staffName: staff ? staff.name : '',
    // 연결 안 됐거나 발송 실패 → 데스크가 직접 연락할 수 있게 번호를 돌려준다
    phone: staff && !called ? formatPhone(staff.phone) : '',
    notLinked: !!staff && !staff.telegram_id
  };
}

export async function deskRecall(env, data, ctx) {
  const pid = ctx.projectId;
  const visit = await first(env, 'SELECT * FROM visits WHERE id = ? AND project_id = ?', s(data.visitId), pid);
  if (!visit) throw new AppError('방문 기록을 찾을 수 없습니다.');
  const staff = visit.staff_id ? await first(env, 'SELECT * FROM staff WHERE id = ? AND project_id = ?', visit.staff_id, pid) : null;
  if (!staff) throw new AppError('담당 직원이 없는 방문입니다.');
  if (visit.acked_at) throw new AppError('이미 확인된 호출입니다.');
  if (!staff.telegram_id) throw new AppError('텔레그램이 연결되지 않은 직원입니다. 전화로 연락해 주세요: ' + formatPhone(staff.phone));
  if (!(await sendCallMessage(env, staff, visit.id, visit.last5))) {
    throw new AppError('호출을 보내지 못했습니다. 전화로 연락해 주세요: ' + formatPhone(staff.phone));
  }
  await run(env, 'UPDATE visits SET called_at = ? WHERE id = ? AND project_id = ?', nowStr(), visit.id, pid);
  return {};
}

export function visitStatus(v, staff) {
  if (!staff) return '담당없음';
  if (v.acked_at) return '확인함';
  if (!v.called_at) return '미호출';
  return (Date.now() - parseKst(v.called_at).getTime()) / 60000 >= UNCONFIRMED_MIN ? '미확인' : '호출함';
}

export async function deskTodayVisits(env, data, ctx) {
  const today = todayStr();
  const rows = await all(env,
    `SELECT v.*, s.name AS s_name, s.nickname AS s_nick, s.phone AS s_phone, s.id AS s_id
     FROM visits v LEFT JOIN staff s ON s.id = v.staff_id
     WHERE v.project_id = ? AND v.visited_at >= ? AND v.visited_at <= ? ORDER BY v.visited_at DESC`, ctx.projectId, today + ' 00:00:00', today + ' 23:59:59');
  return {
    visits: rows.map((v) => {
      const status = visitStatus(v, v.s_id);
      return {
        id: v.id, time: hhmm(v.visited_at), last5: v.last5, gender: v.gender, kind: v.kind,
        staffName: v.s_id ? v.s_name + (v.s_nick ? ' (' + v.s_nick + ')' : '') : '',
        status, ackedAt: hhmm(v.acked_at), phone: v.s_id && status === '미호출' ? formatPhone(v.s_phone) : ''
      };
    }),
    now: nowStr()
  };
}

// ---------- 관리자: 예약·방문 현황 ----------

function matchOrg(staff, data) {
  if (s(data.staffId) && (!staff || staff.id !== data.staffId)) return false;
  if (s(data.headId) && (!staff || staff.head_id !== data.headId)) return false;
  if (s(data.teamId) && (!staff || staff.team_id !== data.teamId)) return false;
  return true;
}

const rangeFrom = (data) => (s(data.from) || '0000-00-00');
const rangeTo = (data) => (s(data.to) || '9999-12-31');

// 이 현장 직원 + (다른 현장으로 이동한 직원은 이름만) — 지난 예약·방문 기록의 담당자 표시용
async function staffMap(env, pid, ids) {
  const byId = {};
  (await all(env, 'SELECT * FROM staff WHERE project_id = ?', pid)).forEach((r) => { byId[r.id] = r; });
  const missing = [...new Set(ids)].filter((id) => id && !byId[id]);
  for (let i = 0; i < missing.length; i += 80) {
    const part = missing.slice(i, i + 80);
    (await all(env, `SELECT id, name FROM staff WHERE id IN (${part.map(() => '?').join(',')})`, ...part)).forEach((r) => {
      byId[r.id] = { id: r.id, name: r.name + ' (타 현장 이전)', nickname: '', job: '', head_id: '', team_id: '' };
    });
  }
  return byId;
}

export async function adminReservations(env, data, ctx) {
  const pid = ctx.projectId;
  const names = await orgNameMap(env, pid);
  const found = await all(env, 'SELECT * FROM reservations WHERE project_id = ? AND visit_date >= ? AND visit_date <= ? ORDER BY visit_date DESC', pid, rangeFrom(data), rangeTo(data));
  const staffById = await staffMap(env, pid, found.map((r) => r.staff_id));
  const rows = found
    .filter((r) => matchOrg(staffById[r.staff_id], data)).slice(0, 3000)
    .map((r) => ({
      date: r.visit_date, last5: r.last5, gender: r.gender, staff: staffById[r.staff_id] ? staffBrief(staffById[r.staff_id], names) : null,
      memo: r.memo, status: effectiveStatus(r), createdAt: r.created_at
    }));
  return { reservations: rows };
}

export async function adminVisits(env, data, ctx) {
  const pid = ctx.projectId;
  const names = await orgNameMap(env, pid);
  const filtering = !!(s(data.staffId) || s(data.headId) || s(data.teamId));
  const found = await all(env, 'SELECT * FROM visits WHERE project_id = ? AND visited_at >= ? AND visited_at <= ? ORDER BY visited_at DESC',
    pid, rangeFrom(data) + ' 00:00:00', rangeTo(data) + ' 23:59:59');
  const staffById = await staffMap(env, pid, found.map((v) => v.staff_id));
  const rows = found
    .filter((v) => {
      const st = staffById[v.staff_id];
      return st ? matchOrg(st, data) : !filtering;
    }).slice(0, 3000)
    .map((v) => ({
      at: v.visited_at, last5: v.last5, gender: v.gender, kind: v.kind,
      staff: staffById[v.staff_id] ? staffBrief(staffById[v.staff_id], names) : null, calledAt: v.called_at, ackedAt: v.acked_at
    }));
  return { visits: rows };
}
