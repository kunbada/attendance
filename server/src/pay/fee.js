// 판매수수료 (5단계): 수수료 규칙, 계약 → 받는 사람별 수수료 계산, 수수료 정산 회차.
// 계산 순서
//   1) 계약앱 계약 중 담당 직원(staffId)이 연결되고 해약이 아닌 것
//   2) 계약금을 낸 날(완납일)이 정산 시작일 이후 ~ 이번 정산 종료일 사이이고 아직 수수료를 주지 않은 것
//   3) 적용할 규칙(동호 > 동 > 타입 > 기본) → 직원·팀장·본부장 몫 (또는 본부장 일괄)
//   4) 받는 사람별 합계 + 해약 환수 차감 → 3.3% 공제 등은 일급 정산과 같은 방식
import { AppError, s, all, first, run, stmt, nowStr, todayStr, newId, writeLog } from '../core/util.js';
import { SUPPLIER_MODE, loadPaySettings, loadJobSettings, makeResolver, deductions } from './calc.js';
import { insertItems } from './items.js';
import { loadFeeSettings, saveFeeSetting, feeSync } from './feeledger.js';

const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const MAX_AMOUNT = 100000000;
const SCOPES = ['기본', '타입', '동', '동호'];
const RANK = { 기본: 1, 타입: 2, 동: 3, 동호: 4 };
// 계약앱 core.js 의 ALL_STAGES 와 같다 (현장 설정에 회차가 없을 때)
const ALL_STAGES = ['계약금 1차', '계약금 2차', '중도금 1차', '중도금 2차', '중도금 3차', '중도금 4차', '중도금 5차', '중도금 6차', '잔금'];
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const parse = (text) => { try { return JSON.parse(text) || {}; } catch (e) { return {}; } };
const num = (v) => Number(v) || 0;

// ====================================================================
// 규칙
// ====================================================================
const ruleView = (r) => ({
  id: r.id, scope: r.scope, scopeValue: r.scope_value, feeBasis: r.fee_basis, staffAmount: r.staff_amount, leaderAmount: r.leader_amount, headAmount: r.head_amount,
  payMode: r.pay_mode, dateFrom: r.date_from, dateTo: r.date_to, active: !!r.active, memo: r.memo, createdBy: r.created_by
});

export async function feeRuleList(env, data, ctx) {
  const pid = ctx.projectId;
  const rows = await all(env, 'SELECT * FROM fee_rules WHERE project_id = ?', pid);
  rows.sort((a, b) => (b.active - a.active) || (RANK[b.scope] - RANK[a.scope]) || a.scope_value.localeCompare(b.scope_value, 'ko') || a.created_at.localeCompare(b.created_at));
  // 규칙을 만들 때 고를 수 있게 계약앱의 타입·동 목록과 수수료기준 값을 함께 준다
  const units = await all(env, `SELECT DISTINCT json_extract(json, '$.type') AS type, substr(id, 1, instr(id, '-') - 1) AS dong FROM ct_records WHERE project_id = ? AND col = 'units' AND deleted = 0`, pid);
  const bases = await all(env, `SELECT DISTINCT json_extract(json, '$.fee') AS fee FROM ct_records WHERE project_id = ? AND col = 'contracts' AND deleted = 0 AND staff_id_g > ''`, pid);
  return {
    rules: rows.map(ruleView),
    types: [...new Set(units.map((u) => s(u.type)).filter(Boolean))].sort(),
    dongs: [...new Set(units.map((u) => s(u.dong)).filter(Boolean))].sort(),
    feeBases: [...new Set(bases.map((b) => s(b.fee)).filter(Boolean))].sort()
  };
}

function readAmount(v, label) {
  const n = Number(v === '' || v === undefined || v === null ? 0 : v);
  if (!Number.isInteger(n) || n < 0 || n > MAX_AMOUNT) throw new AppError(label + '은(는) 0 ~ ' + MAX_AMOUNT.toLocaleString('en-US') + '원 사이의 정수로 입력해 주세요.');
  return n;
}

