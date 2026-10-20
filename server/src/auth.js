// 로그인, 세션, 기기키 확인. 모든 action 은 세션 → 역할 → (직원이면) deviceKey 순으로 확인한다.
import { AppError, s, all, first, run, nowStr, hashSecret, safeEqual, sha256Hex, writeLog } from './util.js';
import { sendMail, mailConfigured } from './mail.js';

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

// ---------- 관리자 비밀번호 이메일 인증 초기화 ----------
// 1) accountResetRequest: 아이디를 받으면 계정에 등록된 이메일로 6자리 코드를 보낸다 (관리자 역할만)
// 2) accountResetConfirm: 코드와 새 비밀번호로 변경. 코드는 10분 유효, 5회 틀리면 30분 잠금
const RESET_CODE_MS = 10 * 60 * 1000;
const RESET_COOLDOWN_MS = 60 * 1000;
const RESET_LOCK_MS = 30 * 60 * 1000;
const RESET_MAX_ATTEMPTS = 5;

const resetHash = (env, accountId, code) => sha256Hex(env.SALT + ':reset:' + accountId + ':' + code);

export async function accountResetRequest(env, data) {
  if (!mailConfigured(env)) throw new AppError('이메일 발송이 아직 설정되지 않았습니다. 배포가이드의 "관리자 비밀번호 초기화"를 참고해 주세요.');
  // 계정이 있는지 없는지 알려 주지 않도록, 아래 어떤 경우에도 같은 응답을 준다
  const reply = { sent: true };
  const acc = await first(env, `SELECT * FROM accounts WHERE login_id = ? AND role = '관리자' AND active = 1`, s(data.loginId).trim());
  if (!acc || !acc.email) return reply;

  const now = Date.now();
  const cur = await first(env, 'SELECT * FROM password_resets WHERE account_id = ?', acc.id);
  if (cur && (cur.locked_until > now || now - cur.requested_at < RESET_COOLDOWN_MS)) return reply; // 잠금 중이거나 1분 안에 다시 요청

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
  await run(env,
    `INSERT INTO password_resets (account_id, code_hash, expires_at, attempts, requested_at, locked_until) VALUES (?, ?, ?, 0, ?, 0)
     ON CONFLICT(account_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0, requested_at = excluded.requested_at, locked_until = 0`,
    acc.id, await resetHash(env, acc.id, code), now + RESET_CODE_MS, now);
  const ok = await sendMail(env, acc.email, '[근태관리] 관리자 비밀번호 초기화 인증 코드',
    '관리자 비밀번호 초기화 인증 코드: ' + code + '\n\n10분 안에 입력해 주세요. 직접 요청하지 않았다면 이 메일을 무시하셔도 됩니다 (비밀번호는 바뀌지 않습니다).');
  if (!ok) {
    await run(env, 'DELETE FROM password_resets WHERE account_id = ?', acc.id);
    throw new AppError('이메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  await writeLog(env, acc.login_id, '비밀번호초기화요청', acc.id);
  return reply;
}

export async function accountResetConfirm(env, data) {
  const bad = new AppError('인증 코드가 올바르지 않거나 만료되었습니다.');
  const code = s(data.code).replace(/\D/g, '');
  const acc = await first(env, `SELECT * FROM accounts WHERE login_id = ? AND role = '관리자' AND active = 1`, s(data.loginId).trim());
  if (!acc) throw bad;
  const now = Date.now();
  const cur = await first(env, 'SELECT * FROM password_resets WHERE account_id = ?', acc.id);
  if (cur && cur.locked_until > now) throw new AppError('인증 코드를 5회 잘못 입력해 30분 동안 잠겼습니다. 나중에 다시 시도해 주세요.', 'LOCKED');
  if (!cur || !cur.code_hash || cur.expires_at < now) throw bad;

  if (!safeEqual(await resetHash(env, acc.id, code), cur.code_hash)) {
    const attempts = cur.attempts + 1;
    if (attempts >= RESET_MAX_ATTEMPTS) {
      await run(env, `UPDATE password_resets SET code_hash = '', attempts = ?, locked_until = ? WHERE account_id = ?`, attempts, now + RESET_LOCK_MS, acc.id);
      throw new AppError('인증 코드를 5회 잘못 입력해 30분 동안 잠겼습니다. 나중에 다시 시도해 주세요.', 'LOCKED');
    }
    await run(env, 'UPDATE password_resets SET attempts = ? WHERE account_id = ?', attempts, acc.id);
    throw bad;
  }
  // 코드가 맞아도 새 비밀번호가 규칙에 안 맞으면 코드는 그대로 두고 다시 입력하게 한다
  const newPw = s(data.newPassword);
  checkPasswordPolicy(newPw);
  await run(env, 'UPDATE accounts SET password_hash = ?, must_change_password = 0, fail_count = 0 WHERE id = ?', await hashSecret(env, newPw), acc.id);
  await run(env, 'DELETE FROM password_resets WHERE account_id = ?', acc.id);
  await destroyUserSessions(env, 'account', acc.id); // 이전에 로그인된 곳은 모두 로그아웃
  await writeLog(env, acc.login_id, '비밀번호초기화(이메일)', acc.id);
  // 본인이 한 일이 맞는지 알 수 있게 알림 메일 (실패해도 변경은 완료)
  await sendMail(env, acc.email, '[근태관리] 관리자 비밀번호가 변경되었습니다', '관리자 비밀번호가 방금 변경되었습니다. 본인이 한 일이 아니라면 즉시 서버 관리자에게 알려 주세요.').catch(() => false);
  return {};
}
