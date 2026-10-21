// 개인별 지급 설정 (현장별 일당·지급주기·일급/수수료 대상·3.3% 공제). 적용 시작일마다 이력을 쌓는다.
import { AppError, s, all, first, run, nowStr, todayStr, newId, writeLog } from '../core/util.js';
import { CYCLES, PAY_MODES, SUPPLIER_MODE, loadPaySettings, loadJobSettings, makeResolver, settingAt } from './calc.js';
import { encryptText } from '../core/util.js';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
export const MAX_WAGE = 10000000;

const view = (r, suppliers) => (r ? {
  effectiveFrom: r.effective_from, dailyWage: r.daily_wage, cycle: r.cycle,
  dailyEnabled: !!r.daily_enabled, feeEnabled: !!r.fee_enabled, withhold: r.pay_mode === '3.3%', payMode: r.pay_mode,
  supplierId: r.supplier_id, supplierName: (suppliers && suppliers[r.supplier_id]) || '', createdBy: r.created_by, source: r.source || ''
} : null);

async function supplierNames(env, pid) {
  const m = {};
  (await all(env, 'SELECT id, name FROM suppliers WHERE project_id = ?', pid)).forEach((r) => { m[r.id] = r.name; });
  return m;
}

// 지급 방식과 (업체 일괄이면) 인력공급업체를 확인한다. payMode 가 없으면 예전 방식(withhold 체크)으로 읽는다.
async function readMode(env, pid, data) {
  let payMode = s(data.payMode);
  if (!payMode) payMode = data.withhold === false ? '공제없음' : '3.3%';
  if (!PAY_MODES.includes(payMode)) throw new AppError('지급 방식은 3.3% 공제 / 공제 없음 / 인력공급업체 일괄지급 중에서 선택해 주세요.');
  let supplierId = '';
  if (payMode === SUPPLIER_MODE) {
    supplierId = s(data.supplierId);
    if (!(await first(env, 'SELECT 1 FROM suppliers WHERE id = ? AND project_id = ? AND active = 1', supplierId, pid))) throw new AppError('인력공급업체를 선택해 주세요. (등록된 업체가 없으면 먼저 업체를 등록합니다)');
  }
  return { payMode, supplierId, withhold: payMode === '3.3%' ? 1 : 0 };
}

// 저장할 값 검증 (개인·직군 설정 공통)
function readValues(data) {
  const from = s(data.effectiveFrom) || todayStr();
  if (!isDate(from)) throw new AppError('적용 시작일 형식이 올바르지 않습니다.');
  const wage = Number(data.dailyWage);
  if (!Number.isInteger(wage) || wage < 0 || wage > MAX_WAGE) throw new AppError('일당은 0 ~ ' + MAX_WAGE.toLocaleString('en-US') + '원 사이의 정수로 입력해 주세요.');
  const cycle = s(data.cycle) || '월';
  if (!CYCLES.includes(cycle)) throw new AppError('지급 주기는 주 / 월 중에서 선택해 주세요.');
  const dailyEnabled = data.dailyEnabled === false ? 0 : 1;
  if (dailyEnabled && wage === 0) throw new AppError('일당 지급 대상이면 일당을 입력해 주세요. (대상이 아니면 [일당 지급 대상] 체크를 해제)');
  return { from, wage, cycle, dailyEnabled, feeEnabled: data.feeEnabled === true ? 1 : 0 };
}

// 활동 중인 직원과 현재 적용 중인 설정, 변경 이력
export async function paySettingList(env, data, ctx) {
  const pid = ctx.projectId;
  const today = todayStr();
  const staff = await all(env, `SELECT id, name, nickname, job, grade, head_id, team_id FROM staff WHERE project_id = ? AND status = '활동' ORDER BY name`, pid);
  const history = await loadPaySettings(env, pid);
  const jobHist = await loadJobSettings(env, pid);
  const sup = await supplierNames(env, pid);
  return {
    staff: staff.map((st) => {
      const h = history[st.id] || [];
      return {
        id: st.id, name: st.name, nickname: st.nickname, job: st.job, grade: st.grade,
        current: view(makeResolver(h, jobHist[st.job])(today), sup), // 개인 설정이 없으면 직군 기본 설정이 보인다 (source 로 구분)
        personal: !!h.length,
        upcoming: h.filter((r) => r.effective_from > today).map((r) => view(r, sup)),
        history: h.slice().reverse().map((r) => view(r, sup)),
        // 설정이 없을 때 화면에 채워 줄 기본값: 판매수수료는 영업 직군만 기본 대상
        defaults: { feeEnabled: st.job === '영업' }
      };
    })
  };
}