export async function feeRuleSave(env, data, ctx) {
  const pid = ctx.projectId;
  const scope = s(data.scope);
  if (!SCOPES.includes(scope)) throw new AppError('적용 범위는 기본 / 타입 / 동 / 동호 중에서 선택해 주세요.');
  let value = s(data.scopeValue).trim();
  if (scope === '기본') value = '';
  else if (!value) throw new AppError('적용 범위(' + scope + ')의 값을 입력해 주세요.');
  if (scope === '동') value = value.replace(/동$/, '').trim();
  if (scope === '동호') {
    const list = value.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
    if (!list.length || list.some((x) => !/^\d{3}-\d{3,4}$/.test(x))) throw new AppError('동호는 101-1203 형식으로, 여러 개면 쉼표로 구분해 입력해 주세요.');
    value = [...new Set(list)].join(',');
  }
  if (value.length > 2000) throw new AppError('적용 범위가 너무 깁니다.');
  const staff = readAmount(data.staffAmount, '직원 몫'), leader = readAmount(data.leaderAmount, '팀장 몫'), head = readAmount(data.headAmount, '본부장 몫');
  if (staff + leader + head === 0) throw new AppError('직원·팀장·본부장 몫 중 하나는 0원보다 커야 합니다.');
  const payMode = s(data.payMode) || '구분';
  if (!['구분', '본부장일괄'].includes(payMode)) throw new AppError('지급 방식은 구분 지급 / 본부장 일괄 중에서 선택해 주세요.');
  const from = s(data.dateFrom), to = s(data.dateTo);
  if ((from && !isDate(from)) || (to && !isDate(to))) throw new AppError('적용 기간 형식이 올바르지 않습니다.');
  if (from && to && from > to) throw new AppError('적용 기간의 시작일이 종료일보다 늦습니다.');
  const basis = s(data.feeBasis).trim().slice(0, 20);
  const memo = s(data.memo).trim().slice(0, 100);
  const active = data.active === false ? 0 : 1;
  const id = s(data.id);
  if (id) {
    const res = await run(env,
      `UPDATE fee_rules SET scope = ?, scope_value = ?, fee_basis = ?, staff_amount = ?, leader_amount = ?, head_amount = ?, pay_mode = ?, date_from = ?, date_to = ?, active = ?, memo = ? WHERE id = ? AND project_id = ?`,
      scope, value, basis, staff, leader, head, payMode, from, to, active, memo, id, pid);
    if (!res.meta.changes) throw new AppError('규칙을 찾을 수 없습니다.');
    await writeLog(env, ctx.account.login_id, '수수료규칙수정', id, scope + ' ' + value + ' / ' + staff + '·' + leader + '·' + head, pid);
    return { id };
  }
  const nid = newId('FR');
  await run(env,
    `INSERT INTO fee_rules (id, project_id, scope, scope_value, fee_basis, staff_amount, leader_amount, head_amount, pay_mode, date_from, date_to, active, memo, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    nid, pid, scope, value, basis, staff, leader, head, payMode, from, to, active, memo, ctx.account.login_id, nowStr());
  await writeLog(env, ctx.account.login_id, '수수료규칙추가', nid, scope + ' ' + value + ' / ' + staff + '·' + leader + '·' + head, pid);
  return { id: nid };
}

export async function feeRuleDelete(env, data, ctx) {
  const res = await run(env, 'DELETE FROM fee_rules WHERE id = ? AND project_id = ?', s(data.id), ctx.projectId);
  if (!res.meta.changes) throw new AppError('규칙을 찾을 수 없습니다.');
  await writeLog(env, ctx.account.login_id, '수수료규칙삭제', s(data.id), '', ctx.projectId);
  return {};
}

// 계약 하나에 적용할 규칙: 동호 > 동 > 타입 > 기본, 같은 범위면 수수료기준이 지정된 것 > 계약일 시작이 늦은 것 > 나중에 만든 것
export function pickRule(rules, c, unit) {
  const dh = s(c.dongho), dong = dh.split('-')[0], type = unit ? s(unit.type) : '', date = s(c.date), basis = s(c.fee);
  const ok = rules.filter((r) => {
    if (!r.active) return false;
    if (r.date_from && (!date || date < r.date_from)) return false;
    if (r.date_to && (!date || date > r.date_to)) return false;
    if (r.fee_basis && r.fee_basis !== basis) return false;
    if (r.scope === '기본') return true;
    if (r.scope === '타입') return r.scope_value === type;
    if (r.scope === '동') return r.scope_value === dong;
    return r.scope_value.split(',').includes(dh);
  });
  ok.sort((a, b) => (RANK[b.scope] - RANK[a.scope]) || ((b.fee_basis ? 1 : 0) - (a.fee_basis ? 1 : 0)) || b.date_from.localeCompare(a.date_from) || b.created_at.localeCompare(a.created_at));
  return ok[0] || null;
}

// ====================================================================
// 계약금 완납일
// ====================================================================
const dayOf = (t) => s(t).slice(0, 10).replace(/\./g, '-');

// 필요한 회차를 모두 채운 날(가장 늦은 회차 기준). 약정액이 없거나 아직 덜 냈으면 null
export function completionDate(deposits, needStages, amounts) {
  if (!needStages.length) return null;
  let last = '';
  for (const stage of needStages) {
    const req = num((amounts || {})[stage]);
    if (req <= 0) return null;
    const list = deposits.filter((d) => d.cat === stage).sort((a, b) => s(a.t).localeCompare(s(b.t)));
    let cum = 0, date = '';
    for (const d of list) { cum += num(d.inn) - num(d.out); if (cum >= req) { date = dayOf(d.t); break; } }
    if (!date) return null;
    if (date > last) last = date;
  }
  return last;
}

// ====================================================================
// 계산
// ====================================================================
async function loadConfig(env, pid) {
  const row = await first(env, `SELECT json FROM ct_records WHERE project_id = ? AND col = 'settings' AND id = 'main' AND deleted = 0`, pid);
  const cfg = row ? parse(row.json) : {};
  return { stages: Array.isArray(cfg.stages) && cfg.stages.length ? cfg.stages : ALL_STAGES };
}

async function loadContractData(env, pid, stages, after) {
  // 필요한 항목만 SQLite 가 꺼내 준다 (수백 건의 JSON 을 통째로 풀면 서버 계산 시간이 길어진다)
  const rows = await all(env,
    `SELECT id, dongho_g AS dongho, status_g AS status, staff_id_g AS staffId, json_extract(json, '$.date') AS date, json_extract(json, '$.fee') AS fee, json_extract(json, '$.name') AS name
     FROM ct_records WHERE project_id = ? AND col = 'contracts' AND deleted = 0 AND staff_id_g > ''`, pid);
  const contracts = rows.filter((c) => c.status !== '해약' && c.dongho && c.staffId);
  const donghos = [...new Set(contracts.map((c) => c.dongho))];
  const units = new Map(), deps = new Map();
  for (const part of chunk(donghos, 80)) {
    const ph = part.map(() => '?').join(',');
    (await all(env, `SELECT id, json_extract(json, '$.type') AS type, json_extract(json, '$.amounts') AS amounts FROM ct_records WHERE project_id = ? AND col = 'units' AND id IN (${ph})`, pid, ...part))
      .forEach((r) => units.set(r.id, { type: r.type, amounts: parse(r.amounts) }));
    (await all(env,
      `SELECT dongho_g AS dongho, json_extract(json, '$.cat') AS cat, json_extract(json, '$.inn') AS inn, json_extract(json, '$.out') AS out, json_extract(json, '$.t') AS t
       FROM ct_records WHERE project_id = ? AND col = 'deposits' AND deleted = 0 AND dongho_g IN (${ph})`, pid, ...part))
      .forEach((r) => { (deps.get(r.dongho) || deps.set(r.dongho, []).get(r.dongho)).push(r); });
  }
  const contractStages = stages.filter((x) => x.startsWith('계약금'));
  return { contracts, units, deps, contractStages, need: (amounts) => {
    const have = contractStages.filter((x) => num((amounts || {})[x]) > 0);
    return after === '계약금1차' ? have.slice(0, 1) : have;
  } };
}

// 정산 대상 계약과 받는 사람별 몫을 계산한다. 원장에는 아무것도 쓰지 않는다 (feeSync 로 해약 환수 줄만 먼저 정리)
export async function computeFee(env, pid, from, to, opts = {}) {
  if (opts.sync) await feeSync(env, pid);
  const st = await loadFeeSettings(env, pid);
  const start = st.start || from;
  const cfg = await loadConfig(env, pid);
  const data = await loadContractData(env, pid, cfg.stages, st.after);
  const rules = await all(env, 'SELECT * FROM fee_rules WHERE project_id = ? AND active = 1', pid);

  // 이미 수수료를 준 계약(몫)과, 다른 작성·검토 중 회차에 들어간 계약·환수
  const issued = new Set();
  (await all(env, `SELECT contract_id FROM fee_ledger WHERE project_id = ? AND kind IN ('지급', '대체') AND state <> '취소'`, pid)).forEach((r) => issued.add(r.contract_id));
  const taken = new Set(), takenRefund = new Set();
  (await all(env,
    `SELECT i.detail_json FROM pay_items i JOIN pay_runs r ON r.id = i.run_id WHERE r.project_id = ? AND r.kind = '수수료' AND r.status IN ('작성', '검토') AND r.id <> ?`, pid, opts.exceptRunId || ''))
    .forEach((r) => parse2(r.detail_json).forEach((d) => { if (d.t === '지급') taken.add(d.cid); else if (d.lid) takenRefund.add(d.lid); }));

  // 직원 정보: 이 현장 직원 전부 + 계약 담당자가 다른 현장으로 옮겼다면 그 사람
  const staff = new Map();
  (await all(env, `SELECT id, name, job, grade, head_id, team_id, status, project_id FROM staff WHERE project_id = ?`, pid)).forEach((r) => staff.set(r.id, r));
  const missing = [...new Set(data.contracts.map((c) => c.staffId))].filter((id) => !staff.has(id));
  for (const part of chunk(missing, 80)) {
    (await all(env, `SELECT id, name, job, grade, head_id, team_id, status, project_id FROM staff WHERE id IN (${part.map(() => '?').join(',')})`, ...part)).forEach((r) => staff.set(r.id, r));
  }
  const leaders = new Map(), heads = new Map(); // 팀 id → 팀장들, 본부 id → 본부장들 (활동 중인 사람만)
  staff.forEach((r) => {
    if (r.project_id !== pid || r.status !== '활동') return;
    if (r.grade === '팀장' && r.team_id) (leaders.get(r.team_id) || leaders.set(r.team_id, []).get(r.team_id)).push(r);
    if (r.grade === '본부장' && r.head_id) (heads.get(r.head_id) || heads.set(r.head_id, []).get(r.head_id)).push(r);
  });
  const settings = await loadPaySettings(env, pid), jobSettings = await loadJobSettings(env, pid);
  const supplierOf = {};
  (await all(env, 'SELECT id, name, active FROM suppliers WHERE project_id = ?', pid)).forEach((r) => { supplierOf[r.id] = r; });
  const curOf = (sid) => { const p = staff.get(sid); return makeResolver(settings[sid], p && p.project_id === pid ? jobSettings[p.job] : null)(to); };

  const lines = [], held = [], dropped = [], marks = [];
  const nameOf = (id) => (staff.get(id) ? staff.get(id).name : '(알 수 없음)');
  let eligible = 0;
  for (const c of data.contracts) {
    if (issued.has(c.id) || taken.has(c.id)) continue;
    const unit = data.units.get(c.dongho);
    const done = completionDate(data.deps.get(c.dongho) || [], data.need(unit && unit.amounts), unit && unit.amounts);
    if (!done || done > to || done < start) continue;
    eligible += 1;
    const hold = (reason) => held.push({ contractId: c.id, dongho: c.dongho, customer: s(c.name), staff: nameOf(c.staffId), reason });
    const rule = pickRule(rules, c, unit);
    if (!rule) { hold('적용할 수수료 규칙이 없습니다'); continue; }
    const person = staff.get(c.staffId);
    if (!person) { hold('담당 직원을 찾을 수 없습니다'); continue; }
    // 받는 사람 정하기
    const shares = [];
    let problem = '';
    const leaderOf = () => {
      if (person.grade === '팀장') return person;
      if (person.grade === '본부장') return null; // 본부장이 직접 계약하면 팀장 몫은 없다
      const list = (person.team_id && person.project_id === pid && leaders.get(person.team_id)) || [];
      if (list.length > 1) { problem = '팀장이 여러 명입니다 (' + list.map((x) => x.name).join(', ') + ')'; return null; }
      if (!list.length) { if (st.missing === '보류') problem = problem || '팀장이 지정되어 있지 않습니다 (' + nameOf(c.staffId) + ' 팀)'; return null; }
      return list[0];
    };
    const headOf = () => {
      if (person.grade === '본부장') return person;
      const list = (person.head_id && person.project_id === pid && heads.get(person.head_id)) || [];
      if (list.length > 1) { problem = '본부장이 여러 명입니다 (' + list.map((x) => x.name).join(', ') + ')'; return null; }
      if (!list.length) { if (st.missing === '보류') problem = problem || '본부장이 지정되어 있지 않습니다'; return null; }
      return list[0];
    };
    if (rule.pay_mode === '본부장일괄') {
      const h = headOf();
      const total = rule.staff_amount + rule.leader_amount + rule.head_amount;
      if (h && total > 0) shares.push({ role: '본부장일괄', staffId: h.id, amount: total });
      else if (!h && !problem) problem = '본부장이 지정되어 있지 않습니다';
    } else {
      if (rule.staff_amount > 0) shares.push({ role: '직원', staffId: person.id, amount: rule.staff_amount });
      if (rule.leader_amount > 0 && person.grade !== '본부장') { const l = leaderOf(); if (l) shares.push({ role: '팀장', staffId: l.id, amount: rule.leader_amount }); }
      if (rule.head_amount > 0) { const h = headOf(); if (h) shares.push({ role: '본부장', staffId: h.id, amount: rule.head_amount }); }
    }
    if (problem) { hold(problem); continue; }
    // 받는 사람의 지급 설정: 설정이 없으면 보류, 수수료 대상이 아니면 그 몫만 뺀다
    let blocked = '';
    const kept = [];
    shares.forEach((sh) => {
      const cur = curOf(sh.staffId);
      if (!cur) { blocked = blocked || nameOf(sh.staffId) + ' 님의 지급 설정이 없습니다'; return; }
      if (!cur.fee_enabled) { dropped.push({ dongho: c.dongho, staff: nameOf(sh.staffId), role: sh.role, amount: sh.amount, reason: '판매수수료 대상이 아닙니다' }); return; }
      if (cur.pay_mode === SUPPLIER_MODE && !(supplierOf[cur.supplier_id] && supplierOf[cur.supplier_id].active)) { blocked = blocked || nameOf(sh.staffId) + ' 님의 인력공급업체가 없거나 사용 중지되었습니다'; return; }
      kept.push(sh);
    });
    if (blocked) { hold(blocked); continue; }
    if (!kept.length) { marks.push({ contractId: c.id, dongho: c.dongho, date: s(c.date), staffId: c.staffId }); continue; }
    kept.forEach((sh) => lines.push({ t: '지급', cid: c.id, dongho: c.dongho, role: sh.role, amount: sh.amount, date: done, contractDate: s(c.date), ruleId: rule.id, owner: c.staffId, staffId: sh.staffId, note: '' }));
  }

  // 해약 환수: 결정된(환수) 줄만, 받는 사람의 합계가 마이너스가 되지 않는 범위에서 차감
  const refunds = (await all(env, `SELECT * FROM fee_ledger WHERE project_id = ? AND kind = '환수' AND state = '대기' AND decision = '환수' AND run_id = '' ORDER BY created_at, id`, pid))
    .filter((l) => !takenRefund.has(l.id));
  const byStaff = new Map();
  lines.forEach((l) => { (byStaff.get(l.staffId) || byStaff.set(l.staffId, { earn: [], refund: [] }).get(l.staffId)).earn.push(l); });
  refunds.forEach((l) => { (byStaff.get(l.staff_id) || byStaff.set(l.staff_id, { earn: [], refund: [] }).get(l.staff_id)).refund.push(l); });

  const items = [], notIncluded = [], carried = [];
  const adjustOf = opts.adjustOf || {};
  byStaff.forEach((g, sid) => {
    const name = nameOf(sid);
    const cur = curOf(sid);
    let running = g.earn.reduce((n, l) => n + l.amount, 0);
    const detail = g.earn.map((l) => ({ t: '지급', cid: l.cid, dongho: l.dongho, role: l.role, amount: l.amount, date: l.date, ruleId: l.ruleId, owner: l.owner, contractDate: l.contractDate, note: '' }));
    g.refund.forEach((l) => {
      if (running + l.amount >= 0) { running += l.amount; detail.push({ t: '환수', lid: l.id, cid: l.contract_id, dongho: l.dongho, role: l.role, amount: l.amount, date: l.cancel_date, note: l.note }); }
      else carried.push({ staff: name, dongho: l.dongho, role: l.role, amount: l.amount, reason: '이번 정산 지급액보다 커서 다음 정산으로 넘김' });
    });
    if (!detail.length) return;
    if (!cur) { notIncluded.push({ staffId: sid, name, reason: '지급 설정(개인 또는 직군 기본)이 없습니다' }); return; }
    const adj = adjustOf[sid] || { amount: 0, memo: '' };
    const gross = running + adj.amount;
    const withhold = cur.pay_mode === '3.3%' ? 1 : 0;
    const tax = deductions(gross, withhold);
    const supplier = cur.pay_mode === SUPPLIER_MODE ? cur.supplier_id : '';
    if (supplier && !(supplierOf[supplier] && supplierOf[supplier].active)) { notIncluded.push({ staffId: sid, name, reason: '지급 대상 인력공급업체가 없거나 사용 중지되었습니다' }); return; }
    items.push({
      id: newId('PI'), staff_id: sid, name, units: detail.filter((d) => d.t === '지급').length, base_amount: running, adjust_amount: adj.amount, adjust_memo: adj.memo,
      gross, income_tax: tax.income, local_tax: tax.local, net: cur.pay_mode === SUPPLIER_MODE ? 0 : gross - tax.income - tax.local, withhold,
      detail_json: JSON.stringify(detail), pay_mode: cur.pay_mode, supplier_id: supplier, supplier_name: supplier ? supplierOf[supplier].name : ''
    });
  });
  items.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return { items, notIncluded, held, dropped, carried, marks, eligible, start };
}
const parse2 = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch (e) { return []; } };

// 확정 직전 비교용: 받는 사람·금액·내역이 같은지
const signature = (items) => JSON.stringify(items.map((i) => [i.staff_id, i.gross, i.pay_mode, i.supplier_id, parse2(i.detail_json).map((d) => [d.t, d.cid, d.role, d.amount, d.lid || ''].join('|')).sort()]).sort((a, b) => a[0].localeCompare(b[0])));

export async function adjustMapOf(env, runId, pid) {
  const map = {};
  (await all(env, 'SELECT staff_id, adjust_amount, adjust_memo FROM pay_items WHERE run_id = ? AND project_id = ?', runId, pid)).forEach((i) => { if (i.adjust_amount) map[i.staff_id] = { amount: i.adjust_amount, memo: i.adjust_memo }; });
  return map;
}

// ====================================================================
// 정산 회차 (pay_runs 의 kind = '수수료')
// ====================================================================
export async function feeRunCreate(env, data, ctx) {
  const pid = ctx.projectId;
  const from = s(data.from), to = s(data.to);
  if (!isDate(from) || !isDate(to)) throw new AppError('기간 형식이 올바르지 않습니다.');
  if (from > to) throw new AppError('시작일이 종료일보다 늦습니다.');
  if (to > todayStr()) throw new AppError('오늘 이후 날짜는 정산할 수 없습니다.');
  const st = await loadFeeSettings(env, pid);
  if (!st.start) await saveFeeSetting(env, pid, '수수료정산시작일', from); // 처음 정산하는 날부터 계산 (이전 계약은 예전 방식으로 이미 지급한 것으로 본다)
  const title = s(data.title).trim().slice(0, 40) || (from + ' ~ ' + to + ' 수수료');
  const r = await computeFee(env, pid, from, to, { sync: true });
  if (!r.items.length) {
    throw new AppError('이 기간에 정산할 수수료가 없습니다.' + (r.held.length ? ' (보류된 계약 ' + r.held.length + '건: ' + r.held.slice(0, 3).map((h) => h.dongho + ' - ' + h.reason).join(', ') + ')' : '')
      + (!st.start ? ' (정산 시작일을 ' + from + ' 로 정했습니다)' : ''));
  }
  const id = newId('PR');
  await env.DB.batch([stmt(env,
    `INSERT INTO pay_runs (id, project_id, kind, title, cycle, period_from, period_to, status, memo, created_by, created_at) VALUES (?, ?, '수수료', ?, '건별', ?, ?, '작성', ?, ?, ?)`,
    id, pid, title, from, to, s(data.memo).trim().slice(0, 100), ctx.account.login_id, nowStr()), insertItems(env, id, pid, r.items)]);
  await writeLog(env, ctx.account.login_id, '수수료정산작성', id, title + ' / ' + r.items.length + '명', pid);
  return { id, people: r.items.length, held: r.held.length, startSet: !st.start };
}

// 회차 화면용: 작성·검토 중이면 다시 계산한 보류·제외·이월 내역도 보여 준다
export async function feeRunExtras(env, pid, r) {
  const x = await computeFee(env, pid, r.period_from, r.period_to, { exceptRunId: r.id });
  return { notIncluded: x.notIncluded, held: x.held, dropped: x.dropped, carried: x.carried, eligible: x.eligible };
}

export async function feeRunRecalc(env, pid, r) {
  const x = await computeFee(env, pid, r.period_from, r.period_to, { sync: true, exceptRunId: r.id, adjustOf: await adjustMapOf(env, r.id, pid) });
  const writes = [stmt(env, 'DELETE FROM pay_items WHERE run_id = ? AND project_id = ?', r.id, pid), stmt(env, `UPDATE pay_runs SET status = '작성', reviewed_at = '' WHERE id = ? AND project_id = ?`, r.id, pid)];
  const ins = insertItems(env, r.id, pid, x.items);
  if (ins) writes.push(ins);
  await env.DB.batch(writes);
  return x;
}

// 확정: 다시 계산해 검토 때와 같을 때만. 원장에 지급 줄을 쌓고 차감한 환수 줄을 확정한다 (한 묶음으로)
export async function feeRunConfirm(env, pid, r, ctx) {
  const stored = await all(env, 'SELECT * FROM pay_items WHERE run_id = ? AND project_id = ?', r.id, pid);
  const fresh = await computeFee(env, pid, r.period_from, r.period_to, { sync: true, exceptRunId: r.id, adjustOf: await adjustMapOf(env, r.id, pid) });
  if (signature(stored) !== signature(fresh.items)) throw new AppError('검토 이후 계약·입금·규칙·조직·지급 설정이 바뀌었습니다. [다시 계산]한 뒤 검토부터 다시 진행해 주세요.');
  const now = nowStr();
  const ledger = [], refundIds = [];
  stored.forEach((i) => parse2(i.detail_json).forEach((d) => {
    if (d.t === '지급') ledger.push({ id: newId('FL'), project_id: pid, contract_id: d.cid, dongho: d.dongho, contract_date: d.contractDate || '', staff_id: i.staff_id, role: d.role, kind: '지급', amount: d.amount, state: '확정', run_id: r.id, ref_id: '', owner_staff_id: d.owner || '', decision: '', resale_until: '', cancel_date: '', note: '', created_at: now });
    else if (d.lid) refundIds.push(d.lid);
  }));
  fresh.marks.forEach((m) => ledger.push({ id: newId('FL'), project_id: pid, contract_id: m.contractId, dongho: m.dongho, contract_date: m.date, staff_id: m.staffId, role: '제외', kind: '대체', amount: 0, state: '확정', run_id: r.id, ref_id: '', owner_staff_id: m.staffId, decision: '', resale_until: '', cancel_date: '', note: '수수료 지급 대상 없음', created_at: now }));
  const writes = [stmt(env, `UPDATE pay_runs SET status = '확정', confirmed_by = ?, confirmed_at = ? WHERE id = ? AND project_id = ? AND status = '검토'`, ctx.account.login_id, now, r.id, pid)];
  // 지급 줄은 같은 (계약, 몫)이 이미 있으면 DB 유일 색인이 막아 전체가 취소된다 (INSERT OR IGNORE 를 쓰지 않는다)
  if (ledger.length) writes.push(stmt(env, `INSERT INTO fee_ledger (id, project_id, contract_id, dongho, contract_date, staff_id, role, kind, amount, state, run_id, ref_id, owner_staff_id, decision, resale_until, cancel_date, note, created_at)
      SELECT json_extract(value, '$.id'), json_extract(value, '$.project_id'), json_extract(value, '$.contract_id'), json_extract(value, '$.dongho'), json_extract(value, '$.contract_date'), json_extract(value, '$.staff_id'), json_extract(value, '$.role'), json_extract(value, '$.kind'), json_extract(value, '$.amount'), json_extract(value, '$.state'), json_extract(value, '$.run_id'), json_extract(value, '$.ref_id'), json_extract(value, '$.owner_staff_id'), json_extract(value, '$.decision'), json_extract(value, '$.resale_until'), json_extract(value, '$.cancel_date'), json_extract(value, '$.note'), json_extract(value, '$.created_at')
      FROM json_each(?) WHERE EXISTS (SELECT 1 FROM pay_runs WHERE id = ? AND status = '확정')`, JSON.stringify(ledger), r.id));
  if (refundIds.length) writes.push(stmt(env, `UPDATE fee_ledger SET state = '확정', run_id = ? WHERE project_id = ? AND kind = '환수' AND state = '대기' AND run_id = '' AND id IN (SELECT value FROM json_each(?))`, r.id, pid, JSON.stringify(refundIds)));
  try {
    const res = await env.DB.batch(writes);
    if (!res[0].meta.changes) throw new AppError('이미 처리된 회차입니다.');
  } catch (e) {
    if (e instanceof AppError) throw e;
    if (/UNIQUE|constraint/i.test(String(e && e.message))) throw new AppError('같은 계약의 수수료가 다른 정산에 이미 확정되었습니다. [다시 계산]해 주세요.');
    throw e;
  }
  return { people: stored.length };
}

// ====================================================================
// 합산 명세: 기간 안에 확정된 회차를 사람별로 일급 + 수수료로 합친다
// ====================================================================
export async function payStatement(env, data, ctx) {
  const pid = ctx.projectId;
  const from = s(data.from), to = s(data.to);
  if (!isDate(from) || !isDate(to) || from > to) throw new AppError('기간을 올바르게 입력해 주세요.');
  const rows = await all(env,
    `SELECT i.staff_id, i.name, i.pay_mode, i.supplier_name, r.kind, SUM(i.gross) AS gross, SUM(i.income_tax + i.local_tax) AS tax, SUM(i.net) AS net, COUNT(*) AS runs
     FROM pay_items i JOIN pay_runs r ON r.id = i.run_id
     WHERE r.project_id = ? AND r.status IN ('확정', '지급완료') AND r.period_to >= ? AND r.period_to <= ?
     GROUP BY i.staff_id, i.name, i.pay_mode, i.supplier_name, r.kind`, pid, from, to);
  const by = new Map();
  rows.forEach((x) => {
    const p = by.get(x.staff_id) || { staffId: x.staff_id, name: x.name, daily: { gross: 0, tax: 0, net: 0 }, fee: { gross: 0, tax: 0, net: 0 }, supplier: '' };
    const t = x.kind === '수수료' ? p.fee : p.daily;
    t.gross += x.gross; t.tax += x.tax; t.net += x.net;
    if (x.pay_mode === SUPPLIER_MODE) p.supplier = x.supplier_name;
    by.set(x.staff_id, p);
  });
  const people = [...by.values()].map((p) => ({ ...p, total: { gross: p.daily.gross + p.fee.gross, tax: p.daily.tax + p.fee.tax, net: p.daily.net + p.fee.net } })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  const sum = (k, f) => people.reduce((n, p) => n + p[k][f], 0);
  return { people, totals: { daily: { gross: sum('daily', 'gross'), net: sum('daily', 'net') }, fee: { gross: sum('fee', 'gross'), net: sum('fee', 'net') }, total: { gross: sum('total', 'gross'), tax: sum('total', 'tax'), net: sum('total', 'net') } } };
}
