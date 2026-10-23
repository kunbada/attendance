/* ===================== 셸 / 라우팅 ===================== */
// 상단 메뉴(그룹) → 하위 탭(화면).  수금관리: 수납확인 → 영수증 / 계약관리: 계약서 작성 후 입력
const GROUPS = [
  ['dash', '대시보드', [['dash', '대시보드']]],
  ['map', '동호배치도', [['map', '동호배치도']]],
  ['pay', '수금관리', [['deposits', '수금입력'], ['payments', '세대별 수납'], ['receipts', '영수증 출력']]],
  ['con', '계약관리', [['contracts', '계약입력'], ['locks', '잠금동호 관리'], ['pre', '가계약 관리'], ['print', '계약서 출력']]],
  ['reports', '레포트', [['reports', '레포트']]],
  ['set', '설정', [['units', '세대관리'], ['settings', '일반설정']]]
];
const VIEWS = GROUPS.flatMap(g => g[2]);
const groupOf = v => GROUPS.find(g => g[2].some(x => x[0] === v)) || GROUPS[0];
const LASTV = {};
const VS = {}; // view state
let CUR = 'dash';
function buildShell() {
  document.body.insertAdjacentHTML('afterbegin', `
  <header class="top">
    <div class="brand" onclick="go('dash')" id="brand"></div>
    <nav id="nav">${GROUPS.map(([g, l, vs]) => `<button data-g="${g}" onclick="go(LASTV['${g}']||'${vs[0][0]}')">${l}<span class="badge" id="badge-${vs[0][0]}" style="display:none"></span></button>`).join('')}</nav>
    <div class="syncbox"><span id="userPill" class="pill none" onclick="userMenu()" style="cursor:pointer;display:none"></span><span id="backupPill" class="pill none" onclick="go('settings')"></span><span id="syncPill" class="pill none" onclick="go('settings')"></span></div>
  </header><div id="subnav" class="subnav"></div>`);
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if ($('.drawer')) closeDrawer(); else if ($('.modal-bg')) closeModal(); } });
  updateSyncPill();
}
function go(v) { if (location.hash !== '#' + v) location.hash = v; else route(); }
function route() {
  const v = (location.hash || '#dash').slice(1).split('?')[0];
  CUR = VIEWS.some(x => x[0] === v) ? v : 'dash';
  const G = groupOf(CUR); LASTV[G[0]] = CUR;
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.g === G[0]));
  const sn = $('#subnav'); sn.style.display = G[2].length > 1 ? '' : 'none';
  sn.innerHTML = G[2].map(([k, l]) => `<button class="${k === CUR ? 'on' : ''}" onclick="go('${k}')">${l}</button>`).join('');
  render();
}
function render() {
  $('#brand').innerHTML = esc(CFG().project.name || '분양계약관리') + '<small>계약·수금관리</small>';
  document.title = (CFG().project.name || '') + ' 계약관리';
  const fn = window['view_' + CUR];
  const el = $('#view');
  const sc = window.scrollY;
  el.innerHTML = '';
  try { fn(el); if (!canWrite()) el.insertAdjacentHTML('afterbegin', '<div class="banner info">읽기 전용 계정입니다. 조회·출력만 가능하고 저장은 되지 않습니다.</div>'); } catch (e) { console.error(e); el.innerHTML = `<div class="banner">화면 오류: ${esc(e.message)}</div>`; }
  window.scrollTo(0, sc);
}
function updateNavBadges() {
  const b = $('#badge-deposits'); if (!b) return;
  b.style.display = IX.unclassified ? '' : 'none'; b.textContent = IX.unclassified;
}

