// 관리자 대시보드와 방명록 통계·내보내기. 집계는 DB 에서 하고(GROUP BY), 화면에는 결과만 보낸다.
import { AppError, s, all, first, todayStr, orgNameMap, writeLog } from '../core/util.js';
import { visitStatus, formatPhone } from '../visit/visit.js';
import { loadTypes, typeGroups, toGroup } from '../core/types.js';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const isMonth = (v) => /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

// 오늘 기준 n일 전 날짜 (한국 시간)
function daysAgo(n) {
  return new Date(Date.now() + 9 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
}

const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

// ---------- 대시보드 ----------

export async function adminDashboard(env, data, ctx) {
  const pid = ctx.projectId;
  const today = todayStr();
  const month = s(data.month) || today.slice(0, 7);
  if (!isMonth(month)) throw new AppError('월 형식이 올바르지 않습니다.');
  const from14 = daysAgo(13);
  const names = await orgNameMap(env, pid);
  const count = async (sql, ...p) => ((await first(env, sql, ...p)) || {}).n || 0;

  // 오늘 카드
  const active = await count(`SELECT COUNT(*) AS n FROM staff WHERE project_id = ? AND status = '활동'`, pid);
  const present = await count(`SELECT COUNT(DISTINCT staff_id) AS n FROM attendance WHERE project_id = ? AND date = ? AND result = '성공'`, pid, today);
  const todayRes = await count(`SELECT COUNT(*) AS n FROM reservations WHERE project_id = ? AND visit_date = ? AND status <> '취소'`, pid, today);
  const todayVisits = await count(`SELECT COUNT(*) AS n FROM visits WHERE project_id = ? AND visited_at >= ? AND visited_at <= ?`, pid, today + ' 00:00:00', today + ' 23:59:59');
  const noStaff = await count(`SELECT COUNT(*) AS n FROM visits WHERE project_id = ? AND visited_at >= ? AND visited_at <= ? AND kind = '담당없음'`, pid, today + ' 00:00:00', today + ' 23:59:59');
  const pendingStaff = await count(`SELECT COUNT(*) AS n FROM staff WHERE project_id = ? AND status = '대기'`, pid);
  const guestToday = (await first(env,
    `SELECT COUNT(*) AS teams, COALESCE(SUM(1 + companions), 0) AS people,
            COALESCE(SUM(CASE WHEN reviewed = 1 AND head_id = '' THEN 1 ELSE 0 END), 0) AS walkin,
            COALESCE(SUM(CASE WHEN reviewed = 0 THEN 1 ELSE 0 END), 0) AS pending
     FROM guestbook WHERE project_id = ? AND visit_date = ?`, pid, today));

  // 최근 14일 추이
  const att = await all(env, `SELECT date AS d, COUNT(DISTINCT staff_id) AS n FROM attendance WHERE project_id = ? AND result = '성공' AND date >= ? GROUP BY date`, pid, from14);
  const res = await all(env, `SELECT visit_date AS d, COUNT(*) AS n FROM reservations WHERE project_id = ? AND visit_date >= ? AND visit_date <= ? AND status <> '취소' GROUP BY visit_date`, pid, from14, today);
  const vis = await all(env, `SELECT substr(visited_at, 1, 10) AS d, COUNT(*) AS n FROM visits WHERE project_id = ? AND visited_at >= ? GROUP BY d`, pid, from14 + ' 00:00:00');
  const gst = await all(env, `SELECT visit_date AS d, SUM(1 + companions) AS n FROM guestbook WHERE project_id = ? AND visit_date >= ? GROUP BY visit_date`, pid, from14);
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
     FROM staff s LEFT JOIN (SELECT DISTINCT staff_id FROM attendance WHERE project_id = ? AND date = ? AND result = '성공') a ON a.staff_id = s.id
     WHERE s.project_id = ? AND s.status = '활동' GROUP BY s.job, s.head_id, s.team_id`, pid, today, pid);
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
     FROM reservations WHERE project_id = ? AND visit_date >= ? AND visit_date <= ? AND status <> '취소'
     GROUP BY staff_id ORDER BY visited DESC, reservations DESC LIMIT 10`, pid, m1, m31);
  const staffRows = top.length ? await all(env, `SELECT id, name, nickname, job, head_id, team_id FROM staff WHERE project_id = ? AND id IN (${top.map(() => '?').join(',')})`, pid, ...top.map((t) => t.staff_id)) : [];
  const staffById = Object.fromEntries(staffRows.map((r) => [r.id, r]));
  const due = await first(env,
    `SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = '방문' THEN 1 ELSE 0 END), 0) AS visited
     FROM reservations WHERE project_id = ? AND visit_date >= ? AND visit_date <= ? AND visit_date <= ? AND status <> '취소'`, pid, m1, m31, today);

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
    visitRate: { reservations: due.total, visited: due.visited, rate: pct(due.visited, due.total) },
    ...(await homeExtra(env, pid, today, groups, names))
  };
}

