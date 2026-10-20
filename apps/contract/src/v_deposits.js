/* ===================== 은행 거래내역 파싱 ===================== */
const DT_RE = /^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})(?:[ T]+(\d{1,2})[.:](\d{1,2})(?:[.:](\d{1,2}))?)?/;
function normDT(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return `${v.getFullYear()}.${pad(v.getMonth() + 1)}.${pad(v.getDate())} ${pad(v.getHours())}.${pad(v.getMinutes())}.${pad(v.getSeconds())}`;
  if (typeof v === 'number' && v > 30000 && v < 80000) { const ms = Math.round((v - 25569) * 86400) * 1000; const d = new Date(ms); return `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())} ${pad(d.getUTCHours())}.${pad(d.getUTCMinutes())}.${pad(d.getUTCSeconds())}`; }
  const s = String(v).trim(); const m = s.match(DT_RE); if (!m) return '';
  return `${m[1]}.${pad(m[2])}.${pad(m[3])} ${pad(m[4] || 0)}.${pad(m[5] || 0)}.${pad(m[6] || 0)}`;
}
const HEAD_ALIAS = { t: ['거래일시', '거래일자', '거래일', '일시'], jeok: ['적요', '거래구분', '구분'], desc: ['기재내용', '내용', '입금자', '입금자명', '받는분/보내는분', '보낸분/받는분', '메모', '거래내용'], out: ['찾으신금액', '출금', '출금액', '출금금액', '찾으신금액(원)'], inn: ['맡기신금액', '입금', '입금액', '입금금액', '맡기신금액(원)'], bal: ['거래후 잔액(원)', '거래후잔액', '잔액', '거래후 잔액', '잔액(원)'], branch: ['취급점', '거래점', '처리점'] };
function parseBank(aoa) {
  const out = []; const errs = [];
  let hi = -1, map = null;
  for (let i = 0; i < Math.min(aoa.length, 30); i++) {
    const row = aoa[i].map(c => String(c ?? '').replace(/\s+/g, ' ').trim());
    if (row.some(c => /거래일시|거래일자/.test(c))) {
      hi = i; map = {};
      Object.entries(HEAD_ALIAS).forEach(([k, al]) => { const j = row.findIndex(c => al.includes(c) || al.includes(c.replace(/\s/g, ''))); if (j >= 0) map[k] = j; });
      break;
    }
  }
  const start = hi >= 0 ? hi + 1 : 0;
  for (let i = start; i < aoa.length; i++) {
    const r = aoa[i]; if (!r || !r.some(c => String(c ?? '').trim())) continue;
    let o;
    if (map && map.t !== undefined) {
      o = { t: normDT(r[map.t]), jeok: s_(r[map.jeok]), desc: s_(r[map.desc]), out: toNum(r[map.out]), inn: toNum(r[map.inn]), bal: toNum(r[map.bal]), branch: s_(r[map.branch]) };
    } else {
      const j = r.findIndex(c => normDT(c)); if (j < 0) { errs.push(i + 1); continue; }
      o = { t: normDT(r[j]), jeok: s_(r[j + 1]), desc: s_(r[j + 2]), out: toNum(r[j + 3]), inn: toNum(r[j + 4]), bal: toNum(r[j + 5]), branch: s_(r[j + 6]) };
    }
    if (!o.t) { errs.push(i + 1); continue; }
    if (!o.inn && !o.out) { errs.push(i + 1); continue; }
    out.push(o);
  }
  return { rows: out, errs };
}
function s_(v) { return String(v ?? '').replace(/　/g, ' ').trim(); }
const depKey = o => `${o.t}|${o.inn || 0}|${o.out || 0}|${o.bal || 0}`;
/* 같은 시각 거래는 잔액 연결고리로 순서 정렬 */
function chainOrder(group) {
  if (group.length < 2) return group;
  const left = group.slice(); const res = [];
  const prevBal = o => o.bal - o.inn + o.out;
  const bals = new Set(left.map(o => o.bal));
  let cur = left.find(o => !bals.has(prevBal(o))) || left[0];
  while (cur) { res.push(cur); left.splice(left.indexOf(cur), 1); const nx = left.find(o => prevBal(o) === cur.bal); cur = nx || left[0]; }
  return res;
}
function depSortKey(d) { return (d.t || '') + '#' + String(d.seq || 0).padStart(4, '0'); }

