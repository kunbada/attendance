// 관리자 전용 action: 직원 관리, 급여정보, 설정(조직·계정 포함)
import { AppError, s, all, first, run, nowStr, newId, hashSecret, decryptText, getSettings, orgNameMap, writeLog } from './util.js';
import { MAX_FAILS, checkPasswordPolicy, destroyUserSessions } from './auth.js';
import { SALES_JOB, normalizePhone, resolveOrg, deviceInUse, checkGrade } from './staff.js';

const adminName = (ctx) => ctx.account.login_id;

async function findStaffOrThrow(env, id) {
  const row = await first(env, 'SELECT * FROM staff WHERE id = ?', s(id));
  if (!row) throw new AppError('직원을 찾을 수 없습니다.');
  return row;
}

// ---------- 직원 ----------

export async function adminStaffList(env) {
  const names = await orgNameMap(env);
  const rows = await all(env, 'SELECT * FROM staff ORDER BY joined_at DESC');
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
  const row = await findStaffOrThrow(env, data.staffId);
  if (row.status !== '대기') throw new AppError('승인 대기 중인 직원이 아닙니다.');
  await run(env, `UPDATE staff SET status = '활동', reject_reason = '', approved_at = ? WHERE id = ?`, nowStr(), row.id);
  await writeLog(env, adminName(ctx), '직원승인', row.id, row.name);
  return {};
}

export async function adminReject(env, data, ctx) {
  const row = await findStaffOrThrow(env, data.staffId);
  if (row.status !== '대기') throw new AppError('승인 대기 중인 직원이 아닙니다.');
  const reason = s(data.reason).trim();
  if (!reason) throw new AppError('반려 사유를 입력해 주세요.');
  await run(env, `UPDATE staff SET status = '반려', reject_reason = ? WHERE id = ?`, reason, row.id);
  await writeLog(env, adminName(ctx), '직원반려', row.id, row.name + ' / ' + reason);
  return {};
}

export async function adminUpdate(env, data, ctx) {
  const row = await findStaffOrThrow(env, data.staffId);
  const name = s(data.name).trim();
  const nickname = s(data.nickname).trim();
  if (!name || name.length > 20) throw new AppError('성명을 입력해 주세요.');
  if (nickname.length > 20) throw new AppError('예명은 20자 이내로 입력해 주세요.');
  const phone = normalizePhone(data.phone);
  if (await first(env, 'SELECT 1 FROM staff WHERE phone = ? AND id <> ?', phone, row.id)) throw new AppError('같은 휴대폰 번호의 직원이 이미 있습니다.');
  const grade = s(data.grade) || row.grade;
  const org = await resolveOrg(env, s(data.job), s(data.headId), s(data.teamId), grade === '본부장');
  checkGrade(grade, org);
  // 승인 권한은 팀장·본부장에게만 줄 수 있다
  const canApprove = grade !== '직원' && data.canApprove === true ? 1 : 0;
  await run(env, 'UPDATE staff SET name = ?, nickname = ?, phone = ?, job = ?, head_id = ?, team_id = ?, grade = ?, can_approve = ? WHERE id = ?',
    name, nickname, phone, org.job, org.headId, org.teamId, grade, canApprove, row.id);
  await writeLog(env, adminName(ctx), '직원수정', row.id, name + (grade !== row.grade || canApprove !== row.can_approve ? ' / 직급 ' + grade + (canApprove ? '(승인권한)' : '') : ''));
  return {};
}

export async function adminRetire(env, data, ctx) {
  const row = await findStaffOrThrow(env, data.staffId);
  if (row.status === '퇴사') throw new AppError('이미 퇴사 처리된 직원입니다.');
  await run(env, `UPDATE staff SET status = '퇴사', device_change_request = '' WHERE id = ?`, row.id);
  await destroyUserSessions(env, 'staff', row.id);
  await writeLog(env, adminName(ctx), '직원퇴사', row.id, row.name);
  return {};
}

// 새 PIN 을 무작위로 만들어 한 번만 보여준다 (관리자가 직원에게 전달)
export async function adminResetPin(env, data, ctx) {
  const row = await findStaffOrThrow(env, data.staffId);
  if (row.status === '퇴사') throw new AppError('퇴사한 직원입니다.');
  const pin = String(crypto.getRandomValues(new Uint32Array(1))[0] % 10000).padStart(4, '0');
  await run(env, 'UPDATE staff SET pin_hash = ?, fail_count = 0 WHERE id = ?', await hashSecret(env, pin), row.id);
  await destroyUserSessions(env, 'staff', row.id);
  await writeLog(env, adminName(ctx), 'PIN초기화', row.id, row.name);
  return { pin };
}

