// 계정 관리 (관리자 전용, 현장과 무관한 action). 역할과 접근 가능한 현장을 함께 정한다.
import { AppError, s, all, first, stmt, newId, hashSecret, writeLog } from './util.js';
import { MAX_FAILS, ACCOUNT_ROLES, MULTI_PROJECT_ROLES, FIXED_PROJECT_ROLES, checkPasswordPolicy, destroyUserSessions } from './auth.js';

export async function adminAccounts(env) {
  const rows = await all(env, 'SELECT * FROM accounts ORDER BY rowid');
  const links = {};
  (await all(env, 'SELECT account_id, project_id FROM account_projects ORDER BY project_id')).forEach((l) => {
    (links[l.account_id] = links[l.account_id] || []).push(l.project_id);
  });
  return {
    accounts: rows.map((a) => ({
      id: a.id, loginId: a.login_id, name: a.name, role: a.role, active: !!a.active,
      locked: a.fail_count >= MAX_FAILS, mustChange: !!a.must_change_password, email: a.email,
      projectIds: links[a.id] || [], allowPayroll: !!a.allow_payroll, allowPayConfirm: !!a.allow_pay_confirm
    }))
  };
}

// 역할에 맞는 현장 지정인지 확인하고 저장할 현장 목록을 돌려준다
async function resolveAccountProjects(env, role, ids) {
  if (role === '관리자') return []; // 관리자는 전체 현장이라 따로 지정하지 않는다
  const projectIds = [...new Set((Array.isArray(ids) ? ids : []).map(s).filter(Boolean))];
  if (FIXED_PROJECT_ROLES.includes(role) && projectIds.length !== 1) throw new AppError(role + ' 계정은 현장을 1개 지정해야 합니다.');
  if (MULTI_PROJECT_ROLES.includes(role) && projectIds.length < 1) throw new AppError(role + ' 계정은 담당 현장을 1개 이상 지정해야 합니다.');
  for (const id of projectIds) {
    if (!(await first(env, 'SELECT 1 FROM projects WHERE id = ?', id))) throw new AppError('존재하지 않는 현장이 지정되었습니다.');
  }
  return projectIds;
}

// password 를 주면 새 비밀번호로 바뀌고(첫 로그인 때 변경 강제) 잠김도 풀린다
export async function adminSaveAccount(env, data, ctx) {
  const loginId = s(data.loginId).trim();
  const name = s(data.name).trim();
  const role = s(data.role);
  const password = s(data.password);
  const active = data.active === false ? 0 : 1;
  // 이메일은 관리자 계정에서만 쓴다 (비밀번호 초기화 인증 코드를 받는 주소)
  const email = role === '관리자' ? s(data.email).trim().toLowerCase() : '';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError('이메일 주소 형식이 올바르지 않습니다.');
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(loginId)) throw new AppError('아이디는 영문·숫자·_ . - 3~20자로 입력해 주세요.');
  if (!name) throw new AppError('이름을 입력해 주세요.');
  if (!ACCOUNT_ROLES.includes(role)) throw new AppError('역할이 올바르지 않습니다.');
  // 급여정보 원문 보기·지급 확정은 보조관리자에게만 계정별로 허용할 수 있다 (관리자는 항상 가능)
  const allowPayroll = role === '보조관리자' && data.allowPayroll === true ? 1 : 0;
  const allowPayConfirm = role === '보조관리자' && data.allowPayConfirm === true ? 1 : 0;

  let id = s(data.id);
  const current = id ? await first(env, 'SELECT * FROM accounts WHERE id = ?', id) : null;
  if (id && !current) throw new AppError('계정을 찾을 수 없습니다.');
  if (await first(env, 'SELECT 1 FROM accounts WHERE login_id = ? AND id <> ?', loginId, id)) throw new AppError('이미 사용 중인 아이디입니다.');
  // 자기 자신을 잠그면 아무도 관리자 화면에 못 들어간다
  if (current && current.id === ctx.account.id && (!active || role !== '관리자')) {
    throw new AppError('본인 계정은 사용 중지하거나 역할을 바꿀 수 없습니다.');
  }
  if (password) checkPasswordPolicy(password);
  else if (!current) throw new AppError('새 계정은 비밀번호가 필요합니다.');
  const projectIds = await resolveAccountProjects(env, role, data.projectIds);

  const mustChange = role === '방명록' ? 0 : 1; // 방명록 태블릿 계정은 비밀번호 변경 화면이 없어 강제하지 않는다
  const writes = [];
  if (current) {
    if (password) {
      writes.push(stmt(env, 'UPDATE accounts SET login_id = ?, name = ?, role = ?, active = ?, email = ?, allow_payroll = ?, allow_pay_confirm = ?, password_hash = ?, must_change_password = ?, fail_count = 0 WHERE id = ?',
        loginId, name, role, active, email, allowPayroll, allowPayConfirm, await hashSecret(env, password), mustChange, id));
    } else {
      writes.push(stmt(env, 'UPDATE accounts SET login_id = ?, name = ?, role = ?, active = ?, email = ?, allow_payroll = ?, allow_pay_confirm = ? WHERE id = ?',
        loginId, name, role, active, email, allowPayroll, allowPayConfirm, id));
    }
  } else {
    id = newId('A');
    writes.push(stmt(env, 'INSERT INTO accounts (id, login_id, password_hash, role, name, active, must_change_password, email, allow_payroll, allow_pay_confirm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, loginId, await hashSecret(env, password), role, name, active, mustChange, email, allowPayroll, allowPayConfirm));
  }
  // 계정과 담당 현장은 함께 저장되거나 함께 취소된다
  writes.push(stmt(env, 'DELETE FROM account_projects WHERE account_id = ?', id));
  projectIds.forEach((pid) => writes.push(stmt(env, 'INSERT INTO account_projects (account_id, project_id) VALUES (?, ?)', id, pid)));
  await env.DB.batch(writes);

  if (current && (password || !active)) await destroyUserSessions(env, 'account', id);
  await writeLog(env, ctx.account.login_id, current ? '계정수정' : '계정추가', id, loginId + ' / ' + role + (projectIds.length ? ' / 현장 ' + projectIds.join(',') : ''));
  return { id };
}
