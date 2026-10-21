// 개인별 지급 설정 (현장별 일당·지급주기·일급/수수료 대상·3.3% 공제). 적용 시작일마다 이력을 쌓는다.
import { AppError, s, all, first, run, nowStr, todayStr, newId, writeLog } from '../core/util.js';
import { CYCLES, loadPaySettings, loadJobSettings, makeResolver, settingAt } from './calc.js';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
export const MAX_WAGE = 10000000;

const view = (r) => (r ? {
  effectiveFrom: r.effective_from, dailyWage: r.daily_wage, cycle: r.cycle,
  dailyEnabled: !!r.daily_enabled, feeEnabled: !!r.fee_enabled, withhold: !!r.withhold, createdBy: r.created_by, source: r.source || ''
} : null);

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
  return { from, wage, cycle, dailyEnabled, feeEnabled: data.feeEnabled === true ? 1 : 0, withhold: data.withhold === false ? 0 : 1 };
}

// 활동 중인 직원과 현재 적용 중인 설정, 변경 이력
export async function paySettingList(env, data, ctx) {
  const pid = ctx.projectId;
  const today = todayStr();
  const staff = await all(env, `SELECT id, name, nickname, job, grade, head_id, team_id FROM staff WHERE project_id = ? AND status = '활동' ORDER BY name`, pid);
  const history = await loadPaySettings(env, pid);
  const jobHist = await loadJobSettings(env, pid);
  return {
    staff: staff.map((st) => {
      const h = history[st.id] || [];
      return {
        id: st.id, name: st.name, nickname: st.nickname, job: st.job, grade: st.grade,
        current: view(makeResolver(h, jobHist[st.job])(today)), // 개인 설정이 없으면 직군 기본 설정이 보인다 (source 로 구분)
        personal: !!h.length,
        upcoming: h.filter((r) => r.effective_from > today).map(view),
        history: h.slice().reverse().map(view),
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
  const { from, wage, cycle, dailyEnabled, feeEnabled, withhold } = readValues(data);
  await run(env,
    `INSERT INTO staff_pay (id, project_id, staff_id, effective_from, daily_wage, cycle, daily_enabled, fee_enabled, withhold, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, staff_id, effective_from) DO UPDATE SET daily_wage = excluded.daily_wage, cycle = excluded.cycle,
       daily_enabled = excluded.daily_enabled, fee_enabled = excluded.fee_enabled, withhold = excluded.withhold,
       created_by = excluded.created_by, created_at = excluded.created_at`,
    newId('SP'), pid, st.id, from, wage, cycle, dailyEnabled, feeEnabled, withhold, ctx.account.login_id, nowStr());
  await writeLog(env, ctx.account.login_id, '지급설정', st.id,
    st.name + ' / ' + from + '부터 일당 ' + wage + ' ' + cycle + ' 일급' + (dailyEnabled ? 'O' : 'X') + ' 수수료' + (feeEnabled ? 'O' : 'X') + ' 공제' + (withhold ? 'O' : 'X'), pid);
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
  return {
    jobs: jobs.map((j) => {
      const h = hist[j.name] || [];
      return {
        job: j.name, people: counts[j.name] || 0, current: view(settingAt(h, today)),
        upcoming: h.filter((r) => r.effective_from > today).map(view), history: h.slice().reverse().map(view),
        defaults: { feeEnabled: j.name === '영업' } // 판매수수료는 영업 직군만 기본 대상
      };
    })
  };
}

export async function jobPaySave(env, data, ctx) {
  const pid = ctx.projectId;
  const job = s(data.job);
  if (!(await first(env, `SELECT 1 FROM orgs WHERE project_id = ? AND kind = '직군' AND name = ?`, pid, job))) throw new AppError('이 현장에 없는 직군입니다.');
  const { from, wage, cycle, dailyEnabled, feeEnabled, withhold } = readValues(data);
  await run(env,
    `INSERT INTO job_pay (id, project_id, job, effective_from, daily_wage, cycle, daily_enabled, fee_enabled, withhold, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, job, effective_from) DO UPDATE SET daily_wage = excluded.daily_wage, cycle = excluded.cycle,
       daily_enabled = excluded.daily_enabled, fee_enabled = excluded.fee_enabled, withhold = excluded.withhold,
       created_by = excluded.created_by, created_at = excluded.created_at`,
    newId('JP'), pid, job, from, wage, cycle, dailyEnabled, feeEnabled, withhold, ctx.account.login_id, nowStr());
  await writeLog(env, ctx.account.login_id, '직군지급설정', job,
    from + '부터 일당 ' + wage + ' ' + cycle + ' 일당' + (dailyEnabled ? 'O' : 'X') + ' 수수료' + (feeEnabled ? 'O' : 'X') + ' 공제' + (withhold ? 'O' : 'X'), pid);
  return {};
}
