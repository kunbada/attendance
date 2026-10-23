/* ===================== 계약관리 ===================== */
// 통합관리 직원 목록이 있으면 목록에서 고르게 하고(staffId 저장), 없으면(로컬 전용·목록을 못 받은 때) 예전처럼 글자 입력
let FORCE_TEXT = false; // 엑셀 붙여넣기 일괄등록은 팀·담당자를 글자 열로 받는다
const asText = fn => { FORCE_TEXT = true; try { return fn(); } finally { FORCE_TEXT = false; } };
const staffFields = (col, teamL, staffL) => STAFF.length && !FORCE_TEXT ? [{ k: 'staffId', l: staffL + ' (직원 선택)', type: 'staffpick' }] : [{ k: 'team', l: teamL, list: distinct(col, 'team') }, { k: 'staff', l: staffL, list: distinct(col, 'staff') }];
const C_FIELDS = () => [
  { k: 'dongho', l: '동호수 *', type: 'dongho' }, { k: 'name', l: '성명 *' },
  { k: 'rrn', l: '주민번호', ph: '000000-0000000' }, { k: 'phone', l: '연락처', ph: '010-0000-0000' },
  { k: 'date', l: '계약일', type: 'date' }, { k: 'ctype', l: '계약유형', list: distinct('contracts', 'ctype', ['정당', '예비당첨', '선착순']) },
  { k: 'stype', l: '공급유형', list: distinct('contracts', 'stype', ['일반', '신혼부부', '청년', '고령자']) }, { k: 'fee', l: '수수료기준', list: distinct('contracts', 'fee', ['일반', '조직']) },
  ...staffFields('contracts', '계약팀', '담당자'),
  { k: 'report', l: '보고여부', type: 'select', opts: ['보고', '미보고', '해약'] }, { k: 'status', l: '계약상태', type: 'select', opts: ['정상', '해약'] },
  { k: 'email', l: '이메일' }, { k: 'mail', l: '우편물 주소' },
  { k: 'addr', l: '주소', full: true }, { k: 'note', l: '특이사항', full: true }, { k: 'memo', l: '비고' }, { k: 'memo2', l: '비고2' }
];
function view_contracts(el) {
  const v = VS.con = VS.con || { q: '', st: '정상', type: '', team: '', pay: '' };
  v.sel = v.sel || new Set();
  const s0 = STAGES()[0], s1 = STAGES()[1];
  const dupCount = {}; live('contracts').forEach(c => { if (c.status !== '해약' && c.dongho) dupCount[c.dongho] = (dupCount[c.dongho] || 0) + 1; });
  let rows = live('contracts').filter(c => (!v.st || c.status === v.st) && (!v.type || (IX.unit[c.dongho] || {}).type === v.type) && (!v.team || c.team === v.team) && matchQ(c, v.q, ['dongho', 'name', 'phone', 'staff', 'team', 'note', 'memo', 'addr']));
  if (v.pay) rows = rows.filter(c => { const ps = payState(c.dongho, v.pay); return !ps.done; });
  const no = {}; live('contracts').forEach((c, i) => no[c.id] = i + 1);
  el.innerHTML = `<div class="toolbar"><h2>계약관리</h2>
    <input class="in" id="q" placeholder="동호/이름/연락처/담당 검색" value="${esc(v.q)}" style="width:220px">
    <select class="in" id="fSt"><option value="">전체</option>${['정상', '해약'].map(x => `<option ${v.st === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <select class="in" id="fType"><option value="">전체 타입</option>${IX.types.map(x => `<option ${v.type === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <select class="in" id="fTeam"><option value="">전체 팀</option>${distinct('contracts', 'team').map(x => `<option ${v.team === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
    <select class="in" id="fPay"><option value="">수납 전체</option>${STAGES().map(x => `<option value="${x}" ${v.pay === x ? 'selected' : ''}>${x} 미완납</option>`).join('')}</select>
    <span class="sp"></span>
    <button class="btn" id="bPrint">선택 계약서 출력</button>
    <button class="btn" onclick="bulkPaste('contracts')">엑셀 붙여넣기 등록</button>
    <button class="btn" id="bX">엑셀</button>
    <button class="btn pri" onclick="editContract()">+ 계약 등록</button></div><div id="g"></div>`;
  const re = () => render();
  $('#q').oninput = debounce(e => { v.q = e.target.value; re(); setTimeout(() => { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 250);
  $('#fSt').onchange = e => { v.st = e.target.value; re(); }; $('#fType').onchange = e => { v.type = e.target.value; re(); };
  $('#fTeam').onchange = e => { v.team = e.target.value; re(); }; $('#fPay').onchange = e => { v.pay = e.target.value; re(); };
  $('#bX').onclick = () => exportXlsx('계약관리_' + today() + '.xlsx', [['No', '보고', '상태', '동호수', '타입', '성명', '주민번호', '연락처', '이메일', '계약일', '계약유형', '공급유형', '수수료기준', '계약팀', '담당자', '주소', '우편물주소', s0, s1, '특이사항', '비고', '비고2']].concat(rows.map(c => [no[c.id], c.report, c.status, c.dongho, (IX.unit[c.dongho] || {}).type || '', c.name, c.rrn, c.phone, c.email, c.date, c.ctype, c.stype, c.fee, c.team, c.staff, c.addr, c.mail, payState(c.dongho, s0).st, s1 ? payState(c.dongho, s1).st : '', c.note, c.memo, c.memo2])), '계약관리');
  $('#bPrint').onclick = () => { const ids = [...v.sel].filter(id => M.contracts[id]); if (!ids.length) return toast('출력할 계약을 체크하세요'); printContracts(ids); };
  vgrid($('#g'), {
    key: 'con', rows, sel: v.sel, keepScroll: true, defaultSort: 'no',
    cols: [
      { k: 'no', l: 'No', w: 50, a: 'c', s: c => no[c.id], f: c => no[c.id] },
      { k: 'report', l: '보고', w: 56, a: 'c', f: c => c.report === '미보고' ? '<span class="chip warn">미보고</span>' : esc(c.report) },
      { k: 'status', l: '상태', w: 54, a: 'c', f: c => chipStatus(c.status) },
      { k: 'dongho', l: '동호수', w: 82, a: 'c', s: c => c.dongho.replace(/-(\d+)$/, (m, h) => '-' + h.padStart(4, '0')), f: c => `<a href="#" class="nocl" style="${dupCount[c.dongho] > 1 && c.status !== '해약' ? 'color:var(--bad);font-weight:700' : ''}" onclick="event.preventDefault();openUnit('${c.dongho}')">${esc(c.dongho)}</a>` },
      { k: 'type', l: '타입', w: 52, a: 'c', s: c => (IX.unit[c.dongho] || {}).type, f: c => (IX.unit[c.dongho] || {}).type || '<span class="red">?</span>' },
      { k: 'name', l: '성명', w: 74, a: 'c' }, { k: 'phone', l: '연락처', w: 112, a: 'c' },
      { k: 'date', l: '계약일', w: 88, a: 'c' }, { k: 'ctype', l: '계약유형', w: 74, a: 'c' }, { k: 'stype', l: '공급유형', w: 70, a: 'c' }, { k: 'fee', l: '수수료', w: 52, a: 'c' },
      { k: 'team', l: '팀', w: 62, a: 'c' }, { k: 'staff', l: '담당', w: 64, a: 'c' },
      { k: 'p0', l: s0, w: 76, a: 'c', s: c => payState(c.dongho, s0).st, f: c => c.status === '해약' ? '' : chipPay(payState(c.dongho, s0)) },
      ...(s1 ? [{ k: 'p1', l: s1, w: 76, a: 'c', s: c => payState(c.dongho, s1).st, f: c => c.status === '해약' ? '' : chipPay(payState(c.dongho, s1)) }] : []),
      { k: 'rrn', l: '주민번호', w: 118, a: 'c', f: c => esc(maskRRN(c.rrn)) },
      { k: 'addr', l: '주소', w: 260 }, { k: 'note', l: '특이사항', w: 200, f: c => esc([c.note, c.memo, c.memo2].filter(Boolean).join(' / ')) }
    ],
    onRow: c => editContract(c.id),
    foot: rs => `<span>${fmt(rs.length)}건</span><span>선택 ${v.sel.size}건</span><span>정상계약 ${fmt(Object.keys(IX.active).length)} / ${fmt(live('units').length)}세대 (${pct(Object.keys(IX.active).length, live('units').length)})</span>${Object.values(dupCount).some(n => n > 1) ? '<span class="red">⚠ 동호 중복 계약 있음(빨간 동호)</span>' : ''}`,
    onSel: () => { }
  });
}
function editContract(id, dh) {
  const isNew = !id; const rec = id ? Object.assign({}, M.contracts[id]) : { dongho: dh || '', date: today(), report: '미보고', status: '정상' };
  const F = C_FIELDS();
  openModal({
    title: isNew ? '계약 등록' : `계약 수정 — ${esc(rec.dongho)} ${esc(rec.name)}`, body: formHtml(F, rec),
    foot: `${!isNew ? `<button class="btn dan" id="mDel" style="margin-right:auto">삭제</button><button class="btn" id="mPrint">계약서 출력</button>` : ''}<button class="btn" onclick="closeModal()">취소</button><button class="btn pri" id="mSave">저장</button>`,
    onOpen: bg => {
      bindDonghoHint(bg, 'contracts', id);
      bg.querySelector('#mSave').onclick = async () => {
        formRead(F, bg, rec);
        if (!rec.dongho || !rec.name) return toast('동호수와 성명은 필수입니다', 1);
        if (!IX.unit[rec.dongho]) { if (!confirm('세대 목록에 없는 동호수입니다. 그래도 저장할까요?')) return; }
        const ex = IX.active[rec.dongho];
        if (rec.status !== '해약' && ex && ex.id !== rec.id) return toast(`${rec.dongho}는 이미 ${ex.name}님 계약이 있습니다. 기존 계약을 해약 처리(또는 삭제)한 뒤 등록하세요`, 1);
        const tasks = [];
        if (rec.status !== '해약') {
          const p = IX.pre[rec.dongho], r = IX.resv[rec.dongho];
          if (p && confirm(`가계약(${p.name})을 '전환' 처리할까요?`)) tasks.push(['pre', Object.assign({}, p, { status: '전환' })]);
          if (r && confirm(`동호지정(${r.name})을 '전환' 처리할까요?`)) tasks.push(['resv', Object.assign({}, r, { status: '전환' })]);
        }
        await save('contracts', rec);
        for (const [c, x] of tasks) await save(c, x);
        closeModal(); toast('저장되었습니다'); render();
      };
      if (!isNew) {
        bg.querySelector('#mDel').onclick = () => confirmBox(`${rec.dongho} ${rec.name} 계약을 삭제할까요?\n(해약 처리는 '계약상태'를 해약으로 바꾸는 것을 권장합니다)`, async () => { await remove('contracts', id); toast('삭제됨'); render(); });
        bg.querySelector('#mPrint').onclick = () => { closeModal(); printContracts([id]); };
      }
    }
  });
}

/* ===================== 가계약 / 동호지정 ===================== */
const SIMPLE_META = {
  pre: { title: '가계약', dateL: '가계약일' },
  resv: { title: '동호지정', dateL: '동호지정일' }
};
function S_FIELDS(col) {
  return [
    { k: 'date', l: SIMPLE_META[col].dateL, type: 'date' }, { k: 'dongho', l: '동호수 *', type: 'dongho' },
    { k: 'name', l: '성명 *' }, { k: 'phone', l: '연락처' },
    { k: 'status', l: '상태', type: 'select', opts: ['진행', '전환', '취소', '환불'] }, { k: 'plan', l: '전환예정일', type: 'date' },
    ...staffFields(col, '팀', '직원명'),
    { k: 'note', l: '비고', full: true }
  ];
}
function view_pre(el) { simpleList(el, 'pre'); }
function view_resv(el) { simpleList(el, 'resv'); }
function simpleList(el, col) {
  const meta = SIMPLE_META[col];
  const v = VS[col] = VS[col] || { q: '', st: '진행' };
  const rows = live(col).filter(r => (!v.st || r.status === v.st) && matchQ(r, v.q, ['dongho', 'name', 'phone', 'staff', 'team', 'note']));
  const no = {}; live(col).forEach((c, i) => no[c.id] = i + 1);
  const cnt = {}; live(col).forEach(r => cnt[r.status] = (cnt[r.status] || 0) + 1);
  const dup = {}; live(col).forEach(r => { if (r.status === '진행') dup[r.dongho] = (dup[r.dongho] || 0) + 1; });
  const paidOf = r => totalPaid(r.dongho);
  el.innerHTML = `<div class="toolbar"><h2>${meta.title}관리</h2>
    <input class="in" id="q" placeholder="동호/이름/연락처 검색" value="${esc(v.q)}" style="width:200px">
    <div class="seg">${['진행', '전환', '취소', '환불', ''].map(x => `<button data-st="${x}" class="${v.st === x ? 'on' : ''}">${x || '전체'} ${x ? (cnt[x] || 0) : live(col).length}</button>`).join('')}</div>
    <span class="sp"></span><button class="btn" onclick="bulkPaste('${col}')">엑셀 붙여넣기 등록</button><button class="btn" id="bX">엑셀</button><button class="btn pri" onclick="editSimple('${col}')">+ ${meta.title} 등록</button></div><div id="g"></div>`;
  $('#q').oninput = debounce(e => { v.q = e.target.value; render(); setTimeout(() => { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 250);
  $$('.seg button').forEach(b => b.onclick = () => { v.st = b.dataset.st; render(); });
  $('#bX').onclick = () => exportXlsx(meta.title + '관리_' + today() + '.xlsx', [['No', '상태', meta.dateL, '동호수', '타입', '성명', '연락처', '입금액', '전환예정일', '팀', '직원명', '계약여부', '비고']].concat(rows.map(r => [no[r.id], r.status, r.date, r.dongho, (IX.unit[r.dongho] || {}).type, r.name, r.phone, paidOf(r), r.plan, r.team, r.staff, IX.active[r.dongho] ? '계약' : '', r.note])), meta.title);
  vgrid($('#g'), {
    key: col, rows, keepScroll: true, defaultSort: 'no',
    cols: [
      { k: 'no', l: 'No', w: 50, a: 'c', s: r => no[r.id], f: r => no[r.id] },
      { k: 'status', l: '상태', w: 60, a: 'c', f: r => chipStatus(r.status) },
      { k: 'date', l: meta.dateL, w: 92, a: 'c' },
      { k: 'dongho', l: '동호수', w: 84, a: 'c', f: r => `<a href="#" class="nocl" style="${dup[r.dongho] > 1 && r.status === '진행' ? 'color:var(--bad);font-weight:700' : ''}" onclick="event.preventDefault();openUnit('${r.dongho}')">${esc(r.dongho)}</a>` },
      { k: 'type', l: '타입', w: 52, a: 'c', s: r => (IX.unit[r.dongho] || {}).type, f: r => (IX.unit[r.dongho] || {}).type || '' },
      { k: 'name', l: '성명', w: 74, a: 'c' }, { k: 'phone', l: '연락처', w: 112, a: 'c' },
      { k: 'paid', l: '입금액', w: 100, a: 'r', s: paidOf, f: r => fmt0(paidOf(r)) },
      { k: 'ratio', l: '입금비율', w: 70, a: 'r', s: r => paidOf(r) / ((IX.unit[r.dongho] || {}).price || 1), f: r => { const u = IX.unit[r.dongho]; return u && paidOf(r) ? pct(paidOf(r), u.price) : ''; } },
      { k: 'plan', l: '전환예정일', w: 92, a: 'c', f: r => `<span class="${r.status === '진행' && r.plan && r.plan < today() ? 'red' : ''}">${esc(r.plan)}</span>` },
      { k: 'team', l: '팀', w: 70, a: 'c' }, { k: 'staff', l: '직원명', w: 70, a: 'c' },
      { k: 'chk', l: '계약체크', w: 70, a: 'c', s: r => IX.active[r.dongho] ? 1 : 0, f: r => IX.active[r.dongho] ? `<span class="chip ${r.status === '진행' ? 'bad' : 'info'}">계약</span>` : '' },
      { k: 'note', l: '비고', w: 260 }
    ],
    onRow: r => editSimple(col, r.id),
    foot: rs => `<span>${fmt(rs.length)}건</span><span>진행중 ${cnt['진행'] || 0}건</span><span class="muted">전환예정일 경과(진행)는 빨간색 · 진행 중인데 계약이 있으면 빨간 '계약' 표시</span>`
  });
}
function editSimple(col, id, dh) {
  const meta = SIMPLE_META[col]; const isNew = !id;
  const rec = id ? Object.assign({}, M[col][id]) : { date: today(), dongho: dh || '', status: '진행' };
  const F = S_FIELDS(col);
  openModal({
    title: (isNew ? meta.title + ' 등록' : meta.title + ' 수정'), body: formHtml(F, rec) + (rec.dongho ? `<div class="sub" style="margin-top:8px">현재 입금액: <b>${fmt(totalPaid(rec.dongho))}</b>원</div>` : ''),
    foot: `${!isNew ? `<button class="btn dan" id="mDel" style="margin-right:auto">삭제</button>` : ''}${!isNew && rec.status === '진행' && col === 'pre' ? `<button class="btn" id="mConv">계약으로 전환</button>` : ''}<button class="btn" onclick="closeModal()">취소</button><button class="btn pri" id="mSave">저장</button>`,
    onOpen: bg => {
      bindDonghoHint(bg, col, id);
      bg.querySelector('#mSave').onclick = async () => {
        formRead(F, bg, rec); if (!rec.dongho || !rec.name) return toast('동호수와 성명은 필수입니다', 1);
        if (rec.status === '진행') {
          const ex = (col === 'pre' ? IX.pre : IX.resv)[rec.dongho];
          if (ex && ex.id !== rec.id && !confirm(`${rec.dongho}는 이미 진행중인 ${meta.title}(${ex.name})이 있습니다. 저장할까요?`)) return;
          if (IX.active[rec.dongho] && !confirm(`${rec.dongho}는 이미 계약(${IX.active[rec.dongho].name})된 세대입니다. 저장할까요?`)) return;
        }
        await save(col, rec); closeModal(); toast('저장되었습니다'); render();
      };
      if (!isNew) bg.querySelector('#mDel').onclick = () => confirmBox('삭제할까요?', async () => { await remove(col, id); render(); });
      const cv = bg.querySelector('#mConv'); if (cv) cv.onclick = () => { closeModal(); editContract(null, rec.dongho); setTimeout(() => { const b = $('.modal-bg'); if (!b) return; b.querySelector('#f_name').value = rec.name; b.querySelector('#f_phone').value = rec.phone || ''; b.querySelector('#f_team').value = rec.team || ''; b.querySelector('#f_staff').value = rec.staff || ''; }, 50); };
    }
  });
}

/* ===================== 잠금동호 ===================== */
const L_FIELDS = () => [{ k: 'date', l: '홀딩일', type: 'date' }, { k: 'dongho', l: '동호수 *', type: 'dongho' }, { k: 'reason', l: '내용', list: distinct('locks', 'reason', ['대행사 홀딩', '청약홈', '시행사 보류']) }, { k: 'status', l: '상태', type: 'select', opts: ['잠금', '해제'] }, { k: 'note', l: '비고', full: true }];
function view_locks(el) {
  const v = VS.locks = VS.locks || { q: '', st: '잠금' };
  const rows = live('locks').filter(r => (!v.st || r.status === v.st) && matchQ(r, v.q, ['dongho', 'reason', 'note']));
  const cnt = {}; live('locks').forEach(r => cnt[r.status] = (cnt[r.status] || 0) + 1);
  el.innerHTML = `<div class="toolbar"><h2>잠금동호관리</h2><input class="in" id="q" placeholder="동호/내용 검색" value="${esc(v.q)}">
    <div class="seg">${['잠금', '해제', ''].map(x => `<button data-st="${x}" class="${v.st === x ? 'on' : ''}">${x || '전체'} ${x ? (cnt[x] || 0) : live('locks').length}</button>`).join('')}</div>
    <span class="sp"></span><button class="btn" id="bRel">선택 일괄해제</button><button class="btn" onclick="bulkPaste('locks')">엑셀 붙여넣기 등록</button><button class="btn pri" onclick="editLock()">+ 잠금 등록</button></div><div id="g"></div>`;
  const sel = v.sel = v.sel || new Set();
  $('#q').oninput = debounce(e => { v.q = e.target.value; render(); }, 250);
  $$('.seg button').forEach(b => b.onclick = () => { v.st = b.dataset.st; render(); });
  $('#bRel').onclick = async () => { const rs = [...sel].map(id => M.locks[id]).filter(r => r && r.status === '잠금'); if (!rs.length) return toast('해제할 잠금을 체크하세요'); await save('locks', rs.map(r => Object.assign({}, r, { status: '해제', note: (r.note ? r.note + ' / ' : '') + today().slice(5).replace('-', '/') + ' 해제' }))); sel.clear(); toast(rs.length + '건 해제'); render(); };
  vgrid($('#g'), {
    key: 'locks', rows, sel, cols: [
      { k: 'status', l: '상태', w: 60, a: 'c', f: r => chipStatus(r.status) }, { k: 'date', l: '홀딩일', w: 96, a: 'c' },
      { k: 'dongho', l: '동호수', w: 90, a: 'c', f: r => `<a href="#" class="nocl" onclick="event.preventDefault();openUnit('${r.dongho}')">${esc(r.dongho)}</a>` },
      { k: 'type', l: '타입', w: 60, a: 'c', f: r => (IX.unit[r.dongho] || {}).type || '' },
      { k: 'reason', l: '내용', w: 140 }, { k: 'cur', l: '현재 세대상태', w: 100, a: 'c', f: r => chipStatus(unitStatus(r.dongho)) }, { k: 'note', l: '비고', w: 300 }
    ], onRow: r => editLock(r.id)
  });
}
function editLock(id, dh) {
  const isNew = !id; const rec = id ? Object.assign({}, M.locks[id]) : { date: today(), dongho: dh || '', status: '잠금', reason: '대행사 홀딩' };
  const F = L_FIELDS();
  openModal({
    title: isNew ? '잠금 등록' : '잠금 수정', body: formHtml(F, rec),
    foot: `${!isNew ? `<button class="btn dan" id="mDel" style="margin-right:auto">삭제</button>` : ''}<button class="btn" onclick="closeModal()">취소</button><button class="btn pri" id="mSave">저장</button>`,
    onOpen: bg => {
      bindDonghoHint(bg, 'locks', id);
      bg.querySelector('#mSave').onclick = async () => { formRead(F, bg, rec); if (!rec.dongho) return toast('동호수 필수', 1); await save('locks', rec); closeModal(); render(); };
      if (!isNew) bg.querySelector('#mDel').onclick = () => confirmBox('삭제할까요?', async () => { await remove('locks', id); render(); });
    }
  });
}

/* ===================== 엑셀 붙여넣기 일괄 등록 ===================== */
const BULK_MAP = {
  contracts: { title: '계약', f: () => asText(C_FIELDS), alias: { dongho: ['동호', '동호수'], name: ['성명', '계약자', '이름'], rrn: ['주민번호', '주민등록번호'], phone: ['연락처', '휴대폰', '전화번호', '휴대번호'], date: ['계약일'], ctype: ['계약유형'], stype: ['공급유형', '유형'], fee: ['수수료기준', '수수료'], team: ['계약팀', '팀', '담당팀'], staff: ['담당자', '담당', '직원명'], report: ['보고여부', '보고'], addr: ['주소', '도로명 주소'], mail: ['우편물주소', '우편물 주소'], email: ['이메일'], note: ['특이사항'], memo: ['비고'] } },
  pre: { title: '가계약', f: () => asText(() => S_FIELDS('pre')), alias: { date: ['가계약일', '일자'], dongho: ['동호', '동호수'], name: ['성명', '이름'], phone: ['연락처'], status: ['상태'], plan: ['전환예정일'], team: ['담당팀', '팀'], staff: ['직원명', '담당'], note: ['비고'] } },
  resv: { title: '동호지정', f: () => asText(() => S_FIELDS('resv')), alias: { date: ['동호지정일', '일자'], dongho: ['동호', '동호수'], name: ['성명', '이름'], phone: ['연락처'], status: ['상태'], plan: ['전환예정일'], team: ['팀', '담당팀'], staff: ['직원명', '담당'], note: ['비고'] } },
  locks: { title: '잠금동호', f: () => L_FIELDS(), alias: { date: ['홀딩일', '일자'], dongho: ['동호', '동호수'], reason: ['내용'], note: ['비고'], status: ['상태'] } }
};
function bulkPaste(col) {
  const bm = BULK_MAP[col];
  openModal({
    title: bm.title + ' 엑셀 붙여넣기 등록', wide: true,
    body: `<div class="help">엑셀에서 <b>제목행 포함</b>하여 범위를 복사한 뒤 붙여넣으세요. 제목(예: ${Object.values(bm.alias).slice(0, 6).map(a => '<code>' + a[0] + '</code>').join(' ')})으로 열을 자동 인식합니다. 동호수 앞의 <code>a</code>는 해약/종료로 처리됩니다.</div>
    <textarea class="in" id="bp" rows="8" style="width:100%;margin-top:8px;font-family:monospace;font-size:12px" placeholder="여기에 붙여넣기 (Ctrl+V)"></textarea><div id="bpPrev" style="margin-top:10px"></div>`,
    foot: `<button class="btn" onclick="closeModal()">취소</button><button class="btn pri" id="bpOk" disabled>등록</button>`,
    onOpen: bg => {
      let recs = [];
      bg.querySelector('#bp').oninput = e => {
        const lines = e.target.value.replace(/\r/g, '').split('\n').filter(l => l.trim()); if (lines.length < 2) return;
        const grid = lines.map(l => l.split('\t')); const head = grid[0].map(h => h.trim());
        const map = {}; Object.entries(bm.alias).forEach(([k, al]) => { const i = head.findIndex(h => al.includes(h)); if (i >= 0) map[k] = i; });
        recs = grid.slice(1).map(r => { const o = {}; Object.entries(map).forEach(([k, i]) => o[k] = (r[i] || '').trim()); return o; }).filter(o => o.dongho || o.name);
        recs.forEach(o => {
          let dh = (o.dongho || '').replace(/\s/g, ''); let cancel = false; if (/^a/i.test(dh)) { dh = dh.slice(1); cancel = true; } if (/a$/i.test(dh)) { dh = dh.slice(0, -1); cancel = true; }
          o.dongho = dh.replace(/^(\d{3})동?(\d{3,4})호?$/, '$1-$2');
          ['date', 'plan'].forEach(k => { if (o[k]) o[k] = normDate(o[k]); });
          if (col === 'contracts') { o.status = cancel ? '해약' : '정상'; o.report = o.report || '미보고'; }
          else if (col === 'locks') { o.status = o.status || (cancel ? '해제' : '잠금'); }
          else { o.status = ['진행', '전환', '취소', '환불'].includes(o.status) ? o.status : (cancel ? (IX.active[o.dongho] ? '전환' : '취소') : '진행'); }
        });
        const cols = Object.keys(map);
        bg.querySelector('#bpPrev').innerHTML = `<div class="sub">인식된 열: ${cols.map(k => '<b>' + (bm.f().find(f => f.k === k) || {}).l + '</b>').join(', ') || '<span class="red">없음 — 제목행을 확인하세요</span>'} · <b>${recs.length}</b>건</div>
          <div style="max-height:300px;overflow:auto;margin-top:6px"><table class="t"><tr><th>상태</th>${cols.map(k => `<th>${(bm.f().find(f => f.k === k) || {}).l}</th>`).join('')}<th>검증</th></tr>${recs.slice(0, 200).map(o => `<tr><td>${esc(o.status || '')}</td>${cols.map(k => `<td>${esc(o[k])}</td>`).join('')}<td>${IX.unit[o.dongho] ? '' : '<span class="red">동호없음</span>'}</td></tr>`).join('')}</table></div>`;
        bg.querySelector('#bpOk').disabled = !recs.length;
      };
      bg.querySelector('#bpOk').onclick = async () => { await save(col, recs); closeModal(); toast(recs.length + '건 등록'); render(); };
    }
  });
}
