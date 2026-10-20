// 방명록 고객의 "예약 있음" / "방문이력 있음" 찾기와 담당자 추천. 모두 같은 현장(projectId) 안에서만 찾는다.
//  - 예약: 같은 뒤 5자리의 예약 (오늘 예정·오늘 방문 처리된 건, 또는 오늘 이후 예정). 예약 중복 기준이 '뒤5자리+성별'이면 성별도 맞춘다.
//  - 방문이력: 이전 방명록(전화번호가 같으면 '동일 번호', 뒤 5자리만 같으면 '뒤 5자리 일치')과 이전 방문 접수 기록
//  - 추천 담당자: 예약 담당자 → 방문이력의 가장 최근 담당자(동일 번호 우선). 활동 중이고 본부가 있는 직원만.
// 목록 하나를 한 번에 계산하도록 뒤 5자리를 모아 DB 에 묻는다 (D1 은 한 질의에 변수 100개 제한).
import { all, getSettings } from '../core/util.js';

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

const usable = (st, head) => st && head && st === '활동'; // 활동 직원 + 본부 소속

/**
 * items: [{ key, phone, last5, gender, createdAt?, excludeId? }]  date: 기준 날짜(오늘)
 * 반환: { [key]: { reservation, history, suggest } }
 */
export async function computeMatches(env, projectId, items, date) {
  const out = {};
  items.forEach((i) => { out[i.key] = { reservation: null, history: null, suggest: null }; });
  const last5s = [...new Set(items.map((i) => i.last5).filter(Boolean))];
  if (!last5s.length) return out;
  const byGender = (await getSettings(env, projectId))['예약중복기준'] === '뒤5자리+성별';

  const resv = [], hist = [], vis = [];
  for (const part of chunk(last5s, 80)) {
    const ph = part.map(() => '?').join(',');
    resv.push(...await all(env,
      `SELECT r.id, r.last5, r.gender, r.visit_date, r.status, r.staff_id, r.created_at,
              s.name AS s_name, s.status AS s_status, s.head_id AS s_head, s.team_id AS s_team
       FROM reservations r LEFT JOIN staff s ON s.id = r.staff_id AND s.project_id = r.project_id
       WHERE r.project_id = ? AND r.last5 IN (${ph}) AND ((r.status = '예정' AND r.visit_date >= ?) OR (r.status = '방문' AND r.visit_date = ?))`, projectId, ...part, date, date));
    hist.push(...await all(env,
      `SELECT g.id, g.phone, g.last5, g.visit_date, g.created_at, g.staff_id,
              s.name AS s_name, s.status AS s_status, s.head_id AS s_head, s.team_id AS s_team
       FROM guestbook g LEFT JOIN staff s ON s.id = g.staff_id AND s.project_id = g.project_id WHERE g.project_id = ? AND g.last5 IN (${ph}) AND g.visit_date <= ?`, projectId, ...part, date));
    // 방명록으로 호출한 방문(kind=방명록)은 방명록 기록에 이미 들어 있으니 중복해서 세지 않는다
    vis.push(...await all(env,
      `SELECT v.id, v.last5, v.visited_at, v.staff_id, v.kind,
              s.name AS s_name, s.status AS s_status, s.head_id AS s_head, s.team_id AS s_team
       FROM visits v LEFT JOIN staff s ON s.id = v.staff_id AND s.project_id = v.project_id
       WHERE v.project_id = ? AND v.last5 IN (${ph}) AND v.visited_at < ? AND v.kind <> '방명록'`, projectId, ...part, date + ' 00:00:00'));
  }

  for (const it of items) {
    if (!it.last5) continue;
    const res = out[it.key];

    // 예약
    const rs = resv.filter((r) => r.last5 === it.last5 && !(byGender && it.gender && r.gender && r.gender !== it.gender));
    rs.sort((a, b) => (a.visit_date === date ? 0 : 1) - (b.visit_date === date ? 0 : 1)
      || a.visit_date.localeCompare(b.visit_date) || a.created_at.localeCompare(b.created_at));
    const r0 = rs[0];
    if (r0) {
      res.reservation = {
        id: r0.id, date: r0.visit_date, status: r0.status, count: rs.length,
        staffId: r0.staff_id, staffName: r0.s_name || '', headId: r0.s_head || '', teamId: r0.s_team || '', staffActive: usable(r0.s_status, r0.s_head)
      };
    }

    // 방문이력 (최근 순)
    const entries = [];
    hist.forEach((g) => {
      if (g.last5 !== it.last5 || g.id === it.excludeId) return;
      if (g.visit_date === date && it.createdAt && g.created_at >= it.createdAt) return; // 나보다 늦게 들어온 건은 이력이 아님
      entries.push({ at: g.created_at, exact: !!it.phone && g.phone === it.phone, staffId: g.staff_id, staffName: g.s_name || '', head: g.s_head, team: g.s_team, st: g.s_status });
    });
    vis.forEach((v) => {
      if (v.last5 === it.last5) entries.push({ at: v.visited_at, exact: false, staffId: v.staff_id, staffName: v.s_name || '', head: v.s_head, team: v.s_team, st: v.s_status });
    });
    entries.sort((a, b) => b.at.localeCompare(a.at));
    if (entries.length) {
      const withStaff = entries.filter((e) => e.staffId && usable(e.st, e.head));
      const pick = withStaff.find((e) => e.exact) || withStaff[0];
      res.history = {
        count: entries.length, lastDate: entries[0].at.slice(0, 10), exact: entries.some((e) => e.exact),
        staffName: pick ? pick.staffName : (entries.find((e) => e.staffName) || {}).staffName || ''
      };
      res.historyPick = pick || null;
    }

    // 추천 담당자
    if (r0 && usable(r0.s_status, r0.s_head)) {
      res.suggest = { source: '예약', staffId: r0.staff_id, staffName: r0.s_name, headId: r0.s_head, teamId: r0.s_team || '' };
    } else if (res.historyPick) {
      const p = res.historyPick;
      res.suggest = { source: '방문이력', staffId: p.staffId, staffName: p.staffName, headId: p.head, teamId: p.team || '' };
    }
    delete res.historyPick;
  }
  return out;
}