/* ===================== 모달 / 드로어 ===================== */
function openModal({ title, body, foot, wide, onOpen }) {
  closeModal();
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}"><div class="modal-h"><h3>${title}</h3><button class="x" onclick="closeModal()">×</button></div><div class="modal-b">${body}</div>${foot ? `<div class="modal-f">${foot}</div>` : ''}</div>`;
  bg.addEventListener('mousedown', e => { if (e.target === bg) bg.dataset.down = 1; });
  bg.addEventListener('mouseup', e => { if (e.target === bg && bg.dataset.down) closeModal(); bg.dataset.down = ''; });
  document.body.appendChild(bg);
  if (onOpen) onOpen(bg);
  const f = bg.querySelector('input:not([type=hidden]):not([readonly]),select,textarea'); if (f) setTimeout(() => f.focus(), 30);
  return bg;
}
function closeModal() { $$('.modal-bg').forEach(m => m.remove()); }
function confirmBox(msg, ok) {
  openModal({ title: '확인', body: `<div style="white-space:pre-wrap;line-height:1.6">${msg}</div>`, foot: `<button class="btn" onclick="closeModal()">취소</button><button class="btn pri" id="cfOk">확인</button>`, onOpen: bg => bg.querySelector('#cfOk').onclick = () => { closeModal(); ok(); } });
}
function openDrawer(title, html) {
  closeDrawer();
  document.body.insertAdjacentHTML('beforeend', `<div class="drawer-bg" onclick="closeDrawer()"></div><div class="drawer"><div class="dh"><h3>${title}</h3><button class="x" onclick="closeDrawer()">×</button></div><div class="db">${html}</div></div>`);
}
function closeDrawer() { $$('.drawer,.drawer-bg').forEach(x => x.remove()); }

