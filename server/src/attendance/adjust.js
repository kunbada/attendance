// 근태 보정 (관리자·보조관리자): 원본 출근 기록은 고치지 않고 날짜별 덮어쓰기 값을 둔다.
import { AppError, s, first, run, nowStr, newId, writeLog } from '../core/util.js';
import { ADJUST_KINDS } from '../pay/calc.js';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

// 이미 확정된 정산 회차에 들어간 날짜는 고칠 수 없다 (정정은 다음 회차의 조정 금액으로)
async function assertNotConfirmed(env, projectId, staffId, date) {
  const locked = await first(env,
    `SELECT r.title FROM pay_items i JOIN pay_runs r ON r.id = i.run_id
     WHERE i.project_id = ? AND i.staff_id = ? AND r.status IN ('확정', '지급완료') AND r.period_from <= ? AND r.period_to >= ? LIMIT 1`,
    projectId, staffId, date, date);
  if (locked) throw new AppError('이미 확정된 정산 회차(' + (locked.title || '일급') + ')에 포함된 날짜입니다. 정정은 다음 회차의 조정 금액으로 처리해 주세요.');
}

async function findStaff(env, id, projectId) {
  const st = await first(env, 'SELECT id, name FROM staff WHERE id = ? AND project_id = ?', s(id), projectId);
  if (!st) throw new AppError('직원을 찾을 수 없습니다.');
  return st;
}

export async function adminAdjustSave(env, data, ctx) {
  const pid = ctx.projectId;
  const st = await findStaff(env, data.staffId, pid);
  const date = s(data.date);
  const kind = s(data.kind);
  const reason = s(data.reason).trim();
  if (!isDate(date)) throw new AppError('날짜 형식이 올바르지 않습니다.');
  if (!ADJUST_KINDS.includes(kind)) throw new AppError('보정 구분은 ' + ADJUST_KINDS.join(' / ') + ' 중에서 선택해 주세요.');
  if (reason.length > 100) throw new AppError('사유는 100자 이내로 입력해 주세요.');
  if (date > new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)) throw new AppError('오늘 이후 날짜는 보정할 수 없습니다.');
  await assertNotConfirmed(env, pid, st.id, date);
  await run(env,
    `INSERT INTO attendance_adjust (id, project_id, staff_id, date, kind, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, staff_id, date) DO UPDATE SET kind = excluded.kind, reason = excluded.reason, created_by = excluded.created_by, created_at = excluded.created_at`,
    newId('AJ'), pid, st.id, date, kind, reason, ctx.account.login_id, nowStr());
  await writeLog(env, ctx.account.login_id, '근태보정', st.id, st.name + ' / ' + date + ' ' + kind + (reason ? ' / ' + reason : ''), pid);
  return {};
}

export async function adminAdjustDelete(env, data, ctx) {
  const pid = ctx.projectId;
  const st = await findStaff(env, data.staffId, pid);
  const date = s(data.date);
  if (!isDate(date)) throw new AppError('날짜 형식이 올바르지 않습니다.');
  await assertNotConfirmed(env, pid, st.id, date);
  const res = await run(env, 'DELETE FROM attendance_adjust WHERE project_id = ? AND staff_id = ? AND date = ?', pid, st.id, date);
  if (res.meta.changes) await writeLog(env, ctx.account.login_id, '근태보정해제', st.id, st.name + ' / ' + date, pid);
  return {};
}