export async function paySettingSave(env, data, ctx) {
  const pid = ctx.projectId;
  const st = await first(env, 'SELECT id, name, job FROM staff WHERE id = ? AND project_id = ?', s(data.staffId), pid);
  if (!st) throw new AppError('직원을 찾을 수 없습니다.');
  const { from, wage, cycle, dailyEnabled, feeEnabled } = readValues(data);
  const { payMode, supplierId, withhold } = await readMode(env, pid, data);
  await run(env,
    `INSERT INTO staff_pay (id, project_id, staff_id, effective_from, daily_wage, cycle, daily_enabled, fee_enabled, withhold, pay_mode, supplier_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, staff_id, effective_from) DO UPDATE SET daily_wage = excluded.daily_wage, cycle = excluded.cycle,
       daily_enabled = excluded.daily_enabled, fee_enabled = excluded.fee_enabled, withhold = excluded.withhold, pay_mode = excluded.pay_mode,
       supplier_id = excluded.supplier_id, created_by = excluded.created_by, created_at = excluded.created_at`,
    newId('SP'), pid, st.id, from, wage, cycle, dailyEnabled, feeEnabled, withhold, payMode, supplierId, ctx.account.login_id, nowStr());
  await writeLog(env, ctx.account.login_id, '지급설정', st.id,
    st.name + ' / ' + from + '부터 일당 ' + wage + ' ' + cycle + ' 일당' + (dailyEnabled ? 'O' : 'X') + ' 수수료' + (feeEnabled ? 'O' : 'X') + ' 방식 ' + payMode, pid);
  return {};
}

// 개인 설정을 모두 지워 직군 기본 설정을 따르게 한다 (이미 확정된 정산 금액은 그대로)
export async function paySettingClear(env, data, ctx) {
  const pid = ctx.projectId;
  const st = await first(env, 'SELECT id, name FROM staff WHERE id = ? AND project_id = ?', s(data.staffId), pid);
  if (!st) throw new AppError('직원을 찾을 수 없습니다.');
  const res = await run(env, 'DELETE FROM staff_pay WHERE project_id = ? AND staff_id = ?', pid, st.id);
  await writeLog(env, ctx.account.login_id, '지급설정초기화', st.id, st.name + ' / 개인 설정 ' + (res.meta.changes || 0) + '건 삭제 → 직군 기본 적용', pid);
  return {};
}

// ---------- 직군별 기본 지급 설정 ----------

// 이 현장의 직군(사용 중) 목록과 현재 기본 설정·이력
export async function jobPayList(env, data, ctx) {
  const pid = ctx.projectId;
  const today = todayStr();
  const jobs = await all(env, `SELECT name FROM orgs WHERE project_id = ? AND kind = '직군' AND active = 1 ORDER BY sort_order, rowid`, pid);
  const counts = {};
  (await all(env, `SELECT job, COUNT(*) AS n FROM staff WHERE project_id = ? AND status = '활동' GROUP BY job`, pid)).forEach((r) => { counts[r.job] = r.n; });
  const hist = await loadJobSettings(env, pid);
  const sup = await supplierNames(env, pid);
  return {
    jobs: jobs.map((j) => {
      const h = hist[j.name] || [];
      return {
        job: j.name, people: counts[j.name] || 0, current: view(settingAt(h, today), sup),
        upcoming: h.filter((r) => r.effective_from > today).map((r) => view(r, sup)), history: h.slice().reverse().map((r) => view(r, sup)),
        defaults: { feeEnabled: j.name === '영업' } // 판매수수료는 영업 직군만 기본 대상
      };
    })
  };
}

