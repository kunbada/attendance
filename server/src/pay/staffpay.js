// 개인별 지급 설정 (현장별 일당·지급주기·일급/수수료 대상·3.3% 공제). 적용 시작일마다 이력을 쌓는다.
import { AppError, s, all, first, run, nowStr, todayStr, newId, writeLog } from '../core/util.js';
import { CYCLES, loadPaySettings, settingAt } from './calc.js';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
export const MAX_WAGE = 10000000;

const view = (r) => (r ? {
  effectiveFrom: r.effective_from, dailyWage: r.daily_wage, cycle: r.cycle,
  dailyEnabled: !!r.daily_enabled, feeEnabled: !!r.fee_enabled, withhold: !!r.withhold, createdBy: r.created_by
} : null);

// 활동 중인 직원과 현재 적용 중인 설정, 변경 이력
export async function paySettingList(env, data, ctx) {
  const pid = ctx.projectId;
  const today = todayStr();
  const staff = await all(env, `SELECT id, name, nickname, job, grade, head_id, team_id FROM staff WHERE project_id = ? AND status = '활동' ORDER BY name`, pid);
  const history = await loadPaySettings(env, pid);
  return {
    staff: staff.map((st) => {
      const h = history[st.id] || [];
      return {
        id: st.id, name: st.name, nickname: st.nickname, job: st.job, grade: st.grade,
        current: view(settingAt(h, today)),
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
  const from = s(data.effectiveFrom) || todayStr();
  if (!isDate(from)) throw new AppError('적용 시작일 형식이 올바르지 않습니다.');
  const wage = Number(data.dailyWage);
  if (!Number.isInteger(wage) || wage < 0 || wage > MAX_WAGE) throw new AppError('일당은 0 ~ ' + MAX_WAGE.toLocaleString('en-US') + '원 사이의 정수로 입력해 주세요.');
  const cycle = s(data.cycle) || '월';
  if (!CYCLES.includes(cycle)) throw new AppError('지급 주기는 주 / 월 중에서 선택해 주세요.');
  const dailyEnabled = data.dailyEnabled === false ? 0 : 1;
  const feeEnabled = data.feeEnabled === true ? 1 : 0;
  const withhold = data.withhold === false ? 0 : 1;
  if (dailyEnabled && wage === 0) throw new AppError('일급 대상이면 일당을 입력해 주세요. (일급 대상이 아니면 [일급 대상] 체크를 해제)');
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
