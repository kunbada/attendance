// 팀장·본부장의 직원 가입 승인 / 퇴사 처리. 관리자가 직급과 승인 권한(can_approve)을 지정한 사람만 쓸 수 있다.
//  - 팀장: 자기 팀의 '직원'
//  - 본부장: 자기 본부의 '직원'과 '팀장'  (다른 본부장·관리자 지정은 관리자만)
import { AppError, s, all, first, run, nowStr, orgNameMap, writeLog } from './util.js';
import { destroyUserSessions } from './auth.js';

function requireLeader(ctx) {
  const me = ctx.staff;
  if (me.grade === '직원' || !me.can_approve) throw new AppError('승인 권한이 없습니다.', 'FORBIDDEN');
  return me;
}

// 이 사람이 관리할 수 있는 직원을 고르는 SQL 조건
// 소속 현장(project_id)을 항상 함께 건다
function scopeOf(me) {
  if (me.grade === '팀장' && me.team_id) return { where: `project_id = ? AND team_id = ? AND grade = '직원' AND id <> ?`, params: [me.project_id, me.team_id, me.id] };
  if (me.grade === '본부장' && me.head_id) return { where: `project_id = ? AND head_id = ? AND grade IN ('직원', '팀장') AND id <> ?`, params: [me.project_id, me.head_id, me.id] };
  return { where: '1 = 0', params: [] }; // 소속이 비어 있으면 아무도 관리할 수 없다
}

async function findInScope(env, me, staffId) {
  const sc = scopeOf(me);
  const row = await first(env, `SELECT * FROM staff WHERE id = ? AND ${sc.where}`, s(staffId), ...sc.params);
  if (!row) throw new AppError('관리할 수 있는 직원이 아닙니다.');
  return row;
}

const who = (me) => me.name + '(' + me.grade + ')';

export async function leaderStaffList(env, data, ctx) {
  const me = requireLeader(ctx);
  const sc = scopeOf(me);
  const names = await orgNameMap(env, me.project_id);
  const rows = await all(env,
    `SELECT * FROM staff WHERE ${sc.where} AND status IN ('대기', '활동') ORDER BY status, grade DESC, name`, ...sc.params);
  const view = (r) => ({
    id: r.id, name: r.name, nickname: r.nickname, phone: r.phone, job: r.job, grade: r.grade, status: r.status,
    headName: names[r.head_id] || '', teamName: names[r.team_id] || '', joinedAt: r.joined_at, telegramLinked: !!r.telegram_id
  });
  return {
    scope: me.grade === '팀장' ? (names[me.head_id] || '') + ' ' + (names[me.team_id] || '') : names[me.head_id] || '',
    grade: me.grade,
    pending: rows.filter((r) => r.status === '대기').map(view),
    members: rows.filter((r) => r.status === '활동').map(view)
  };
}

export async function leaderApprove(env, data, ctx) {
  const me = requireLeader(ctx);
  const row = await findInScope(env, me, data.staffId);
  if (row.status !== '대기') throw new AppError('승인 대기 중인 직원이 아닙니다.');
  await run(env, `UPDATE staff SET status = '활동', reject_reason = '', approved_at = ? WHERE id = ? AND project_id = ? AND status = '대기'`, nowStr(), row.id, me.project_id);
  await writeLog(env, who(me), '직원승인', row.id, row.name, me.project_id);
  return {};
}

export async function leaderReject(env, data, ctx) {
  const me = requireLeader(ctx);
  const row = await findInScope(env, me, data.staffId);
  if (row.status !== '대기') throw new AppError('승인 대기 중인 직원이 아닙니다.');
  const reason = s(data.reason).trim();
  if (!reason) throw new AppError('반려 사유를 입력해 주세요.');
  await run(env, `UPDATE staff SET status = '반려', reject_reason = ? WHERE id = ? AND project_id = ? AND status = '대기'`, reason, row.id, me.project_id);
  await writeLog(env, who(me), '직원반려', row.id, row.name + ' / ' + reason, me.project_id);
  return {};
}

export async function leaderRetire(env, data, ctx) {
  const me = requireLeader(ctx);
  const row = await findInScope(env, me, data.staffId);
  if (row.status !== '활동') throw new AppError('활동 중인 직원만 퇴사 처리할 수 있습니다.');
  await run(env, `UPDATE staff SET status = '퇴사', device_change_request = '' WHERE id = ? AND project_id = ?`, row.id, me.project_id);
  await destroyUserSessions(env, 'staff', row.id);
  await writeLog(env, who(me), '직원퇴사', row.id, row.name, me.project_id);
  return {};
}
