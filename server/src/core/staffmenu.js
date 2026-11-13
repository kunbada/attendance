// 직원 앱 메뉴: 직군별로 방문예약·고객설문·부동산설문을 보이거나 숨긴다 (현장별 설정, project_settings '직원앱메뉴' JSON)
// 그리고 직원 본인의 출근현황(월별).
import { AppError, s, all, first, run, writeLog } from './util.js';
import { collectWork } from '../pay/calc.js';

export const MENU_KEYS = ['reserve', 'survey', 'realtor', 'counsel'];
export const MENU_LABEL = { reserve: '방문예약', survey: '고객설문', realtor: '부동산설문', counsel: '상담고객 앱' };
const KEY = '직원앱메뉴';

// { 직군이름: { reserve: true, survey: true, realtor: false } } — 적히지 않은 직군·메뉴는 보인다(기본)
export async function loadStaffMenu(env, pid) {
  const r = await first(env, 'SELECT value FROM project_settings WHERE project_id = ? AND key = ?', pid, KEY);
  try { const o = r && r.value ? JSON.parse(r.value) : {}; return o && typeof o === 'object' ? o : {}; } catch (e) { return {}; }
}
// 상담고객 앱은 기본으로 이름에 "상담"이 들어간 직군만 (다른 직군은 관리자가 켜야 한다). 나머지 메뉴는 기본으로 보인다
const defaultOn = (k, job) => (k === 'counsel' ? /상담/.test(s(job)) : true);
export function menuFor(conf, job) {
  const j = (conf && conf[job]) || {};
  return Object.fromEntries(MENU_KEYS.map((k) => [k, j[k] === undefined ? defaultOn(k, job) : j[k] !== false]));
}
// 직원이 숨겨진 메뉴의 기능을 부르면 서버에서도 막는다
export async function requireStaffMenu(env, ctx, key) {
  if (ctx.role !== 'staff' && ctx.role !== 'counsel') return;
  if (!menuFor(await loadStaffMenu(env, ctx.projectId), ctx.staff.job)[key]) throw new AppError(MENU_LABEL[key] + '은(는) 이 직군에서 쓸 수 없습니다. 관리자에게 문의해 주세요.', 'FORBIDDEN');
}

export async function staffMenuGet(env, data, ctx) {
  const jobs = (await all(env, `SELECT name FROM orgs WHERE project_id = ? AND kind = '직군' AND active = 1 ORDER BY sort_order, name`, ctx.projectId)).map((r) => r.name);
  const conf = await loadStaffMenu(env, ctx.projectId);
  return { jobs, menus: MENU_KEYS.map((k) => ({ key: k, label: MENU_LABEL[k] })), menu: Object.fromEntries(jobs.map((j) => [j, menuFor(conf, j)])) };
}

export async function staffMenuSave(env, data, ctx) {
  const pid = ctx.projectId;
  const jobs = new Set((await all(env, `SELECT name FROM orgs WHERE project_id = ? AND kind = '직군'`, pid)).map((r) => r.name));
  const raw = data.menu && typeof data.menu === 'object' ? data.menu : {};
  const out = {};
  for (const job of Object.keys(raw)) {
    if (!jobs.has(job)) throw new AppError('이 현장에 없는 직군입니다: ' + job);
    out[job] = Object.fromEntries(MENU_KEYS.map((k) => [k, raw[job][k] === undefined ? defaultOn(k, job) : raw[job][k] !== false]));
  }
  await run(env, 'INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value', pid, KEY, JSON.stringify(out));
  const hidden = Object.keys(out).map((j) => j + ':' + MENU_KEYS.filter((k) => !out[j][k]).map((k) => MENU_LABEL[k]).join('·')).filter((x) => !x.endsWith(':'));
  await writeLog(env, ctx.account.login_id, '직원앱메뉴', pid, hidden.length ? '숨김 ' + hidden.join(' / ') : '모두 보임', pid);
  return {};
}

// 내 출근현황: 한 달의 날짜별 출근 시각과 관리자 보정(인정·반일·불인정), 근무일수(보정 반영)
export async function staffMyAttendance(env, data, ctx) {
  const pid = ctx.projectId, me = ctx.staff;
  const month = s(data.month) || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AppError('월 형식이 올바르지 않습니다.');
  const from = month + '-01', to = month + '-31';
  const times = {};
  (await all(env, `SELECT date, MIN(time) AS t FROM attendance WHERE project_id = ? AND staff_id = ? AND result = '성공' AND date >= ? AND date <= ? GROUP BY date`, pid, me.id, from, to))
    .forEach((r) => { times[r.date] = s(r.t).slice(0, 5); });
  const adj = {};
  (await all(env, 'SELECT date, kind, reason FROM attendance_adjust WHERE project_id = ? AND staff_id = ? AND date >= ? AND date <= ?', pid, me.id, from, to))
    .forEach((r) => { adj[r.date] = { kind: r.kind, reason: r.reason }; });
  const work = (await collectWork(env, pid, from, to, me.id))[me.id] || [];
  const days = work.map((w) => ({
    date: w.date, time: times[w.date] || '', adjust: adj[w.date] ? adj[w.date].kind : '', reason: adj[w.date] ? adj[w.date].reason : '', units: w.units
  })).sort((a, b) => b.date.localeCompare(a.date));
  const count = (k) => days.filter((d) => d.adjust === k).length;
  return {
    month, days,
    summary: { checkins: Object.keys(times).length, workDays: days.reduce((a, d) => a + d.units, 0) / 2, 인정: count('인정'), 반일: count('반일'), 불인정: count('불인정') }
  };
}
