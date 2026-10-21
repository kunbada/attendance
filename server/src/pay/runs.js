// 일급 정산 회차: 작성 → 검토 → 확정 → 지급완료. 확정된 회차는 수정할 수 없다 (정정은 다음 회차의 조정 금액으로).
// 정산 단위는 "현장 + 기간"이고, 대상은 그 기간에 그 현장에서 일한 사람이다 (지금 어느 현장 소속인지와 무관).
import { AppError, s, all, first, run, stmt, nowStr, todayStr, newId, decryptText, writeLog } from '../core/util.js';
import { CYCLES, collectWork, loadPaySettings, settingAt, priceItem, deductions } from './calc.js';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const EDITABLE = ['작성', '검토'];
const MAX_ADJUST = 100000000;

// 지급 확정·지급완료 처리 권한: 관리자, 또는 관리자가 허용한 보조관리자
function requireConfirmRight(ctx) {
  if (ctx.role !== 'admin' && !ctx.account.allow_pay_confirm) throw new AppError('지급 확정 권한이 없습니다. 관리자에게 요청해 주세요.', 'FORBIDDEN');
}

async function getRun(env, id, projectId) {
  const r = await first(env, 'SELECT * FROM pay_runs WHERE id = ? AND project_id = ?', s(id), projectId);
  if (!r) throw new AppError('정산 회차를 찾을 수 없습니다.');
  return r;
}

function assertEditable(r) {
  if (!EDITABLE.includes(r.status)) throw new AppError('이미 ' + r.status + ' 상태라 수정할 수 없습니다. 정정은 다음 회차의 조정 금액으로 처리해 주세요.');
}

const runView = (r) => ({
  id: r.id, title: r.title, kind: r.kind, cycle: r.cycle, from: r.period_from, to: r.period_to, status: r.status, memo: r.memo,
  createdBy: r.created_by, createdAt: r.created_at, reviewedAt: r.reviewed_at, confirmedBy: r.confirmed_by, confirmedAt: r.confirmed_at, paidAt: r.paid_at
});

const itemView = (i) => ({
  id: i.id, staffId: i.staff_id, name: i.name, days: i.units / 2, baseAmount: i.base_amount, adjustAmount: i.adjust_amount, adjustMemo: i.adjust_memo,
  gross: i.gross, incomeTax: i.income_tax, localTax: i.local_tax, net: i.net, withhold: !!i.withhold, detail: JSON.parse(i.detail_json || '[]')
});

// 기간 안에서 일한 사람들의 명세를 계산한다. 대상이 아닌 사람은 이유와 함께 notIncluded 로 돌려준다.
async function buildItems(env, pid, cycle, from, to, adjustOf, exceptRunId) {
  const work = await collectWork(env, pid, from, to);
  const settings = await loadPaySettings(env, pid);
  const ids = Object.keys(work);
  const names = {};
  for (let i = 0; i < ids.length; i += 80) {
    const part = ids.slice(i, i + 80);
    (await all(env, `SELECT id, name FROM staff WHERE id IN (${part.map(() => '?').join(',')})`, ...part)).forEach((r) => { names[r.id] = r.name; });
  }
  // 같은 기간이 겹치는 다른 회차에 이미 들어간 사람은 중복 지급을 막으려고 제외한다
  const taken = {};
  (await all(env,
    `SELECT i.staff_id, r.title FROM pay_items i JOIN pay_runs r ON r.id = i.run_id
     WHERE r.project_id = ? AND r.kind = '일급' AND r.period_from <= ? AND r.period_to >= ? AND r.id <> ?`, pid, to, from, exceptRunId || '')).forEach((r) => { taken[r.staff_id] = r.title; });

  const items = [], notIncluded = [];
  ids.forEach((sid) => {
    const days = work[sid];
    if (!days.some((d) => d.units > 0)) return; // 불인정으로 0일이 된 사람
    const hist = settings[sid];
    const cur = settingAt(hist, to);
    const name = names[sid] || '(알 수 없음)';
    const skip = (reason) => notIncluded.push({ staffId: sid, name, reason });
    if (!cur) return skip('지급 설정(일당)이 없습니다');
    if (!cur.daily_enabled) return skip('일급 대상이 아닙니다');
    if (cur.cycle !== cycle) return skip('지급 주기가 다릅니다 (' + cur.cycle + ')');
    if (taken[sid]) return skip('다른 회차(' + taken[sid] + ')에 이미 포함되었습니다');
    const adj = adjustOf[sid] || { amount: 0, memo: '' };
    const p = priceItem(days, hist, to, adj.amount);
    items.push({
      id: newId('PI'), staff_id: sid, name, units: p.units, base_amount: p.base, adjust_amount: adj.amount, adjust_memo: adj.memo,
      gross: p.gross, income_tax: p.incomeTax, local_tax: p.localTax, net: p.net, withhold: p.withhold, detail_json: JSON.stringify(p.detail)
    });
  });
  items.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { items, notIncluded };
}