export async function adminApproveDevice(env, data, ctx) {
  const row = await findStaffOrThrow(env, data.staffId);
  const newKey = row.device_change_request;
  if (!newKey) throw new AppError('기기 변경 요청이 없습니다.');
  if (await deviceInUse(env, newKey, row.id)) throw new AppError('새 휴대폰이 이미 다른 직원에게 등록되어 있어 승인할 수 없습니다.');
  await run(env, `UPDATE staff SET device_key = ?, device_change_request = '' WHERE id = ?`, newKey, row.id);
  await destroyUserSessions(env, 'staff', row.id); // 이전 폰의 로그인 해제
  await writeLog(env, adminName(ctx), '기기변경승인', row.id, row.name);
  return {};
}

// ---------- 급여정보 (암호화되어 저장됨) ----------

async function findPayroll(env, staffId) {
  const p = await first(env, 'SELECT * FROM payroll WHERE staff_id = ?', s(staffId));
  if (!p) throw new AppError('급여정보가 없습니다.');
  return p;
}

const maskRrn = (rrn) => (rrn.length >= 8 ? rrn.slice(0, 8) + '******' : '******');
const maskAccount = (no) => '******' + no.replace(/\D/g, '').slice(-4);

export async function adminPayrollGet(env, data) {
  const p = await findPayroll(env, data.staffId);
  return {
    name: p.name, rrn: maskRrn(await decryptText(env, p.rrn_enc)), bank: p.bank,
    accountNo: maskAccount(await decryptText(env, p.account_enc)), holder: p.holder, consentAt: p.consent_at
  };
}

export async function adminPayrollReveal(env, data, ctx) {
  const p = await findPayroll(env, data.staffId);
  await writeLog(env, adminName(ctx), '급여정보열람', p.staff_id, p.name);
  return { rrn: await decryptText(env, p.rrn_enc), accountNo: await decryptText(env, p.account_enc) };
}

// ---------- 설정 ----------

const SETTING_RULES = {
  '현장명': (v) => {
    if (v.length > 40) throw new AppError('현장명은 40자 이내로 입력해 주세요.');
    return v;
  },
  'GPS허용거리m': (v) => {
    const n = Number(v);
    if (!isFinite(n) || n < 10 || n > 5000 || Math.floor(n) !== n) throw new AppError('GPS 허용거리는 10~5000 사이 정수(m)로 입력해 주세요.');
    return String(n);
  },
  '예약중복기준': (v) => {
    if (v !== '뒤5자리' && v !== '뒤5자리+성별') throw new AppError('예약 중복 기준 값이 올바르지 않습니다.');
    return v;
  },
  '텔레그램봇이름': (v) => {
    v = v.replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{0,64}$/.test(v)) throw new AppError('텔레그램 봇 이름은 영문·숫자·밑줄만 쓸 수 있습니다.');
    return v;
  }
};

export async function adminSettings(env) {
  return { settings: await getSettings(env) };
}

