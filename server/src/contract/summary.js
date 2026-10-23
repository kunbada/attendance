// 계약관리 현황 요약 (통합관리 > 계약관리 > 현황 요약).
// 계약앱 대시보드(v_dash.js)와 같은 규칙으로 계산한다: 세대 상태 우선순위 계약 > 가계약 > 동호지정 > 잠금 > 잔여,
// 회차 납부상태는 같은 회차 구분(cat)의 입금-출금 합계와 세대의 회차 약정액(units.amounts)을 비교한다.
import { s, all, first, todayStr } from '../core/util.js';
import { currentRev } from './contract.js';

// 계약앱 core.js 의 ALL_STAGES / DEFAULT_STAGES 와 같다 (현장 설정에 회차가 없을 때)
const ALL_STAGES = ['계약금 1차', '계약금 2차', '중도금 1차', '중도금 2차', '중도금 3차', '중도금 4차', '중도금 5차', '중도금 6차', '잔금'];
const parse = (text) => { try { return JSON.parse(text) || {}; } catch (e) { return {}; } };
const num = (v) => Number(v) || 0;

export async function contractSummary(env, data, ctx) {
  const pid = ctx.projectId;
  const today = todayStr();

  const cfgRow = await first(env, `SELECT json FROM ct_records WHERE project_id = ? AND col = 'settings' AND id = 'main' AND deleted = 0`, pid);
  const cfg = cfgRow ? parse(cfgRow.json) : {};
  const stages = Array.isArray(cfg.stages) && cfg.stages.length ? cfg.stages : ALL_STAGES;
  const stageDue = cfg.stageDue || {};
  const moneyLabel = (cfg.project && cfg.project.moneyLabel) || '분양대금';

  // 세대·계약·가계약·동호지정·잠금 (모두 합쳐 천 건 안팎)
  const rows = await all(env,
    `SELECT col, id, dongho_g AS dongho, status_g AS status, json_extract(json, '$.type') AS type, json_extract(json, '$.amounts') AS amounts, json_extract(json, '$.date') AS date
     FROM ct_records WHERE project_id = ? AND col IN ('units', 'contracts', 'pre', 'resv', 'locks') AND deleted = 0`, pid);
  const units = [], active = {}, pre = {}, resv = {}, lock = {};
  rows.forEach((r) => {
    if (r.col === 'units') units.push(r);
    else if (r.col === 'contracts') { if (r.dongho && r.status !== '해약' && !active[r.dongho]) active[r.dongho] = r; }
    else if (r.col === 'pre') { if (r.status === '진행' && r.dongho) pre[r.dongho] = r; }
    else if (r.col === 'resv') { if (r.status === '진행' && r.dongho) resv[r.dongho] = r; }
    else if (r.col === 'locks') { if (r.status === '잠금' && r.dongho) lock[r.dongho] = r; }
  });
  const unitStatus = (dh) => (active[dh] ? '계약' : pre[dh] ? '가계약' : resv[dh] ? '동호지정' : lock[dh] ? '잠금' : '잔여');

  // 입금내역은 한 번만 훑어서 (동호, 회차)별 합계와 오늘·미분류 건수를 함께 구한다
  const todayDots = today.replace(/-/g, '.') + '%';
  const dep = await all(env,
    `SELECT json_extract(json, '$.dongho') AS dongho, json_extract(json, '$.cat') AS cat,
            SUM(COALESCE(json_extract(json, '$.inn'), 0)) AS inn, SUM(COALESCE(json_extract(json, '$.out'), 0)) AS out, COUNT(*) AS n,
            SUM(CASE WHEN json_extract(json, '$.t') LIKE ? THEN 1 ELSE 0 END) AS todayN,
            SUM(CASE WHEN json_extract(json, '$.t') LIKE ? THEN COALESCE(json_extract(json, '$.inn'), 0) ELSE 0 END) AS todayIn
     FROM ct_records WHERE project_id = ? AND col = 'deposits' AND deleted = 0 GROUP BY 1, 2`, todayDots, todayDots, pid);
  const stageSet = new Set(stages);
  const paid = {};
  let totalIn = 0, unclassified = 0, todayDep = 0, todayDepIn = 0;
  dep.forEach((d) => {
    if (!d.cat) unclassified += d.n;
    todayDep += d.todayN; todayDepIn += d.todayIn;
    if (stageSet.has(d.cat)) totalIn += num(d.inn) - num(d.out);
    if (d.dongho && stageSet.has(d.cat)) { const p = (paid[d.dongho] = paid[d.dongho] || {}); p[d.cat] = (p[d.cat] || 0) + num(d.inn) - num(d.out); }
  });

  // 세대 상태 집계 (전체 / 타입별)
  const st = { 계약: 0, 가계약: 0, 동호지정: 0, 잠금: 0, 잔여: 0 };
  const types = {};
  units.forEach((u) => {
    const status = unitStatus(u.id);
    st[status]++;
    const t = (types[u.type] = types[u.type] || { type: u.type, supply: 0, contract: 0, pre: 0, resv: 0, lock: 0 });
    t.supply++;
    if (status === '계약') t.contract++; else if (status === '가계약') t.pre++; else if (status === '동호지정') t.resv++; else if (status === '잠금') t.lock++;
  });

  // 회차별 납부 현황 (계약앱 stageSummary / payState 와 같은 규칙)
  const unitAmounts = {};
  units.forEach((u) => { unitAmounts[u.id] = parse(u.amounts); });
  const act = Object.values(active);
  const stageActive = {};
  stages.forEach((sg) => { stageActive[sg] = (!!stageDue[sg] && stageDue[sg] <= today) || Object.values(paid).some((p) => (p[sg] || 0) > 0); });
  const payOf = (dh, sg) => {
    const req = num((unitAmounts[dh] || {})[sg]);
    const got = ((paid[dh] || {})[sg]) || 0;
    return { req, paid: got, done: req > 0 && got >= req };
  };
  const stageRows = stages.map((sg) => {
    let done = 0, part = 0, none = 0, req = 0, got = 0;
    act.forEach((c) => {
      const ps = payOf(c.dongho, sg);
      req += ps.req; got += Math.max(0, ps.paid);
      if (ps.done) done++; else if (ps.paid > 0) part++; else none++;
    });
    return { stage: sg, targets: act.length, done, part, none, req, paid: got, active: !!stageActive[sg], due: stageDue[sg] || '' };
  });

  const totalUnits = units.length;
  return {
    asOf: today, moneyLabel, rev: await currentRev(env, pid),
    units: totalUnits, contract: st.계약, pre: st.가계약, resv: st.동호지정, lock: st.잠금, remain: st.잔여,
    contractRate: totalUnits ? Math.round(st.계약 / totalUnits * 1000) / 10 : 0,
    withPreRate: totalUnits ? Math.round((st.계약 + st.가계약) / totalUnits * 1000) / 10 : 0,
    todayContracts: act.filter((c) => c.date === today).length,
    totalIn, todayDeposits: todayDep, todayDepositAmount: todayDepIn, unclassified,
    firstStage: stages[0] ? { stage: stages[0], done: stageRows[0].done, notDone: act.length - stageRows[0].done } : null,
    types: Object.values(types).sort((a, b) => s(a.type).localeCompare(s(b.type), 'ko')),
    stages: stageRows
  };
}
