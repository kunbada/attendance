// 담당자 매칭: 계약앱 계약의 team·staff 는 글자다. 통합관리에서 직원(staff)과 연결해 staffId 로 저장한다 (5단계 수수료 계산의 기준).
//  - 계약 1건의 담당자는 1명 (공동판매 불가): staffId 는 직원 한 명의 id 하나뿐이다
//  - 같은 (팀, 담당자) 글자를 가진 계약을 한꺼번에 연결한다
import { AppError, s, all, first, writeLog } from '../core/util.js';
import { writeAll, kstIso } from './contract.js';

const parse = (text) => { try { return JSON.parse(text) || {}; } catch (e) { return {}; } };
const norm = (v) => s(v).replace(/\s/g, '');

// 계약앱에서 담당자를 고를 직원 목록 (이름·소속만. 연락처 등 개인정보는 보내지 않는다)
export async function contractStaffList(env, data, ctx) {
  const rows = await all(env,
    `SELECT s.id, s.name, s.nickname, s.job, s.status, h.name AS head, t.name AS team
     FROM staff s LEFT JOIN orgs h ON h.id = s.head_id AND h.project_id = s.project_id LEFT JOIN orgs t ON t.id = s.team_id AND t.project_id = s.project_id
     WHERE s.project_id = ? AND s.status IN ('활동', '퇴사') ORDER BY (s.status = '활동') DESC, s.name`, ctx.projectId);
  return { staff: rows.map((x) => ({ id: x.id, name: x.name, nickname: x.nickname || '', job: x.job || '', head: x.head || '', team: x.team || '', status: x.status })) };
}

export async function contractMatchList(env, data, ctx) {
  const pid = ctx.projectId;
  const rows = await all(env,
    `SELECT COALESCE(json_extract(json, '$.team'), '') AS team, COALESCE(json_extract(json, '$.staff'), '') AS staff, COALESCE(staff_id_g, '') AS sid, COUNT(*) AS n
     FROM ct_records WHERE project_id = ? AND col = 'contracts' AND deleted = 0 GROUP BY 1, 2, 3`, pid);
  const staff = await all(env,
    `SELECT s.id, s.name, s.nickname, s.job, s.grade, s.status, h.name AS head, t.name AS team
     FROM staff s LEFT JOIN orgs h ON h.id = s.head_id AND h.project_id = s.project_id LEFT JOIN orgs t ON t.id = s.team_id AND t.project_id = s.project_id
     WHERE s.project_id = ? AND s.status IN ('활동', '퇴사', '대기') ORDER BY s.name`, pid);
  const byId = Object.fromEntries(staff.map((x) => [x.id, x]));

  // (팀, 담당자) 글자 묶음별로 연결된 건수와 추천 직원
  const groups = new Map();
  rows.forEach((r) => {
    const k = r.team + '|' + r.staff;
    const g = groups.get(k) || { team: r.team, staff: r.staff, total: 0, linked: 0, unlinked: 0, staffIds: [] };
    g.total += r.n;
    if (r.sid) { g.linked += r.n; if (!g.staffIds.includes(r.sid)) g.staffIds.push(r.sid); } else g.unlinked += r.n;
    groups.set(k, g);
  });
  const list = [...groups.values()].map((g) => {
    const key = norm(g.staff);
    const cands = key ? staff.filter((x) => norm(x.name) === key || (x.nickname && norm(x.nickname) === key)) : [];
    // 같은 이름이 여럿이면 팀이 같은 직원을 앞에 둔다
    cands.sort((a, b) => (norm(b.team) === norm(g.team) ? 1 : 0) - (norm(a.team) === norm(g.team) ? 1 : 0));
    return {
      team: g.team, staff: g.staff, total: g.total, linked: g.linked, unlinked: g.unlinked,
      linkedStaff: g.staffIds.map((id) => (byId[id] ? { id, name: byId[id].name } : { id, name: '(이 현장에 없는 직원)' })),
      suggestions: cands.slice(0, 5).map((x) => ({ id: x.id, name: x.name, nickname: x.nickname, head: x.head || '', team: x.team || '', status: x.status }))
    };
  }).sort((a, b) => b.unlinked - a.unlinked || a.team.localeCompare(b.team, 'ko') || a.staff.localeCompare(b.staff, 'ko'));
  return {
    groups: list,
    staff: staff.map((x) => ({ id: x.id, name: x.name, nickname: x.nickname, job: x.job, grade: x.grade, status: x.status, head: x.head || '', team: x.team || '' })),
    total: rows.reduce((a, r) => a + r.n, 0), linked: rows.reduce((a, r) => a + (r.sid ? r.n : 0), 0)
  };
}

// (팀, 담당자) 글자가 같은 계약 전부에 staffId 를 넣는다. staffId 가 비어 있으면 연결을 푼다
export async function contractMatchSave(env, data, ctx) {
  const pid = ctx.projectId;
  const team = s(data.team), staff = s(data.staff);
  const staffId = s(data.staffId);
  if (staffId) {
    const st = await first(env, `SELECT id, name FROM staff WHERE id = ? AND project_id = ? AND status <> '반려'`, staffId, pid);
    if (!st) throw new AppError('이 현장의 직원이 아닙니다.');
  }
  const rows = await all(env,
    `SELECT id, rev, json FROM ct_records WHERE project_id = ? AND col = 'contracts' AND deleted = 0
       AND COALESCE(json_extract(json, '$.team'), '') = ? AND COALESCE(json_extract(json, '$.staff'), '') = ? LIMIT 2000`, pid, team, staff);
  const stamp = kstIso();
  const by = '통합관리(' + s(ctx.account.name) + ')';
  const items = [];
  rows.forEach((r) => {
    const rec = parse(r.json);
    if (s(rec.staffId) === staffId) return; // 이미 같은 값
    delete rec._rv;
    if (staffId) rec.staffId = staffId; else delete rec.staffId;
    rec.updatedAt = stamp; rec.updatedBy = by;
    items.push({ c: 'contracts', id: r.id, rec, js: JSON.stringify(rec), base: r.rev });
  });
  const w = await writeAll(env, pid, items);
  const failed = w.retry.length + w.rejected.length;
  await writeLog(env, ctx.account.login_id, staffId ? '담당자매칭' : '담당자매칭해제', pid, '팀 "' + team + '" 담당 "' + staff + '" → ' + (staffId || '(해제)') + ' / ' + (items.length - failed) + '건', pid);
  return { updated: items.length - failed, skipped: rows.length - items.length, failed };
}
