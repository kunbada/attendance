// 직원 가입, 로그인, 내 정보, 기기 변경 요청
import { AppError, s, all, first, run, stmt, nowStr, todayStr, newId, hashSecret, safeEqual, encryptText, getSettings, writeLog } from './util.js';
import { MAX_FAILS, createSession } from './auth.js';

export const SALES_JOB = '영업'; // 이 직군만 본부→팀을 선택한다

// ---------- 공용 검사 ----------

export function normalizePhone(v) {
  const d = s(v).replace(/\D/g, '');
  if (!/^01[016789]\d{7,8}$/.test(d)) throw new AppError('휴대폰 번호 형식이 올바르지 않습니다.');
  return d;
}

export function requireDeviceKey(ctx) {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(ctx.deviceKey)) {
    throw new AppError('기기 정보를 확인할 수 없습니다. 페이지를 새로고침해 주세요.');
  }
  return ctx.deviceKey;
}

export function requirePin(v) {
  const p = s(v);
  if (!/^\d{4}$/.test(p)) throw new AppError('PIN은 숫자 4자리입니다.');
  return p;
}

export function activeOrgs(env) {
  return all(env, 'SELECT * FROM orgs WHERE active = 1 ORDER BY sort_order, rowid');
}

// 직군·본부·팀 선택이 유효한지 확인하고 저장할 값을 돌려준다
// allowNoTeam: 본부장은 팀 없이 본부에만 소속될 수 있다
export async function resolveOrg(env, job, headId, teamId, allowNoTeam = false) {
  const orgs = await activeOrgs(env);
  if (!orgs.some((o) => o.kind === '직군' && o.name === job)) throw new AppError('직군을 선택해 주세요.');
  if (job !== SALES_JOB) return { job, headId: '', teamId: '' };
  if (!orgs.some((o) => o.kind === '본부' && o.id === headId)) throw new AppError('본부를 선택해 주세요.');
  if (allowNoTeam && !teamId) return { job, headId, teamId: '' };
  if (!orgs.some((o) => o.kind === '팀' && o.id === teamId && o.parent_id === headId)) throw new AppError('팀을 선택해 주세요.');
  return { job, headId, teamId };
}

// 대기·활동 직원 중 이 기기를 이미 쓰는 사람이 있는지 (1폰 1인)
export async function deviceInUse(env, deviceKey, exceptStaffId) {
  return !!(await first(env,
    `SELECT 1 FROM staff WHERE status IN ('대기', '활동') AND id <> ? AND (device_key = ? OR device_change_request = ?) LIMIT 1`,
    exceptStaffId, deviceKey, deviceKey));
}

export async function checkPin(env, row, pin) {
  const lockedMsg = 'PIN을 5회 잘못 입력해 잠겼습니다. 관리자에게 PIN 초기화를 요청해 주세요.';
  if (row.fail_count >= MAX_FAILS) throw new AppError(lockedMsg, 'LOCKED');
  if (!safeEqual(await hashSecret(env, pin), row.pin_hash)) {
    const fails = row.fail_count + 1;
    await run(env, 'UPDATE staff SET fail_count = ? WHERE id = ?', fails, row.id);
    if (fails >= MAX_FAILS) throw new AppError(lockedMsg, 'LOCKED');
    throw new AppError('PIN이 올바르지 않습니다. (' + fails + '/' + MAX_FAILS + ')');
  }
  if (row.fail_count > 0) await run(env, 'UPDATE staff SET fail_count = 0 WHERE id = ?', row.id);
}

const staffSelf = (r) => ({ id: r.id, name: r.name, nickname: r.nickname, phone: r.phone, job: r.job, status: r.status, grade: r.grade });

export const GRADES = ['직원', '팀장', '본부장'];