// 명세 여러 줄을 한 문장(json_each)으로 넣는다 (D1 의 요청당 쿼리 수 제한을 아끼려는 것)
function insertItems(env, runId, pid, items) {
  if (!items.length) return null;
  return stmt(env,
    `INSERT INTO pay_items (id, run_id, project_id, staff_id, name, units, base_amount, adjust_amount, adjust_memo, gross, income_tax, local_tax, net, withhold, detail_json)
     SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.staff_id'), json_extract(value, '$.name'), json_extract(value, '$.units'),
       json_extract(value, '$.base_amount'), json_extract(value, '$.adjust_amount'), json_extract(value, '$.adjust_memo'), json_extract(value, '$.gross'),
       json_extract(value, '$.income_tax'), json_extract(value, '$.local_tax'), json_extract(value, '$.net'), json_extract(value, '$.withhold'), json_extract(value, '$.detail_json')
     FROM json_each(?)`, runId, pid, JSON.stringify(items));
}

const totals = (items) => ({
  people: items.length, gross: items.reduce((n, i) => n + i.gross, 0), tax: items.reduce((n, i) => n + i.income_tax + i.local_tax, 0), net: items.reduce((n, i) => n + i.net, 0)
});

export async function payRunList(env, data, ctx) {
  const rows = await all(env,
    `SELECT r.*, COUNT(i.id) AS people, COALESCE(SUM(i.gross), 0) AS gross, COALESCE(SUM(i.income_tax + i.local_tax), 0) AS tax, COALESCE(SUM(i.net), 0) AS net
     FROM pay_runs r LEFT JOIN pay_items i ON i.run_id = r.id WHERE r.project_id = ? GROUP BY r.id ORDER BY r.period_from DESC, r.created_at DESC`, ctx.projectId);
  return { runs: rows.map((r) => ({ ...runView(r), people: r.people, gross: r.gross, tax: r.tax, net: r.net })) };
}

