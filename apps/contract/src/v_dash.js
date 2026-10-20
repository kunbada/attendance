/* ===================== 대시보드 ===================== */
function calcTypeTable() {
  const rows = {}; IX.types.forEach(t => rows[t] = { t, sup: 0, con: 0, pre: 0, resv: 0, lock: 0 });
  live('units').forEach(u => { const r = rows[u.type]; r.sup++; const s = unitStatus(u.id); if (s === '계약') r.con++; else if (s === '가계약') r.pre++; else if (s === '동호지정') r.resv++; else if (s === '잠금') r.lock++; });
  return Object.values(rows);
}
function typeTableHtml() {
  const rows = calcTypeTable(); const sp = new Set(Object.keys(CFG().special || {}));
  const line = (r, cls = '') => `<tr class="${cls}"><td class="l"><b>${esc(r.t)}</b></td><td class="r">${fmt(r.sup)}</td><td class="r">${fmt(r.con)}</td><td class="r">${fmt(r.sup - r.con)}</td><td class="r"><b>${pct(r.con, r.sup)}</b></td><td class="r">${fmt0(r.pre)}</td><td class="r">${fmt(r.con + r.pre)}</td><td class="r">${fmt(r.sup - r.con - r.pre)}</td><td class="r">${pct(r.con + r.pre, r.sup)}</td><td class="r">${fmt0(r.resv)}</td><td class="r">${fmt0(r.lock)}</td><td class="r">${fmt(r.sup - r.con - r.pre - r.resv - r.lock)}</td></tr>`;
  const sum = (arr, t) => arr.reduce((a, r) => ({ t, sup: a.sup + r.sup, con: a.con + r.con, pre: a.pre + r.pre, resv: a.resv + r.resv, lock: a.lock + r.lock }), { t, sup: 0, con: 0, pre: 0, resv: 0, lock: 0 });
  let foot = '';
  if (sp.size) foot += line(sum(rows.filter(r => sp.has(r.t)), '특별공급 타입'), 'sum') + line(sum(rows.filter(r => !sp.has(r.t)), '일반공급 타입'), 'sum');
  foot += line(sum(rows, '합계'), 'sum');
  return `<table class="t"><thead><tr><th rowspan="2">타입</th><th rowspan="2">공급</th><th colspan="3">정당계약</th><th colspan="4">가계약 포함</th><th rowspan="2">동호지정</th><th rowspan="2">잠금</th><th rowspan="2">순잔여</th></tr>
  <tr><th>계약</th><th>잔여</th><th>분양률</th><th>가계약</th><th>계</th><th>잔여</th><th>분양률</th></tr></thead><tbody>${rows.map(r => line(r)).join('')}${foot}</tbody></table>`;
}
function specialHtml() {
  const sp = CFG().special || {}; const types = Object.keys(sp); if (!types.length) return '<div class="muted">설정 &gt; 특별공급 배정에서 입력하면 표시됩니다.</div>';
  const cats = [...new Set(types.flatMap(t => Object.keys(sp[t])))];
  const cnt = {}; Object.values(IX.active).forEach(c => { const u = IX.unit[c.dongho]; if (!u) return; const k = u.type + '|' + c.stype; cnt[k] = (cnt[k] || 0) + 1; });
  let tot = { a: {}, c: {} };
  const body = types.map(t => {
    const a = cats.map(c => sp[t][c] || 0), cc = cats.map(c => cnt[t + '|' + c] || 0);
    cats.forEach((c, i) => { tot.a[c] = (tot.a[c] || 0) + a[i]; tot.c[c] = (tot.c[c] || 0) + cc[i]; });
    const sa = a.reduce((x, y) => x + y, 0), sc = cc.reduce((x, y) => x + y, 0);
    return `<tr><td rowspan="3"><b>${t}</b></td><td>배정</td>${a.map(x => `<td class="r">${x}</td>`).join('')}<td class="r">${sa}</td></tr><tr><td>계약</td>${cc.map(x => `<td class="r">${x}</td>`).join('')}<td class="r">${sc}</td></tr><tr><td>잔여</td>${a.map((x, i) => `<td class="r ${x - cc[i] > 0 ? 'red' : ''}">${x - cc[i]}</td>`).join('')}<td class="r"><b>${sa - sc}</b></td></tr>`;
  }).join('');
  const ta = cats.map(c => tot.a[c]), tc = cats.map(c => tot.c[c]);
  return `<table class="t"><thead><tr><th>타입</th><th>구분</th>${cats.map(c => `<th>${esc(c)}</th>`).join('')}<th>계</th></tr></thead><tbody>${body}
  <tr class="sum"><td rowspan="2">합계</td><td>계약/배정</td>${ta.map((x, i) => `<td class="r">${tc[i]}/${x}</td>`).join('')}<td class="r">${tc.reduce((a, b) => a + b, 0)}/${ta.reduce((a, b) => a + b, 0)}</td></tr>
  <tr class="sum"><td>잔여</td>${ta.map((x, i) => `<td class="r">${x - tc[i]}</td>`).join('')}<td class="r">${ta.reduce((a, b) => a + b, 0) - tc.reduce((a, b) => a + b, 0)}</td></tr></tbody></table>`;
}
function stageSummary() {
  const act = Object.values(IX.active);
  return STAGES().map(s => {
    let done = 0, part = 0, none = 0, req = 0, paid = 0, over = 0;
    act.forEach(c => { const ps = payState(c.dongho, s); req += ps.req; paid += Math.max(0, ps.paid); if (ps.paid > ps.req && ps.req) over++; if (ps.done) done++; else if (ps.paid > 0) part++; else none++; });
    return { s, n: act.length, done, part, none, req, paid, over };
  });
}
function stageTableHtml(onlyActive) {
  const rows = stageSummary().filter(r => !onlyActive || r.paid > 0);
  return `<table class="t"><thead><tr><th>회차</th><th>대상</th><th>완납</th><th>일부납</th><th>미납</th><th>약정액</th><th>수납액</th><th>수납률</th></tr></thead><tbody>
  ${rows.map(r => !IX.stageActive[r.s] ? `<tr class="muted"><td>${r.s}</td><td class="r">${fmt(r.n)}</td><td colspan="3">납부 전 (예정)${(CFG().stageDue || {})[r.s] ? ' · 기한 ' + CFG().stageDue[r.s] : ''}</td><td class="r">${fmt(r.req)}</td><td class="r">0</td><td class="r">-</td></tr>` : `<tr class="click" onclick="VS.pay={stage:'${r.s}',only:'미완납'};go('payments')"><td><b>${r.s}</b></td><td class="r">${fmt(r.n)}</td><td class="r green">${fmt(r.done)}</td><td class="r">${fmt0(r.part)}</td><td class="r ${r.none ? 'red' : ''}">${fmt0(r.none)}</td><td class="r">${fmt(r.req)}</td><td class="r">${fmt(r.paid)}</td><td class="r"><b>${pct(r.paid, r.req)}</b></td></tr>`).join('') || '<tr><td colspan="8" class="muted">수납 내역 없음</td></tr>'}</tbody></table>`;
}
function monthly() {
  const m = {}; Object.values(IX.active).forEach(c => { const k = (c.date || '').slice(0, 7); if (k.length === 7) m[k] = (m[k] || 0) + 1; });
  const keys = Object.keys(m).sort(); return keys.map(k => ({ k, n: m[k] }));
}
function vbarsHtml(arr, labelF, valF, color) {
  const max = Math.max(1, ...arr.map(valF));
  return `<div class="vbars">${arr.map(a => `<div class="vb"><span>${fmt0(valF(a))}</span><i style="height:${valF(a) / max * 100}%;${color ? 'background:' + color : ''}"></i></div>`).join('')}</div><div class="vlabels">${arr.map(a => `<div>${labelF(a)}</div>`).join('')}</div>`;
}
function hbarsHtml(arr, total, color) {
  const max = Math.max(1, ...arr.map(a => a.n));
  return `<div class="bars">${arr.map(a => `<div class="bar"><div title="${esc(a.k)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.k)}</div><div class="tr"><i style="width:${a.n / max * 100}%;background:${color || 'var(--accent)'}"></i></div><div class="r num">${fmt(a.n)}${total ? ` <span class="muted">(${pct(a.n, total, 0)})</span>` : ''}</div></div>`).join('')}</div>`;
}
function countBy(arr, f) { const m = {}; arr.forEach(x => { const k = f(x) || '(미입력)'; m[k] = (m[k] || 0) + 1; }); return Object.entries(m).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n); }
function regionCounts() {
  const act = Object.values(IX.active);
  return countBy(act, c => { const r = region(c.addr); if (r.sido === '경기도') return r.sgg; if (r.sido === '서울시') return '서울시'; return r.sido ? '기타(' + r.sido + ')' : ''; });
}
function view_dash(el) {
  const units = live('units'); const N = units.length;
  const st = { 계약: 0, 가계약: 0, 동호지정: 0, 잠금: 0, 잔여: 0 }; units.forEach(u => st[unitStatus(u.id)]++);
  const act = Object.values(IX.active);
  const s0 = STAGES()[0];
  const dDone = act.filter(c => payState(c.dongho, s0).done).length;
  const totalIn = live('deposits').reduce((a, d) => a + (PAY_CATS().has(d.cat) ? (d.inn || 0) - (d.out || 0) : 0), 0);
  const td = today().replace(/-/g, '.');
  const todayDep = live('deposits').filter(d => d.t && d.t.startsWith(td));
  const todayCon = act.filter(c => c.date === today()).length;
  const mon = monthly(); let cum = 0; mon.forEach(x => { cum += x.n; x.cum = cum; });
  const banners = [];
  if (!N) banners.push(`<div class="banner info">세대(분양가) 데이터가 없습니다. <button class="btn sm pri" onclick="go('settings')">설정 · 데이터 가져오기</button></div>`);
  if (BK.dir && !BK.perm) banners.push(`<div class="banner">로컬 백업 폴더 권한이 필요합니다(브라우저 재시작 시 1회). <button class="btn sm pri" onclick="grantBackup()">백업폴더 허용</button></div>`);
  else if (!BK.dir) banners.push(`<div class="banner">로컬 백업 폴더가 지정되지 않았습니다. 비상시를 대비해 지정해 두세요. <button class="btn sm pri" onclick="pickBackupDir()">백업폴더 지정</button></div>`);
  el.innerHTML = `${banners.join('')}
  <div class="toolbar"><h2>계약 현황</h2><span class="sub">${today()} 기준</span><span class="sp"></span><button class="btn" onclick="printReport('status')">현황 보고서 인쇄</button></div>
  <div class="kpis">
    <div class="kpi"><div class="l">총 세대</div><div class="v">${fmt(N)}</div><div class="s">타입 ${IX.types.length}개</div></div>
    <div class="kpi link" onclick="go('contracts')"><div class="l">계약</div><div class="v blue">${fmt(st.계약)}</div><div class="s">분양률 ${pct(st.계약, N)} · 오늘 ${todayCon}건</div></div>
    <div class="kpi link" onclick="go('pre')"><div class="l">가계약</div><div class="v" style="color:var(--st-pre)">${fmt(st.가계약)}</div><div class="s">가계약포함 ${pct(st.계약 + st.가계약, N)}</div></div>
    <div class="kpi link" onclick="go('locks')"><div class="l">잠금동호</div><div class="v" style="color:var(--st-lock)">${fmt(st.잠금)}</div></div>
    <div class="kpi link" onclick="go('map')"><div class="l">잔여</div><div class="v">${fmt(st.잔여)}</div><div class="s">동호배치도 보기</div></div>
    <div class="kpi link" onclick="VS.pay={stage:'${s0}',only:'미완납'};go('payments')"><div class="l">${s0} 완납</div><div class="v green">${fmt(dDone)}</div><div class="s">미완납 ${fmt(act.length - dDone)}세대</div></div>
    <div class="kpi"><div class="l">총 수납액</div><div class="v" style="font-size:18px">${fmt(totalIn)}</div><div class="s">오늘 입금 ${todayDep.length}건 · ${fmt(todayDep.reduce((a, d) => a + (d.inn || 0), 0))}</div></div>
    <div class="kpi link ${IX.unclassified ? 'warn' : ''}" onclick="VS.dep=Object.assign(VS.dep||{}, {f:'미분류'});go('deposits')"><div class="l">미분류 입금</div><div class="v ${IX.unclassified ? 'red' : ''}">${fmt(IX.unclassified)}</div><div class="s">클릭하여 분류</div></div>
  </div>
  <div class="grid2">
    <div class="card"><h3>타입별 계약현황</h3>${typeTableHtml()}</div>
    <div class="card"><h3>회차별 수납현황 <span class="muted" style="font-weight:400">(행 클릭 → 미납자)</span></h3>${stageTableHtml()}</div>
    <div class="card"><h3>특별공급 배정/계약</h3>${specialHtml()}</div>
    <div class="card"><h3>월별 계약 (계약일 기준, 현재 유효계약)</h3>${mon.length ? vbarsHtml(mon, x => x.k.slice(2).replace('-', '.'), x => x.n) + `<table class="t" style="margin-top:8px"><tr><th>월</th>${mon.map(x => `<th>${x.k.slice(2)}</th>`).join('')}</tr><tr><td>누계</td>${mon.map(x => `<td>${x.cum}</td>`).join('')}</tr><tr><td>분양률</td>${mon.map(x => `<td>${pct(x.cum, N, 0)}</td>`).join('')}</tr></table>` : '<div class="muted">계약 없음</div>'}</div>
    <div class="card"><h3>팀별 계약</h3>${hbarsHtml(countBy(act, c => String(c.team || '').replace(/팀$/, '')).slice(0, 20), act.length)}</div>
    <div class="card"><h3>지역별 계약 (계약자 주소)</h3>${hbarsHtml(regionCounts().slice(0, 15), act.length, '#5b8def')}</div>
    <div class="card"><h3>공급유형 / 계약유형</h3><div class="grid2"><div>${hbarsHtml(countBy(act, c => c.stype), act.length, '#22a06b')}</div><div>${hbarsHtml(countBy(act, c => c.ctype), act.length, '#e08a2c')}</div></div></div>
    <div class="card"><h3>최근 14일 입금 (단위: 백만원)</h3>${dailyDepHtml()}</div>
  </div>`;
}
function dailyDepHtml() {
  const days = []; const d = new Date(); for (let i = 13; i >= 0; i--) { const x = new Date(d); x.setDate(d.getDate() - i); days.push(x.getFullYear() + '.' + pad(x.getMonth() + 1) + '.' + pad(x.getDate())); }
  const m = {}; live('deposits').forEach(dp => { const k = (dp.t || '').slice(0, 10); if (m[k] === undefined) m[k] = 0; m[k] += dp.inn || 0; });
  const arr = days.map(k => ({ k, n: Math.round((m[k] || 0) / 1e6) }));
  return vbarsHtml(arr, x => x.k.slice(8), x => x.n, '#22a06b');
}