// 팀장·본부장 지정이 소속과 맞는지 확인한다 (관리자 화면에서 지정할 때 사용)
export function checkGrade(grade, org) {
  if (!GRADES.includes(grade)) throw new AppError('직급 값이 올바르지 않습니다.');
  if (grade !== '직원' && org.job !== SALES_JOB) throw new AppError('팀장·본부장은 "' + SALES_JOB + '" 직군만 지정할 수 있습니다.');
  if (grade === '팀장' && !org.teamId) throw new AppError('팀장은 소속 팀이 있어야 합니다.');
  if (grade === '본부장' && !org.headId) throw new AppError('본부장은 소속 본부가 있어야 합니다.');
}

// ---------- action ----------

export async function publicOrgs(env) {
  const orgs = await activeOrgs(env);
  const pick = (kind) => orgs.filter((o) => o.kind === kind).map((o) => ({ id: o.id, name: o.name, parentId: o.parent_id }));
  const settings = await getSettings(env);
  return { siteName: settings['현장명'] || '', jobs: pick('직군'), heads: pick('본부'), teams: pick('팀'), salesJob: SALES_JOB };
}

export async function staffSignup(env, data, ctx) {
  const name = s(data.name).trim();
  const nickname = s(data.nickname).trim();
  if (!name || name.length > 20) throw new AppError('성명을 입력해 주세요.');
  if (nickname.length > 20) throw new AppError('예명은 20자 이내로 입력해 주세요.');
  const phone = normalizePhone(data.phone);
  const deviceKey = requireDeviceKey(ctx);
  const pin = requirePin(data.pin);
  const org = await resolveOrg(env, s(data.job), s(data.headId), s(data.teamId));

  const rrnDigits = s(data.rrn).replace(/\D/g, '');
  if (rrnDigits.length !== 13) throw new AppError('주민등록번호 13자리를 입력해 주세요.');
  const rrn = rrnDigits.slice(0, 6) + '-' + rrnDigits.slice(6);
  const bank = s(data.bank).trim();
  const accountNo = s(data.accountNo).replace(/[^\d-]/g, '');
  const holder = s(data.holder).trim();
  if (!bank) throw new AppError('은행을 선택해 주세요.');
  if (accountNo.replace(/-/g, '').length < 6 || accountNo.length > 24) throw new AppError('계좌번호를 확인해 주세요.');
  if (!holder) throw new AppError('예금주를 입력해 주세요.');
  if (data.consent !== true) throw new AppError('개인정보 수집·이용에 동의해 주세요.');

  const existing = await first(env, 'SELECT * FROM staff WHERE phone = ?', phone);
  if (existing) {
    if (existing.status === '대기') throw new AppError('이미 가입 신청되어 승인 대기 중인 번호입니다.');
    if (existing.status === '활동') throw new AppError('이미 가입된 번호입니다. 로그인해 주세요.');
    if (existing.status === '퇴사') throw new AppError('가입할 수 없는 번호입니다. 관리자에게 문의해 주세요.');
  }
  const staffId = existing ? existing.id : newId('S');
  if (await deviceInUse(env, deviceKey, staffId)) throw new AppError('이 휴대폰은 이미 다른 직원으로 등록되어 있습니다.');

  const now = nowStr();
  const pinHash = await hashSecret(env, pin);
  const rrnEnc = await encryptText(env, rrn);
  const accEnc = await encryptText(env, accountNo);
  const payroll = stmt(env,
    `INSERT INTO payroll (staff_id, name, rrn_enc, bank, account_enc, holder, consent_at) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(staff_id) DO UPDATE SET name = excluded.name, rrn_enc = excluded.rrn_enc, bank = excluded.bank,
       account_enc = excluded.account_enc, holder = excluded.holder, consent_at = excluded.consent_at`,
    staffId, name, rrnEnc, bank, accEnc, holder, now);
  const staff = existing
    ? stmt(env,
      `UPDATE staff SET name = ?, nickname = ?, phone = ?, job = ?, head_id = ?, team_id = ?, status = '대기', reject_reason = '',
         pin_hash = ?, fail_count = 0, device_key = ?, device_change_request = '', joined_at = ?, approved_at = '' WHERE id = ?`,
      name, nickname, phone, org.job, org.headId, org.teamId, pinHash, deviceKey, now, staffId)
    : stmt(env,
      `INSERT INTO staff (id, name, nickname, phone, job, head_id, team_id, status, pin_hash, device_key, joined_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '대기', ?, ?, ?)`,
      staffId, name, nickname, phone, org.job, org.headId, org.teamId, pinHash, deviceKey, now);
  try {
    await env.DB.batch([payroll, staff]); // 급여정보와 직원 정보는 함께 저장되거나 함께 취소된다
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw new AppError('이미 가입 신청된 번호입니다.');
    throw e;
  }
  await writeLog(env, name, existing ? '재가입신청' : '가입신청', staffId);
  return {};
}

