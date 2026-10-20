/* ===================== 출력 필드 정의 ===================== */
function FIELD_DEFS() {
  const st = STAGES(); const lab = CFG().project.moneyLabel || '금액';
  const defs = [
    ['계약자', 'name', '성명'], ['계약자', 'rrn', '주민번호'], ['계약자', 'rrn1', '주민번호 앞6'], ['계약자', 'rrn2', '주민번호 뒤7'], ['계약자', 'phone', '연락처'], ['계약자', 'addr', '주소'], ['계약자', 'mail', '우편물주소'], ['계약자', 'email', '이메일'], ['계약자', 'stype', '공급유형'], ['계약자', 'ctype', '계약유형'],
    ['세대', 'dongho', '동호수(101-1203)'], ['세대', 'dong', '동'], ['세대', 'ho', '호'], ['세대', 'dongho2', '101동 1203호'], ['세대', 'type', '타입'],
    ['세대', 'exArea', '전용면적'], ['세대', 'resArea', '주거공용면적'], ['세대', 'etcArea', '그밖의공용면적'], ['세대', 'supArea', '공급면적'], ['세대', 'sumArea', '면적합계(전용+주거공용+기타공용)'], ['세대', 'conArea', '계약면적'], ['세대', 'landArea', '대지지분'],
    ['금액', 'price', lab], ['금액', 'priceKor', lab + ' 한글'], ['금액', 'midSum', '중도금 합계'], ['금액', 'midSumKor', '중도금 합계 한글'],
    ...st.flatMap(s => [['금액', 'amt:' + s, s], ['금액', 'kor:' + s, s + ' 한글']]),
    ...st.filter(s => (CFG().stageDue || {})[s]).map(s => ['일자', 'due:' + s, s + ' 납부기한']),
    ['일자', 'date', '계약일'], ['일자', 'dateY', '계약일-년'], ['일자', 'dateM', '계약일-월'], ['일자', 'dateD', '계약일-일'], ['일자', 'today', '오늘'], ['일자', 'todayY', '오늘-년'], ['일자', 'todayM', '오늘-월'], ['일자', 'todayD', '오늘-일'],
    ['기타', 'proj', '주택명(프로젝트)'], ['기타', 'lessor', '임대인/시행사'], ['기타', 'bizNo', '사업자번호'], ['기타', 'account', '계좌번호'], ['기타', 'text', '고정 문구'], ['기타', 'check', '체크(V)']
  ];
  return defs.map(([g, k, l]) => ({ g, k, l }));
}
function fieldVal(f, c, u) {
  c = c || {}; u = u || {}; const am = u.amounts || {}; const P = CFG().project; const k = f.key;
  const area = n => n ? Number(n).toFixed(f.dec ?? 4).replace(/\.?0+$/, m => (f.dec === 0 ? '' : m.startsWith('.') ? '' : m)) : '';
  const money = n => f.kor ? numKor(n) : fmt(n);
  const kor = n => (f.prefix ?? '일금 ') + numKor(n) + (f.suffix ?? '원정');
  const [dy, dm, dd] = (c.date || '').split('-'); const [ty, tm, tdd] = today().split('-');
  const st = STAGES(); const mid = st.filter(s => /중도/.test(s)).reduce((a, s) => a + (am[s] || 0), 0);
  switch (true) {
    case k === 'rrn1': return String(c.rrn || '').split('-')[0] || '';
    case k === 'rrn2': return String(c.rrn || '').split('-')[1] || '';
    case k === 'dong': return (c.dongho || u.id || '').split('-')[0];
    case k === 'ho': return (c.dongho || u.id || '').split('-')[1];
    case k === 'dongho2': { const [a, b] = (c.dongho || u.id || '').split('-'); return a ? `${a}동 ${b}호` : ''; }
    case k === 'dongho': return c.dongho || u.id || '';
    case k === 'type': return u.type || '';
    case ['exArea', 'resArea', 'etcArea', 'conArea', 'landArea'].includes(k): return area(u[k]);
    case k === 'supArea': return area(u.supArea || ((u.exArea || 0) + (u.resArea || 0)));
    case k === 'sumArea': return area((u.exArea || 0) + (u.resArea || 0) + (u.etcArea || 0));
    case k === 'price': return fmt(u.price);
    case k === 'priceKor': return kor(u.price);
    case k === 'midSum': return fmt(mid);
    case k === 'midSumKor': return kor(mid);
    case k.startsWith('amt:'): return fmt(am[k.slice(4)]);
    case k.startsWith('kor:'): return kor(am[k.slice(4)]);
    case k.startsWith('due:'): return dfmt((CFG().stageDue || {})[k.slice(4)], f.dfmt);
    case k === 'date': return dfmt(c.date, f.dfmt);
    case k === 'dateY': return dy || ''; case k === 'dateM': return dm ? String(+dm) : ''; case k === 'dateD': return dd ? String(+dd) : '';
    case k === 'today': return dfmt(today(), f.dfmt);
    case k === 'todayY': return ty; case k === 'todayM': return String(+tm); case k === 'todayD': return String(+tdd);
    case k === 'proj': return P.name || ''; case k === 'lessor': return P.lessor || ''; case k === 'bizNo': return P.bizNo || ''; case k === 'account': return P.account || '';
    case k === 'text': return f.text || ''; case k === 'check': return 'V';
    default: return c[k] ?? '';
  }
}
function dfmt(d, how) { if (!d) return ''; const [y, m, dd] = d.split('-'); if (how === 'kor') return `${y}년 ${+m}월 ${+dd}일`; if (how === 'dot') return `${y}. ${pad(+m)}. ${pad(+dd)}.`; return d; }