/* ===================== 자동 추천 ===================== */
const BANK_PFX = /^(농협|국민|신한|우리|하나|기업|카카오|카뱅|토스|케이|새마을|신협|우체국|수협|부산|대구|경남|광주|전북|제주|씨티|SC|IBK|KB|NH|중앙회)/;
function parseDescDongho(desc) {
  const s = String(desc || '').normalize('NFKC').replace(/\s/g, '');
  const res = []; const dongs = IX.dongs;
  let m;
  const push = (dg, ho) => { const id = dg + '-' + String(+ho); if (IX.unit[id] && !res.includes(id)) res.push(id); };
  const re1 = /(\d{3})(?:[-_\/.,]+|동)(\d{3,4})/g; while ((m = re1.exec(s))) push(m[1], m[2]);
  if (!res.length) { const re2 = /(?:^|\D)(\d{1,2})(?:-|동)(\d{3,4})/g; while ((m = re2.exec(s))) { const dg = dongs.filter(d => d.endsWith(m[1])); if (dg.length === 1) push(dg[0], m[2]); } }
  if (!res.length) { const re3 = /(\d{6,7})/g; while ((m = re3.exec(s))) { const n = m[1]; push(n.slice(0, 3), n.slice(3)); } }
  // 잘린 호수 (예: 103/120, 104동10)
  let partial = null;
  if (!res.length) { const mm = s.match(/(\d{3})(?:[-_\/.,]|동)(\d{1,3})$/) || s.match(/(\d{3})(?:[-_\/.,]|동)(\d{1,3})\D/); if (mm && dongs.includes(mm[1])) partial = { dong: mm[1], hoPfx: mm[2] }; }
  return { list: res, partial };
}
function nameOfDesc(desc) { return String(desc || '').normalize('NFKC').replace(/\s/g, '').replace(/\d+차(중도금|중도|중)?/g, '').replace(/(중도금|계약금|잔금|가계약)/g, '').replace(/\d+(동|호)/g, '').replace(/[0-9\-_\/.,()\[\]]/g, '').replace(/[^가-힣A-Za-z]/g, '').replace(BANK_PFX, '').replace(/(님|씨)$/, ''); }
function nameMatch(holder, nm) { holder = (holder || '').replace(/\s/g, ''); if (!holder || !nm) return false; return holder === nm || holder.startsWith(nm) || nm.includes(holder) || (nm.length >= 2 && holder.includes(nm)); }
function suggestFor(d, ctx) {
  const text = (d.jeok || '') + ' ' + (d.desc || '');
  if (/결산|이자/.test(text) && !/\d{3}/.test(d.desc || '')) return { cat: '예금결산', conf: 'high', why: '이자/결산' };
  if (d.out && !d.inn) { if (/대체/.test(d.jeok)) return { cat: '대체지급', conf: 'mid', why: '출금(대체)' }; return { cat: '', conf: 'low', why: '출금 건 — 환불지급/대체지급 확인' }; }
  const nm = nameOfDesc(d.desc);
  let dh = '', conf = 'low', why = '';
  const known = IX.descMap[(d.desc || '').replace(/\s/g, '')];
  const p = parseDescDongho(d.desc);
  if (p.list.length) {
    dh = p.list[0]; const h = holderOf(dh);
    if (!h) { conf = 'low'; why = '동호 인식, 계약자 없음'; }
    else if (!nm) { conf = 'mid'; why = '동호 인식(이름 없음)'; }
    else if (nameMatch(h, nm)) { conf = 'high'; why = '동호+이름 일치'; }
    else { conf = 'low'; why = `이름 불일치(${h})`; }
  } else if (known && holderOf(known)) { dh = known; conf = 'high'; why = '이전 동일 기재내용'; }
  if (!dh || conf === 'low') {
    const cands = nm ? IX.nameIdx.filter(x => x.name && (x.name === nm || (nm.length >= 2 && (x.name.startsWith(nm) || nm.includes(x.name))))) : [];
    let cs = cands;
    const dm = String(d.desc || '').normalize('NFKC').match(/(\d{3})동/); if (dm && IX.dongs.includes(dm[1]) && cs.some(x => x.dongho.startsWith(dm[1] + '-'))) cs = cs.filter(x => x.dongho.startsWith(dm[1] + '-'));
    if (p.partial) cs = cands.filter(x => x.dongho.startsWith(p.partial.dong + '-' + p.partial.hoPfx));
    const uniq = [...new Set(cs.map(x => x.dongho))];
    if (uniq.length === 1 && dh && uniq[0] !== dh) { const parsed = dh; dh = uniq[0]; conf = 'low'; why = `기재동호 ${parsed} 계약자 불일치 → 이름 기준 ${dh}`; }
    else if (uniq.length === 1) { const exact = cs[0].name === nm; dh = uniq[0]; conf = (exact || p.partial) ? (p.partial ? 'high' : 'mid') : 'mid'; why = p.partial ? '부분동호+이름' : (exact ? '이름 일치(유일)' : '이름 앞부분 일치'); }
    else if (uniq.length > 1 && !dh) { return { cat: '', dongho: '', conf: 'low', why: '동명 후보 ' + uniq.slice(0, 4).join(', ') }; }
    else if (p.partial && !dh) {
      const us = Object.keys(IX.unit).filter(id => id.startsWith(p.partial.dong + '-' + p.partial.hoPfx) && holderOf(id));
      if (us.length === 1) { dh = us[0]; conf = 'mid'; why = '부분동호(유일)'; }
    }
  }
  if (!dh) return { cat: '', dongho: '', conf: 'low', why: why || '인식 실패' };
  // 회차 추천: 아직 완납 안된 첫 회차
  const u = IX.unit[dh]; let cat = STAGES()[0];
  if (u && u.amounts) {
    const pend = ctx && ctx[dh] || {};
    for (const sg of STAGES()) { const req = u.amounts[sg] || 0; const paid = ((IX.paid[dh] || {})[sg] || 0) + (pend[sg] || 0); if (req && paid < req) { cat = sg; break; } }
  }
  if (!IX.active[dh] && (IX.pre[dh] || IX.resv[dh])) why += ' · ' + (IX.pre[dh] ? '가계약' : '동호지정');
  return { cat, dongho: dh, conf, why };
}
function nextStage(dh, ctx) { const u = IX.unit[dh]; if (!u || !u.amounts) return STAGES()[0]; const pend = (ctx && ctx[dh]) || {}; for (const sg of STAGES()) { const req = u.amounts[sg] || 0; const paid = ((IX.paid[dh] || {})[sg] || 0) + (pend[sg] || 0); if (req && paid < req) return sg; } return STAGES()[0]; }
function applySug(d, ctx) {
  if (!d.sug) return false;
  if (d.sug.cat) d.cat = d.sug.cat;
  if (d.sug.dongho) { d.dongho = d.sug.dongho; d.name = holderOf(d.dongho) || d.name; }
  if (ctx && d.dongho && PAY_CATS().has(d.cat)) { const p = ctx[d.dongho] = ctx[d.dongho] || {}; p[d.cat] = (p[d.cat] || 0) + (d.inn || 0) - (d.out || 0); }
  d.auto = true; return true;
}

