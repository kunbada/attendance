// 관리자 대시보드와 방명록 통계·내보내기. 집계는 DB 에서 하고(GROUP BY), 화면에는 결과만 보낸다.
import { AppError, s, all, first, todayStr, orgNameMap } from './util.js';
import { visitStatus, formatPhone } from './visit.js';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

// 오늘 기준 n일 전 날짜 (한국 시간)
function daysAgo(n) {
  return new Date(Date.now() + 9 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

// ---------- 대시보드 ----------

export async function adminDashboard(env, data) {
  const today = todayStr();
  const month = s(data.month) || today.slice(0, 7);
  if (!isMonth(month)) throw new AppError('월 형식이 올바르지 않습니다.');
  const from14 = daysAgo(13);
  const names = await orgNameMap(env);
  const count = async (sql, ...p) => ((await first(env, sql, ...p)) || {}).n || 0;

  // 오늘 카드
  const active = await count(`SELECT COUNT(*) AS n FROM staff WHERE status = '활동'`);
  const present = await count(`SELECT COUNT(DISTINCT staff_id) AS n FROM attendance WHERE date = ? AND result = '성공'`, today);
  const todayRes = await count(`SELECT COUNT(*) AS n FROM reservations WHERE visit_date = ? AND status <> '취소'`, today);
  const todayVisits = await count(`SELECT COUNT(*) AS n FROM visits WHERE visited_at >= ? AND visited_at <= ?`, today + ' 00:00:00', today + ' 23:59:59');
  const noStaff = await count(`SELECT COUNT(*) AS n FROM visits WHERE visited_at >= ? AND visited_at <= ? AND kind = '담당없음'`, today + ' 00:00:00', today + ' 23:59:59');
  const pendingStaff = await count(`SELECT COUNT(*) AS n FROM staff WHERE status = '대기'`);
  const guestToday = (await first(env,
    `SELECT COUNT(*) AS teams, COALESCE(SUM(1 + companions), 0) AS people,
            COALESCE(SUM(CASE WHEN reviewed = 1 AND head_id = '' THEN 1 ELSE 0 END), 0) AS walkin,
            COALESCE(SUM(CASE WHEN reviewed = 0 THEN 1 ELSE 0 END), 0) AS pending
     FROM guestbook WHERE visit_date = ?`, today));

  // 최근 14일 추이
  const att = await all(env, `SELECT date AS d, COUNT(DISTINCT staff_id) AS n FROM attendance WHERE result = '성공' AND date >= ? GROUP BY date`, from14);
  const res = await all(env, `SELECT visit_date AS d, COUNT(*) AS n FROM reservations WHERE visit_date >= ? AND visit_date <= ? AND status <> '취소' GROUP BY visit_date`, from14, today);
  const vis = await all(env, `SELECT substr(visited_at, 1, 10) AS d, COUNT(*) AS n FROM visits WHERE visited_at >= ? GROUP BY d`, from14 + ' 00:00:00');
  const gst = await all(env, `SELECT visit_date AS d, SUM(1 + companions) AS n FROM guestbook WHERE visit_date >= ? GROUP BY visit_date`, from14);
  const map = (rows) => Object.fromEntries(rows.map((r) => [r.d, r.n]));
  const mA = map(att), mR = map(res), mV = map(vis), mG = map(gst);
  const trend = [];
  for (let i = 13; i >= 0; i--) {
    const d = daysAgo(i);
    trend.push({ date: d, attendance: mA[d] || 0, reservations: mR[d] || 0, visits: mV[d] || 0, guestPeople: mG[d] || 0 });
  }

  // 오늘 출근율: 본부·팀·직군별
  const groups = await all(env,
    `SELECT s.job, s.head_id, s.team_id, COUNT(*) AS total, SUM(CASE WHEN a.staff_id IS NOT NULL THEN 1 ELSE 0 END) AS present
     FROM staff s LEFT JOIN (SELECT DISTINCT staff_id FROM attendance WHERE date = ? AND result = '성공') a ON a.staff_id = s.id
     WHERE s.status = '활동' GROUP BY s.job, s.head_id, s.team_id`, today);
  const bucket = (keyFn) => {
    const m = {};
    groups.forEach((g) => {
      const k = keyFn(g);
      if (!k) return;
      m[k] = m[k] || { name: k, total: 0, present: 0 };
      m[k].total += g.total;
      m[k].present += g.present;
    });
    return Object.values(m).map((x) => ({ ...x, rate: pct(x.present, x.total) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  };
  const byHead = bucket((g) => names[g.head_id] || '');
  const byTeam = bucket((g) => (g.team_id ? (names[g.head_id] || '') + ' ' + (names[g.team_id] || '') : ''));
  const byJob = bucket((g) => g.job);

  // 이번 달 직원별 예약·방문 TOP 10, 예약 대비 방문율
  const m1 = month + '-01', m31 = month + '-31';
  const top = await all(env,
    `SELECT staff_id, COUNT(*) AS reservations, SUM(CASE WHEN status = '방문' THEN 1 ELSE 0 END) AS visited
     FROM reservations WHERE visit_date >= ? AND visit_date <= ? AND status <> '취소'
     GROUP BY staff_id ORDER BY visited DESC, reservations DESC LIMIT 10`, m1, m31);
  const staffRows = top.length ? await all(env, `SELECT id, name, nickname, job, head_id, team_id FROM staff WHERE id IN (${top.map(() => '?').join(',')})`, ...top.map((t) => t.staff_id)) : [];
  const staffById = Object.fromEntries(staffRows.map((r) => [r.id, r]));
  const due = await first(env,
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = '방문' THEN 1 ELSE 0 END), 0) AS visited
     FROM reservations WHERE visit_date >= ? AND visit_date <= ? AND visit_date <= ? AND status <> '취소'`, m1, m31, today);

  return {
    today: {
      date: today, attendance: present, activeStaff: active, attendanceRate: pct(present, active), reservations: todayRes, visits: todayVisits,
      noStaffVisits: noStaff, pendingStaff, guestTeams: guestToday.teams, guestPeople: guestToday.people, walkIn: guestToday.walkin, guestPending: guestToday.pending
    },
    trend,
    attendanceRate: { byHead, byTeam, byJob },
    month,
    topStaff: top.map((t) => {
      const st = staffById[t.staff_id];
      return {
        name: st ? st.name + (st.nickname ? ' (' + st.nickname + ')' : '') : '(삭제된 직원)',
        org: st ? [st.job, names[st.head_id], names[st.team_id]].filter(Boolean).join(' · ') : '',
        reservations: t.reservations, visited: t.visited
      };
    }),
    visitRate: { reservations: due.total, visited: due.visited, rate: pct(due.visited, due.total) }
  };
}

// ---------- 방명록 통계·내보내기 ----------

function range(data) {
  const to = s(data.to) || todayStr();
  const from = s(data.from) || to.slice(0, 8) + '01';
  if (!isDate(from) || !isDate(to)) throw new AppError('날짜 형식이 올바르지 않습니다.');
  if (from > to) throw new AppError('시작일이 종료일보다 늦습니다.');
  return { from, to };
}

// 방문 팀 = 방명록 건수, 방문객 = 건마다 (1 + 동반인 수)의 합
export async function adminGuestStats(env, data) {
  const { from, to } = range(data);
  const names = await orgNameMap(env);
  const total = await first(env,
    `SELECT COUNT(*) AS teams, COALESCE(SUM(1 + companions), 0) AS people,
            COALESCE(SUM(CASE WHEN companions = 0 THEN 1 ELSE 0 END), 0) AS solo,
            COALESCE(SUM(CASE WHEN companions > 0 THEN 1 ELSE 0 END), 0) AS group_teams,
            COALESCE(SUM(CASE WHEN reviewed = 1 AND head_id = '' THEN 1 ELSE 0 END), 0) AS walkin_teams,
            COALESCE(SUM(CASE WHEN reviewed = 1 AND head_id = '' THEN 1 + companions ELSE 0 END), 0) AS walkin_people,
            COALESCE(SUM(CASE WHEN reviewed = 1 AND head_id <> '' THEN 1 ELSE 0 END), 0) AS assigned_teams,
            COALESCE(SUM(CASE WHEN reviewed = 1 AND head_id <> '' THEN 1 + companions ELSE 0 END), 0) AS assigned_people,
            COALESCE(SUM(CASE WHEN reviewed = 0 THEN 1 ELSE 0 END), 0) AS pending,
            COALESCE(SUM(CASE WHEN consent = 1 THEN 1 ELSE 0 END), 0) AS consented,
            COALESCE(SUM(CASE WHEN gender = '남' THEN 1 ELSE 0 END), 0) AS male,
            COALESCE(SUM(CASE WHEN gender = '여' THEN 1 ELSE 0 END), 0) AS female,
            COALESCE(SUM(CASE WHEN gender = '' THEN 1 ELSE 0 END), 0) AS gender_unknown
     FROM guestbook WHERE visit_date >= ? AND visit_date <= ?`, from, to);
  const byDay = await all(env,
    `SELECT visit_date AS date, COUNT(*) AS teams, SUM(1 + companions) AS people,
            SUM(CASE WHEN reviewed = 1 AND head_id = '' THEN 1 ELSE 0 END) AS walkin
     FROM guestbook WHERE visit_date >= ? AND visit_date <= ? GROUP BY visit_date ORDER BY visit_date`, from, to);
  const byOrg = await all(env,
    `SELECT head_id, team_id, COUNT(*) AS teams, SUM(1 + companions) AS people
     FROM guestbook WHERE visit_date >= ? AND visit_date <= ? AND reviewed = 1 AND head_id <> '' GROUP BY head_id, team_id`, from, to);
  return {
    from, to,
    total: {
      teams: total.teams, people: total.people, solo: total.solo, groupTeams: total.group_teams,
      walkInTeams: total.walkin_teams, walkInPeople: total.walkin_people, assignedTeams: total.assigned_teams, assignedPeople: total.assigned_people,
      pending: total.pending, consented: total.consented, male: total.male, female: total.female, genderUnknown: total.gender_unknown
    },
    byDay,
    byOrg: byOrg.map((o) => ({ head: names[o.head_id] || '', team: names[o.team_id] || '(팀 미지정)', teams: o.teams, people: o.people }))
      .sort((a, b) => (a.head + a.team).localeCompare(b.head + b.team, 'ko'))
  };
}

// 방명록 전체 목록 (CSV 내보내기용). 개인정보가 들어 있어 관리자만 부를 수 있다.
export async function adminGuestbook(env, data) {
  const { from, to } = range(data);
  const names = await orgNameMap(env);
  const rows = await all(env,
    `SELECT g.*, s.name AS s_name, v.called_at AS v_called, v.acked_at AS v_acked
     FROM guestbook g LEFT JOIN staff s ON s.id = g.staff_id LEFT JOIN visits v ON v.id = g.visit_id
     WHERE g.visit_date >= ? AND g.visit_date <= ? ORDER BY g.created_at LIMIT 5000`, from, to);
  return {
    from, to,
    guests: rows.map((g) => ({
      date: g.visit_date, time: g.created_at.slice(11, 16), name: g.name, phone: formatPhone(g.phone), gender: g.gender,
      companions: g.companions, people: 1 + g.companions, party: g.companions > 0 ? '동반' : '단독',
      category: !g.reviewed ? '확인 필요' : g.head_id ? '분양' : '워킹',
      head: names[g.head_id] || '', team: names[g.team_id] || '',
      staff: g.s_name || (g.staff_none ? '없음' : ''), consent: !!g.consent, consentAt: g.consent_at, source: g.source,
      called: g.v_called ? g.v_called.slice(11, 16) : '', acked: g.v_acked ? g.v_acked.slice(11, 16) : '',
      status: g.visit_id ? visitStatus({ called_at: g.v_called, acked_at: g.v_acked }, true) : ''
    }))
  };
}