export async function jobPaySave(env, data, ctx) {
  const pid = ctx.projectId;
  const job = s(data.job);
  if (!(await first(env, `SELECT 1 FROM orgs WHERE project_id = ? AND kind = '직군' AND name = ?`, pid, job))) throw new AppError('이 현장에 없는 직군입니다.');
  const { from, wage, cycle, dailyEnabled, feeEnabled } = readValues(data);
  const { payMode, supplierId, withhold } = await readMode(env, pid, data);
  await run(env,
    `INSERT INTO job_pay (id, project_id, job, effective_from, daily_wage, cycle, daily_enabled, fee_enabled, withhold, pay_mode, supplier_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, job, effective_from) DO UPDATE SET daily_wage = excluded.daily_wage, cycle = excluded.cycle,
       daily_enabled = excluded.daily_enabled, fee_enabled = excluded.fee_enabled, withhold = excluded.withhold, pay_mode = excluded.pay_mode,
       supplier_id = excluded.supplier_id, created_by = excluded.created_by, created_at = excluded.created_at`,
    newId('JP'), pid, job, from, wage, cycle, dailyEnabled, feeEnabled, withhold, payMode, supplierId, ctx.account.login_id, nowStr());
  await writeLog(env, ctx.account.login_id, '직군지급설정', job,
    from + '부터 일당 ' + wage + ' ' + cycle + ' 일당' + (dailyEnabled ? 'O' : 'X') + ' 수수료' + (feeEnabled ? 'O' : 'X') + ' 방식 ' + payMode, pid);
  return {};
}

// ---------- 인력공급업체 (용역비를 개인이 아니라 업체에 일괄 지급할 때) ----------

export async function paySupplierList(env, data, ctx) {
  const rows = await all(env, 'SELECT * FROM suppliers WHERE project_id = ? ORDER BY active DESC, name', ctx.projectId);
  // 계좌번호 원문은 화면에 보내지 않는다 (이체 파일을 만들 때만 풀어서 쓰고 기록을 남긴다)
  return { suppliers: rows.map((r) => ({ id: r.id, name: r.name, bizNo: r.biz_no, bank: r.bank, accountSet: !!r.account_enc, holder: r.holder, contact: r.contact, active: !!r.active })) };
}

export async function paySupplierSave(env, data, ctx) {
  const pid = ctx.projectId;
  const name = s(data.name).trim();
  if (!name || name.length > 40) throw new AppError('업체 이름을 입력해 주세요. (40자 이내)');
  const bizNo = s(data.bizNo).replace(/\D/g, '');
  if (bizNo && bizNo.length !== 10) throw new AppError('사업자등록번호는 숫자 10자리입니다.');
  const accountNo = s(data.accountNo).replace(/[^\d-]/g, '');
  if (accountNo && (accountNo.replace(/-/g, '').length < 6 || accountNo.length > 24)) throw new AppError('계좌번호를 확인해 주세요.');
  const bank = s(data.bank).trim().slice(0, 20), holder = s(data.holder).trim().slice(0, 30), contact = s(data.contact).trim().slice(0, 40);
  const active = data.active === false ? 0 : 1;
  const id = s(data.id);
  const cur = id ? await first(env, 'SELECT * FROM suppliers WHERE id = ? AND project_id = ?', id, pid) : null;
  if (id && !cur) throw new AppError('업체를 찾을 수 없습니다.');
  if (await first(env, 'SELECT 1 FROM suppliers WHERE project_id = ? AND name = ? AND id <> ?', pid, name, id)) throw new AppError('같은 이름의 업체가 이미 있습니다.');
  const enc = accountNo ? await encryptText(env, accountNo) : (cur ? cur.account_enc : ''); // 계좌번호를 비워 두면 기존 값 유지
  if (cur) {
    await run(env, 'UPDATE suppliers SET name = ?, biz_no = ?, bank = ?, account_enc = ?, holder = ?, contact = ?, active = ? WHERE id = ? AND project_id = ?',
      name, bizNo, bank, enc, holder, contact, active, id, pid);
    await writeLog(env, ctx.account.login_id, '업체수정', id, name, pid);
    return { id };
  }
  const nid = newId('SU');
  await run(env, 'INSERT INTO suppliers (id, project_id, name, biz_no, bank, account_enc, holder, contact, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid, pid, name, bizNo, bank, enc, holder, contact, active, nowStr());
  await writeLog(env, ctx.account.login_id, '업체등록', nid, name, pid);
  return { id: nid };
}