/* ===================== 수금관리 화면 ===================== */
function gapSet() {
  const deps = live('deposits'); const bals = new Set(deps.map(d => d.bal)); const g = new Set();
  const sorted = deps.slice().sort((a, b) => depSortKey(a) < depSortKey(b) ? -1 : 1);
  sorted.forEach((d, i) => { if (i === 0) return; const pb = d.bal - (d.inn || 0) + (d.out || 0); if (!bals.has(pb)) g.add(d.id); });
  return g;
}
function view_deposits(el) {
  const v = VS.dep = VS.dep || { f: '', cat: '', q: '', from: '', to: '' };
  v.sel = v.sel || new Set();
  const deps = live('deposits');
  { const ctx = {}; deps.filter(d => !d.cat && !d.sug).sort((a, b) => depSortKey(a) < depSortKey(b) ? -1 : 1).forEach(d => d.sug = suggestFor(d, ctx)); }
  const order = deps.slice().sort((a, b) => depSortKey(a) < depSortKey(b) ? -1 : 1); const no = {}; order.forEach((d, i) => no[d.id] = i + 1);
  const gaps = gapSet();
  const cnt = { 미분류: deps.filter(d => !d.cat).length, 검토: deps.filter(d => d.auto).length, 누락의심: gaps.size, 추천있음: deps.filter(d => !d.cat && d.sug && (d.sug.dongho || d.sug.cat)).length };
  const from = (v.from || '').replace(/-/g, '.'), to = (v.to || '').replace(/-/g, '.');
  const rows = deps.filter(d => (v.f === '미분류' ? !d.cat : v.f === '검토' ? d.auto : v.f === '누락의심' ? gaps.has(d.id) : true)
    && (!v.cat || d.cat === v.cat) && (!from || d.t >= from) && (!to || d.t.slice(0, 10) <= to) && matchQ(d, v.q, ['t', 'desc', 'dongho', 'name', 'jeok', 'note', 'cat']));
  const cats = CFG().depositCats || STAGES();
  el.innerHTML = `<div class="toolbar"><h2>수금관리</h2>
    <button class="btn pri" onclick="openImport()">⬆ 입금내역 올리기</button>
    <div class="seg">${[['', '전체 ' + fmt(deps.length)], ['미분류', '미분류 ' + cnt.미분류], ['검토', '자동분류(검토) ' + cnt.검토], ['누락의심', '잔액불연속 ' + cnt.누락의심]].map(([k, l]) => `<button data-f="${k}" class="${v.f === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <select class="in" id="fCat"><option value="">전체 구분</option>${cats.map(c => `<option ${v.cat === c ? 'selected' : ''}>${c}</option>`).join('')}</select>
    <input class="in" type="date" id="fFrom" value="${v.from}"> ~ <input class="in" type="date" id="fTo" value="${v.to}">
    <input class="in" id="q" placeholder="기재내용/동호/이름" value="${esc(v.q)}" style="width:160px">
    <span class="sp"></span><button class="btn" id="bX">엑셀</button></div>
    <div class="toolbar" id="bulkBar" style="background:#fff;border:1px solid var(--line);border-radius:8px;padding:6px 8px">
      <b>선택 <span id="selN">${v.sel.size}</span>건</b>
      <select class="in" id="bCat"><option value="">구분 선택</option>${cats.map(c => `<option>${c}</option>`).join('')}<option value="__clear">(분류 해제)</option></select>
      <input class="in" id="bDh" placeholder="동호수" list="dl_units2" style="width:100px"><datalist id="dl_units2">${live('units').map(u => `<option value="${u.id}">`).join('')}</datalist>
      <button class="btn" id="bApply">선택에 적용</button>
      <button class="btn" id="bSug">선택 추천 적용</button>
      <button class="btn" id="bSugAll" title="미분류 중 추천이 있는 건 모두 적용">미분류 추천 전체적용 (${cnt.추천있음})</button>
      <button class="btn" id="bReSug">추천 다시계산</button>
      <button class="btn" id="bOk">검토완료 표시</button>
      <span class="sp"></span><button class="btn dan" id="bDel">선택 삭제</button>
    </div>
    <div id="g"></div>`;
  $$('.seg button[data-f]').forEach(b => b.onclick = () => { v.f = b.dataset.f; render(); });
  $('#fCat').onchange = e => { v.cat = e.target.value; render(); };
  $('#fFrom').onchange = e => { v.from = e.target.value; render(); }; $('#fTo').onchange = e => { v.to = e.target.value; render(); };
  $('#q').oninput = debounce(e => { v.q = e.target.value; render(); setTimeout(() => { const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }); }, 300);
  $('#bX').onclick = () => exportXlsx('수금현황_' + today() + '.xlsx', [['No', '거래일시', '적요', '기재내용', '찾으신금액', '맡기신금액', '거래후잔액', '취급점', '입금구분', '동호수', '계약자명', '메모']].concat(rows.slice().sort((a, b) => no[a.id] - no[b.id]).map(d => [no[d.id], d.t, d.jeok, d.desc, d.out || '', d.inn || '', d.bal, d.branch, d.cat, d.dongho, d.name, d.note])), '수금현황');
  const selected = () => [...v.sel].map(id => M.deposits[id]).filter(Boolean);
  $('#bApply').onclick = async () => {
    const c = $('#bCat').value, dh = $('#bDh').value.trim(); const rs = selected(); if (!rs.length) return toast('행을 체크하세요');
    if (!c && !dh) return toast('구분 또는 동호수를 입력하세요');
    rs.forEach(d => { if (c === '__clear') { d.cat = ''; d.dongho = ''; d.name = ''; } else { if (c) d.cat = c; if (dh) { d.dongho = dh; d.name = holderOf(dh) || d.name; } } d.auto = false; });
    await save('deposits', rs); v.sel.clear(); toast(rs.length + '건 적용'); render();
  };
  $('#bSug').onclick = async () => { const ctx = {}; const rs = selected().filter(d => d.sug && applySug(d, ctx)); if (!rs.length) return toast('적용할 추천이 없습니다'); await save('deposits', rs); v.sel.clear(); toast(rs.length + '건 추천 적용'); render(); };
  $('#bSugAll').onclick = () => { const rs = deps.filter(d => !d.cat && d.sug && (d.sug.dongho || d.sug.cat)); if (!rs.length) return toast('적용할 추천이 없습니다'); confirmBox(`미분류 ${rs.length}건에 추천을 적용합니다.\n(적용 건은 '자동분류(검토)'에서 확인 가능)`, async () => { const ctx = {}; rs.sort((a, b) => depSortKey(a) < depSortKey(b) ? -1 : 1).forEach(d => applySug(d, ctx)); await save('deposits', rs); toast(rs.length + '건 적용'); render(); }); };
  $('#bReSug').onclick = async () => { const rs = deps.filter(d => !d.cat).sort((a, b) => depSortKey(a) < depSortKey(b) ? -1 : 1); const ctx = {}; rs.forEach(d => { d.sug = suggestFor(d, ctx); }); await save('deposits', rs); toast('미분류 ' + rs.length + '건 추천 재계산'); render(); };
  $('#bOk').onclick = async () => { const rs = selected().filter(d => d.auto); rs.forEach(d => d.auto = false); if (!rs.length) return toast('자동분류 건을 체크하세요'); await save('deposits', rs); v.sel.clear(); render(); };
  $('#bDel').onclick = () => { const rs = selected(); if (!rs.length) return toast('행을 체크하세요'); confirmBox(`${rs.length}건의 거래내역을 삭제할까요?`, async () => { rs.forEach(d => d.deleted = true); await save('deposits', rs); v.sel.clear(); render(); }); };
  const catOpts = ['', ...cats];
  const g = vgrid($('#g'), {
    key: 'dep', rows, sel: v.sel, keepScroll: true, defaultSort: 'no', defaultDir: -1, height: 'calc(100vh - 220px)',
    rowClass: d => d.auto ? 'auto' : '',
    cols: [
      { k: 'no', l: 'No', w: 56, a: 'c', s: d => no[d.id], f: d => no[d.id] },
      { k: 't', l: '거래일시', w: 138, a: 'c', s: d => depSortKey(d) },
      { k: 'jeok', l: '적요', w: 66, a: 'c' },
      { k: 'desc', l: '기재내용', w: 130, f: d => `<b>${esc(d.desc)}</b>` },
      { k: 'out', l: '찾으신금액', w: 100, a: 'r', f: d => `<span class="red">${fmt0(d.out)}</span>` },
      { k: 'inn', l: '맡기신금액', w: 100, a: 'r', f: d => `<b>${fmt0(d.inn)}</b>` },
      { k: 'bal', l: '거래후잔액', w: 118, a: 'r', f: d => gaps.has(d.id) ? `<span class="red" title="직전 거래 잔액과 연결되지 않습니다 → 이 거래 앞에 누락된 거래가 있을 수 있음">⚠ ${fmt(d.bal)}</span>` : `<span class="muted">${fmt(d.bal)}</span>` },
      { k: 'branch', l: '취급점', w: 80, a: 'c', f: d => `<span class="muted">${esc(d.branch)}</span>` },
      { k: 'cat', l: '입금구분', w: 106, f: d => `<select class="cell" data-f="cat" style="${!d.cat ? 'background:#fff4e0' : ''}">${catOpts.map(c => `<option ${c === (d.cat || '') ? 'selected' : ''} value="${c}">${c || '—'}</option>`).join('')}</select>` },
      { k: 'dongho', l: '동호수', w: 92, f: d => `<input class="cell ${d.dongho && !IX.unit[d.dongho] ? 'bad' : ''}" data-f="dongho" value="${esc(d.dongho)}" list="dl_units2">` },
      { k: 'name', l: '계약자명', w: 76, a: 'c', f: d => esc(d.name) },
      { k: 'pst', l: '납부상태', w: 78, a: 'c', s: d => d.dongho && PAY_CATS().has(d.cat) ? payState(d.dongho, d.cat).st : '', f: d => d.dongho && PAY_CATS().has(d.cat) ? chipPay(payState(d.dongho, d.cat)) : '' },
      { k: 'sug', l: '추천', w: 190, s: d => d.sug ? d.sug.conf : '', f: d => { if (d.cat && !d.auto) return ''; if (d.auto) return `<span class="chip info" title="${esc(d.sug ? d.sug.why : '')}">자동분류 · 검토</span>`; const s = d.sug; if (!s || (!s.dongho && !s.cat)) return s ? `<span class="muted" title="${esc(s.why)}">${esc(s.why)}</span>` : ''; return `<button class="btn sm nocl" data-act="sug" title="${esc(s.why)}">✓</button> <span class="chip ${s.conf === 'high' ? 'ok' : s.conf === 'mid' ? 'warn' : 'gray'}" title="${esc(s.why)}">${esc(s.dongho || '')} ${esc(s.cat || '')}</span>`; } },
      { k: 'note', l: '메모', w: 160, f: d => `<input class="cell" data-f="note" value="${esc(d.note)}">` }
    ],
    foot: rs => { const inn = rs.reduce((a, d) => a + (d.inn || 0), 0), out = rs.reduce((a, d) => a + (d.out || 0), 0); return `<span>${fmt(rs.length)}건</span><span>입금 <b>${fmt(inn)}</b></span><span>출금 <b class="red">${fmt(out)}</b></span><span class="muted">동호수 칸에서 Enter → 다음 행 · 노란칸=미분류 · ⚠=잔액 불연속(누락의심)</span>`; },
    onSel: () => { $('#selN').textContent = v.sel.size; },
    onChange: async (d, t, rowEl) => {
      const f = t.dataset.f; if (!f) return;
      if (f === 'dongho') { let dh = t.value.trim().replace(/\s/g, '').replace(/^(\d{3})동?(\d{3,4})호?$/, '$1-$2'); d.dongho = dh; d.name = holderOf(dh) || ''; if (dh && !d.cat && d.inn) d.cat = nextStage(dh); }
      else d[f] = t.value;
      d.auto = false;
      await save('deposits', d); g.draw(true);
    },
    onAction: async (d, e) => { if (e.target.dataset.act === 'sug') { applySug(d); d.auto = false; await save('deposits', d); g.draw(true); } },
    onKey: (d, e, rowEl) => {
      if (e.key === 'Enter' && e.target.dataset.f) { e.preventDefault(); e.target.dispatchEvent(new Event('change', { bubbles: true })); const i = +rowEl.dataset.i + 1; setTimeout(() => { const nx = $(`#g .vg-row[data-i="${i}"] [data-f="${e.target.dataset.f}"]`); if (nx) { nx.focus(); nx.select && nx.select(); } else { g.body.scrollTop += 30; setTimeout(() => { const n2 = $(`#g .vg-row[data-i="${i}"] [data-f="${e.target.dataset.f}"]`); if (n2) { n2.focus(); n2.select && n2.select(); } }, 60); } }, 80); }
    }
  });
}