export async function payRunCreate(env, data, ctx) {
  const pid = ctx.projectId;
  const cycle = s(data.cycle);
  const from = s(data.from), to = s(data.to);
  if (!CYCLES.includes(cycle)) throw new AppError('지급 주기는 주 / 월 중에서 선택해 주세요.');
  if (!isDate(from) || !isDate(to)) throw new AppError('기간 형식이 올바르지 않습니다.');
  if (from > to) throw new AppError('시작일이 종료일보다 늦습니다.');
  const span = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  if (cycle === '주' && span > 7) throw new AppError('주 단위 정산은 기간이 7일 이내여야 합니다.');
  if (cycle === '월' && from.slice(0, 7) !== to.slice(0, 7)) throw new AppError('월 단위 정산은 같은 달 안에서 선택해 주세요.');
  if (to > todayStr()) throw new AppError('오늘 이후 날짜는 정산할 수 없습니다.');
  const title = s(data.title).trim().slice(0, 40) || (from + ' ~ ' + to + ' ' + cycle + '급');
  const { items, notIncluded } = await buildItems(env, pid, cycle, from, to, {}, '');
  if (!items.length) throw new AppError('이 기간에 정산할 대상이 없습니다.' + (notIncluded.length ? ' (제외된 사람 ' + notIncluded.length + '명: ' + notIncluded.slice(0, 3).map((n) => n.name + ' - ' + n.reason).join(', ') + ')' : ''));
  const id = newId('PR');
  const writes = [stmt(env,
    `INSERT INTO pay_runs (id, project_id, kind, title, cycle, period_from, period_to, status, memo, created_by, created_at) VALUES (?, ?, '일급', ?, ?, ?, ?, '작성', ?, ?, ?)`,
    id, pid, title, cycle, from, to, s(data.memo).trim().slice(0, 100), ctx.account.login_id, nowStr())];
  writes.push(insertItems(env, id, pid, items));
  await env.DB.batch(writes);
  await writeLog(env, ctx.account.login_id, '정산작성', id, title + ' / ' + items.length + '명', pid);
  return { id, ...totals(items), notIncluded };
}

export async function payRunGet(env, data, ctx) {
  const r = await getRun(env, data.runId, ctx.projectId);
  const items = await all(env, 'SELECT * FROM pay_items WHERE run_id = ? AND project_id = ? ORDER BY name', r.id, ctx.projectId);
  let notIncluded = [];
  if (EDITABLE.includes(r.status)) notIncluded = (await buildItems(env, ctx.projectId, r.cycle, r.period_from, r.period_to, {}, r.id)).notIncluded;
  return { run: runView(r), items: items.map(itemView), totals: totals(items), notIncluded, canConfirm: ctx.role === 'admin' || !!ctx.account.allow_pay_confirm };
}

async function adjustMap(env, runId, pid) {
  const map = {};
  (await all(env, 'SELECT staff_id, adjust_amount, adjust_memo FROM pay_items WHERE run_id = ? AND project_id = ?', runId, pid)).forEach((i) => {
    if (i.adjust_amount) map[i.staff_id] = { amount: i.adjust_amount, memo: i.adjust_memo };
  });
  return map;
}

// 근태 보정·지급 설정이 바뀐 뒤 다시 계산 (조정 금액은 유지). 검토 중이었다면 다시 작성 상태로 돌아간다.
export async function payRunRecalc(env, data, ctx) {
  const pid = ctx.projectId;
  const r = await getRun(env, data.runId, pid);
  assertEditable(r);
  const { items, notIncluded } = await buildItems(env, pid, r.cycle, r.period_from, r.period_to, await adjustMap(env, r.id, pid), r.id);
  const writes = [stmt(env, 'DELETE FROM pay_items WHERE run_id = ? AND project_id = ?', r.id, pid),
    stmt(env, `UPDATE pay_runs SET status = '작성', reviewed_at = '' WHERE id = ? AND project_id = ?`, r.id, pid)];
  const ins = insertItems(env, r.id, pid, items);
  if (ins) writes.push(ins);
  await env.DB.batch(writes);
  await writeLog(env, ctx.account.login_id, '정산재계산', r.id, r.title + ' / ' + items.length + '명', pid);
  return { ...totals(items), notIncluded };
}

export async function payRunReview(env, data, ctx) {
  const pid = ctx.projectId;
  const r = await getRun(env, data.runId, pid);
  if (r.status !== '작성') throw new AppError('작성 상태의 회차만 검토로 넘길 수 있습니다.');
  const n = await first(env, 'SELECT COUNT(*) AS n FROM pay_items WHERE run_id = ? AND project_id = ?', r.id, pid);
  if (!n || !n.n) throw new AppError('명세가 없는 회차입니다.');
  await run(env, `UPDATE pay_runs SET status = '검토', reviewed_at = ? WHERE id = ? AND project_id = ? AND status = '작성'`, nowStr(), r.id, pid);
  await writeLog(env, ctx.account.login_id, '정산검토', r.id, r.title, pid);
  return {};
}