// 홈 대시보드 개편(2026-11-13): 인력·고객·계약 현황에 쓰는 추가 통계. 모두 GROUP BY 집계라 행을 많이 읽지 않는다
async function homeExtra(env, pid, today, groups, names) {
  const from30 = daysAgo(29), month = today.slice(0, 7);
  const days30 = [];
  for (let i = 29; i >= 0; i--) days30.push(daysAgo(i));
  const byDay = (rows) => Object.fromEntries(rows.map((r) => [r.d, r.n]));
  const [att, sv, gb, rt, rv, staffAgg, svAgg, gbMonth, rvAgg, rtRows, ext, ctMonthly, csAgg, csNotes, types, svTypes, csTypes] = await Promise.all([
    all(env, `SELECT date AS d, COUNT(DISTINCT staff_id) AS n FROM attendance WHERE project_id = ? AND result = '성공' AND date >= ? GROUP BY date`, pid, from30),
    all(env, `SELECT substr(submitted_at, 1, 10) AS d, COUNT(*) AS n FROM responses WHERE project_id = ? AND submitted_at >= ? GROUP BY d`, pid, from30 + ' 00:00:00'),
    all(env, `SELECT visit_date AS d, SUM(1 + companions) AS n FROM guestbook WHERE project_id = ? AND visit_date >= ? GROUP BY visit_date`, pid, from30),
    all(env, `SELECT substr(submitted_at, 1, 10) AS d, COUNT(*) AS n FROM realtor_responses WHERE project_id = ? AND submitted_at >= ? GROUP BY d`, pid, from30 + ' 00:00:00'),
    all(env, `SELECT visit_date AS d, COUNT(*) AS n FROM reservations WHERE project_id = ? AND visit_date >= ? AND visit_date <= ? AND status <> '취소' GROUP BY visit_date`, pid, from30, today),
    first(env, `SELECT COUNT(*) AS active, COALESCE(SUM(CASE WHEN telegram_id = '' THEN 1 ELSE 0 END), 0) AS noTg FROM staff WHERE project_id = ? AND status = '활동'`, pid),
    first(env, `SELECT COUNT(*) AS total, COALESCE(SUM(consent_pi), 0) AS consent, COALESCE(SUM(CASE WHEN submitted_at >= ? THEN 1 ELSE 0 END), 0) AS today FROM responses WHERE project_id = ?`, today + ' 00:00:00', pid),
    first(env, `SELECT COUNT(*) AS teams, COALESCE(SUM(1 + companions), 0) AS people FROM guestbook WHERE project_id = ? AND visit_date >= ?`, pid, month + '-01'),
    first(env, `SELECT COALESCE(SUM(CASE WHEN visit_date > ? AND visit_date <= ? AND status = '예정' THEN 1 ELSE 0 END), 0) AS next7 FROM reservations WHERE project_id = ? AND visit_date > ?`, today, daysAgo(-7), pid, today),
    all(env, `SELECT cust_hash, refer_count, mgm, submitted_at FROM realtor_responses WHERE project_id = ? ORDER BY submitted_at, rowid`, pid),
    first(env, `SELECT COUNT(*) AS n FROM customers WHERE project_id = ? AND source_kind NOT IN ('', '상담')`, pid),
    all(env, `SELECT substr(json_extract(json, '$.date'), 1, 7) AS m, COUNT(*) AS n, COALESCE(SUM(CASE WHEN status_g = '해약' THEN 1 ELSE 0 END), 0) AS cancel
              FROM ct_records WHERE project_id = ? AND col = 'contracts' AND deleted = 0 GROUP BY m`, pid),
    first(env, `SELECT COUNT(*) AS n FROM customers WHERE project_id = ? AND counsel_at <> ''`, pid),
    first(env, `SELECT COUNT(*) AS n FROM customer_notes WHERE project_id = ? AND staff_id <> '' AND at >= ?`, pid, month + '-01'),
    loadTypes(env, pid),
    all(env, `SELECT value_code AS code, COUNT(*) AS n FROM response_answers WHERE project_id = ? AND q_key = 'STD_TYPE' GROUP BY value_code`, pid),
    all(env, `SELECT interest FROM customers WHERE project_id = ? AND interest <> ''`, pid)
  ]);
  // 관심 타입군: 설문 응답(타입군 코드) + 고객 관심 타입(상담 앱 등, 세부 주택형은 타입군으로)
  const tg = typeGroups(types);
  const svBy = Object.fromEntries(svTypes.map((r) => [r.code, r.n]));
  const csBy = {};
  csTypes.forEach((r) => new Set(s(r.interest).split(',').filter(Boolean).map((v) => toGroup(v, types))).forEach((g) => { csBy[g] = (csBy[g] || 0) + 1; }));
  const typeInterest = tg.map((g) => ({ code: g.code, label: g.label, units: g.units, survey: svBy[g.code] || 0, customers: csBy[g.code] || 0 }))
    .concat(tg.length ? [{ code: '미정', label: '미정', units: 0, survey: svBy['미정'] || 0, customers: csBy['미정'] || 0 }] : []);
  const mAtt = byDay(att), mSv = byDay(sv), mGb = byDay(gb), mRt = byDay(rt), mRv = byDay(rv);
  const trend30 = days30.map((d) => ({ date: d, attendance: mAtt[d] || 0, surveys: mSv[d] || 0, guests: mGb[d] || 0, realtors: mRt[d] || 0, reservations: mRv[d] || 0 }));
  // 이번 달 하루 평균 출근 (출근이 있었던 날 기준)
  const monthAtt = att.filter((r) => r.d.startsWith(month));
  const avgAtt = monthAtt.length ? Math.round(monthAtt.reduce((a, r) => a + r.n, 0) / monthAtt.length * 10) / 10 : 0;
  // 직군별 등록 인원 (오늘 출근 포함)
  const jobs = {};
  groups.forEach((g) => { const j = (jobs[g.job] = jobs[g.job] || { name: g.job, total: 0, present: 0 }); j.total += g.total; j.present += g.present; });
  // 부동산: 사람(연락처) 기준 최근 조사만
  const latest = {};
  rtRows.forEach((r) => { latest[r.cust_hash || r.submitted_at] = r; });
  const people = Object.values(latest);
  // 계약 월별 추이 (최근 12개월, 해약 제외 건수)
  const months = [];
  for (let i = 11; i >= 0; i--) { const d = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 - i, 1)); months.push(d.toISOString().slice(0, 7)); }
  const ctBy = Object.fromEntries(ctMonthly.filter((r) => r.m).map((r) => [r.m, r]));
  const before = ctMonthly.filter((r) => r.m && r.m < months[0]).reduce((a, r) => a + r.n - r.cancel, 0);
  let cum = before;
  const contractMonthly = months.map((m) => { const r = ctBy[m] || { n: 0, cancel: 0 }; cum += r.n - r.cancel; return { month: m, contracts: r.n - r.cancel, cancels: r.cancel, cumulative: cum }; });
  return {
    staffStats: {
      active: staffAgg.active, noTelegram: staffAgg.noTg, avgAttendanceMonth: avgAtt,
      byJob: Object.values(jobs).map((x) => ({ ...x, rate: pct(x.present, x.total) })).sort((a, b) => b.total - a.total),
      heads: new Set(groups.filter((g) => g.head_id).map((g) => g.head_id)).size, teams: new Set(groups.filter((g) => g.team_id).map((g) => g.team_id)).size
    },
    trend30,
    customerStats: {
      surveys: svAgg.total, surveyConsent: svAgg.consent, surveysToday: svAgg.today,
      guestTeamsMonth: gbMonth.teams, guestPeopleMonth: gbMonth.people,
      reservationsNext7: rvAgg ? rvAgg.next7 : 0,
      realtorPeople: people.length, realtorResponses: rtRows.length, realtorMgm: people.filter((r) => r.mgm === '참여').length,
      realtorRefer: people.reduce((a, r) => a + (r.refer_count || 0), 0), external: ext.n,
      counselCustomers: csAgg.n, counselNotesMonth: csNotes.n, typeInterest
    },
    contractMonthly
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
export async function adminGuestStats(env, data, ctx) {
  const pid = ctx.projectId;
  const { from, to } = range(data);
  const names = await orgNameMap(env, pid);
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
     FROM guestbook WHERE project_id = ? AND visit_date >= ? AND visit_date <= ?`, pid, from, to);
  const byDay = await all(env,
    `SELECT visit_date AS date, COUNT(*) AS teams, SUM(1 + companions) AS people,
            SUM(CASE WHEN reviewed = 1 AND head_id = '' THEN 1 ELSE 0 END) AS walkin
     FROM guestbook WHERE project_id = ? AND visit_date >= ? AND visit_date <= ? GROUP BY visit_date ORDER BY visit_date`, pid, from, to);
  const byOrg = await all(env,
    `SELECT head_id, team_id, COUNT(*) AS teams, SUM(1 + companions) AS people
     FROM guestbook WHERE project_id = ? AND visit_date >= ? AND visit_date <= ? AND reviewed = 1 AND head_id <> '' GROUP BY head_id, team_id`, pid, from, to);
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
export async function adminGuestbook(env, data, ctx) {
  const pid = ctx.projectId;
  const { from, to } = range(data);
  const names = await orgNameMap(env, pid);
  const rows = await all(env,
    `SELECT g.*, s.name AS s_name, v.called_at AS v_called, v.acked_at AS v_acked
     FROM guestbook g LEFT JOIN staff s ON s.id = g.staff_id LEFT JOIN visits v ON v.id = g.visit_id
     WHERE g.project_id = ? AND g.visit_date >= ? AND g.visit_date <= ? ORDER BY g.created_at LIMIT 5000`, pid, from, to);
  await writeLog(env, ctx.account.login_id, '방명록내보내기', '', from + ' ~ ' + to + ' / ' + rows.length + '건', pid); // 개인정보가 담긴 목록이라 기록한다
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