/* ===================== 입금내역 올리기 ===================== */
function openImport() {
  openModal({
    title: '입금내역 올리기 (스피드조회)', wide: true,
    body: `<div class="grid2">
      <div><div class="dropzone" id="dz">📄 거래내역 파일을 끌어다 놓거나 <b>클릭</b>하여 선택<br><span class="muted">xls · xlsx · csv · html</span><input type="file" id="fileIn" accept=".xls,.xlsx,.csv,.txt,.html,.htm" style="display:none"></div></div>
      <div><textarea class="in" id="pasteIn" rows="5" style="width:100%;height:100%;min-height:92px;font-family:monospace;font-size:12px" placeholder="또는 스피드조회 화면에서 드래그 복사 → 여기에 붙여넣기 (Ctrl+V)&#10;거래일시 ~ 취급점까지 (제목행 있어도/없어도 됨)"></textarea></div></div>
      <div id="impPrev" style="margin-top:12px"></div>`,
    foot: `<label style="margin-right:auto;display:flex;gap:6px;align-items:center"><input type="checkbox" id="impAuto" checked> 확실한 추천(동호+이름 일치 등)은 자동 분류</label><button class="btn" onclick="closeModal()">취소</button><button class="btn pri" id="impOk" disabled>추가</button>`,
    onOpen: bg => {
      let parsed = null;
      const dz = bg.querySelector('#dz'), fi = bg.querySelector('#fileIn');
      dz.onclick = () => fi.click();
      dz.ondragover = e => { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = () => dz.classList.remove('over');
      dz.ondrop = e => { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); };
      fi.onchange = () => fi.files[0] && readFile(fi.files[0]);
      const readFile = f => {
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const wb = XLSX.read(new Uint8Array(rd.result), { type: 'array', cellDates: false, raw: false });
            let aoa = [];
            wb.SheetNames.forEach(n => { aoa = aoa.concat(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' })); });
            preview(parseBank(aoa), f.name);
          } catch (e) { toast('파일을 읽지 못했습니다: ' + e.message, 1); }
        };
        rd.readAsArrayBuffer(f);
      };
      bg.querySelector('#pasteIn').oninput = debounce(e => { const txt = e.target.value; if (!txt.trim()) return; const aoa = txt.replace(/\r/g, '').split('\n').map(l => l.split('\t')); preview(parseBank(aoa), '붙여넣기'); }, 300);
      const preview = (res, src) => {
        const exist = new Set(live('deposits').map(d => d.k || depKey(d)));
        const seenIn = new Set();
        const rows = res.rows.map(o => { const k = depKey(o); const dup = exist.has(k) || seenIn.has(k); seenIn.add(k); return Object.assign(o, { k, dup }); });
        const news = rows.filter(r => !r.dup);
        const lastT = live('deposits').reduce((a, d) => d.t > a ? d.t : a, '');
        const desc = rows.length > 1 && rows[0].t > rows[rows.length - 1].t;
        news.forEach(r => r.back = lastT && r.t < lastT);
        parsed = { news, desc };
        const nBack = news.filter(r => r.back).length;
        const rng = rows.length ? [rows.map(r => r.t).sort()[0], rows.map(r => r.t).sort().pop()] : ['', ''];
        bg.querySelector('#impPrev').innerHTML = `<div class="kpis" style="grid-template-columns:repeat(5,1fr)">
          <div class="kpi"><div class="l">읽은 거래</div><div class="v">${rows.length}</div><div class="s">${esc(src)}${desc ? ' · 최근순→시간순 자동정렬' : ''}</div></div>
          <div class="kpi"><div class="l">신규 추가</div><div class="v green">${news.length}</div></div>
          <div class="kpi"><div class="l">중복(이미 있음)</div><div class="v muted">${rows.length - news.length}</div></div>
          <div class="kpi ${nBack ? 'warn' : ''}"><div class="l">누락분 끼워넣기</div><div class="v">${nBack}</div><div class="s">기존 최종(${lastT.slice(0, 10)}) 이전 거래</div></div>
          <div class="kpi ${res.errs.length ? 'warn' : ''}"><div class="l">인식 못한 행</div><div class="v">${res.errs.length}</div><div class="s">${res.errs.slice(0, 6).join(',')}</div></div></div>
          <div class="sub" style="margin-bottom:6px">기간: ${rng[0]} ~ ${rng[1]}</div>
          <div style="max-height:340px;overflow:auto"><table class="t"><thead><tr><th></th><th>거래일시</th><th>적요</th><th>기재내용</th><th>찾으신</th><th>맡기신</th><th>잔액</th><th>취급점</th></tr></thead><tbody>
          ${rows.slice(0, 400).map(r => `<tr style="${r.dup ? 'color:#aaa' : ''}"><td>${r.dup ? '중복' : r.back ? '<span class="chip warn">누락분</span>' : '<span class="chip ok">신규</span>'}</td><td>${r.t}</td><td>${esc(r.jeok)}</td><td class="l">${esc(r.desc)}</td><td class="r">${fmt0(r.out)}</td><td class="r">${fmt0(r.inn)}</td><td class="r">${fmt(r.bal)}</td><td>${esc(r.branch)}</td></tr>`).join('')}</tbody></table></div>`;
        bg.querySelector('#impOk').disabled = !news.length;
        bg.querySelector('#impOk').textContent = news.length ? `${news.length}건 추가` : '추가할 신규 거래 없음';
      };
      bg.querySelector('#impOk').onclick = async () => {
        if (!parsed || !parsed.news.length) return;
        const auto = bg.querySelector('#impAuto').checked;
        // 시간순 정렬(최근순이면 뒤집기) + 같은 시각은 잔액 체인 순서
        let arr = parsed.news.slice(); if (parsed.desc) arr.reverse();
        arr.sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : 0);
        const grp = {}; arr.forEach(o => (grp[o.t] = grp[o.t] || []).push(o));
        const existSeq = {}; live('deposits').forEach(d => { existSeq[d.t] = Math.max(existSeq[d.t] || 0, d.seq || 0); });
        const recs = []; const ctx = {};
        Object.keys(grp).sort().forEach(t => chainOrder(grp[t]).forEach((o, i) => {
          const d = { id: uid('d'), k: o.k, t: o.t, jeok: o.jeok, desc: o.desc, out: o.out, inn: o.inn, bal: o.bal, branch: o.branch, cat: '', dongho: '', name: '', note: '', seq: (existSeq[t] || 0) + i + 1, importedAt: nowISO() };
          d.sug = suggestFor(d, ctx);
          if (auto && d.sug.conf === 'high') applySug(d, ctx);
          recs.push(d);
        }));
        await save('deposits', recs);
        closeModal();
        const nAuto = recs.filter(d => d.auto).length;
        toast(`${recs.length}건 추가 · 자동분류 ${nAuto}건 · 미분류 ${recs.length - nAuto}건`);
        VS.dep = Object.assign(VS.dep || {}, { f: '미분류' }); go('deposits'); render();
        backupNow(false);
      };
    }
  });
}