export async function adminSaveSettings(env, data, ctx) {
  const values = data.values || {};
  const clean = {};
  Object.keys(values).forEach((k) => {
    if (k === '출근셀카사용') return; // 셀카 기능은 제외되었다 (옛 화면이 보내도 무시)
    if (!SETTING_RULES[k]) throw new AppError('알 수 없는 설정 항목입니다: ' + k);
    clean[k] = SETTING_RULES[k](s(values[k]).trim());
  });
  for (const k of Object.keys(clean)) {
    await run(env, `INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, k, clean[k]);
  }
  await writeLog(env, adminName(ctx), '설정변경', '', Object.keys(clean).join(', '));
  return {};
}

// ---------- 조직 (본부·팀·직군) ----------

export async function adminOrgs(env) {
  const rows = await all(env, 'SELECT * FROM orgs ORDER BY sort_order, rowid');
  return { orgs: rows.map((o) => ({ id: o.id, kind: o.kind, name: o.name, parentId: o.parent_id, order: o.sort_order, active: !!o.active })) };
}

export async function adminSaveOrg(env, data, ctx) {
  const kind = s(data.kind);
  const name = s(data.name).trim();
  let parentId = s(data.parentId);
  const order = Number(data.order) || 0;
  const active = data.active === false ? 0 : 1;
  if (!['본부', '팀', '직군'].includes(kind)) throw new AppError('구분이 올바르지 않습니다.');
  if (!name || name.length > 30) throw new AppError('이름을 입력해 주세요. (30자 이내)');

  if (kind === '팀') {
    if (!(await first(env, `SELECT 1 FROM orgs WHERE kind = '본부' AND id = ?`, parentId))) throw new AppError('팀은 소속 본부를 선택해야 합니다.');
  } else {
    parentId = '';
  }
  let id = s(data.id);
  const current = id ? await first(env, 'SELECT * FROM orgs WHERE id = ?', id) : null;
  if (id && !current) throw new AppError('조직을 찾을 수 없습니다.');
  if (current && current.kind !== kind) throw new AppError('구분은 바꿀 수 없습니다.');
  if (await first(env, 'SELECT 1 FROM orgs WHERE kind = ? AND name = ? AND parent_id = ? AND id <> ?', kind, name, parentId, id)) {
    throw new AppError('같은 이름이 이미 있습니다.');
  }
  // '영업' 직군은 가입 화면의 본부→팀 선택 규칙이 이 이름에 걸려 있다
  if (current && kind === '직군' && current.name === SALES_JOB && (name !== SALES_JOB || !active)) {
    throw new AppError('"' + SALES_JOB + '" 직군은 이름을 바꾸거나 사용 중지할 수 없습니다.');
  }

  if (current) {
    await run(env, 'UPDATE orgs SET name = ?, parent_id = ?, sort_order = ?, active = ? WHERE id = ?', name, parentId, order, active, id);
    // 직원에는 직군 이름이 그대로 저장되어 있으므로 함께 바꾼다
    if (kind === '직군' && current.name !== name) await run(env, 'UPDATE staff SET job = ? WHERE job = ?', name, current.name);
    await writeLog(env, adminName(ctx), '조직수정', id, kind + ' ' + name);
  } else {
    id = newId('O');
    await run(env, 'INSERT INTO orgs (id, kind, name, parent_id, sort_order, active) VALUES (?, ?, ?, ?, ?, ?)', id, kind, name, parentId, order, active);
    await writeLog(env, adminName(ctx), '조직추가', id, kind + ' ' + name);
  }
  return { id };
}

// ---------- 데스크·관리자 계정 ----------

export async function adminAccounts(env) {
  const rows = await all(env, 'SELECT * FROM accounts ORDER BY rowid');
  return {
    accounts: rows.map((a) => ({
      id: a.id, loginId: a.login_id, name: a.name, role: a.role, active: !!a.active,
      locked: a.fail_count >= MAX_FAILS, mustChange: !!a.must_change_password
    }))
  };
}

// password 를 주면 새 비밀번호로 바뀌고(첫 로그인 때 변경 강제) 잠김도 풀린다
export async function adminSaveAccount(env, data, ctx) {
  const loginId = s(data.loginId).trim();
  const name = s(data.name).trim();
  const role = s(data.role);
  const password = s(data.password);
  const active = data.active === false ? 0 : 1;
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(loginId)) throw new AppError('아이디는 영문·숫자·_ . - 3~20자로 입력해 주세요.');
  if (!name) throw new AppError('이름을 입력해 주세요.');
  if (!['관리자', '데스크', '방명록'].includes(role)) throw new AppError('역할이 올바르지 않습니다.');

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

  if (current) {
    if (password) {
      await run(env, 'UPDATE accounts SET login_id = ?, name = ?, role = ?, active = ?, password_hash = ?, must_change_password = ?, fail_count = 0 WHERE id = ?',
        loginId, name, role, active, await hashSecret(env, password), role === '방명록' ? 0 : 1, id); // 방명록 태블릿 계정은 비밀번호 변경 화면이 없어 강제하지 않는다
    } else {
      await run(env, 'UPDATE accounts SET login_id = ?, name = ?, role = ?, active = ? WHERE id = ?', loginId, name, role, active, id);
    }
    if (password || !active) await destroyUserSessions(env, 'account', id);
    await writeLog(env, adminName(ctx), '계정수정', id, loginId);
  } else {
    id = newId('A');
    await run(env, 'INSERT INTO accounts (id, login_id, password_hash, role, name, active, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, loginId, await hashSecret(env, password), role, name, active, role === '방명록' ? 0 : 1);
    await writeLog(env, adminName(ctx), '계정추가', id, loginId);
  }
  return { id };
}