/* ===================== 동호배치도 ===================== */
function view_map(el) {
  const v = VS.map = VS.map || { dong: '', mode: 'status', stage: STAGES()[0], q: '', type: '' };
  const units = live('units');
  const cnt = { 계약: 0, 가계약: 0, 동호지정: 0, 잠금: 0, 잔여: 0 }; units.forEach(u => cnt[unitStatus(u.id)]++);
  el.innerHTML = `<div class="toolbar"><h2>동호배치도</h2>
    <select class="in" id="mDong"><option value="">전체 동</option>${IX.dongs.map(d => `<option ${v.dong === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
    <select class="in" id="mType"><option value="">전체 타입</option>${IX.types.map(d => `<option ${v.type === d ? 'selected' : ''}>${d}</option>`).join('')}</select>
    <div class="seg"><button data-m="status" class="${v.mode === 'status' ? 'on' : ''}">계약상태</button><button data-m="pay" class="${v.mode === 'pay' ? 'on' : ''}">수납표시</button></div>
    <select class="in" id="mStage" style="${v.mode === 'pay' ? '' : 'display:none'}">${STAGES().map(s => `<option ${v.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <input class="in" id="mQ" placeholder="이름/동호 검색" value="${esc(v.q)}" style="width:160px">
    <span class="sp"></span>
    <div class="legend"><span><b style="background:var(--st-contract)"></b>계약 ${cnt.계약}</span><span><b style="background:var(--st-pre)"></b>가계약 ${cnt.가계약}</span><span><b style="background:var(--st-resv)"></b>동호지정 ${cnt.동호지정}</span><span><b style="background:var(--st-lock)"></b>잠금 ${cnt.잠금}</span><span><b></b>잔여 ${cnt.잔여}</span>${v.mode === 'pay' ? `<span><b style="background:#ff3b3b;border-radius:50%"></b>미납</span><span><b style="background:#ffb020;border-radius:50%"></b>일부납</span>` : ''}</div>
    <button class="btn" onclick="printMap()">인쇄</button>
  </div><div class="card"><div class="dmap-wrap" id="dmapWrap">${mapHtml(v)}</div></div>`;
  $('#mDong').onchange = e => { v.dong = e.target.value; render(); };
  $('#mType').onchange = e => { v.type = e.target.value; render(); };
  $('#mStage').onchange = e => { v.stage = e.target.value; render(); };
  $$('.seg button[data-m]').forEach(b => b.onclick = () => { v.mode = b.dataset.m; render(); });
  $('#mQ').oninput = debounce(e => { v.q = e.target.value.trim(); $('#dmapWrap').innerHTML = mapHtml(v); }, 200);
  $('#dmapWrap').onclick = e => { const td = e.target.closest('td[data-dh]'); if (td) openUnit(td.dataset.dh); };
}
function mapHtml(v) {
  const byDong = {}; live('units').forEach(u => (byDong[u.dong] = byDong[u.dong] || []).push(u));
  const q = (v.q || '').replace(/\s/g, '');
  return Object.keys(byDong).sort().filter(d => !v.dong || d === v.dong).map(d => {
    const us = byDong[d]; const lines = [...new Set(us.map(u => u.line || +String(u.ho).slice(-2)))].sort((a, b) => a - b);
    const floors = [...new Set(us.map(u => u.floor || Math.floor(+u.ho / 100)))].sort((a, b) => b - a);
    const idx = {}; us.forEach(u => idx[(u.floor || Math.floor(+u.ho / 100)) + '_' + (u.line || +String(u.ho).slice(-2))] = u);
    const typeOfLine = l => { const u = us.find(x => (x.line || +String(x.ho).slice(-2)) === l); return u ? u.type : ''; };
    const rows = floors.map(f => `<tr><td class="fl">${f}F</td>${lines.map(l => {
      const u = idx[f + '_' + l]; if (!u) return '<td class="none"></td>';
      const s = unitStatus(u.id); const nm = holderOf(u.id);
      let cls = 's-' + s;
      if (v.type && u.type !== v.type) cls += ' dim';
      if (q && !(u.id.includes(q) || (nm || '').includes(q))) cls += ' dim';
      if (v.mode === 'pay' && s === '계약') { const ps = payState(u.id, v.stage); if (!ps.done) cls += ps.paid > 0 ? ' pay-warn' : ' pay-bad'; }
      return `<td class="${cls}" data-dh="${u.id}" title="${u.id} ${u.type} ${s}${nm ? ' · ' + esc(nm) : ''}">${u.ho}<span class="nm">${esc(nm)}</span></td>`;
    }).join('')}</tr>`).join('');
    return `<div class="dmap"><h4>${d}동 <span class="muted" style="font-weight:400;font-size:12px">${us.length}세대 · 계약 ${us.filter(u => IX.active[u.id]).length}</span></h4><table>${rows}<tr class="types"><td></td>${lines.map(l => `<td>${typeOfLine(l)}</td>`).join('')}</tr></table></div>`;
  }).join('') || '<div class="empty">세대 데이터가 없습니다</div>';
}
function printMap() {
  const v = VS.map || {};
  $('#printRoot').innerHTML = `<style>@page{size:A3 landscape}</style><div class="rep"><h2>${esc(CFG().project.name)} 동호배치도</h2><div class="meta">${today()} 기준 · 계약 ${Object.keys(IX.active).length}/${live('units').length}</div><div class="dmap-wrap" style="flex-wrap:wrap;overflow:visible">${mapHtml(v)}</div></div>`;
  setTimeout(() => window.print(), 50);
}

/* ===================== 세대 상세 드로어 ===================== */
function openUnit(dh) {
  const u = IX.unit[dh]; if (!u) return toast('세대 정보 없음: ' + dh, 1);
  const s = unitStatus(dh); const c = IX.active[dh];
  const hist = (IX.contractsByDh[dh] || []).filter(x => x.status === '해약');
  const p = live('pre').filter(x => x.dongho === dh), r = live('resv').filter(x => x.dongho === dh), l = live('locks').filter(x => x.dongho === dh);
  const deps = (IX.depByDh[dh] || []).slice().sort((a, b) => a.t < b.t ? -1 : 1);
  const lab = CFG().project.moneyLabel || '금액';
  const stageRows = STAGES().map(sg => { const ps = payState(dh, sg); return `<tr><td>${sg}</td><td class="r">${fmt(ps.req)}</td><td class="r">${fmt0(ps.paid)}</td><td class="r ${ps.diff > 0 ? 'red' : ''}">${ps.paid ? fmt(ps.diff) : ''}</td><td>${ps.paid || c ? chipPay(ps) : ''}</td><td class="muted">${(ps.last || '').slice(0, 10)}</td><td>${ps.paid > 0 ? `<button class="btn sm" onclick="printReceipt('${dh}','${sg}')">영수증</button>` : ''}</td></tr>`; }).join('');
  openDrawer(`${dh} <span class="muted" style="font-size:13px;font-weight:400">${u.type}</span> ${chipStatus(s)}`, `
    <section><div class="kv">
      <div>타입</div><div>${u.type} · 전용 ${u.exArea}㎡ · 공급 ${u.supArea}㎡</div>
      <div>${lab}</div><div><b>${fmt(u.price)}</b> 원</div>
      <div>층/라인</div><div>${u.floor}층 / ${u.line}라인</div>
    </div></section>
    <section><h4>계약자 ${c ? `<button class="btn sm" onclick="closeDrawer();editContract('${c.id}')">수정</button> <button class="btn sm" onclick="closeDrawer();printContractFor('${c.id}')">계약서 출력</button>` : `<button class="btn sm pri" onclick="closeDrawer();editContract(null,'${dh}')">+ 계약 등록</button>`}</h4>
      ${c ? `<div class="kv"><div>성명</div><div><b>${esc(c.name)}</b> (${esc(c.stype || '')})</div><div>연락처</div><div>${esc(c.phone)}</div><div>계약일</div><div>${esc(c.date)} · ${esc(c.ctype)}</div><div>주소</div><div>${esc(c.addr)}</div><div>팀/담당</div><div>${esc(c.team)} / ${esc(c.staff)}</div><div>특이사항</div><div>${esc([c.note, c.memo, c.memo2].filter(Boolean).join(' / '))}</div></div>` : '<div class="muted">계약 없음</div>'}
    </section>
    <section><h4>납부 현황</h4><table class="t"><thead><tr><th>회차</th><th>약정</th><th>납부</th><th>차액</th><th>상태</th><th>최근입금</th><th></th></tr></thead><tbody>${stageRows}
      <tr class="sum"><td>합계</td><td class="r">${fmt(STAGES().reduce((a, sg) => a + payState(dh, sg).req, 0))}</td><td class="r">${fmt(totalPaid(dh))}</td><td colspan="4"></td></tr></tbody></table></section>
    <section><h4>입금 내역 (${deps.length})</h4><table class="t"><thead><tr><th>거래일시</th><th>기재내용</th><th>입금</th><th>출금</th><th>구분</th></tr></thead><tbody>${deps.map(d => `<tr><td>${esc(d.t)}</td><td class="l">${esc(d.desc)}</td><td class="r">${fmt0(d.inn)}</td><td class="r">${fmt0(d.out)}</td><td>${esc(d.cat)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">없음</td></tr>'}</tbody></table></section>
    <section><h4>가계약 / 동호지정 / 잠금 이력 <button class="btn sm" onclick="closeDrawer();editSimple('pre',null,'${dh}')">+가계약</button> <button class="btn sm" onclick="closeDrawer();editSimple('resv',null,'${dh}')">+동호지정</button> <button class="btn sm" onclick="closeDrawer();editLock(null,'${dh}')">+잠금</button></h4>
      <table class="t"><tbody>${[...p.map(x => ['가계약', x, 'pre']), ...r.map(x => ['동호지정', x, 'resv']), ...l.map(x => ['잠금', x, 'locks'])].map(([k, x, col]) => `<tr class="click" onclick="closeDrawer();${col === 'locks' ? `editLock('${x.id}')` : `editSimple('${col}','${x.id}')`}"><td>${k}</td><td>${esc(x.date)}</td><td>${esc(x.name || x.reason || '')}</td><td>${chipStatus(x.status)}</td><td class="l">${esc(x.note || '')}</td></tr>`).join('') || '<tr><td class="muted">없음</td></tr>'}</tbody></table></section>
    ${hist.length ? `<section><h4>해약 이력</h4><table class="t"><tbody>${hist.map(h => `<tr class="click" onclick="closeDrawer();editContract('${h.id}')"><td>${esc(h.date)}</td><td>${esc(h.name)}</td><td>${esc(h.phone)}</td><td class="l">${esc(h.note || h.memo || '')}</td></tr>`).join('')}</tbody></table></section>` : ''}
  `);
}
