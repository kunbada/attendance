// 로그인, 세션, 기기키 확인. 모든 action 은 세션 → 역할 → (직원이면) deviceKey 순으로 확인한다.
import { AppError, s, all, first, run, nowStr, hashSecret, safeEqual, writeLog } from './util.js';

export const MAX_FAILS = 5;
// 직원은 매일 로그인하기 번거로우니 30일, 관리자·데스크는 공용 PC 가능성 때문에 12시간
// 방명록 태블릿은 매번 로그인할 수 없으니 30일 (분실 시 관리자가 계정을 중지하면 즉시 무효)
const LIFETIME_MS = { staff: 30 * 24 * 3600 * 1000, account: 12 * 3600 * 1000 };
const KIOSK_LIFETIME_MS = 30 * 24 * 3600 * 1000;

export function checkPasswordPolicy(pw) {
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw new AppError('비밀번호는 8자 이상, 영문과 숫자를 함께 써 주세요.');
  }
}

// ---------- 세션 ----------

export async function createSession(env, kind, userId, lifetimeMs = LIFETIME_MS[kind]) {
  if (Math.random() < 0.1) await run(env, 'DELETE FROM sessions WHERE expires_at < ?', Date.now()); // 만료 세션 정리
  const token = crypto.randomUUID();
  await run(env, 'INSERT INTO sessions (token, kind, user_id, expires_at) VALUES (?, ?, ?, ?)', token, kind, userId, Date.now() + lifetimeMs);
  return token;
}

async function getSession(env, token) {
  token = s(token);
  if (!/^[0-9a-f-]{36}$/.test(token)) return null;
  return first(env, 'SELECT kind, user_id FROM sessions WHERE token = ? AND expires_at > ?', token, Date.now());
}

export function destroySession(env, token) {
  return run(env, 'DELETE FROM sessions WHERE token = ?', s(token));
}

export function destroyUserSessions(env, kind, userId) {
  return run(env, 'DELETE FROM sessions WHERE kind = ? AND user_id = ?', kind, userId);
}

// ---------- 요청 인증 ----------

export async function authenticate(env, req, roles) {
  const ctx = { role: 'public', token: s(req.token), deviceKey: s(req.deviceKey) };
  if (roles.includes('public')) return ctx;

  const session = await getSession(env, ctx.token);
  if (!session) throw new AppError('로그인이 필요합니다. 다시 로그인해 주세요.', 'AUTH');

  if (session.kind === 'staff') {
    const staff = await first(env, 'SELECT * FROM staff WHERE id = ?', session.user_id);
    if (!staff || staff.status !== '활동') throw new AppError('로그인이 필요합니다. 다시 로그인해 주세요.', 'AUTH');
    if (!ctx.deviceKey || staff.device_key !== ctx.deviceKey) throw new AppError('등록된 휴대폰이 아닙니다.', 'DEVICE_MISMATCH');
    ctx.role = 'staff';
    ctx.staff = staff;
  } else {
    const account = await first(env, 'SELECT * FROM accounts WHERE id = ?', session.user_id);
    if (!account || !account.active) throw new AppError('로그인이 필요합니다. 다시 로그인해 주세요.', 'AUTH');
    ctx.role = account.role === '관리자' ? 'admin' : account.role === '방명록' ? 'kiosk' : 'desk';
    ctx.account = account;
  }

  const allowed = roles.includes(ctx.role) || (ctx.role === 'admin' && roles.includes('desk'));
  if (!allowed) throw new AppError('권한이 없습니다.', 'FORBIDDEN');
  return ctx;
}

// ---------- 관리자·데스크 로그인 ----------

export async function accountLogin(env, data) {
  const loginId = s(data.loginId).trim();
  const password = s(data.password);
  const acc = await first(env, 'SELECT * FROM accounts WHERE login_id = ? AND active = 1', loginId);
  if (!acc) throw new AppError('아이디 또는 비밀번호가 올바르지 않습니다.');

  const lockedMsg = '비밀번호를 5회 잘못 입력해 잠겼습니다. 관리자에게 문의해 주세요.';
  if (acc.fail_count >= MAX_FAILS) throw new AppError(lockedMsg, 'LOCKED');
  if (!safeEqual(await hashSecret(env, password), acc.password_hash)) {
    const fails = acc.fail_count + 1;
    await run(env, 'UPDATE accounts SET fail_count = ? WHERE id = ?', fails, acc.id);
    if (fails >= MAX_FAILS) throw new AppError(lockedMsg, 'LOCKED');
    throw new AppError('아이디 또는 비밀번호가 올바르지 않습니다. (' + fails + '/' + MAX_FAILS + ')');
  }
  if (acc.fail_count > 0) await run(env, 'UPDATE accounts SET fail_count = 0 WHERE id = ?', acc.id);

  return {
    token: await createSession(env, 'account', acc.id, acc.role === '방명록' ? KIOSK_LIFETIME_MS : LIFETIME_MS.account),
    account: { name: acc.name, role: acc.role, mustChangePassword: !!acc.must_change_password }
  };
}

export async function accountChangePassword(env, data, ctx) {
  const oldPw = s(data.oldPassword);
  const newPw = s(data.newPassword);
  if (!safeEqual(await hashSecret(env, oldPw), ctx.account.password_hash)) throw new AppError('현재 비밀번호가 올바르지 않습니다.');
  checkPasswordPolicy(newPw);
  if (newPw === oldPw) throw new AppError('새 비밀번호가 현재 비밀번호와 같습니다.');
  await run(env, 'UPDATE accounts SET password_hash = ?, must_change_password = 0 WHERE id = ?', await hashSecret(env, newPw), ctx.account.id);
  await writeLog(env, ctx.account.login_id, '비밀번호변경', ctx.account.id);
  return {};
}

export async function authLogout(env, data, ctx) {
  await destroySession(env, ctx.token);
  return {};
}