/* ===================== 폼 빌더 ===================== */
function distinct(col, key, extra = []) { const s = new Set(extra); live(col).forEach(r => { if (r[key]) s.add(String(r[key]).trim()); }); return [...s].filter(Boolean).sort(); }
// 직원 선택 표시: 본부-팀-이름(예명). 같은 표시가 겹치면 뒤에 번호를 붙여 구분한다
function staffLabels() {
  const list = STAFF.map(s => ({ s, base: [s.head, s.team, s.name + (s.nickname ? '(' + s.nickname + ')' : '')].filter(Boolean).join('-') + (s.status !== '활동' ? ' [' + s.status + ']' : '') }))
    .sort((a, b) => a.base.localeCompare(b.base, 'ko'));
  const seen = {}; list.forEach(x => { seen[x.base] = (seen[x.base] || 0) + 1; });
  const used = {}; const byId = {}, byLabel = {};
  list.forEach(x => { x.label = x.base; if (seen[x.base] > 1) { used[x.base] = (used[x.base] || 0) + 1; x.label += ' #' + used[x.base]; } byId[x.s.id] = x.label; byLabel[x.label] = x.s.id; });
  return { list, byId, byLabel };
}
function formHtml(fields, rec) {
  return `<div class="form">${fields.map(f => {
    const v = rec[f.k] ?? '';
    const id = 'f_' + f.k;
    let inp = '';
    if (f.type === 'select') inp = `<select class="in" id="${id}">${(f.opts || []).map(o => `<option ${String(o) === String(v) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (f.type === 'textarea') inp = `<textarea class="in" id="${id}" rows="3">${esc(v)}</textarea>`;
    else if (f.type === 'staffpick') { // 직원이 수백 명일 수 있어 입력하면 걸러지는 목록(datalist). 본부-팀-이름(예명)
      const L = staffLabels(), cur = rec.staffId ? (L.byId[rec.staffId] || '') : '';
      inp = `<input class="in" id="${id}" value="${esc(cur)}" list="dl_staffpick" autocomplete="off" placeholder="${esc(!rec.staffId && (rec.staff || rec.team) ? '기존 입력 유지: ' + (rec.team || '') + ' ' + (rec.staff || '') + ' — 바꾸려면 본부·팀·이름 입력' : '본부·팀·이름을 입력하면 걸러집니다')}"><datalist id="dl_staffpick">${L.list.map(x => `<option value="${esc(x.label)}">`).join('')}</datalist>`
        + (rec.staffId && !cur ? '<div class="hint red">연결된 직원이 이 현장 목록에 없습니다 (이동·반려 등)</div>' : '');
    }
    else if (f.type === 'dongho') inp = `<input class="in" id="${id}" value="${esc(v)}" list="dl_units" placeholder="예: 101-1203" autocomplete="off">`;
    else inp = `<input class="in" id="${id}" type="${f.type === 'date' ? 'date' : 'text'}" value="${esc(f.type === 'num' ? fmt0(v) : v)}" ${f.list ? `list="dl_${f.k}"` : ''} ${f.ro ? 'readonly' : ''} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}>`;
    const dlist = f.list ? `<datalist id="dl_${f.k}">${f.list.map(o => `<option value="${esc(o)}">`).join('')}</datalist>` : '';
    return `<div class="f ${f.full ? 'full' : ''}"><label for="${id}">${esc(f.l)}</label>${inp}${dlist}${f.type === 'dongho' ? `<div class="hint" id="${id}_hint"></div>` : ''}</div>`;
  }).join('')}<datalist id="dl_units">${live('units').map(u => `<option value="${u.id}">${u.type}</option>`).join('')}</datalist></div>`;
}
function formRead(fields, root, rec) {
  fields.forEach(f => { const el = root.querySelector('#f_' + f.k); if (!el || f.ro) return; let v = el.value.trim(); if (f.type === 'num') v = toNum(v); if (f.type === 'dongho') v = v.replace(/\s/g, '').replace(/^(\d{3})동?(\d{3,4})호?$/, '$1-$2'); if (f.type === 'staffpick') { // 직원을 고르면 팀·담당자 글자도 함께 채운다 (보고서·기존 화면은 글자를 쓴다). 비워 두면 기존 값 유지
      const id = v ? staffLabels().byLabel[v] : '';
      if (v && !id) { if (v !== (staffLabels().byId[rec.staffId] || '')) toast('담당자는 목록에 있는 직원만 고를 수 있습니다 (본부-팀-이름). 기존 값이 유지됩니다', 1); return; }
      if (id) { const s = STAFF.find(x => x.id === id); rec.staffId = id; if (s) { rec.staff = s.name; rec.team = s.team || ''; } } else delete rec.staffId;
      return;
    }
    rec[f.k] = v; });
  return rec;
}
/* 동호 입력 시 세대정보/중복 경고 */
function bindDonghoHint(root, kind, selfId) {
  const inp = root.querySelector('#f_dongho'); if (!inp) return;
  const h = root.querySelector('#f_dongho_hint');
  const upd = () => {
    const dh = inp.value.trim().replace(/^(\d{3})동?(\d{3,4})호?$/, '$1-$2');
    const u = IX.unit[dh];
    if (!dh) { h.innerHTML = ''; return; }
    if (!u) { h.innerHTML = `<span class="red">세대 목록에 없는 동호수입니다</span>`; return; }
    const msgs = [`<b>${u.type}</b>`, `${CFG().project.moneyLabel || '금액'} ${fmt(u.price)}`];
    const c = IX.active[dh], p = IX.pre[dh], r = IX.resv[dh], l = IX.lock[dh];
    if (c && !(kind === 'contracts' && c.id === selfId)) msgs.push(`<span class="red">● 계약중: ${esc(c.name)}</span>`);
    if (p && !(kind === 'pre' && p.id === selfId)) msgs.push(`<span class="${kind === 'contracts' ? 'blue' : 'red'}">● 가계약: ${esc(p.name)}</span>`);
    if (r && !(kind === 'resv' && r.id === selfId)) msgs.push(`<span class="${kind === 'resv' ? 'red' : 'blue'}">● 동호지정: ${esc(r.name)}</span>`);
    if (l && !(kind === 'locks' && l.id === selfId)) msgs.push(`<span class="red">● 잠금동호: ${esc(l.reason)}</span>`);
    h.innerHTML = msgs.join(' · ');
  };
  inp.addEventListener('input', upd); upd();
}

/* ===================== 가상 스크롤 그리드 ===================== */
function vgrid(el, o) {
  // o: {cols:[{k,l,w,a,f,s}], rows, rowH, onRow(row,ev), sel:Set (id 선택), key:'state key', foot:html, height}
  const st = VS['grid_' + o.key] = VS['grid_' + o.key] || { sort: o.defaultSort || null, dir: o.defaultDir || 1 };
  let rows = o.rows.slice();
  if (st.sort) { const c = o.cols.find(c => c.k === st.sort); if (c) { const g = c.s || (r => r[c.k]); rows.sort((a, b) => { let x = g(a), y = g(b); if (x === y) return 0; if (x === undefined || x === null || x === '') return 1; if (y === undefined || y === null || y === '') return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'ko', { numeric: true })) * st.dir; }); } }
  const H = o.rowH || 30;
  const cols = o.sel ? [{ k: '_sel', l: `<input type="checkbox" class="selall">`, w: 34, a: 'c', f: r => `<input type="checkbox" class="selrow" ${o.sel.has(r.id) ? 'checked' : ''}>`, nosort: 1 }].concat(o.cols) : o.cols;
  const W = cols.reduce((a, c) => a + (c.w || 100), 0);
  el.classList.add('vg'); el.style.height = (o.height || 'calc(100vh - 175px)');
  el.innerHTML = `<div class="vg-head"><div style="display:flex;min-width:${W}px">${cols.map(c => `<div class="vg-c ${c.a || ''} ${st.sort === c.k ? 'sorted' : ''}" data-dir="${st.dir > 0 ? '▲' : '▼'}" data-k="${c.k}" style="width:${c.w || 100}px">${c.l}</div>`).join('')}</div></div>
    <div class="vg-body"><div class="vg-inner" style="height:${rows.length * H}px;min-width:${W}px"></div></div>
    <div class="vg-foot">${o.foot ? o.foot(rows) : `<span>${fmt(rows.length)}건</span>`}</div>`;
  const body = el.querySelector('.vg-body'), inner = el.querySelector('.vg-inner'), head = el.querySelector('.vg-head');
  let last = '';
  const draw = (force) => {
    const top = body.scrollTop, h = body.clientHeight || 600;
    const s = Math.max(0, Math.floor(top / H) - 10), e = Math.min(rows.length, Math.ceil((top + h) / H) + 10);
    const sig = s + ':' + e; if (sig === last && !force) return; last = sig;
    let html = '';
    for (let i = s; i < e; i++) {
      const r = rows[i];
      html += `<div class="vg-row ${o.sel && o.sel.has(r.id) ? 'sel' : ''} ${o.rowClass ? o.rowClass(r) : ''}" data-i="${i}" style="top:${i * H}px;height:${H}px">${cols.map(c => `<div class="vg-c ${c.a || ''}" style="width:${c.w || 100}px">${c.f ? c.f(r, i) : esc(r[c.k])}</div>`).join('')}</div>`;
    }
    inner.innerHTML = html || (rows.length ? '' : '<div class="empty">데이터가 없습니다</div>');
  };
  body.addEventListener('scroll', () => { head.scrollLeft = body.scrollLeft; draw(); });
  head.addEventListener('click', e => {
    const c = e.target.closest('.vg-c'); if (!c) return;
    if (e.target.classList.contains('selall')) { const on = e.target.checked; rows.forEach(r => on ? o.sel.add(r.id) : o.sel.delete(r.id)); draw(true); o.onSel && o.onSel(); return; }
    const k = c.dataset.k; const cd = cols.find(x => x.k === k); if (!cd || cd.nosort) return;
    if (st.sort === k) st.dir *= -1; else { st.sort = k; st.dir = 1; }
    vgrid(el, o);
  });
  inner.addEventListener('click', e => {
    const rowEl = e.target.closest('.vg-row'); if (!rowEl) return; const r = rows[+rowEl.dataset.i];
    if (e.target.classList.contains('selrow')) { e.target.checked ? o.sel.add(r.id) : o.sel.delete(r.id); rowEl.classList.toggle('sel', e.target.checked); o.onSel && o.onSel(); return; }
    if (e.target.closest('input,select,button,a,.nocl')) { o.onAction && o.onAction(r, e); return; }
    o.onRow && o.onRow(r, e);
  });
  if (o.onChange) inner.addEventListener('change', e => { const rowEl = e.target.closest('.vg-row'); if (!rowEl) return; o.onChange(rows[+rowEl.dataset.i], e.target, rowEl); });
  if (o.onKey) inner.addEventListener('keydown', e => { const rowEl = e.target.closest('.vg-row'); if (!rowEl) return; o.onKey(rows[+rowEl.dataset.i], e, rowEl); });
  requestAnimationFrame(() => { if (VS['scroll_' + o.key] && o.keepScroll) body.scrollTop = VS['scroll_' + o.key]; draw(true); });
  body.addEventListener('scroll', () => VS['scroll_' + o.key] = body.scrollTop);
  el._rows = rows; el._draw = draw;
  return { rows, draw, body };
}
/* 텍스트 검색 */
function matchQ(r, q, keys) { if (!q) return true; const qs = q.toLowerCase().split(/\s+/).filter(Boolean); const hay = keys.map(k => String(r[k] ?? '')).join(' ').toLowerCase(); return qs.every(x => hay.includes(x)); }
function chipStatus(st) { const m = { '계약': 'info', '정상': 'info', '가계약': 'warn', '동호지정': 'warn', '잠금': 'lock', '잔여': 'gray', '해약': 'bad', '진행': 'info', '전환': 'ok', '취소': 'gray', '환불': 'bad', '해제': 'gray' }; return `<span class="chip ${m[st] || 'gray'}">${esc(st)}</span>`; }
function chipPay(ps) { return `<span class="chip ${ps.cls}" title="약정 ${fmt(ps.req)} / 납부 ${fmt(ps.paid)}">${ps.st}</span>`; }
