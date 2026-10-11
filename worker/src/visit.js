// 방문 접수·호출·현황 (안내데스크용) + 관리자 예약·방문 현황
import { AppError, s, all, first, run, todayStr, nowStr, newId, parseKst, orgNameMap, staffBrief } from './util.js';
import { requireLast5, normGender, effectiveStatus } from './reservation.js';
import { sendCallMessage, hhmm } from './telegram.js';

const UNCONFIRMED_MIN = 3; // 호출 후 이 시간이 지나도 확인이 없으면 화면에서 빨간색

function formatPhone(d) {
  d = s(d);
  return d.length === 11 ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7) : d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
}

// 데스크 화면에 보여줄 직원 요약. 텔레그램 미연결이면 직접 연락하도록 휴대폰 번호를 함께 준다.
function deskStaffView(r, names) {
  const linked = !!r.telegram_id;
  return {
    id: r.id, name: r.name, nickname: r.nickname, job: r.job,
    headName: names[r.head_id] || '', teamName: names[r.team_id] || '',
    telegramLinked: linked, phone: linked ? '' : formatPhone(r.phone)
  };
}

export async function deskLookup(env, data) {
  const last5 = requireLast5(data.last5);
  const gender = normGender(data.gender);
  const names = await orgNameMap(env);
  const rows = await all(env,
    `SELECT id, gender, status, staff_id FROM reservations WHERE last5 = ? AND visit_date = ? AND status IN ('예정', '방문')`, last5, todayStr());
  const out = [];
  for (const r of rows) {
    if (gender && r.gender && r.gender !== gender) continue;
    const st = await first(env, 'SELECT * FROM staff WHERE id = ?', r.staff_id);
    out.push({
      id: r.id, last5, gender: r.gender, status: r.status,
      staff: st ? deskStaffView(st, names) : null, staffActive: !!st && st.status === '활동'
    });
  }
  return { reservations: out };
}

export async function deskSearchStaff(env, data) {
  const q = s(data.q).trim().toLowerCase();
  if (!q) return { staff: [] };
  const names = await orgNameMap(env);
  const like = '%' + q.replace(/[%_\\]/g, '\\$&') + '%';
  const rows = await all(env,
    `SELECT * FROM staff WHERE status = '활동' AND (lower(name) LIKE ? ESCAPE '\\' OR lower(nickname) LIKE ? ESCAPE '\\') LIMIT 20`, like, like);
  return { staff: rows.map((r) => deskStaffView(r, names)) };
}

