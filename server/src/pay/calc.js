// 용역비 계산. 금액은 모두 원 단위 정수이고, 반올림(절사) 규칙은 이 파일에만 둔다.
import { all } from '../core/util.js';

export const CYCLES = ['주', '월'];
export const ADJUST_KINDS = ['인정', '불인정', '반일'];
// 하루 = 2 단위(반일 = 1). 정수로만 계산해 소수 오차가 생기지 않게 한다
const UNITS = { 성공: 2, 인정: 2, 불인정: 0, 반일: 1 };

// 하루치 금액 = 일당 × (단위 / 2), 원 단위 절사
export const dayAmount = (wage, units) => Math.floor((wage * units) / 2);

// 공제: 소득세 3% + 지방소득세 0.3%, 각각 원 단위 절사해 따로 표시한다
export function deductions(gross, withhold) {
  if (!withhold || gross <= 0) return { income: 0, local: 0 };
  return { income: Math.floor((gross * 30) / 1000), local: Math.floor((gross * 3) / 1000) };
}

// 기간 안의 직원별 근무 내역: 원본 출근(성공) 위에 관리자 보정을 덮어쓴다.
// 반환 { [staffId]: [{ date, units, note }] } (units 0 도 보정 근거를 보이려고 남긴다)
export async function collectWork(env, projectId, from, to, staffId = '') {
  const only = staffId ? ' AND staff_id = ?' : '';
  const extra = staffId ? [staffId] : [];
  const att = await all(env,
    `SELECT DISTINCT staff_id, date FROM attendance WHERE project_id = ? AND result = '성공' AND date >= ? AND date <= ?${only}`, projectId, from, to, ...extra);
  const adj = await all(env,
    `SELECT staff_id, date, kind, reason FROM attendance_adjust WHERE project_id = ? AND date >= ? AND date <= ?${only}`, projectId, from, to, ...extra);
  const days = {};
  const put = (sid, date, units, note) => { ((days[sid] = days[sid] || {})[date]) = { date, units, note }; };
  att.forEach((r) => put(r.staff_id, r.date, UNITS.성공, '출근'));
  adj.forEach((r) => put(r.staff_id, r.date, UNITS[r.kind], r.kind + (r.reason ? ' (' + r.reason + ')' : '')));
  const out = {};
  Object.keys(days).forEach((sid) => { out[sid] = Object.values(days[sid]).sort((a, b) => a.date.localeCompare(b.date)); });
  return out;
}

// 개인 지급 설정 이력: 날짜 d 에 적용되는 설정 = effective_from <= d 중 가장 늦은 것
export async function loadPaySettings(env, projectId) {
  const rows = await all(env, 'SELECT * FROM staff_pay WHERE project_id = ? ORDER BY effective_from', projectId);
  const by = {};
  rows.forEach((r) => { (by[r.staff_id] = by[r.staff_id] || []).push(r); });
  return by;
}

export function settingAt(history, date) {
  let cur = null;
  (history || []).forEach((r) => { if (r.effective_from <= date) cur = r; });
  return cur;
}

// 근무 내역 + 설정 → 한 사람의 명세 (금액 계산)
export function priceItem(days, history, periodTo, adjustAmount = 0) {
  let units = 0, base = 0;
  const detail = days.map((d) => {
    const st = settingAt(history, d.date);
    const wage = st ? st.daily_wage : 0;
    const amount = dayAmount(wage, d.units);
    units += d.units;
    base += amount;
    return { date: d.date, units: d.units, wage, amount, note: d.note };
  });
  const gross = base + adjustAmount;
  const last = settingAt(history, periodTo);
  const withhold = last ? last.withhold : 1;
  const tax = deductions(gross, withhold);
  return { units, base, gross, incomeTax: tax.income, localTax: tax.local, net: gross - tax.income - tax.local, withhold, detail };
}
