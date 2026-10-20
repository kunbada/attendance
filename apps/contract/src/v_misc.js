/* ===================== 세대 · 분양가 ===================== */
function view_units(el) {
  const v = VS.units = VS.units || { q: '', type: '', st: '', sk: '' };
  const skinds = [...new Set(live('units').map(u => u.skind).filter(Boolean))].sort();
  const lab = CFG().project.moneyLabel || '금액';
  const rows = live('units').filter(u => (!v.type || u.type === v.type) && (!v.sk || u.skind === v.sk) && (!v.st || unitStatus(u.id) === v.st) && matchQ(Object.assign({ h: holderOf(u.id) }, u), v.q, ['id', 'type', 'h']));
  el.innerHTML = `<div class="toolbar"><h2>세대관리 (세대 · 분양가 · 공급구분)</h2><input class="in" id="q" placeholder="동호/이름" value="${esc(v.q)}">
    <select class="in" id="fType"><option value="">전체 타입</option>${IX.types.map(x => `<option ${v.type === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <select class="in" id="fSk"><option value="">전체 공급구분</option>${skinds.map(x => `<option ${v.sk === x ? 'selected' : ''}>${esc(x)}</option>`).join('')}</select>
    <select class="in" id="fSt"><option value="">전체 상태</option>${['계약', '가계약', '잠금', '잔여'].map(x => `<option ${v.st === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
    <span class="sp"></span><button class="btn" onclick="unitPaste()">분양가표 붙여넣기</button><button class="btn" id="bX">엑셀</button><button class="btn pri" onclick="editUnit()">+ 세대 추가</button></div><div id="g"></div>`;
  $('#q').oninput = debounce(e => { v.q = e.target.value; render(); setTimeout(() => $('#q').focus()); }, 250);
  $('#fType').onchange = e => { v.type = e.target.value; render(); }; $('#fSt').onchange = e => { v.st = e.target.value; render(); }; $('#fSk').onchange = e => { v.sk = e.target.value; render(); };
  $('#bX').onclick = () => exportXlsx('분양가테이블_' + today() + '.xlsx', [['동호', '동', '호', '층', '라인', '타입', '공급구분', '전용', '주거공용', '공급', '기타공용', '계약면적', '대지지분', '대지비', '건축비', 'VAT', lab].concat(STAGES()).concat(['상태', '계약자'])].concat(rows.map(u => [u.id, u.dong, u.ho, u.floor, u.line, u.type, u.skind || '', u.exArea, u.resArea, u.supArea, u.etcArea, u.conArea, u.landArea, u.priceLand, u.priceBuild, u.vat, u.price].concat(STAGES().map(s => (u.amounts || {})[s] || 0)).concat([unitStatus(u.id), holderOf(u.id)]))), '분양가');
  vgrid($('#g'), {
    key: 'units', rows, defaultSort: 'id',
    cols: [
      { k: 'id', l: '동호', w: 84, a: 'c', s: u => u.dong + '-' + String(u.ho).padStart(4, '0') }, { k: 'type', l: '타입', w: 56, a: 'c' }, { k: 'skind', l: '공급구분', w: 80, a: 'c' }, { k: 'floor', l: '층', w: 44, a: 'c' }, { k: 'line', l: '라인', w: 44, a: 'c' },
      { k: 'exArea', l: '전용㎡', w: 70, a: 'r' }, { k: 'supArea', l: '공급㎡', w: 76, a: 'r' },
      { k: 'price', l: lab, w: 110, a: 'r', f: u => fmt(u.price) },
      ...STAGES().map(s => ({ k: 'a_' + s, l: s, w: 96, a: 'r', s: u => (u.amounts || {})[s], f: u => fmt0((u.amounts || {})[s]) })),
      { k: 'st', l: '상태', w: 70, a: 'c', s: u => unitStatus(u.id), f: u => chipStatus(unitStatus(u.id)) }, { k: 'h', l: '계약자', w: 80, a: 'c', s: u => holderOf(u.id), f: u => esc(holderOf(u.id)) },
      { k: 'chk', l: '회차합계 검증', w: 100, a: 'c', s: u => STAGES().reduce((a, s) => a + ((u.amounts || {})[s] || 0), 0) - u.price, f: u => { const d = STAGES().reduce((a, s) => a + ((u.amounts || {})[s] || 0), 0) - u.price; return d ? `<span class="red">${d > 0 ? '+' : ''}${fmt(d)}</span>` : '<span class="green">일치</span>'; } }
    ],
    onRow: u => editUnit(u.id), foot: rs => `<span>${rs.length}세대</span><span>${lab} 합계 ${fmt(rs.reduce((a, u) => a + (u.price || 0), 0))}</span>`
  });
}
function editUnit(id) {
  const isNew = !id; const u = id ? JSON.parse(JSON.stringify(M.units[id])) : { amounts: {} };
  const F = [{ k: 'id', l: '동호 (예: 101-1203) *', ro: !isNew }, { k: 'type', l: '타입' }, { k: 'skind', l: '공급구분 (일반/특공 종류 등)' }, { k: 'floor', l: '층', type: 'num' }, { k: 'line', l: '라인', type: 'num' }, { k: 'exArea', l: '전용면적' }, { k: 'resArea', l: '주거공용면적' }, { k: 'supArea', l: '공급면적' }, { k: 'etcArea', l: '기타공용면적' }, { k: 'conArea', l: '계약면적' }, { k: 'landArea', l: '대지지분' }, { k: 'price', l: (CFG().project.moneyLabel || '금액') + ' *', type: 'num' }];
  const SF = STAGES().map((s, i) => ({ k: 'am' + i, l: s, type: 'num' })); const rec = Object.assign({}, u); STAGES().forEach((s, i) => rec['am' + i] = (u.amounts || {})[s] || 0);
  openModal({
    title: isNew ? '세대 추가' : '세대 수정 ' + id, body: formHtml(F.concat(SF), rec) + `<div class="sub" style="margin-top:6px">회차 합계: <b id="amSum"></b></div>`,
    foot: `${!isNew ? `<button class="btn dan" id="mDel" style="margin-right:auto">삭제</button>` : ''}<button class="btn" onclick="closeModal()">취소</button><button class="btn pri" id="mSave">저장</button>`,
    onOpen: bg => {
      const calc = () => { let t = 0; SF.forEach(f => t += toNum(bg.querySelector('#f_' + f.k).value)); bg.querySelector('#amSum').textContent = fmt(t) + ' / ' + fmt(toNum(bg.querySelector('#f_price').value)); }; calc();
      $$('input', bg).forEach(i => i.addEventListener('input', calc));
      bg.querySelector('#mSave').onclick = async () => {
        formRead(F.concat(SF), bg, rec); if (!DH_RE.test(rec.id)) return toast('동호 형식: 101-1203', 1);
        const o = { id: rec.id, dong: rec.id.split('-')[0], ho: rec.id.split('-')[1], type: rec.type, skind: (rec.skind || '').trim(), floor: rec.floor || Math.floor(+rec.id.split('-')[1] / 100), line: rec.line || (+rec.id.split('-')[1] % 100), exArea: +rec.exArea || 0, resArea: +rec.resArea || 0, supArea: +rec.supArea || 0, etcArea: +rec.etcArea || 0, conArea: +rec.conArea || 0, landArea: +rec.landArea || 0, price: rec.price, amounts: {} };
        Object.assign(o, { priceLand: u.priceLand, priceBuild: u.priceBuild, vat: u.vat });
        STAGES().forEach((s, i) => o.amounts[s] = rec['am' + i]);
        if (isNew && M.units[o.id] && !M.units[o.id].deleted) return toast('이미 있는 동호입니다', 1);
        await save('units', o); closeModal(); render();
      };
      if (!isNew) bg.querySelector('#mDel').onclick = () => confirmBox('세대를 삭제할까요?', async () => { await remove('units', id); render(); });
    }
  });
}
function unitPaste() {
  openModal({
    title: '분양가표 붙여넣기', wide: true,
    body: `<div class="help">엑셀 분양가테이블에서 <b>제목행 1줄 + 데이터</b>를 복사해 붙여넣으세요. 인식 제목: <code>동호</code>(필수) <code>주택형/타입</code> <code>공급구분</code> <code>층구분/층</code> <code>라인</code> <code>전용면적</code> <code>주거공용면적</code> <code>공급면적</code> <code>기타공용면적</code> <code>계약면적</code> <code>대지지분</code> <code>금액/분양가/임대보증금</code> 그리고 회차명(${STAGES().map(s => '<code>' + s + '</code>').join(' ')}). 같은 동호가 있으면 덮어씁니다.</div>
    <textarea class="in" id="up" rows="8" style="width:100%;margin-top:8px;font-family:monospace;font-size:12px"></textarea><div id="upPrev"></div>`,
    foot: `<button class="btn" onclick="closeModal()">취소</button><button class="btn pri" id="upOk" disabled>저장</button>`,
    onOpen: bg => {
      let recs = [];
      bg.querySelector('#up').oninput = e => {
        const lines = e.target.value.replace(/\r/g, '').split('\n').filter(l => l.trim()); if (lines.length < 2) return;
        const g = lines.map(l => l.split('\t')); const h = g[0].map(x => x.trim());
        const ix = al => h.findIndex(x => al.includes(x));
        const m = { skind: ix(['공급구분', '특공구분', '공급유형']), id: ix(['동호', '동호수']), type: ix(['주택형', '타입', '약식']), floor: ix(['층구분', '층']), line: ix(['라인']), exArea: ix(['전용면적', '전용']), resArea: ix(['주거공용면적', '주거공용']), supArea: ix(['공급면적', '공급']), etcArea: ix(['기타공용면적', '기타공용']), conArea: ix(['계약면적']), landArea: ix(['대지지분']), price: ix(['금액', '분양가', '임대보증금', '공급금액', '분양금액', '총액']) };
        const sm = {}; STAGES().forEach(s => { const j = h.lastIndexOf(s); if (j >= 0) sm[s] = j; });
        recs = g.slice(1).map(r => { const id = (r[m.id] || '').trim(); if (!DH_RE.test(id)) return null; const o = { id, dong: id.split('-')[0], ho: id.split('-')[1], type: (r[m.type] || '').trim(), skind: m.skind >= 0 ? (r[m.skind] || '').trim() : '', floor: toNum(r[m.floor]) || Math.floor(+id.split('-')[1] / 100), line: toNum(r[m.line]) || (+id.split('-')[1] % 100), price: toNum(r[m.price]), amounts: {} };['exArea', 'resArea', 'supArea', 'etcArea', 'conArea', 'landArea'].forEach(k => o[k] = m[k] >= 0 ? parseFloat(String(r[m[k]]).replace(/,/g, '')) || 0 : 0); STAGES().forEach(s => o.amounts[s] = sm[s] !== undefined ? toNum(r[sm[s]]) : 0); return o; }).filter(Boolean);
        bg.querySelector('#upPrev').innerHTML = `<div class="sub" style="margin:6px 0">${recs.length}세대 인식 · 금액열 ${m.price >= 0 ? '✓' : '<span class="red">없음</span>'} · 회차열 ${Object.keys(sm).length}개</div><div style="max-height:260px;overflow:auto"><table class="t"><tr><th>동호</th><th>타입</th><th>층</th><th>라인</th><th>전용</th><th>금액</th>${STAGES().map(s => `<th>${s}</th>`).join('')}</tr>${recs.slice(0, 100).map(o => `<tr><td>${o.id}</td><td>${o.type}</td><td>${o.floor}</td><td>${o.line}</td><td>${o.exArea}</td><td class="r">${fmt(o.price)}</td>${STAGES().map(s => `<td class="r">${fmt0(o.amounts[s])}</td>`).join('')}</tr>`).join('')}</table></div>`;
        bg.querySelector('#upOk').disabled = !recs.length;
      };
      bg.querySelector('#upOk').onclick = async () => { await save('units', recs); closeModal(); toast(recs.length + '세대 저장'); render(); };
    }
  });
}

/* ===================== 레포트 ===================== */
function view_reports(el) {
  const v = VS.rep = VS.rep || { date: today(), from: today().slice(0, 8) + '01', to: today(), stage: STAGES()[0] };
  el.innerHTML = `<div class="toolbar"><h2>레포트</h2></div>
  <div class="grid3">
    <div class="card"><h3>📋 일일 업무보고</h3><div class="sub">당일 신규계약·해약·가계약·동호지정·입금 내역 + 누계 현황</div><div class="toolbar" style="margin-top:10px"><input class="in" type="date" id="rDate" value="${v.date}"><button class="btn pri" onclick="printReport('daily')">보기/인쇄</button></div></div>
    <div class="card"><h3>📊 계약현황 보고서</h3><div class="sub">타입별 계약현황, 특별공급, 회차별 수납, 월별·팀별·지역별</div><div class="toolbar" style="margin-top:10px"><button class="btn pri" onclick="printReport('status')">보기/인쇄</button></div></div>
    <div class="card"><h3>💰 회차별 미납자 리스트</h3><div class="sub">선택 회차 미완납 세대 (연락처 포함)</div><div class="toolbar" style="margin-top:10px"><select class="in" id="rStage">${STAGES().map(s => `<option ${v.stage === s ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="btn pri" onclick="printUnpaid(VS.rep.stage)">보기/인쇄</button></div></div>
    <div class="card"><h3>📅 기간별 계약 리스트</h3><div class="sub">계약일 기준 기간 내 계약자 명단</div><div class="toolbar" style="margin-top:10px"><input class="in" type="date" id="rFrom" value="${v.from}">~<input class="in" type="date" id="rTo" value="${v.to}"></div><div class="toolbar"><button class="btn pri" onclick="printReport('period')">보기/인쇄</button><button class="btn" onclick="printReport('team')">팀·담당자 실적</button><button class="btn" onclick="printReport('deplog')">입금 일계표</button></div></div>
    <div class="card"><h3>🗓 주차·요일별 계약</h3><div class="sub">주차별 × 요일별 계약 건수 (요일별계약 시트 대체)</div><div class="toolbar" style="margin-top:10px"><button class="btn pri" onclick="printReport('weekday')">보기/인쇄</button></div></div>
    <div class="card"><h3>📁 엑셀 내보내기</h3><div class="sub">전체 데이터를 시트별로 한 파일에</div><div class="toolbar" style="margin-top:10px"><button class="btn pri" onclick="exportAllXlsx()">전체 엑셀 다운로드</button></div></div>
  </div><div id="repOut" style="margin-top:14px"></div>`;
  $('#rDate').onchange = e => v.date = e.target.value; $('#rStage').onchange = e => v.stage = e.target.value;
  $('#rFrom').onchange = e => v.from = e.target.value; $('#rTo').onchange = e => v.to = e.target.value;
}
function showReport(title, html, landscape) {
  const full = `<div class="rep"><h2>${esc(CFG().project.name)} ${title}</h2><div class="meta">출력: ${today()} ${new Date().toTimeString().slice(0, 5)} · ${esc(META.user || '')}</div>${html}</div>`;
  openModal({ title, wide: true, body: `<div style="max-height:70vh;overflow:auto">${full}</div>`, foot: `<button class="btn" onclick="closeModal()">닫기</button><button class="btn pri" id="rPrint">인쇄</button>`, onOpen: bg => bg.querySelector('#rPrint').onclick = () => { $('#printRoot').innerHTML = `<style>@page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:8mm}</style>` + full; setTimeout(() => window.print(), 50); } });
}
function printReport(kind) {
  const v = VS.rep || { date: today(), from: today().slice(0, 8) + '01', to: today() };
  const act = Object.values(IX.active);
  if (kind === 'status') return showReport('계약현황 보고서', `<section><h3>타입별 계약현황</h3>${typeTableHtml()}</section><section><h3>회차별 수납현황</h3>${stageTableHtml()}</section><section><h3>특별공급 배정/계약</h3>${specialHtml()}</section>
    <section><h3>팀별 계약</h3><table class="t"><tr>${countBy(act, c => c.team).map(x => `<th>${esc(x.k)}</th>`).join('')}</tr><tr>${countBy(act, c => c.team).map(x => `<td>${x.n}</td>`).join('')}</tr></table></section>
    <section><h3>지역별 계약</h3><table class="t"><tr>${regionCounts().map(x => `<th>${esc(x.k)}</th>`).join('')}</tr><tr>${regionCounts().map(x => `<td>${x.n}</td>`).join('')}</tr></table></section>`, true);
  if (kind === 'daily') {
    const d = v.date || today(), dt = d.replace(/-/g, '.');
    const nc = live('contracts').filter(c => c.date === d);
    const np = live('pre').filter(c => c.date === d), nr = live('resv').filter(c => c.date === d);
    const dep = live('deposits').filter(x => (x.t || '').startsWith(dt)).sort((a, b) => a.t < b.t ? -1 : 1);
    const byCat = countBy(dep, x => x.cat || '미분류'); const sumCat = {}; dep.forEach(x => sumCat[x.cat || '미분류'] = (sumCat[x.cat || '미분류'] || 0) + (x.inn || 0) - (x.out || 0));
    const tbl = (rs, cols) => rs.length ? `<table class="t"><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}</tr>${rs.map(r => `<tr>${cols.map(c => `<td class="${c[2] || ''}">${c[1](r)}</td>`).join('')}</tr>`).join('')}</table>` : '<div class="muted">없음</div>';
    return showReport(`일일 업무보고 (${d})`, `
      <section><h3>당일 계약 ${nc.length}건 (정상 ${nc.filter(c => c.status !== '해약').length} / 해약 ${nc.filter(c => c.status === '해약').length})</h3>${tbl(nc, [['동호', c => c.dongho], ['타입', c => (IX.unit[c.dongho] || {}).type || ''], ['성명', c => esc(c.name)], ['계약유형', c => esc(c.ctype)], ['공급유형', c => esc(c.stype)], ['팀', c => esc(c.team)], ['담당', c => esc(c.staff)], ['상태', c => c.status], [STAGES()[0], c => payState(c.dongho, STAGES()[0]).st]])}</section>
      <section><h3>당일 가계약 ${np.length}건 · 동호지정 ${nr.length}건</h3>${tbl(np.map(x => Object.assign({ k: '가계약' }, x)).concat(nr.map(x => Object.assign({ k: '동호지정' }, x))), [['구분', r => r.k], ['동호', r => r.dongho], ['성명', r => esc(r.name)], ['전환예정', r => r.plan || ''], ['팀', r => esc(r.team)], ['직원', r => esc(r.staff)], ['상태', r => r.status]])}</section>
      <section><h3>당일 입금 ${dep.length}건 · ${fmt(dep.reduce((a, x) => a + (x.inn || 0), 0))}원</h3><table class="t"><tr>${byCat.map(x => `<th>${esc(x.k)}</th>`).join('')}</tr><tr>${byCat.map(x => `<td>${x.n}건<br>${fmt(sumCat[x.k])}</td>`).join('')}</tr></table>
      ${tbl(dep, [['거래일시', x => x.t.slice(11)], ['기재내용', x => esc(x.desc), 'l'], ['입금', x => fmt0(x.inn), 'r'], ['출금', x => fmt0(x.out), 'r'], ['구분', x => esc(x.cat || '미분류')], ['동호', x => x.dongho], ['계약자', x => esc(x.name)]])}</section>
      <section><h3>누계 현황</h3>${typeTableHtml()}</section>`, true);
  }
  if (kind === 'period') {
    const rs = live('contracts').filter(c => c.date >= v.from && c.date <= v.to).sort((a, b) => (a.date + a.dongho) < (b.date + b.dongho) ? -1 : 1);
    return showReport(`기간별 계약 리스트 (${v.from} ~ ${v.to})`, `<div class="sub">${rs.length}건 (정상 ${rs.filter(c => c.status !== '해약').length})</div><table class="t"><tr><th>No</th><th>계약일</th><th>동호</th><th>타입</th><th>성명</th><th>연락처</th><th>계약유형</th><th>공급유형</th><th>수수료</th><th>팀</th><th>담당</th><th>상태</th></tr>${rs.map((c, i) => `<tr><td>${i + 1}</td><td>${c.date}</td><td>${c.dongho}</td><td>${(IX.unit[c.dongho] || {}).type || ''}</td><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.ctype)}</td><td>${esc(c.stype)}</td><td>${esc(c.fee)}</td><td>${esc(c.team)}</td><td>${esc(c.staff)}</td><td>${c.status}</td></tr>`).join('')}</table>`, true);
  }
  if (kind === 'team') {
    const rs = live('contracts').filter(c => c.status !== '해약' && c.date >= v.from && c.date <= v.to);
    const m = {}; rs.forEach(c => { const k = (c.team || '(미입력)') + '|' + (c.staff || ''); const o = m[k] = m[k] || { team: c.team || '(미입력)', staff: c.staff || '', n: 0, fee: {}, types: {} }; o.n++; o.fee[c.fee || '-'] = (o.fee[c.fee || '-'] || 0) + 1; const t = (IX.unit[c.dongho] || {}).type || '?'; o.types[t] = (o.types[t] || 0) + 1; });
    const arr = Object.values(m).sort((a, b) => String(a.team).localeCompare(String(b.team), 'ko', { numeric: true }) || b.n - a.n);
    const fees = [...new Set(rs.map(c => c.fee || '-'))]; const types = IX.types;
    return showReport(`팀·담당자 실적 (${v.from} ~ ${v.to})`, `<table class="t"><tr><th>팀</th><th>담당자</th><th>계약</th>${fees.map(f => `<th>${esc(f)}</th>`).join('')}${types.map(t => `<th>${t}</th>`).join('')}</tr>${arr.map(o => `<tr><td>${esc(o.team)}</td><td>${esc(o.staff)}</td><td><b>${o.n}</b></td>${fees.map(f => `<td>${o.fee[f] || ''}</td>`).join('')}${types.map(t => `<td>${o.types[t] || ''}</td>`).join('')}</tr>`).join('')}<tr class="sum"><td colspan="2">합계</td><td>${rs.length}</td>${fees.map(f => `<td>${rs.filter(c => (c.fee || '-') === f).length}</td>`).join('')}${types.map(t => `<td>${rs.filter(c => (IX.unit[c.dongho] || {}).type === t).length}</td>`).join('')}</tr></table>`, true);
  }
  if (kind === 'weekday') {
    const ds = act.map(c => c.date).filter(d => /^\d{4}-\d\d-\d\d$/.test(d)).sort(); if (!ds.length) return showReport('주차·요일별 계약', '<div class="muted">계약 없음</div>');
    const w0 = new Date(ds[0]); w0.setDate(w0.getDate() - ((w0.getDay() + 6) % 7));
    const wk = {}; act.forEach(c => { if (!c.date) return; const d = new Date(c.date); const w = Math.floor((d - w0) / 604800000); const dw = (d.getDay() + 6) % 7; const o = wk[w] = wk[w] || [0, 0, 0, 0, 0, 0, 0]; o[dw]++; });
    const keys = Object.keys(wk).map(Number).sort((a, b) => a - b); const tot = [0, 0, 0, 0, 0, 0, 0];
    return showReport('주차·요일별 계약', `<table class="t"><tr><th>주차</th><th>기간</th>${'월화수목금토일'.split('').map(x => `<th>${x}</th>`).join('')}<th>합계</th></tr>${keys.map(k => { const s = new Date(w0.getTime() + k * 604800000), e = new Date(s.getTime() + 6 * 86400000); wk[k].forEach((n, i) => tot[i] += n); return `<tr><td>${k + 1}주차</td><td>${pad(s.getMonth() + 1)}/${pad(s.getDate())}~${pad(e.getMonth() + 1)}/${pad(e.getDate())}</td>${wk[k].map(n => `<td>${n || ''}</td>`).join('')}<td><b>${wk[k].reduce((a, b) => a + b, 0)}</b></td></tr>`; }).join('')}<tr class="sum"><td colspan="2">합계</td>${tot.map(n => `<td>${n}</td>`).join('')}<td>${tot.reduce((a, b) => a + b, 0)}</td></tr></table>`);
  }
  if (kind === 'deplog') {
    const f = v.from.replace(/-/g, '.'), t = v.to.replace(/-/g, '.');
    const deps = live('deposits').filter(d => d.t.slice(0, 10) >= f && d.t.slice(0, 10) <= t);
    const cats = [...new Set(deps.map(d => d.cat || '미분류'))]; const days = {};
    deps.forEach(d => { const k = d.t.slice(0, 10); const o = days[k] = days[k] || { inn: 0, out: 0, n: 0 }; o[d.cat || '미분류'] = (o[d.cat || '미분류'] || 0) + (d.inn || 0) - (d.out || 0); o.inn += d.inn || 0; o.out += d.out || 0; o.n++; });
    const ks = Object.keys(days).sort();
    return showReport(`입금 일계표 (${v.from} ~ ${v.to})`, `<table class="t"><tr><th>일자</th><th>건수</th>${cats.map(c => `<th>${esc(c)}</th>`).join('')}<th>입금계</th><th>출금계</th></tr>${ks.map(k => `<tr><td>${k}</td><td>${days[k].n}</td>${cats.map(c => `<td class="r">${fmt0(days[k][c])}</td>`).join('')}<td class="r"><b>${fmt(days[k].inn)}</b></td><td class="r">${fmt0(days[k].out)}</td></tr>`).join('')}<tr class="sum"><td>합계</td><td>${deps.length}</td>${cats.map(c => `<td class="r">${fmt(ks.reduce((a, k) => a + (days[k][c] || 0), 0))}</td>`).join('')}<td class="r">${fmt(deps.reduce((a, d) => a + (d.inn || 0), 0))}</td><td class="r">${fmt(deps.reduce((a, d) => a + (d.out || 0), 0))}</td></tr></table>`, true);
  }
}
function printUnpaid(stage, rows) {
  rows = (rows || Object.values(IX.active).map(c => ({ dongho: c.dongho, name: c.name, phone: c.phone, team: c.team, staff: c.staff, kind: '계약' }))).filter(r => !payState(r.dongho, stage).done).sort((a, b) => a.dongho.localeCompare(b.dongho, 'ko', { numeric: true }));
  let tr = 0, tp = 0;
  const body = rows.map((r, i) => { const ps = payState(r.dongho, stage); tr += ps.req; tp += ps.paid; return `<tr><td>${i + 1}</td><td>${r.dongho}</td><td>${(IX.unit[r.dongho] || {}).type || ''}</td><td>${esc(r.name)}</td><td>${esc(r.phone)}</td><td class="r">${fmt(ps.req)}</td><td class="r">${fmt0(ps.paid)}</td><td class="r"><b>${fmt(ps.diff)}</b></td><td>${ps.st}</td><td>${esc(r.team || '')}</td><td>${esc(r.staff || '')}</td></tr>`; }).join('');
  showReport(`${stage} 미납자 리스트`, `<div class="sub">${rows.length}세대 · 미납액 ${fmt(tr - tp)}원 ${(CFG().stageDue || {})[stage] ? '· 납부기한 ' + CFG().stageDue[stage] : ''}</div><table class="t"><tr><th>No</th><th>동호</th><th>타입</th><th>성명</th><th>연락처</th><th>약정</th><th>납부</th><th>미납액</th><th>상태</th><th>팀</th><th>담당</th></tr>${body}<tr class="sum"><td colspan="5">합계</td><td class="r">${fmt(tr)}</td><td class="r">${fmt(tp)}</td><td class="r">${fmt(tr - tp)}</td><td colspan="3"></td></tr></table>`);
}
function exportAllXlsx() {
  const wb = XLSX.utils.book_new(); const add = (n, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), n);
  const st = STAGES();
  add('계약관리', [['보고', '상태', '동호수', '타입', '성명', '주민번호', '연락처', '이메일', '계약일', '계약유형', '공급유형', '수수료기준', '계약팀', '담당자', '주소', '우편물주소', '특이사항', '비고', '비고2'].concat(st)].concat(live('contracts').map(c => [c.report, c.status, c.dongho, (IX.unit[c.dongho] || {}).type, c.name, c.rrn, c.phone, c.email, c.date, c.ctype, c.stype, c.fee, c.team, c.staff, c.addr, c.mail, c.note, c.memo, c.memo2].concat(st.map(s => payState(c.dongho, s).paid)))));
  ['pre', 'resv'].forEach(col => add(SIMPLE_META[col].title + '관리', [['상태', '일자', '동호수', '성명', '연락처', '전환예정일', '팀', '직원', '비고']].concat(live(col).map(r => [r.status, r.date, r.dongho, r.name, r.phone, r.plan, r.team, r.staff, r.note]))));
  add('잠금동호', [['상태', '홀딩일', '동호수', '내용', '비고']].concat(live('locks').map(r => [r.status, r.date, r.dongho, r.reason, r.note])));
  add('수금현황', [['거래일시', '적요', '기재내용', '찾으신금액', '맡기신금액', '거래후잔액', '취급점', '입금구분', '동호수', '계약자명', '메모']].concat(live('deposits').slice().sort((a, b) => depSortKey(a) < depSortKey(b) ? -1 : 1).map(d => [d.t, d.jeok, d.desc, d.out || '', d.inn || '', d.bal, d.branch, d.cat, d.dongho, d.name, d.note])));
  add('분양가테이블', [['동호', '타입', '층', '라인', '전용', '공급', '금액'].concat(st)].concat(live('units').map(u => [u.id, u.type, u.floor, u.line, u.exArea, u.supArea, u.price].concat(st.map(s => (u.amounts || {})[s] || 0)))));
  XLSX.writeFile(wb, (CFG().project.name || '분양') + '_전체_' + today() + '.xlsx');
}

/* ===================== 설정 · 백업 ===================== */
function view_settings(el) {
  const C = JSON.parse(JSON.stringify(CFG())); const P = C.project;
  const nOut = Object.keys(OUTBOX).length;
  const spText = Object.entries(C.special || {}).map(([t, o]) => t + ': ' + Object.entries(o).map(([k, n]) => k + ' ' + n).join(', ')).join('\n');
  const dueText = STAGES().map(s => s + ' = ' + ((C.stageDue || {})[s] || '')).join('\n');
  el.innerHTML = `<div class="toolbar"><h2>일반설정 · 백업</h2></div><div class="grid2">
  <div>
    <div class="card" style="margin-bottom:12px"><h3>💾 로컬 백업 (비상용)</h3>
      <div class="help">지정한 PC 폴더에 <code>${esc((P.name || PROJ).replace(/\s/g, '_'))}_최신백업.json</code>(변경 시 1분 내 갱신)과 시간별 백업 파일이 자동 저장됩니다. 인터넷이 끊겨도 앱은 브라우저 내장 DB로 계속 동작하며, PC를 바꾸는 등 비상시에는 아래 <b>백업 파일에서 복원</b>으로 즉시 이어서 작업할 수 있습니다.</div>
      <div class="kv" style="margin:10px 0"><div>백업 폴더</div><div>${BK.dir ? `<b>${esc(BK.dir.name)}</b> ${BK.perm ? '<span class="chip ok">연결됨</span>' : '<span class="chip warn">권한 필요</span>'}` : '<span class="chip gray">미지정</span>'}</div><div>최근 백업</div><div>${esc(META.lastBackup || '-')}</div></div>
      <div class="toolbar"><button class="btn pri" onclick="pickBackupDir()">${BK.dir ? '폴더 변경' : '백업 폴더 지정'}</button>${BK.dir && !BK.perm ? '<button class="btn pri" onclick="grantBackup()">권한 허용</button>' : ''}<button class="btn" onclick="backupNow(true)">지금 백업</button><button class="btn" onclick="downloadBackup()">백업 파일 다운로드</button><label class="btn">백업 파일에서 복원<input type="file" accept=".json" id="restoreIn" style="display:none"></label></div>
    </div>
    <div class="card" style="margin-bottom:12px"><h3>☁ 온라인 DB 동기화 (구글시트)</h3>
      <div class="help">구글시트 + Apps Script(Code.gs)를 웹앱으로 배포한 URL과 비밀번호(토큰)를 입력하면, 모든 변경이 2~3초 내 자동 전송되고 30초마다 다른 PC의 변경을 받아옵니다. 오프라인 중 변경은 쌓아뒀다가 연결되면 자동 전송합니다.</div>
      <div class="form" style="margin-top:10px"><div class="f full"><label>Apps Script 웹앱 URL</label><input class="in" id="sUrl" value="${esc(META.syncUrl)}" placeholder="https://script.google.com/macros/s/..../exec"></div>
      <div class="f"><label>서버 비밀키 (선택: 사용자 계정 없이 쓸 때만)</label><input class="in" id="sTok" type="password" value="${esc(META.token)}"></div><div class="f"><label>사용자 이름(이 PC)</label><input class="in" id="sUser" value="${esc(META.user)}" placeholder="예: 윤상무"></div></div>
      <div class="kv" style="margin:10px 0"><div>상태</div><div>${META.syncUrl ? (syncErr ? `<span class="red">${esc(syncErr)}</span>` : '정상') : '미설정(로컬 전용)'}</div><div>구글시트</div><div>${META.sheetUrl ? `<a href="${esc(META.sheetUrl)}" target="_blank" rel="noopener">시트 열기 ↗</a>` : '<span class="muted">-</span>'}${META.pk ? '' : ' <span class="muted">(공용/기본 시트)</span>'}</div><div>최근 동기화</div><div>${esc(META.lastSync || '-')} · rev ${META.lastRev || 0}</div><div>전송 대기</div><div>${nOut}건</div></div>
      <div class="toolbar"><button class="btn pri" id="sSave">저장 & 연결 테스트</button><button class="btn" onclick="sync().then(()=>{toast(syncErr||'동기화 완료',!!syncErr);render()})">지금 동기화</button><button class="btn" id="sPull">서버 전체 다시받기</button><button class="btn" id="sPush">이 PC 데이터를 서버에 전체 업로드</button></div>
      <details class="box" style="margin-top:10px"><summary>설치 방법 (처음 1회)</summary><div class="help">
        1. 구글 드라이브에서 새 <b>구글 스프레드시트</b>를 만듭니다 (예: “양주역 계약관리 DB”).<br>
        2. 메뉴 <b>확장 프로그램 → Apps Script</b> → 기본 코드를 지우고 함께 드린 <code>Code.gs</code> 내용을 붙여넣기.<br>
        3. 코드 맨 위 <code>TOKEN</code> 값을 원하는 비밀번호로 바꾸고 저장.<br>
        4. <b>배포 → 새 배포 → 유형: 웹 앱</b>, 실행: <b>나</b>, 액세스: <b>모든 사용자</b> → 배포 → 권한 승인.<br>
        5. 나온 <b>웹 앱 URL</b>(…/exec)과 토큰을 위에 입력 → 저장 & 연결 테스트.<br>
        6. 처음 PC 한 대에서 <b>이 PC 데이터를 서버에 전체 업로드</b> → 다른 PC는 URL/토큰만 입력하면 자동으로 받아옵니다.<br>
        ※ 코드를 수정하면 <b>배포 관리 → 편집 → 새 버전</b>으로 다시 배포해야 반영됩니다. 시트는 사람이 보기 위한 열도 함께 저장되며, 시트에서 직접 수정한 값은 앱에 반영되지 않습니다(앱에서 수정).</div></details>
    </div>
    <div class="card"><h3>🗂 프로젝트 · 데이터</h3>
      <div class="kv" style="margin-bottom:10px"><div>현재 프로젝트</div><div><b>${esc(projList().find(p => p.key === PROJ)?.name || PROJ)}</b> <span class="muted">(${PROJ})</span></div><div>데이터</div><div>세대 ${live('units').length} · 계약 ${live('contracts').length} · 가계약 ${live('pre').length} · 동호지정 ${live('resv').length} · 잠금 ${live('locks').length} · 입금 ${live('deposits').length}</div></div>
      <div class="toolbar"><select class="in" id="pSel">${projList().map(p => `<option value="${p.key}" ${p.key === PROJ ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select><button class="btn" id="pGo">전환</button><button class="btn" id="pNew">새 프로젝트</button></div>
      <div class="toolbar"><label class="btn">초기데이터(JSON) 불러오기<input type="file" accept=".json" id="initIn" style="display:none"></label><button class="btn dan" id="wipe">이 프로젝트 데이터 전체 삭제</button></div>
      <div class="help">※ 프로젝트별로 데이터와 서버 설정이 분리됩니다. 동일한 HTML 파일로 여러 현장을 관리할 수 있습니다.</div>
    </div>
  </div>
  <div>
    <div class="card" style="margin-bottom:12px"><h3>🏢 현장 정보</h3>
      <div class="form"><div class="f full"><label>현장명(주택명)</label><input class="in" id="cName" value="${esc(P.name)}"></div>
      <div class="f"><label>임대인/시행사(법인명)</label><input class="in" id="cLes" value="${esc(P.lessor)}"></div><div class="f"><label>사업자번호</label><input class="in" id="cBiz" value="${esc(P.bizNo)}"></div>
      <div class="f"><label>분양대금 은행</label><input class="in" id="cBank" value="${esc(P.bank)}"></div><div class="f"><label>계좌번호</label><input class="in" id="cAcc" value="${esc(P.account)}"></div>
      <div class="f"><label>금액 명칭</label><input class="in" id="cLab" value="${esc(P.moneyLabel)}" placeholder="분양대금 / 임대보증금"></div></div></div>
    <div class="card" style="margin-bottom:12px"><h3>💳 납부 회차 · 기한</h3>
      <div class="form"><div class="f full"><label>사용 회차 (눌러서 켜고 끄기 — 계약금 1차만, 중도금 5차까지만 써도 됩니다)</label>
        <div id="stChips" style="display:flex;flex-wrap:wrap;gap:6px;margin:4px 0">${ALL_STAGES.map(x => `<button type="button" class="btn sm ${STAGES().includes(x) ? 'pri' : ''}" data-s="${x}">${x}</button>`).join('')}</div>
        <input class="in" id="cStages" value="${esc(STAGES().join(', '))}"><div class="help">직접 입력도 가능합니다(쉼표 구분). 세대관리의 회차명과 동일해야 합니다.</div></div>
      <div class="f full"><label>회차별 납부기한 (회차 = YYYY-MM-DD)</label><textarea class="in" id="cDue" rows="7">${esc(dueText)}</textarea></div>
      <div class="f full"><label>입금 구분 목록 (쉼표 구분)</label><input class="in" id="cCats" value="${esc((C.depositCats || []).join(', '))}"></div></div></div>
    <div class="card"><h3>🎯 특별공급 배정</h3>
      <div class="help">타입: 유형 수, 유형 수 … 한 줄에 한 타입 (예: <code>59C: 청년 12, 신혼부부 42, 고령자 6</code>). 유형명은 계약의 '공급유형'과 같아야 집계됩니다.</div>
      <textarea class="in" id="cSp" rows="6" style="width:100%;margin-top:6px">${esc(spText)}</textarea>
      <div class="toolbar" style="margin-top:10px"><span class="sp"></span><button class="btn pri" id="cSave">현장 설정 저장</button></div></div>
  </div></div>`;
  $$('#stChips button').forEach(b => b.onclick = () => {
    const cur = $('#cStages').value.split(',').map(x => x.trim()).filter(Boolean); const s = b.dataset.s;
    const nx = cur.includes(s) ? cur.filter(x => x !== s) : cur.concat(s);
    const ord = x => { const i = ALL_STAGES.indexOf(x); return i < 0 ? 99 : i; };
    $('#cStages').value = nx.sort((a, b) => ord(a) - ord(b)).join(', '); b.classList.toggle('pri');
  });
  $('#cSave').onclick = async () => {
    const st = $('#cStages').value.split(',').map(s => s.trim()).filter(Boolean);
    const due = {}; $('#cDue').value.split('\n').forEach(l => { const m = l.split('='); if (m.length === 2 && m[1].trim()) due[m[0].trim()] = normDate(m[1].trim()); });
    const sp = {}; $('#cSp').value.split('\n').forEach(l => { const m = l.match(/^\s*([^:]+):(.+)$/); if (!m) return; const o = {}; m[2].split(',').forEach(x => { const mm = x.trim().match(/^(.+?)\s+(\d+)$/); if (mm) o[mm[1].trim()] = +mm[2]; }); sp[m[1].trim()] = o; });
    const n = Object.assign({}, CFG(), { id: 'main', stages: st, stageDue: due, special: sp, depositCats: (() => { const c = $('#cCats').value.split(',').map(s => s.trim()).filter(Boolean); return st.filter(x => !c.includes(x)).concat(c); })(), project: { name: $('#cName').value.trim(), lessor: $('#cLes').value.trim(), bizNo: $('#cBiz').value.trim(), bank: $('#cBank').value.trim(), account: $('#cAcc').value.trim(), moneyLabel: $('#cLab').value.trim() } });
    await save('settings', n); const pl = projList(); const me = pl.find(p => p.key === PROJ); if (me) { me.name = n.project.name; LS.set('bunyang.projects', pl); }
    toast('설정 저장'); render();
  };
  $('#sSave').onclick = async () => {
    META.syncUrl = $('#sUrl').value.trim(); META.token = $('#sTok').value.trim(); META.user = $('#sUser').value.trim(); await persistMeta();
    if (!META.syncUrl) { toast('로컬 전용으로 저장'); render(); return; }
    try { const r = await callServer({ op: 'ping' }); if (r.url) { META.sheetUrl = r.url; await persistMeta(); } toast('연결 성공 · 서버 rev ' + r.rev); await sync(); } catch (e) { toast('연결 실패: ' + e.message, 1); }
    render();
  };
  $('#sPull').onclick = () => confirmBox('서버의 전체 데이터를 다시 받습니다. (이 PC의 미전송 변경은 유지)', async () => { await sync({ full: true }); toast(syncErr || '다시받기 완료', !!syncErr); render(); });
  $('#sPush').onclick = () => confirmBox('이 PC의 모든 데이터를 서버로 업로드합니다.\n서버에 같은 항목이 더 최근에 수정되어 있으면 서버 것이 유지됩니다.', async () => { COLS.forEach(c => S[c].forEach(r => { OUTBOX[c + '|' + r.id] = 1; delete BASE[c + '|' + r.id]; })); await idb.setMeta('outbox', OUTBOX); updateSyncPill(); await sync(); toast(syncErr || '업로드 완료', !!syncErr); render(); });
  const readJson = (inp, cb) => inp.onchange = () => { const f = inp.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { try { cb(JSON.parse(rd.result), f.name); } catch (e) { toast('JSON 오류: ' + e.message, 1); } }; rd.readAsText(f); };
  const doRestore = (obj, name) => confirmBox(`'${name}' 로 이 PC의 데이터를 교체합니다.\n세대 ${(obj.units || []).length} · 계약 ${(obj.contracts || []).length} · 입금 ${(obj.deposits || []).length}건\n\n(현재 데이터는 먼저 자동 다운로드됩니다)`, async () => {
    downloadBackup();
    const toServer = META.syncUrl && isAdmin() && (prompt(`[주의] 서버(구글시트)의 이 현장 데이터를 모두 지우고 '${name}' 내용으로 교체하려면 아래에 "덮어쓰기"를 입력하세요.

(이 PC에만 복원하려면 취소를 누르세요. 현재 프로젝트: ${CFG().project.name || PROJ} / 서버에 이미 있는 데이터는 복구가 어렵습니다)`) || '').trim() === '덮어쓰기';
    if (toServer) { try { const w = await callServer({ op: 'wipe' }); toast(`서버의 기존 데이터 ${w.wiped}건을 정리했습니다`); } catch (e) { return toast('서버 정리 실패(관리자만 가능): ' + e.message, 1); } }
    await restoreFrom(obj, { touch: toServer, markAll: toServer, resetRev: !toServer });
    if (toServer) await sync(); toast('복원 완료'); render();
  });
  readJson($('#restoreIn'), doRestore); readJson($('#initIn'), doRestore);
  $('#wipe').onclick = () => confirmBox('이 프로젝트의 이 PC 데이터를 모두 삭제합니다. (서버 데이터는 유지)\n삭제 전 백업 파일이 다운로드됩니다.', async () => { downloadBackup(); await restoreFrom({ units: [] }); OUTBOX = {}; META.lastRev = 0; await persistMeta(); render(); });
  $('#pGo').onclick = () => { LS.set('bunyang.current', $('#pSel').value); location.reload(); };
  $('#pNew').onclick = newProjectDialog;
}

/* ===================== 새 현장 만들기 (구글시트 자동 생성) ===================== */
function newProjectDialog() {
  
  openModal({
    title: '새 현장(프로젝트) 만들기',
    body: `<div class="form"><div class="f full"><label>현장명</label><input class="in" id="npName" placeholder="예: 양주역 중흥S-클래스"></div>
      <div class="f full"><label>견본/초기데이터 파일 (선택, .json)</label><input type="file" id="npFile" accept=".json"><div class="help">세대·분양가 등이 들어있는 견본 파일(<code>견본_초기데이터.json</code>) 또는 다른 현장의 백업 파일을 고르면 자동으로 채워집니다. 비워두면 빈 현장으로 시작합니다.</div></div>
      <div class="f full"><div class="help">${!META.syncUrl ? '서버가 연결되어 있지 않아 이 PC에만 저장되는 현장으로 만들어집니다.' : isAdmin() ? '<b>이 현장 전용 구글시트 파일이 새로 만들어지고</b>, 이 현장의 모든 데이터가 그 시트에 저장됩니다. (양주역 등 기존 현장의 시트와는 완전히 별개입니다)' : '<span class="red">새 현장은 관리자만 만들 수 있습니다 (구글시트를 새로 만들어야 하므로).</span>'}</div></div></div>`,
    foot: '<button class="btn" onclick="closeModal()">취소</button><button class="btn pri" id="npOk">만들기</button>',
    onOpen: bg => bg.querySelector('#npOk').onclick = async () => {
      const name = $('#npName').value.trim(); if (!name) return toast('현장명을 입력하세요', 1);
      if (META.syncUrl && !isAdmin()) return toast('관리자만 새 현장을 만들 수 있습니다', 1);
      const f = $('#npFile').files[0]; const auto = !!META.syncUrl;
      const key = 'p' + Date.now().toString(36);
      const btn = $('#npOk'); btn.disabled = true; btn.textContent = '만드는 중…';
      try {
        let txt = null;
        if (f) { txt = await f.text(); const o = JSON.parse(txt); if (!o.units) throw new Error('세대(units)가 없는 파일입니다'); sessionStorage.setItem('bunyang.pendingData', txt); }
        const srv = {};
        if (auto) { const r = await callServer({ op: 'newProject', pk: key, name }); Object.assign(srv, { syncUrl: META.syncUrl, token: META.token, user: META.user, pk: key, sheetUrl: r.url }); }
        const pl = projList(); pl.push({ key, name }); LS.set('bunyang.projects', pl);
        LS.set('bunyang.pending', { key, name, srv }); LS.set('bunyang.current', key); location.reload();
      } catch (e) { toast('실패: ' + e.message, 1); btn.disabled = false; btn.textContent = '만들기'; }
    }
  });
}