export async function staffLogin(env, data, ctx) {
  const phone = normalizePhone(data.phone);
  const pin = requirePin(data.pin);
  const deviceKey = requireDeviceKey(ctx);
  const row = await first(env, 'SELECT * FROM staff WHERE phone = ?', phone);
  if (!row) throw new AppError('휴대폰 번호 또는 PIN이 올바르지 않습니다.');

  // PIN 을 먼저 확인한다: PIN 을 모르는 사람에게 상태·기기 정보를 알려주지 않기 위해
  await checkPin(env, row, pin);

  if (row.status === '대기') throw new AppError('관리자 승인을 기다리는 중입니다. 승인 후 로그인할 수 있습니다.');
  if (row.status === '반려') throw new AppError('가입이 반려되었습니다. 사유: ' + row.reject_reason + ' (다시 가입 신청할 수 있습니다)');
  if (row.status !== '활동') throw new AppError('로그인할 수 없는 계정입니다. 관리자에게 문의해 주세요.');

  if (row.device_key !== deviceKey) {
    if (row.device_change_request === deviceKey) {
      throw new AppError('기기 변경 승인을 기다리는 중입니다. 관리자에게 승인을 요청해 주세요.', 'DEVICE_PENDING');
    }
    throw new AppError('등록된 휴대폰이 아닙니다.', 'DEVICE_MISMATCH');
  }
  return { token: await createSession(env, 'staff', row.id), staff: staffSelf(row) };
}

export async function staffMe(env, data, ctx) {
  const today = todayStr();
  const month = today.slice(0, 7);
  const todayRec = await first(env, `SELECT time FROM attendance WHERE staff_id = ? AND date = ? AND result = '성공'`, ctx.staff.id, today);
  const days = await first(env,
    `SELECT COUNT(DISTINCT date) AS n FROM attendance WHERE staff_id = ? AND result = '성공' AND date >= ? AND date <= ?`,
    ctx.staff.id, month + '-01', month + '-31');
  const settings = await getSettings(env);
  return {
    staff: staffSelf(ctx.staff),
    checkedInToday: !!todayRec,
    checkedInAt: todayRec ? todayRec.time.slice(0, 5) : '',
    monthDays: days ? days.n : 0,
    telegramLinked: !!ctx.staff.telegram_id,
    canApprove: ctx.staff.grade !== '직원' && !!ctx.staff.can_approve,
    genderRequired: settings['예약중복기준'] === '뒤5자리+성별'
  };
}

export async function staffRequestDeviceChange(env, data, ctx) {
  const phone = normalizePhone(data.phone);
  const pin = requirePin(data.pin);
  const newKey = requireDeviceKey(ctx);
  const row = await first(env, 'SELECT * FROM staff WHERE phone = ?', phone);
  if (!row) throw new AppError('휴대폰 번호 또는 PIN이 올바르지 않습니다.');
  await checkPin(env, row, pin);
  if (row.status !== '활동') throw new AppError('승인된 직원만 기기 변경을 요청할 수 있습니다.');
  if (row.device_key === newKey) throw new AppError('이미 이 휴대폰이 등록되어 있습니다. 바로 로그인해 주세요.');
  if (await deviceInUse(env, newKey, row.id)) throw new AppError('이 휴대폰은 이미 다른 직원에게 등록되어 있습니다.');

  await run(env, 'UPDATE staff SET device_change_request = ? WHERE id = ?', newKey, row.id);
  await writeLog(env, row.name, '기기변경요청', row.id);
  return {};
}