// 확정: 검토를 마친 뒤 근태·설정이 바뀌지 않았는지 다시 계산해 보고 같을 때만 확정한다
export async function payRunConfirm(env, data, ctx) {
  requireConfirmRight(ctx);
  const pid = ctx.projectId;
  const r = await getRun(env, data.runId, pid);
  if (r.status !== '검토') throw new AppError('검토 상태의 회차만 확정할 수 있습니다.');
  const stored = await all(env, 'SELECT staff_id, units, gross FROM pay_items WHERE run_id = ? AND project_id = ?', r.id, pid);
  const fresh = (await buildItems(env, pid, r.cycle, r.period_from, r.period_to, await adjustMap(env, r.id, pid), r.id)).items;
  const same = stored.length === fresh.length && stored.every((a) => { const b = fresh.find((x) => x.staff_id === a.staff_id); return b && b.units === a.units && b.gross === a.gross; });
  if (!same) throw new AppError('검토 이후 근태 보정이나 지급 설정이 바뀌었습니다. [다시 계산]한 뒤 검토부터 다시 진행해 주세요.');
  const res = await run(env, `UPDATE pay_runs SET status = '확정', confirmed_by = ?, confirmed_at = ? WHERE id = ? AND project_id = ? AND status = '검토'`, ctx.account.login_id, nowStr(), r.id, pid);
  if (!res.meta.changes) throw new AppError('이미 처리된 회차입니다.');
  const t = totals(stored.length ? await all(env, 'SELECT * FROM pay_items WHERE run_id = ? AND project_id = ?', r.id, pid) : []);
  await writeLog(env, ctx.account.login_id, '정산확정', r.id, r.title + ' / ' + t.people + '명 / 실지급 ' + t.net, pid);
  return {};
}

export async function payRunPaid(env, data, ctx) {
  requireConfirmRight(ctx);
  const pid = ctx.projectId;
  const r = await getRun(env, data.runId, pid);
  if (r.status !== '확정') throw new AppError('확정된 회차만 지급완료로 표시할 수 있습니다.');
  await run(env, `UPDATE pay_runs SET status = '지급완료', paid_at = ? WHERE id = ? AND project_id = ? AND status = '확정'`, nowStr(), r.id, pid);
  await writeLog(env, ctx.account.login_id, '지급완료', r.id, r.title, pid);
  return {};
}

export async function payRunDelete(env, data, ctx) {
  const pid = ctx.projectId;
  const r = await getRun(env, data.runId, pid);
  assertEditable(r);
  await env.DB.batch([stmt(env, 'DELETE FROM pay_items WHERE run_id = ? AND project_id = ?', r.id, pid), stmt(env, 'DELETE FROM pay_runs WHERE id = ? AND project_id = ?', r.id, pid)]);
  await writeLog(env, ctx.account.login_id, '정산삭제', r.id, r.title, pid);
  return {};
}