export async function deskRegisterVisit(env, data, ctx) {
  let last5 = requireLast5(data.last5);
  let gender = normGender(data.gender);
  const kind = s(data.kind);
  let staff = null;
  let reservation = null;

  if (kind === '예약') {
    reservation = await first(env, 'SELECT * FROM reservations WHERE id = ?', s(data.reservationId));
    if (!reservation || reservation.visit_date !== todayStr()) throw new AppError('오늘 예약을 찾을 수 없습니다.');
    if (reservation.status !== '예정') throw new AppError('이미 방문 처리된 예약입니다. 다시 부르려면 아래 방문 목록의 [재호출]을 누르세요.');
    staff = await first(env, 'SELECT * FROM staff WHERE id = ?', reservation.staff_id);
    last5 = reservation.last5;
    gender = reservation.gender;
  } else if (kind === '지명') {
    staff = await first(env, 'SELECT * FROM staff WHERE id = ?', s(data.staffId));
  } else if (kind !== '담당없음') {
    throw new AppError('방문 구분이 올바르지 않습니다.');
  }
  if (kind !== '담당없음' && (!staff || staff.status !== '활동')) {
    throw new AppError('담당 직원이 활동 중이 아닙니다. [담당 없음으로 기록]을 사용해 주세요.');
  }

  // 예약을 '방문'으로 먼저 확정한다 (두 데스크가 동시에 눌러도 한 번만 호출되도록)
  if (reservation) {
    const claim = await run(env, `UPDATE reservations SET status = '방문' WHERE id = ? AND status = '예정'`, reservation.id);
    if (claim.meta.changes === 0) throw new AppError('이미 방문 처리된 예약입니다. 다시 부르려면 아래 방문 목록의 [재호출]을 누르세요.');
  }
  const visitId = newId('V');
  const now = nowStr();
  await run(env,
    `INSERT INTO visits (id, visited_at, last5, gender, reservation_id, staff_id, kind, desk_account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    visitId, now, last5, gender, reservation ? reservation.id : '', staff ? staff.id : '', kind, ctx.account.id);

  const called = staff ? await sendCallMessage(env, staff, visitId, last5, gender) : false;
  if (called) await run(env, 'UPDATE visits SET called_at = ? WHERE id = ?', now, visitId);

  return {
    visitId, kind, called,
    staffName: staff ? staff.name : '',
    // 연결 안 됐거나 발송 실패 → 데스크가 직접 연락할 수 있게 번호를 돌려준다
    phone: staff && !called ? formatPhone(staff.phone) : '',
    notLinked: !!staff && !staff.telegram_id
  };
}

export async function deskRecall(env, data) {
  const visit = await first(env, 'SELECT * FROM visits WHERE id = ?', s(data.visitId));
  if (!visit) throw new AppError('방문 기록을 찾을 수 없습니다.');
  const staff = visit.staff_id ? await first(env, 'SELECT * FROM staff WHERE id = ?', visit.staff_id) : null;
  if (!staff) throw new AppError('담당 직원이 없는 방문입니다.');
  if (visit.acked_at) throw new AppError('이미 확인된 호출입니다.');
  if (!staff.telegram_id) throw new AppError('텔레그램이 연결되지 않은 직원입니다. 전화로 연락해 주세요: ' + formatPhone(staff.phone));
  if (!(await sendCallMessage(env, staff, visit.id, visit.last5, visit.gender))) {
    throw new AppError('호출을 보내지 못했습니다. 전화로 연락해 주세요: ' + formatPhone(staff.phone));
  }
  await run(env, 'UPDATE visits SET called_at = ? WHERE id = ?', nowStr(), visit.id);
  return {};
}

function visitStatus(v, staff) {
  if (!staff) return '담당없음';
  if (v.acked_at) return '확인함';
  if (!v.called_at) return '미호출';
  return (Date.now() - parseKst(v.called_at).getTime()) / 60000 >= UNCONFIRMED_MIN ? '미확인' : '호출함';
}

export async function deskTodayVisits(env) {
  const today = todayStr();
  const rows = await all(env,
    `SELECT v.*, s.name AS s_name, s.nickname AS s_nick, s.phone AS s_phone, s.id AS s_id
     FROM visits v LEFT JOIN staff s ON s.id = v.staff_id
     WHERE v.visited_at >= ? AND v.visited_at <= ? ORDER BY v.visited_at DESC`, today + ' 00:00:00', today + ' 23:59:59');
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

export async function adminReservations(env, data) {
  const names = await orgNameMap(env);
  const staffById = {};
  (await all(env, 'SELECT * FROM staff')).forEach((r) => { staffById[r.id] = r; });
  const rows = (await all(env, 'SELECT * FROM reservations WHERE visit_date >= ? AND visit_date <= ? ORDER BY visit_date DESC', rangeFrom(data), rangeTo(data)))
    .filter((r) => matchOrg(staffById[r.staff_id], data)).slice(0, 3000)
    .map((r) => ({
      date: r.visit_date, last5: r.last5, gender: r.gender, staff: staffById[r.staff_id] ? staffBrief(staffById[r.staff_id], names) : null,
      memo: r.memo, status: effectiveStatus(r), createdAt: r.created_at
    }));
  return { reservations: rows };
}

export async function adminVisits(env, data) {
  const names = await orgNameMap(env);
  const staffById = {};
  (await all(env, 'SELECT * FROM staff')).forEach((r) => { staffById[r.id] = r; });
  const filtering = !!(s(data.staffId) || s(data.headId) || s(data.teamId));
  const rows = (await all(env, 'SELECT * FROM visits WHERE visited_at >= ? AND visited_at <= ? ORDER BY visited_at DESC',
    rangeFrom(data) + ' 00:00:00', rangeTo(data) + ' 23:59:59'))
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
