// 관리자·보조관리자 action: 직원(인력) 관리, 급여정보, 현장 이동. 모두 ctx.projectId 현장의 직원만 다룬다.
import { AppError, s, all, first, run, nowStr, hashSecret, decryptText, orgNameMap, writeLog } from './util.js';
import { MAX_FAILS, destroyUserSessions } from './auth.js';
import { normalizePhone, resolveOrg, deviceInUse, checkGrade } from './staff.js';

const adminName = (ctx) => ctx.account.login_id;

// 다른 현장 직원의 번호를 넣어도 "없는 직원"으로만 보이도록 같은 메시지를 쓴다
async function findStaffOrThrow(env, id, projectId) {
  const row = await first(env, 'SELECT * FROM staff WHERE id = ? AND project_id = ?', s(id), projectId);
  if (!row) throw new AppError('직원을 찾을 수 없습니다.');
  return row;
}

// ---------- 직원 ----------

export async function adminStaffList(env, data, ctx) {
  const names = await orgNameMap(env, ctx.projectId);
  const rows = await all(env, 'SELECT * FROM staff WHERE project_id = ? ORDER BY joined_at DESC', ctx.projectId);
  return {
    staff: rows.map((r) => ({
      id: r.id, name: r.name, nickname: r.nickname, phone: r.phone, job: r.job,
      headId: r.head_id, headName: names[r.head_id] || '', teamId: r.team_id, teamName: names[r.team_id] || '',
      grade: r.grade, canApprove: !!r.can_approve,
      status: r.status, rejectReason: r.reject_reason, joinedAt: r.joined_at, approvedAt: r.approved_at,
      deviceChangePending: !!r.device_change_request, telegramLinked: !!r.telegram_id, locked: r.fail_count >= MAX_FAILS
    }))
  };
}

export async function adminApprove(env, data, ctx) {
  const row = await findStaffOrThrow(env, data.staffId, ctx.projectId);
  if (row.status !== '대기') throw new AppError('승인 대기 중인 직원이 아닙니다.');
  await run(env, `UPDATE staff SET status = '활동', reject_reason = '', approved_at = ? WHERE id = ? AND project_id = ?`, nowStr(), row.id, ctx.projectId);
  await writeLog(env, adminName(ctx), '직원승인', row.id, row.name, ctx.projectId);
  return {};
}

export async function adminReject(env, data, ctx) {
  const row = await findStaffOrThrow(env, data.staffId, ctx.projectId);
  if (row.status !== '대기') throw new AppError('승인 대기 중인 직원이 아닙니다.');
  const reason = s(data.reason).trim();
  if (!reason) throw new AppError('반려 사유를 입력해 주세요.');
  await run(env, `UPDATE staff SET status = '반려', reject_reason = ? WHERE id = ? AND project_id = ?`, reason, row.id, ctx.projectId);
  await writeLog(env, adminName(ctx), '직원반려', row.id, row.name + ' / ' + reason, ctx.projectId);
  return {};
}

export async function adminUpdate(env, data, ctx) {
  const row = await findStaffOrThrow(env, data.staffId, ctx.projectId);
  const name = s(data.name).trim();
  const nickname = s(data.nickname).trim();
  if (!name || name.length > 20) throw new AppError('성명을 입력해 주세요.');
  if (nickname.length > 20) throw new AppError('예명은 20자 이내로 입력해 주세요.');
  const phone = normalizePhone(data.phone);
  // 휴대폰 번호는 사람 한 명당 한 행이라 현장과 관계없이 전체에서 유일하다
  if (await first(env, 'SELECT 1 FROM staff WHERE phone = ? AND id <> ?', phone, row.id)) throw new AppError('같은 휴대폰 번호의 직원이 이미 있습니다.');
  const grade = s(data.grade) || row.grade;
  const org = await resolveOrg(env, ctx.projectId, s(data.job), s(data.headId), s(data.teamId), grade === '본부장');
  checkGrade(grade, org);
  // 승인 권한은 팀장·본부장에게만 줄 수 있다
  const canApprove = grade !== '직원' && data.canApprove === true ? 1 : 0;
  await run(env, 'UPDATE staff SET name = ?, nickname = ?, phone = ?, job = ?, head_id = ?, team_id = ?, grade = ?, can_approve = ? WHERE id = ? AND project_id = ?',
    name, nickname, phone, org.job, org.headId, org.teamId, grade, canApprove, row.id, ctx.projectId);
  await writeLog(env, adminName(ctx), '직원수정', row.id, name + (grade !== row.grade || canApprove !== row.can_approve ? ' / 직급 ' + grade + (canApprove ? '(승인권한)' : '') : ''), ctx.projectId);
  return {};
}

export async function adminRetire(env, data, ctx) {
  const row = await findStaffOrThrow(env, data.staffId, ctx.projectId);
  if (row.status === '퇴사') throw new AppError('이미 퇴사 처리된 직원입니다.');
  await run(env, `UPDATE staff SET status = '퇴사', device_change_request = '' WHERE id = ? AND project_id = ?`, row.id, ctx.projectId);
  await destroyUserSessions(env, 'staff', row.id);
  await writeLog(env, adminName(ctx), '직원퇴사', row.id, row.name, ctx.projectId);
  return {};
}