// 개인 명세의 조정 금액(±) 입력. 사유 필수. 세금은 조정 후 금액 기준으로 다시 계산한다.
export async function payItemSave(env, data, ctx) {
  const pid = ctx.projectId;
  const r = await getRun(env, data.runId, pid);
  assertEditable(r);
  const it = await first(env, 'SELECT * FROM pay_items WHERE run_id = ? AND project_id = ? AND staff_id = ?', r.id, pid, s(data.staffId));
  if (!it) throw new AppError('명세를 찾을 수 없습니다.');
  const amount = Number(data.adjustAmount);
  const memo = s(data.adjustMemo).trim();
  if (!Number.isInteger(amount) || Math.abs(amount) > MAX_ADJUST) throw new AppError('조정 금액은 원 단위 정수로 입력해 주세요.');
  if (amount !== 0 && !memo) throw new AppError('조정 사유를 입력해 주세요.');
  if (memo.length > 100) throw new AppError('조정 사유는 100자 이내로 입력해 주세요.');
  const gross = it.base_amount + amount;
  if (gross < 0) throw new AppError('조정 후 금액이 0원보다 작을 수 없습니다.');
  const tax = deductions(gross, it.withhold);
  await env.DB.batch([
    stmt(env, 'UPDATE pay_items SET adjust_amount = ?, adjust_memo = ?, gross = ?, income_tax = ?, local_tax = ?, net = ? WHERE id = ? AND project_id = ?',
      amount, amount ? memo : '', gross, tax.income, tax.local, gross - tax.income - tax.local, it.id, pid),
    stmt(env, `UPDATE pay_runs SET status = '작성', reviewed_at = '' WHERE id = ? AND project_id = ?`, r.id, pid)
  ]);
  await writeLog(env, ctx.account.login_id, '정산조정', r.id, it.name + ' / ' + amount + (memo ? ' / ' + memo : ''), pid);
  return {};
}

// 이체용 파일 데이터 (은행·계좌 원문). 관리자 또는 급여 원문 보기가 허용된 계정만, 열람 기록을 남긴다.
export async function payTransferExport(env, data, ctx) {
  if (ctx.role !== 'admin' && !ctx.account.allow_payroll) throw new AppError('이체 파일은 관리자 또는 급여정보 열람이 허용된 계정만 만들 수 있습니다.', 'FORBIDDEN');
  const pid = ctx.projectId;
  const r = await getRun(env, data.runId, pid);
  if (!['확정', '지급완료'].includes(r.status)) throw new AppError('확정된 회차만 이체 파일을 만들 수 있습니다.');
  const items = await all(env, 'SELECT * FROM pay_items WHERE run_id = ? AND project_id = ? AND net > 0 ORDER BY name', r.id, pid);
  const rows = [];
  for (const i of items) {
    const p = await first(env, 'SELECT bank, account_enc, holder FROM payroll WHERE staff_id = ?', i.staff_id);
    rows.push({ name: i.name, bank: p ? p.bank : '', accountNo: p ? await decryptText(env, p.account_enc) : '', holder: p ? p.holder : '', amount: i.net, missing: !p });
  }
  await writeLog(env, ctx.account.login_id, '이체파일', r.id, r.title + ' / ' + rows.length + '명 / ' + rows.reduce((n, x) => n + x.amount, 0), pid);
  return { title: r.title, rows };
}

// 직원앱 '내 지급내역': 본인 명세만, 확정된 회차만. 현장을 옮겼어도 이전 현장 지급분까지 모두 보인다.
export async function staffMyPay(env, data, ctx) {
  const rows = await all(env,
    `SELECT i.*, r.title, r.cycle, r.period_from, r.period_to, r.status, r.paid_at, p.name AS project_name
     FROM pay_items i JOIN pay_runs r ON r.id = i.run_id JOIN projects p ON p.id = i.project_id
     WHERE i.staff_id = ? AND r.status IN ('확정', '지급완료') ORDER BY r.period_to DESC, r.created_at DESC LIMIT 60`, ctx.staff.id);
  return {
    pays: rows.map((i) => ({
      project: i.project_name, title: i.title, from: i.period_from, to: i.period_to, status: i.status, paidAt: i.paid_at,
      days: i.units / 2, gross: i.gross, incomeTax: i.income_tax, localTax: i.local_tax, net: i.net, adjustAmount: i.adjust_amount, adjustMemo: i.adjust_memo,
      detail: JSON.parse(i.detail_json || '[]').map((d) => ({ date: d.date, days: d.units / 2, amount: d.amount, note: d.note }))
    }))
  };
}