/* ===================== 세대별 수납현황 ===================== */
function view_payments(el) {
  const v = VS.pay = Object.assign({ stage: STAGES()[0], only: '', q: '', type: '', incPre: false }, VS.pay || {});
  const due = CFG().stageDue || {};
  let base = Object.values(IX.active).map(c => ({ id: c.id, dongho: c.dongho, name: c.name, phone: c.phone, kind: '계약', team: c.team, staff: c.staff, date: c.date }));
  if (v.incPre) base = base.concat(Object.values(IX.pre).filter(p => !IX.active[p.dongho]).map(p => ({ id: p.id, dongho: p.dongho, name: p.name, phone: p.phone, kind: '가계약', team: p.team, staff: p.staff, date: p.date })));
  let rows = base.filter(r => (!v.type || (IX.unit[r.dongho] || {}).type === v.type) && matchQ(r, v.q, ['dongho', 'name', 'phone', 'team', 'staff']));
  if (v.only) rows = rows.filter(r => { const ps = payState(r.dongho, v.stage); return v.only === '미완납' ? !ps.done : v.only === '완납' ? ps.done && ps.paid === ps.req : v.only === '초과' ? ps.paid > ps.req : v.only === '미입금' ? ps.paid <= 0 : true; });
  const stg = STAGES();
  el.innerHTML = `<div class="toolbar"><h2>세대별 수납현황</h2>
    <select class="in" id="pStage">${stg.map(s => `<option ${v.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <div class="seg">${['', '미완납', '미입금', '완납', '초과'].map(x => `<button data-o="${x}" class="${v.only === x ? 'on' : ''}">${x || '전체'}</button>`).join('')}</div>
    <select class="in" id="pType"><option value="">전체 타입</option>${IX.types.map(x => `<option ${v.type === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <label><input type="checkbox" id="pPre" ${v.incPre ? 'checked' : ''}> 가계약 포함</label>
    <input class="in" id="q" placeholder="동호/이름 검색" value="${esc(v.q)}" style="width:140px">
    ${due[v.stage] ? `<span class="chip ${due[v.stage] < today() ? 'bad' : 'info'}">${v.stage} 납부기한 ${due[v.stage]}</span>` : ''}
    <span class="sp"></span><button class="btn" id="bRc" title="완납된 세대의 영수증을 한 번에 인쇄">완납 영수증 일괄(${rows.filter(r => payState(r.dongho, v.stage).done).length})</button><button class="btn" id="bPr">미납자 리스트 인쇄</button><button class="btn" id="bX">엑셀</button></div><div id="g"></div>`;
  $('#pStage').onchange = e => { v.stage = e.target.value; render(); };
  $$('.seg button[data-o]').forEach(b => b.onclick = () => { v.only = b.dataset.o; render(); });
  $('#pType').onchange = e => { v.type = e.target.value; render(); };
  $('#pPre').onchange = e => { v.incPre = e.target.checked; render(); };
  $('#q').oninput = debounce(e => { v.q = e.target.value; render(); setTimeout(() => $('#q').focus()); }, 300);
  $('#bX').onclick = () => exportXlsx('세대별수납_' + today() + '.xlsx', [['구분', '동호수', '타입', '성명', '연락처', '팀', '담당', CFG().project.moneyLabel || '금액'].concat(stg.flatMap(s => [s + ' 약정', s + ' 납부', s + ' 상태'])).concat(['총납부'])].concat(rows.map(r => { const u = IX.unit[r.dongho] || {}; return [r.kind, r.dongho, u.type, r.name, r.phone, r.team, r.staff, u.price].concat(stg.flatMap(s => { const ps = payState(r.dongho, s); return [ps.req, ps.paid, ps.st]; })).concat([totalPaid(r.dongho)]); })), '세대별수납');
  $('#bPr').onclick = () => printUnpaid(v.stage, rows);
  $('#bRc').onclick = () => printReceipts(rows.filter(r => payState(r.dongho, v.stage).done).map(r => [r.dongho, v.stage]));
  vgrid($('#g'), {
    key: 'pay', rows, defaultSort: 'dongho',
    cols: [
      { k: 'kind', l: '구분', w: 60, a: 'c', f: r => chipStatus(r.kind) },
      { k: 'dongho', l: '동호수', w: 84, a: 'c', s: r => r.dongho.replace(/-(\d+)$/, (m, h) => '-' + h.padStart(4, '0')), f: r => `<a href="#" class="nocl" onclick="event.preventDefault();openUnit('${r.dongho}')">${r.dongho}</a>` },
      { k: 'type', l: '타입', w: 52, a: 'c', s: r => (IX.unit[r.dongho] || {}).type, f: r => (IX.unit[r.dongho] || {}).type || '' },
      { k: 'name', l: '성명', w: 70, a: 'c' }, { k: 'phone', l: '연락처', w: 110, a: 'c' },
      { k: 'price', l: CFG().project.moneyLabel || '금액', w: 104, a: 'r', s: r => (IX.unit[r.dongho] || {}).price, f: r => fmt((IX.unit[r.dongho] || {}).price) },
      ...stg.map(s => ({ k: 'p_' + s, l: s, w: s === v.stage ? 150 : 96, a: 'r', s: r => payState(r.dongho, s).paid, f: r => { const ps = payState(r.dongho, s); if (!ps.paid && s !== v.stage) return '<span class="muted">-</span>'; return `${s === v.stage ? chipPay(ps) + ' ' : ''}<span class="${ps.done ? 'green' : ps.paid ? '' : 'red'}">${ps.paid ? fmt(ps.paid) : '0'}</span>`; } })),
      { k: 'rc', l: '영수증', w: 64, a: 'c', f: r => payState(r.dongho, v.stage).done ? `<button class="btn sm" onclick="event.stopPropagation();printReceipt('${r.dongho}','${v.stage}')">출력</button>` : '' },
      { k: 'diff', l: v.stage + ' 미납액', w: 110, a: 'r', s: r => payState(r.dongho, v.stage).diff, f: r => { const ps = payState(r.dongho, v.stage); return ps.diff > 0 ? `<b class="red">${fmt(ps.diff)}</b>` : ps.diff < 0 ? `<span class="blue">+${fmt(-ps.diff)}</span>` : ''; } },
      { k: 'tot', l: '총납부', w: 110, a: 'r', s: r => totalPaid(r.dongho), f: r => fmt(totalPaid(r.dongho)) },
      { k: 'team', l: '팀', w: 60, a: 'c' }, { k: 'staff', l: '담당', w: 64, a: 'c' }
    ],
    onRow: r => openUnit(r.dongho),
    foot: rs => { let req = 0, paid = 0; rs.forEach(r => { const ps = payState(r.dongho, v.stage); req += ps.req; paid += ps.paid; }); return `<span>${fmt(rs.length)}세대</span><span>${v.stage} 약정 ${fmt(req)} / 납부 ${fmt(paid)} (${pct(paid, req)})</span><span class="red">미납 ${fmt(Math.max(0, req - paid))}</span>`; }
  });
}

/* ===================== ② 영수증 발행 (수납확인 → 영수증 → 계약서 작성/입력) ===================== */
function view_receipts(el) {
  const v = VS.rc = Object.assign({ stage: STAGES()[0], only: '완납', q: '', incPre: true }, VS.rc || {});
  let base = Object.values(IX.active).map(c => ({ id: c.id, dongho: c.dongho, name: c.name, phone: c.phone, kind: '계약', team: c.team, staff: c.staff }));
  if (v.incPre) base = base.concat(Object.values(IX.pre).filter(p => !IX.active[p.dongho]).map(p => ({ id: p.id, dongho: p.dongho, name: p.name, phone: p.phone, kind: '가계약', team: p.team, staff: p.staff })));
  let rows = base.filter(r => payState(r.dongho, v.stage).paid > 0 && matchQ(r, v.q, ['dongho', 'name', 'phone']));
  if (v.only === '완납') rows = rows.filter(r => payState(r.dongho, v.stage).done);
  const stg = STAGES();
  el.innerHTML = `<div class="toolbar"><h2>영수증 발행</h2>
    <select class="in" id="rStage">${stg.map(s => `<option ${v.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <div class="seg">${['완납', '입금있음'].map(x => `<button data-o="${x}" class="${v.only === x ? 'on' : ''}">${x === '완납' ? '납부완료만' : '입금있음 전체'}</button>`).join('')}</div>
    <label><input type="checkbox" id="rPre" ${v.incPre ? 'checked' : ''}> 가계약 포함</label>
    <input class="in" id="q" placeholder="동호/이름 검색" value="${esc(v.q)}" style="width:140px">
    <span class="sp"></span><button class="btn pri" id="rAll">표시된 ${rows.length}건 일괄 인쇄</button></div>
  <div class="help" style="margin-bottom:8px">관리 프로세스: <b>① 수납확인</b>(수금관리·세대별 수납) → <b>② 영수증 출력</b>(선택) → <b>③ 계약서 작성 후 계약관리에 입력</b>. 영수증은 A4 한 장에 위쪽 <b>계약자 보관용</b> / 아래쪽 <b>회사 보관용</b>으로 출력되며, 가운데 절취선으로 잘라 나눕니다. (인쇄 설정: 여백 없음 · 배율 100%)</div><div id="g"></div>`;
  $('#rStage').onchange = e => { v.stage = e.target.value; render(); };
  $$('.seg button[data-o]').forEach(b => b.onclick = () => { v.only = b.dataset.o; render(); });
  $('#rPre').onchange = e => { v.incPre = e.target.checked; render(); };
  $('#q').oninput = debounce(e => { v.q = e.target.value; render(); setTimeout(() => $('#q').focus()); }, 300);
  $('#rAll').onclick = () => printReceipts(rows.map(r => [r.dongho, v.stage]));
  vgrid($('#g'), {
    key: 'rcpt', rows, defaultSort: 'dongho',
    cols: [
      { k: 'kind', l: '구분', w: 60, a: 'c', f: r => chipStatus(r.kind) },
      { k: 'dongho', l: '동호수', w: 84, a: 'c', s: r => r.dongho.replace(/-(\d+)$/, (m, h) => '-' + h.padStart(4, '0')) },
      { k: 'name', l: '성명', w: 80, a: 'c' }, { k: 'phone', l: '연락처', w: 110, a: 'c' },
      { k: 'req', l: v.stage + ' 약정', w: 110, a: 'r', s: r => payState(r.dongho, v.stage).req, f: r => fmt(payState(r.dongho, v.stage).req) },
      { k: 'paid', l: '납부액', w: 110, a: 'r', s: r => payState(r.dongho, v.stage).paid, f: r => fmt(payState(r.dongho, v.stage).paid) },
      { k: 'st', l: '상태', w: 80, a: 'c', s: r => payState(r.dongho, v.stage).st, f: r => chipPay(payState(r.dongho, v.stage)) },
      { k: 'last', l: '최종 입금일', w: 100, a: 'c', s: r => payState(r.dongho, v.stage).last, f: r => (payState(r.dongho, v.stage).last || '').slice(0, 10) },
      { k: 'pr', l: '영수증', w: 80, a: 'c', f: r => `<button class="btn sm pri" onclick="event.stopPropagation();printReceipt('${r.dongho}','${v.stage}')">인쇄</button>` },
      { k: 'team', l: '팀', w: 60, a: 'c' }, { k: 'staff', l: '담당', w: 64, a: 'c' }
    ],
    onRow: r => openUnit(r.dongho),
    foot: rs => `<span>${fmt(rs.length)}건</span>`
  });
}