// 새 PIN 을 무작위로 만들어 한 번만 보여준다 (관리자가 직원에게 전달)
export async function adminResetPin(env, data, ctx) {
  const row = await findStaffOrThrow(env, data.staffId, ctx.projectId);
  if (row.status === '퇴사') throw new AppError('퇴사한 직원입니다.');
  const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
  await run(env, 'UPDATE staff SET pin_hash = ?, fail_count = 0 WHERE id = ? AND project_id = ?', await hashSecret(env, pin), row.id, ctx.projectId);
  await destroyUserSessions(env, 'staff', row.id);
  await writeLog(env, adminName(ctx), 'PIN초기화', row.id, row.name, ctx.projectId);
  return { pin };
}

export async function adminApproveDevice(env, data, ctx) {
  const row = await findStaffOrThrow(env, data.staffId, ctx.projectId);
  const newKey = row.device_change_request;
  if (!newKey) throw new AppError('기기 변경 요청이 없습니다.');
  if (await deviceInUse(env, newKey, row.id)) throw new AppError('새 휴대폰이 이미 다른 직원에게 등록되어 있어 승인할 수 없습니다.');
  await run(env, `UPDATE staff SET device_key = ?, device_change_request = '' WHERE id = ? AND project_id = ?`, newKey, row.id, ctx.projectId);
  await destroyUserSessions(env, 'staff', row.id); // 이전 폰의 로그인 해제
  await writeLog(env, adminName(ctx), '기기변경승인', row.id, row.name, ctx.projectId);
  return {};
}

// 현장 이동 (관리자 전용): 소속 현장을 바꾸고 새 현장의 직군·본부·팀으로 다시 배정한다.
// 직급(팀장·본부장)과 승인 권한은 현장마다 다르므로 '직원'으로 되돌린다. 지난 출근·예약 기록은 이전 현장에 그대로 남는다.
// data: { staffId, toProjectId, job, headId, teamId }  (ctx.projectId = 지금 소속 현장)
export async function adminMoveStaff(env, data, ctx) {
  const row = await findStaffOrThrow(env, data.staffId, ctx.projectId);
  if (row.status === '퇴사') throw new AppError('퇴사한 직원은 이동할 수 없습니다.');
  const to = await first(env, 'SELECT * FROM projects WHERE id = ?', s(data.toProjectId));
  if (!to) throw new AppError('이동할 현장을 찾을 수 없습니다.');
  if (to.id === row.project_id) throw new AppError('이미 이 현장 소속입니다.');
  if (to.status === '종료') throw new AppError('종료된 현장으로는 이동할 수 없습니다.');
  const org = await resolveOrg(env, to.id, s(data.job), s(data.headId), s(data.teamId));
  await run(env, `UPDATE staff SET project_id = ?, job = ?, head_id = ?, team_id = ?, grade = '직원', can_approve = 0 WHERE id = ? AND project_id = ?`,
    to.id, org.job, org.headId, org.teamId, row.id, ctx.projectId);
  await destroyUserSessions(env, 'staff', row.id); // 다시 로그인하면 새 현장으로 들어간다
  await writeLog(env, adminName(ctx), '직원현장이동', row.id, row.name + ' / ' + ctx.project.name + ' → ' + to.name, ctx.projectId);
  return {};
}

// ---------- 급여정보 (암호화되어 저장됨) ----------

async function findPayroll(env, staffId, projectId) {
  const p = await first(env,
    'SELECT p.* FROM payroll p JOIN staff s ON s.id = p.staff_id WHERE p.staff_id = ? AND s.project_id = ?', s(staffId), projectId);
  if (!p) throw new AppError('급여정보가 없습니다.');
  return p;
}

const maskRrn = (rrn) => (rrn.length >= 8 ? rrn.slice(0, 8) + '******' : '******');
const maskAccount = (no) => '******' + no.replace(/\D/g, '').slice(-4);

export async function adminPayrollGet(env, data, ctx) {
  const p = await findPayroll(env, data.staffId, ctx.projectId);
  return {
    name: p.name, rrn: maskRrn(await decryptText(env, p.rrn_enc)), bank: p.bank,
    accountNo: maskAccount(await decryptText(env, p.account_enc)), holder: p.holder, consentAt: p.consent_at
  };
}

// 원문은 관리자, 또는 관리자가 허용한 보조관리자만. 열람할 때마다 기록한다
export async function adminPayrollReveal(env, data, ctx) {
  if (ctx.role !== 'admin' && !ctx.account.allow_payroll) throw new AppError('급여정보 원문을 볼 권한이 없습니다. 관리자에게 요청해 주세요.', 'FORBIDDEN');
  const p = await findPayroll(env, data.staffId, ctx.projectId);
  await writeLog(env, adminName(ctx), '급여정보열람', p.staff_id, p.name, ctx.projectId);
  return { rrn: await decryptText(env, p.rrn_enc), accountNo: await decryptText(env, p.account_enc) };
}