/* ===================== 템플릿 ===================== */
function defaultTemplate() {
  let y = 30; const f = (key, x, extra = {}) => Object.assign({ id: uid('f'), key, page: 1, x, y: (y += 9) - 9, size: 11, align: 'left', w: 0, bold: false }, extra);
  return {
    id: 'tpl_contract', name: '표준임대차계약서', paperW: 210, paperH: 297, pages: 2, offX: 0, offY: 0,
    fields: [f('dongho2', 30), f('type', 30), f('name', 30), f('rrn', 30), f('phone', 30), f('addr', 30, { size: 10 }), f('exArea', 30), f('resArea', 30), f('etcArea', 30), f('sumArea', 30), f('price', 30), f('priceKor', 30), f('amt:' + STAGES()[0], 30), f('kor:' + STAGES()[0], 30), f('midSum', 30), f('date', 30, { dfmt: 'kor' }),
    Object.assign(f('name', 140), { page: 2, y: 250 }), Object.assign(f('date', 30), { page: 2, y: 240, dfmt: 'kor' })]
  };
}
let _defTpl = null;
function templates() { const t = live('templates'); if (t.length) return t; return [_defTpl = _defTpl || defaultTemplate()]; }
let BG_CACHE = {};
async function getBg(tid, page) { const k = tid + '_' + page; if (BG_CACHE[k] !== undefined) return BG_CACHE[k]; BG_CACHE[k] = (await idb.getMeta('bg_' + k)) || ''; return BG_CACHE[k]; }
async function setBg(tid, page, data) { BG_CACHE[tid + '_' + page] = data; await idb.setMeta('bg_' + tid + '_' + page, data); }

/* ===================== 출력 화면 (디자이너) ===================== */
function view_print(el) {
  const v = VS.pd = VS.pd || { tid: templates()[0].id, sel: null, zoom: 2.6, prev: '', showBg: true };
  let T = JSON.parse(JSON.stringify(templates().find(t => t.id === v.tid) || templates()[0])); v.tid = T.id;
  const prevC = M.contracts[v.prev] || Object.values(IX.active)[0];
  const defs = FIELD_DEFS();
  const Z = v.zoom;
  el.innerHTML = `<div class="toolbar"><h2>계약서 출력</h2>
    <select class="in" id="tSel">${templates().map(t => `<option value="${t.id}" ${t.id === T.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select>
    <button class="btn" id="tNew">새 양식</button><button class="btn" id="tDup">복제</button><button class="btn dan" id="tDel">삭제</button>
    <span class="sp"></span>
    <label class="sub">미리보기 계약</label><input class="in" id="pvDh" list="dl_cdh" placeholder="동호수" value="${esc(prevC ? prevC.dongho : '')}" style="width:110px"><datalist id="dl_cdh">${Object.values(IX.active).map(c => `<option value="${c.dongho}">${esc(c.name)}</option>`).join('')}</datalist>
    <label><input type="checkbox" id="showBg" ${v.showBg ? 'checked' : ''}> 배경</label>
    <select class="in" id="zoom">${[1.8, 2.2, 2.6, 3.2, 4].map(z => `<option value="${z}" ${z === Z ? 'selected' : ''}>${Math.round(z / 2.6 * 100)}%</option>`).join('')}</select>
    <button class="btn" id="bGrid">보정용 눈금 인쇄</button>
    <button class="btn" id="bTest">미리보기 계약 시험인쇄(배경포함)</button>
    <button class="btn pri" id="bPrintOne">미리보기 계약 출력</button></div>
    <div class="banner info"><div>인쇄된 계약서 용지에 <b>내용만</b> 찍히도록 위치(mm)를 맞춥니다. ① 계약서 스캔/사진을 페이지 배경으로 올리고 ② 필드를 끌어 맞춘 뒤 ③ 실제 용지로 시험 출력하여 어긋나면 <b>전체 보정(X/Y)</b>으로 미세조정하세요. 인쇄 시 브라우저 설정은 <b>여백 없음·배율 100%·머리글/바닥글 해제</b>.</div></div>
    <div class="pd">
      <div class="card" style="padding:10px">
        <div class="form" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px">
          <div class="f full"><label>양식 이름</label><input class="in" id="tName" value="${esc(T.name)}"></div>
          <div class="f"><label>용지 폭(mm)</label><input class="in" id="tW" value="${T.paperW}"></div><div class="f"><label>높이(mm)</label><input class="in" id="tH" value="${T.paperH}"></div>
          <div class="f"><label>페이지 수</label><input class="in" id="tP" value="${T.pages}"></div><div class="f"></div>
          <div class="f"><label>전체 보정 X(mm, +오른쪽)</label><input class="in" id="tOX" value="${T.offX || 0}"></div><div class="f"><label>전체 보정 Y(mm, +아래)</label><input class="in" id="tOY" value="${T.offY || 0}"></div>
        </div>
        <h4 style="margin:12px 0 4px">필드 추가</h4>
        <select class="in" id="addKey" style="width:100%">${[...new Set(defs.map(d => d.g))].map(g => `<optgroup label="${g}">${defs.filter(d => d.g === g).map(d => `<option value="${esc(d.k)}">${esc(d.l)}</option>`).join('')}</optgroup>`).join('')}</select>
        <div style="display:flex;gap:6px;margin-top:6px"><select class="in" id="addPage">${Array.from({ length: T.pages }, (_, i) => `<option value="${i + 1}">${i + 1}페이지</option>`).join('')}</select><button class="btn pri" id="bAdd">+ 추가</button></div>
        <h4 style="margin:12px 0 4px">배치된 필드 (${T.fields.length})</h4>
        <div class="pd-list" id="fList">${T.fields.map(f => `<div data-id="${f.id}" class="${v.sel === f.id ? 'sel' : ''}">p${f.page} · ${esc((defs.find(d => d.k === f.key) || {}).l || f.key)}${f.key === 'text' ? ': ' + esc(f.text || '') : ''}</div>`).join('')}</div>
        <div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${Array.from({ length: T.pages }, (_, i) => `<label class="btn sm">p${i + 1} 배경<input type="file" accept="image/*" data-bgp="${i + 1}" style="display:none"></label>`).join('')}<button class="btn sm" id="bgClr">배경삭제</button></div>
        <div class="muted" style="font-size:11px;margin-top:4px">배경 이미지는 이 PC에만 저장됩니다(위치 맞춤용, 인쇄 안 됨).</div>
      </div>
      <div class="pd-canvas-wrap" id="cv"></div>
      <div class="card pd-props" id="props" style="padding:12px"></div>
    </div>`;
  const persist = debounce(async () => { await save('templates', T); }, 500);
  const drawCanvas = async () => {
    const pages = [];
    for (let p = 1; p <= T.pages; p++) {
      const bg = v.showBg ? await getBg(T.id, p) : '';
      pages.push(`<div class="pd-page" data-p="${p}" style="width:${T.paperW * Z}px;height:${T.paperH * Z}px;${bg ? `background-image:url(${bg})` : ''}">${T.fields.filter(f => f.page == p).map(f => fieldBox(f)).join('')}<div style="position:absolute;right:6px;bottom:4px;color:#aaa;font-size:11px">p${p}</div></div>`);
    }
    $('#cv').innerHTML = pages.join('');
  };
  const fieldBox = f => { const val = fieldVal(f, prevC, prevC ? IX.unit[prevC.dongho] : null) || '[' + ((defs.find(d => d.k === f.key) || {}).l || f.key) + ']'; const w = f.w ? `width:${f.w * Z}px;text-align:${f.align};` : ''; const left = f.w || f.align === 'left' ? f.x : f.x; return `<div class="pd-field ${v.sel === f.id ? 'sel' : ''}" data-id="${f.id}" style="left:${left * Z}px;top:${f.y * Z}px;font-size:${f.size * Z * 0.3528}px;${f.bold ? 'font-weight:700;' : ''}${f.ls ? `letter-spacing:${f.ls * Z}px;` : ''}${w}">${esc(val)}</div>`; };
  const drawProps = () => {
    const f = T.fields.find(x => x.id === v.sel);
    if (!f) { $('#props').innerHTML = '<div class="muted">필드를 선택하세요.<br><br>• 드래그로 이동<br>• 방향키 0.5mm, Shift+방향키 2mm 이동<br>• Delete 키로 삭제</div>'; return; }
    $('#props').innerHTML = `<h4 style="margin:0 0 8px">${esc((defs.find(d => d.k === f.key) || {}).l || f.key)}</h4>
      <div class="f"><label>항목</label><select class="in" data-p="key">${defs.map(d => `<option value="${esc(d.k)}" ${d.k === f.key ? 'selected' : ''}>${d.g} · ${esc(d.l)}</option>`).join('')}</select></div>
      ${f.key === 'text' ? `<div class="f"><label>문구</label><input class="in" data-p="text" value="${esc(f.text || '')}"></div>` : ''}
      <div class="grid2" style="gap:6px"><div class="f"><label>X (mm)</label><input class="in" data-p="x" value="${f.x}"></div><div class="f"><label>Y (mm)</label><input class="in" data-p="y" value="${f.y}"></div>
      <div class="f"><label>글자크기(pt)</label><input class="in" data-p="size" value="${f.size}"></div><div class="f"><label>페이지</label><input class="in" data-p="page" value="${f.page}"></div>
      <div class="f"><label>정렬</label><select class="in" data-p="align">${['left', 'center', 'right'].map(a => `<option ${f.align === a ? 'selected' : ''} value="${a}">${{ left: '왼쪽', center: '가운데', right: '오른쪽' }[a]}</option>`).join('')}</select></div><div class="f"><label>칸 폭(mm, 정렬용)</label><input class="in" data-p="w" value="${f.w || 0}"></div>
      <div class="f"><label>자간(mm, 칸맞춤)</label><input class="in" data-p="ls" value="${f.ls || 0}"></div><div class="f"><label>굵게</label><select class="in" data-p="bold"><option value="">보통</option><option value="1" ${f.bold ? 'selected' : ''}>굵게</option></select></div></div>
      ${/date|today|due:/.test(f.key) && !/[YMD]$/.test(f.key) ? `<div class="f"><label>날짜형식</label><select class="in" data-p="dfmt"><option value="">2026-03-05</option><option value="kor" ${f.dfmt === 'kor' ? 'selected' : ''}>2026년 3월 5일</option><option value="dot" ${f.dfmt === 'dot' ? 'selected' : ''}>2026. 03. 05.</option></select></div>` : ''}
      ${/Kor$|^kor:/.test(f.key) ? `<div class="grid2" style="gap:6px"><div class="f"><label>앞 문구</label><input class="in" data-p="prefix" value="${esc(f.prefix ?? '일금 ')}"></div><div class="f"><label>뒤 문구</label><input class="in" data-p="suffix" value="${esc(f.suffix ?? '원정')}"></div></div>` : ''}
      ${/Area$/.test(f.key) ? `<div class="f"><label>소수점 자리</label><input class="in" data-p="dec" value="${f.dec ?? 4}"></div>` : ''}
      <div style="display:flex;gap:6px;margin-top:8px"><button class="btn" id="fDup">복제</button><button class="btn dan" id="fDel">삭제</button></div>`;
    $$('#props [data-p]').forEach(inp => inp.onchange = () => {
      const p = inp.dataset.p; let val = inp.value;
      if (['x', 'y', 'size', 'w', 'ls', 'dec'].includes(p)) val = parseFloat(val) || 0; if (p === 'page') val = Math.max(1, Math.min(T.pages, parseInt(val) || 1)); if (p === 'bold') val = !!val;
      f[p] = val; persist(); drawCanvas(); if (p === 'key') { drawProps(); refreshList(); }
    });
    $('#fDel').onclick = () => { T.fields = T.fields.filter(x => x.id !== f.id); v.sel = null; persist(); render(); };
    $('#fDup').onclick = () => { const n = Object.assign({}, f, { id: uid('f'), y: f.y + 6 }); T.fields.push(n); v.sel = n.id; persist(); render(); };
  };
  const refreshList = () => { $('#fList').innerHTML = T.fields.map(f => `<div data-id="${f.id}" class="${v.sel === f.id ? 'sel' : ''}">p${f.page} · ${esc((defs.find(d => d.k === f.key) || {}).l || f.key)}${f.key === 'text' ? ': ' + esc(f.text || '') : ''}</div>`).join(''); };
  drawCanvas(); drawProps();
  $('#fList').onclick = e => { const d = e.target.closest('[data-id]'); if (!d) return; v.sel = d.dataset.id; refreshList(); drawProps(); drawCanvas(); };
  // 드래그
  $('#cv').onmousedown = e => {
    const fe = e.target.closest('.pd-field'); if (!fe) { if (e.target.closest('.pd-page')) { v.sel = null; drawProps(); refreshList(); $$('.pd-field.sel').forEach(x => x.classList.remove('sel')); } return; }
    e.preventDefault(); const f = T.fields.find(x => x.id === fe.dataset.id); v.sel = f.id; $$('.pd-field.sel').forEach(x => x.classList.remove('sel')); fe.classList.add('sel'); drawProps(); refreshList();
    const sx = e.clientX, sy = e.clientY, ox = f.x, oy = f.y;
    const mv = ev => { f.x = Math.round((ox + (ev.clientX - sx) / Z) * 2) / 2; f.y = Math.round((oy + (ev.clientY - sy) / Z) * 2) / 2; fe.style.left = f.x * Z + 'px'; fe.style.top = f.y * Z + 'px'; };
    const up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); persist(); drawProps(); };
    document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
  };
  document.onkeydown = e => {
    if (CUR !== 'print' || !v.sel || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const f = T.fields.find(x => x.id === v.sel); if (!f) return; const st = e.shiftKey ? 2 : 0.5;
    if (e.key === 'ArrowLeft') f.x -= st; else if (e.key === 'ArrowRight') f.x += st; else if (e.key === 'ArrowUp') f.y -= st; else if (e.key === 'ArrowDown') f.y += st;
    else if (e.key === 'Delete') { T.fields = T.fields.filter(x => x.id !== f.id); v.sel = null; persist(); render(); return; } else return;
    e.preventDefault(); f.x = Math.round(f.x * 2) / 2; f.y = Math.round(f.y * 2) / 2; persist(); drawCanvas(); drawProps();
  };
  const tset = (id, k, num) => $(id).onchange = e => { T[k] = num ? (parseFloat(e.target.value) || 0) : e.target.value; if (k === 'pages') T.pages = Math.max(1, Math.round(T.pages)); persist(); setTimeout(render, 550); };
  tset('#tName', 'name'); tset('#tW', 'paperW', 1); tset('#tH', 'paperH', 1); tset('#tP', 'pages', 1); tset('#tOX', 'offX', 1); tset('#tOY', 'offY', 1);
  $('#tSel').onchange = e => { v.tid = e.target.value; v.sel = null; render(); };
  $('#tNew').onclick = async () => { const t = { id: uid('tpl'), name: '새 양식', paperW: 210, paperH: 297, pages: 1, offX: 0, offY: 0, fields: [] }; await save('templates', t); v.tid = t.id; render(); };
  $('#tDup').onclick = async () => { const t = JSON.parse(JSON.stringify(T)); t.id = uid('tpl'); t.name += ' 복사'; delete t.deleted; await save('templates', t); for (let p = 1; p <= T.pages; p++) { const b = await getBg(T.id, p); if (b) await setBg(t.id, p, b); } v.tid = t.id; render(); };
  $('#tDel').onclick = () => confirmBox(`'${T.name}' 양식을 삭제할까요?`, async () => { await save('templates', Object.assign(T, { deleted: true })); v.tid = (templates()[0] || {}).id; render(); });
  $('#bAdd').onclick = () => { const n = { id: uid('f'), key: $('#addKey').value, page: +$('#addPage').value, x: 20, y: 20, size: 11, align: 'left', w: 0, bold: false }; if (n.key === 'text') n.text = '문구'; T.fields.push(n); v.sel = n.id; persist(); render(); };
  $('#pvDh').onchange = e => { const c = IX.active[e.target.value.trim()]; if (c) { v.prev = c.id; render(); } else toast('계약이 없는 동호입니다', 1); };
  $('#showBg').onchange = e => { v.showBg = e.target.checked; drawCanvas(); };
  $('#zoom').onchange = e => { v.zoom = parseFloat(e.target.value); render(); };
  $$('[data-bgp]').forEach(inp => inp.onchange = () => { const f = inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = async () => { await setBg(T.id, +inp.dataset.bgp, rd.result); drawCanvas(); }; rd.readAsDataURL(f); });
  $('#bgClr').onclick = async () => { for (let p = 1; p <= T.pages; p++) await setBg(T.id, p, ''); drawCanvas(); };
  $('#bPrintOne').onclick = () => prevC ? printContracts([prevC.id], T.id) : toast('계약 없음');
  $('#bTest').onclick = () => prevC ? printContracts([prevC.id], T.id, { bg: true }) : toast('계약 없음');
  $('#bGrid').onclick = () => printGrid(T);
}
async function printContracts(ids, tid, opt = {}) {
  const tps = templates();
  if (!tid) {
    if (tps.length > 1) {
      openModal({ title: '출력 양식 선택', body: `<div style="display:flex;flex-direction:column;gap:6px">${tps.map(t => `<button class="btn" data-t="${t.id}">${esc(t.name)}</button>`).join('')}</div>`, onOpen: bg => $$('[data-t]', bg).forEach(b => b.onclick = () => { closeModal(); printContracts(ids, b.dataset.t, opt); }) });
      return;
    }
    tid = tps[0].id;
  }
  const T = tps.find(t => t.id === tid) || tps[0];
  let html = `<style>@page{size:${T.paperW}mm ${T.paperH}mm;margin:0}</style>`;
  for (const id of ids) {
    const c = M.contracts[id]; const u = IX.unit[c.dongho];
    for (let p = 1; p <= T.pages; p++) {
      const bg = opt.bg ? await getBg(T.id, p) : '';
      html += `<div class="pp" style="width:${T.paperW}mm;height:${T.paperH}mm;${bg ? `background-image:url(${bg})` : ''}">${T.fields.filter(f => f.page == p).map(f => { const val = fieldVal(f, c, u); if (val === '' || val === undefined) return ''; const x = f.x + (T.offX || 0), y = f.y + (T.offY || 0); return `<div class="pf" style="left:${x}mm;top:${y}mm;font-size:${f.size}pt;${f.bold ? 'font-weight:700;' : ''}${f.ls ? `letter-spacing:${f.ls}mm;` : ''}${f.w ? `width:${f.w}mm;text-align:${f.align};` : ''}">${esc(val)}</div>`; }).join('')}</div>`;
    }
  }
  $('#printRoot').innerHTML = html;
  setTimeout(() => window.print(), 80);
}
function printContractFor(id) { printContracts([id]); }
function printGrid(T) {
  let lines = '';
  for (let x = 0; x <= T.paperW; x += 5) lines += `<div style="position:absolute;left:${x}mm;top:0;bottom:0;border-left:${x % 10 ? '0.1mm dotted #9bb' : '0.2mm solid #48a'}"></div>${x % 10 === 0 ? `<div style="position:absolute;left:${x + 0.5}mm;top:1mm;font-size:6pt;color:#26a">${x}</div><div style="position:absolute;left:${x + 0.5}mm;top:${T.paperH / 2}mm;font-size:6pt;color:#26a">${x}</div>` : ''}`;
  for (let y = 0; y <= T.paperH; y += 5) lines += `<div style="position:absolute;top:${y}mm;left:0;right:0;border-top:${y % 10 ? '0.1mm dotted #9bb' : '0.2mm solid #48a'}"></div>${y % 10 === 0 ? `<div style="position:absolute;top:${y + 0.3}mm;left:1mm;font-size:6pt;color:#c33">${y}</div><div style="position:absolute;top:${y + 0.3}mm;left:${T.paperW / 2}mm;font-size:6pt;color:#c33">${y}</div>` : ''}`;
  $('#printRoot').innerHTML = `<style>@page{size:${T.paperW}mm ${T.paperH}mm;margin:0}</style><div class="pp" style="width:${T.paperW}mm;height:${T.paperH}mm">${lines}</div>`;
  setTimeout(() => window.print(), 80);
}

/* ===================== 영수증 (A4 한 장 = 위 계약자 보관 / 아래 회사 보관) ===================== */
function receiptPage(dh, stage) {
  const u = IX.unit[dh] || {}; const c = IX.active[dh] || IX.pre[dh] || IX.resv[dh] || {}; const P = CFG().project;
  const all = (IX.depByDh[dh] || []).filter(d => d.cat === stage).sort((a, b) => a.t < b.t ? -1 : 1);
  const ps = payState(dh, stage); const first = all[0] || {};
  const MAX = 5; const deps = all.slice(0, MAX); const rest = all.slice(MAX);
  const who = P.moneyLabel === '임대보증금' ? '임차인' : '계약자';
  const rows = deps.map(d => `<tr><td>${esc(P.moneyLabel || '분양대금')}</td><td>${esc(stage)}</td><td class="r">${fmt(ps.req)}</td><td>${d.t.slice(0, 10)}</td><td colspan="2" class="r">${fmt((d.inn || 0) - (d.out || 0))}</td></tr>`).join('')
    + (rest.length ? `<tr><td colspan="3">외 ${rest.length}건</td><td></td><td colspan="2" class="r">${fmt(rest.reduce((a, d) => a + (d.inn || 0) - (d.out || 0), 0))}</td></tr>` : '');
  const one = copy => `<div class="rc"><div class="rbox"><div class="copy">[${copy}]</div><h1>영 수 증</h1>
    <table><tr><th>${P.lessor ? '임대인/시행' : '시행사'}</th><th>사업자번호<br>/법인명</th><td colspan="2">${esc(P.bizNo)} / ${esc(P.lessor)}</td><th>타입</th><td>${esc(u.type || '')}</td></tr>
    <tr><th colspan="2">주택명</th><td colspan="4">${esc(P.name)}</td></tr>
    <tr><th>${who}</th><th>성명</th><td colspan="2"><b>${esc(c.name || '')}</b></td><th>동·호</th><td><b>${esc(dh)}</b></td></tr>
    <tr><th>구분</th><th>회차</th><th>약정금액</th><th>납부일</th><th colspan="2">납부금액</th></tr>
    ${rows}
    <tr><th colspan="3">※ 취급(수납)인 날인이 없는 것은 무효임</th><th>납부총액</th><td colspan="2" class="r"><b>${fmt(ps.paid)}</b> 원</td></tr>
    <tr><th colspan="2">입금일(최초)</th><td colspan="2">${esc(first.t || '')}</td><th>입금자명</th><td>${esc(first.desc || '')}</td></tr></table>
    <div class="rsign"><span>${esc(P.lessor)}</span><span>발행일 ${today()} &nbsp;&nbsp; 취급(수납)인 :　　　　　　(인)</span></div></div></div>`;
  return `<div class="pp receipt">${one('계약자 보관용')}<div class="cut"><span>✂ 절취선</span></div>${one('회사 보관용')}</div>`;
}
function printReceipts(items) {
  if (!items.length) return toast('출력할 영수증이 없습니다', 1);
  $('#printRoot').innerHTML = `<style>@page{size:A4;margin:0}</style>` + items.map(([dh, st]) => receiptPage(dh, st)).join('');
  setTimeout(() => window.print(), 80);
}
function printReceipt(dh, stage) { printReceipts([[dh, stage]]); }
