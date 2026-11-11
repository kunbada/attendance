// 고객관리 > 외부 데이터 업로드: 엑셀·CSV·붙여넣기로 고객 명단 / 관심고객 / 상담·TM 결과를 고객 DB 에 올린다.
// 파일은 이 브라우저에서 읽어 줄 단위로 나눠 보낸다 (200줄씩). 올리기 전에 열 연결과 오류를 미리 보여 준다.
(function () {
  var simpleTable = Hub.simpleTable, downloadCsv = Hub.downloadCsv;
  var XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; // 엑셀 파일을 고를 때만 불러온다 (버전 고정)
  var CHUNK = 200;

  var KINDS = [
    { key: '명단', title: '고객 명단', desc: 'TM 업체 DB, 광고·이벤트 접수 명단, 이전 현장 고객 등 이름·전화번호가 있는 명단' },
    { key: '관심고객', title: '관심고객 등록', desc: '홈페이지·랜딩페이지에서 내려받은 관심고객 등록 파일' },
    { key: '상담결과', title: '상담·TM 결과', desc: '통화·상담 결과(일시·결과·내용·등급)를 고객별 상담 기록으로 추가' }
  ];
  // 올릴 수 있는 항목과, 머리글에서 자동으로 알아보는 이름들
  var FIELDS = [
    { key: 'phone', label: '전화번호 (필수)', alias: ['전화번호', '연락처', '휴대폰', '핸드폰', '휴대전화', '전화', 'hp', 'phone', 'mobile', 'tel'] },
    { key: 'name', label: '이름', alias: ['이름', '성명', '고객명', '성함', 'name'] },
    { key: 'at', label: '상담 일시', only: '상담결과', alias: ['상담일시', '상담일', '통화일', '일시', '날짜', '일자'] },
    { key: 'result', label: '상담 결과', only: '상담결과', alias: ['상담결과', '통화결과', '결과'] },
    { key: 'kind', label: '기록 구분 (TM/상담/메모)', only: '상담결과', alias: ['구분', '기록구분'] },
    { key: 'memo', label: '메모 · 상담 내용', alias: ['상담내용', '메모', '비고', '내용', '문의내용', '문의', '특이사항'] },
    { key: 'grade', label: '등급 (A~D)', alias: ['등급', '고객등급'] },
    { key: 'status', label: '진행 상태', alias: ['진행상태', '상태'] },
    { key: 'region', label: '지역', alias: ['거주지역', '지역', '거주지', '주소'] },
    { key: 'interest', label: '관심 타입·평형', alias: ['관심타입', '관심평형', '관심', '타입', '평형'] }
  ];
  var TEMPLATES = {
    '명단': [['이름', '전화번호', '등급', '지역', '관심타입', '메모'], ['홍길동', '010-0000-0000', 'B', '양주', '84B', '주말 방문 희망']],
    '관심고객': [['이름', '전화번호', '지역', '관심타입', '메모'], ['홍길동', '010-0000-0000', '의정부', '59A', '분양가 문의']],
    '상담결과': [['전화번호', '이름', '상담일시', '상담결과', '상담내용', '등급', '진행상태'], ['010-0000-0000', '홍길동', '2026-11-03 14:00', '방문약속', '토요일 오후 방문 예정', 'A', '방문예정']]
  };

  var st = { kind: '명단', source: '', consent: '', fileName: '', header: [], data: [], map: {} };

  // ---------- 파일 읽기 ----------
  function loadScript(url) {
    return new Promise(function (resolve, reject) {
      if (window.XLSX) return resolve();
      var sc = document.createElement('script');
      sc.src = url; sc.onload = resolve;
      sc.onerror = function () { reject(new Error('엑셀 읽기 도구를 불러오지 못했습니다. 인터넷 연결을 확인하거나 CSV 로 저장해 올려 주세요.')); };
      document.head.appendChild(sc);
    });
  }
  // 한글 CSV 는 UTF-8 이 아니라 EUC-KR(엑셀 기본 저장)인 경우가 많다
  function decodeText(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('euc-kr').decode(buf); }
  }
  // 따옴표가 있는 CSV / 탭으로 나뉜 붙여넣기 글자를 줄·칸으로 나눈다
  function parseDelimited(text) {
    text = text.replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '';
    var sep = first.split('\t').length > first.split(',').length ? '\t' : ',';
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === sep) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  async function readFile(file) {
    var buf = await file.arrayBuffer();
    if (/\.(xlsx|xls)$/i.test(file.name)) {
      await loadScript(XLSX_URL);
      // 날짜 칸은 엑셀 표시 형식(11/5/26 등)이 제각각이라 날짜 값으로 받아 직접 YYYY-MM-DD HH:MM 으로 바꾼다
      // (엑셀은 날짜를 "1900년부터 며칠째" 숫자로 저장한다. 시간대 보정 없이 그 숫자를 그대로 날짜·시각으로 푼다)
      var wb = XLSX.read(buf, { type: 'array', cellNF: true });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var pad = function (n) { return ('0' + n).slice(-2); };
      Object.keys(ws).forEach(function (k) {
        var c = ws[k];
        if (k[0] === '!' || !c || c.t !== 'n' || !c.z || !XLSX.SSF.is_date(c.z)) return;
        var d = new Date(Math.round((c.v - 25569) * 1440) * 60000);
        var day = d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
        c.v = d.getUTCHours() || d.getUTCMinutes() ? day + ' ' + pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) : day;
        c.t = 's';
      });
      return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    }
    return parseDelimited(decodeText(buf));
  }
  function setTable(rows, fileName) {
    rows = rows.map(function (r) { return r.map(function (c) { return String(c === null || c === undefined ? '' : c).trim(); }); })
      .filter(function (r) { return r.some(function (c) { return c !== ''; }); });
    if (rows.length < 2) throw new Error('첫 줄은 머리글(이름, 전화번호 …), 둘째 줄부터 내용이 있어야 합니다.');
    st.header = rows[0]; st.data = rows.slice(1); st.fileName = fileName; st.map = {};
    // 머리글 이름으로 열을 자동 연결 (긴 이름부터 맞춰 '상담결과'가 '결과'보다 먼저 잡히게)
    var used = {};
    FIELDS.forEach(function (f) {
      var best = -1, bestLen = 0;
      st.header.forEach(function (hd, i) {
        if (used[i]) return;
        var k = hd.replace(/[\s_()·\/-]/g, '').toLowerCase();
        f.alias.forEach(function (a) { if (k.indexOf(a) >= 0 && a.length > bestLen) { best = i; bestLen = a.length; } });
      });
      if (best >= 0) { st.map[f.key] = best; used[best] = true; }
    });
  }

  // 서버와 같은 전화번호 규칙 (미리보기에서 오류를 먼저 보여 주려는 것. 최종 판단은 서버가 한다)
  function normPhone(v) {
    var d = String(v || '').replace(/\D/g, '');
    if (d.indexOf('82') === 0 && d.length >= 11) d = '0' + d.slice(2);
    if (/^1[016789]\d{7,8}$/.test(d)) d = '0' + d;
    return /^0\d{8,10}$/.test(d) ? d : '';
  }
  function fieldsFor(kind) { return FIELDS.filter(function (f) { return !f.only || f.only === kind; }); }
  function buildRows() {
    var fs = fieldsFor(st.kind);
    return st.data.map(function (r, i) {
      var o = { line: i + 2 };
      fs.forEach(function (f) { var idx = st.map[f.key]; if (idx !== undefined && idx !== '' && idx >= 0) o[f.key] = r[idx] || ''; });
      return o;
    });
  }

  // ---------- 화면 ----------
  async function render(root) {
    var hist = (await Api.call('customer.importList')).imports;
    root.innerHTML = '';
    var again = function () { return render(root); };
    var wrap = h('div', { class: 'steps' });
    root.appendChild(wrap);

    // 1) 자료 종류·출처·동의
    var pick = h('div', { class: 'kind-pick' }, KINDS.map(function (k) {
      var b = h('button', { type: 'button', class: st.kind === k.key ? 'active' : '' }, h('b', null, k.title), h('span', null, k.desc));
      b.addEventListener('click', function () { st.kind = k.key; runBusy(null, again); });
      return b;
    }));
    var source = h('input', { type: 'text', maxLength: 30, value: st.source, placeholder: '예: TM업체A, 홈페이지 관심등록, 11월 전단 이벤트' });
    source.setAttribute('list', 'import-sources');
    var known = {};
    hist.forEach(function (x) { known[x.source] = 1; });
    var dl = h('datalist', { id: 'import-sources' }, Object.keys(known).map(function (x) { return h('option', { value: x }); }));
    source.addEventListener('input', function () { st.source = source.value; });
    var consent = h('select', null, option('', '선택해 주세요', !st.consent), option('동의', '동의 받은 자료 (개인정보 수집·이용 동의를 받은 명단)', st.consent === '동의'), option('미확인', '동의 미확인 (고객 화면에 "동의 미확인"으로 표시)', st.consent === '미확인'));
    consent.addEventListener('change', function () { st.consent = consent.value; });
    wrap.appendChild(h('div', { class: 'card step-card' }, h('h2', null, '어떤 자료인가요?'), pick,
      h('div', { class: 'form-row' }, field('출처', source, '고객마다 이 출처가 기록되고, 고객 DB 에서 출처별로 걸러 볼 수 있습니다.'), field('개인정보 동의', consent, '동의를 받지 않은 명단으로 연락하면 법적 문제가 될 수 있습니다. 확실하지 않으면 "동의 미확인"으로 올려 주세요.')), dl));

    // 2) 파일
    var fileIn = h('input', { type: 'file', accept: '.xlsx,.xls,.csv,.txt', style: 'display:none' });
    var choose = h('button', { type: 'button', class: 'btn small primary' }, '파일 선택 (엑셀 · CSV)');
    choose.addEventListener('click', function () { fileIn.click(); });
    var take = function (file) {
      if (!file) return;
      runBusy(choose, async function () { setTable(await readFile(file), file.name); await again(); });
    };
    fileIn.addEventListener('change', function () { take(fileIn.files[0]); });
    var drop = h('div', { class: 'dropzone' }, st.fileName ? h('strong', null, st.fileName + ' · ' + st.data.length.toLocaleString('ko-KR') + '줄') : '엑셀(.xlsx) 또는 CSV 파일을 여기에 끌어다 놓거나 아래에서 선택하세요. 첫 줄은 머리글이어야 합니다.');
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); take(e.dataTransfer.files[0]); });
    var paste = h('button', { type: 'button', class: 'btn small' }, '엑셀에서 복사해 붙여넣기');
    paste.addEventListener('click', function () {
      var ta = h('textarea', { rows: 10, placeholder: '엑셀에서 머리글을 포함해 범위를 복사한 뒤 여기에 붙여넣으세요 (Ctrl+V)' });
      modal('붙여넣기', h('div', null, ta), [{ label: '불러오기', primary: true, onClick: async function (close) { setTable(parseDelimited(ta.value), '붙여넣기'); close(); await again(); } }], { wide: true });
    });
    var tpl = h('button', { type: 'button', class: 'btn small' }, '양식 내려받기');
    tpl.addEventListener('click', function () { downloadCsv('업로드양식_' + st.kind + '.csv', TEMPLATES[st.kind]); });
    wrap.appendChild(h('div', { class: 'card step-card' }, h('h2', null, '파일 불러오기'), drop, h('div', { class: 'toolbar', style: 'margin:0' }, choose, paste, tpl, fileIn,
      h('span', { class: 'muted' }, '파일은 서버에 그대로 저장되지 않습니다. 이 화면에서 읽어 필요한 항목만 보냅니다.'))));

    // 3) 열 연결 + 미리보기 + 올리기
    if (st.data.length) {
      var fs = fieldsFor(st.kind);
      var grid = h('div', { class: 'map-grid' }, fs.map(function (f) {
        var sel = h('select', null, option('', '(사용 안 함)'), st.header.map(function (hd, i) { return option(String(i), hd || '(' + (i + 1) + '번째 열)', st.map[f.key] === i); }));
        sel.addEventListener('change', function () { if (sel.value === '') delete st.map[f.key]; else st.map[f.key] = Number(sel.value); runBusy(null, again); });
        return field(f.label, sel);
      }));
      var rows = buildRows();
      var seen = {}, bad = 0, dup = 0;
      rows.forEach(function (r) { var p = normPhone(r.phone); r._bad = !p; if (!p) bad++; else if (seen[p]) dup++; else seen[p] = 1; });
      var shown = fs.filter(function (f) { return st.map[f.key] !== undefined; });
      var preview = simpleTable(['줄'].concat(shown.map(function (f) { return f.label.replace(' (필수)', ''); })), rows.slice(0, 8).map(function (r) {
        return h('tr', null, h('td', null, String(r.line)), shown.map(function (f) { return h('td', { class: f.key === 'phone' && r._bad ? 'bad' : '' }, r[f.key] || (f.key === 'phone' ? '(없음)' : '')); }));
      }));
      var ready = st.map.phone !== undefined;
      var up = h('button', { type: 'button', class: 'btn primary', style: 'width:auto' }, rows.length.toLocaleString('ko-KR') + '줄 올리기');
      var prog = h('div', { class: 'progress hidden' }, h('span', { style: 'width:0' }));
      var status = h('div', { class: 'muted' });
      up.addEventListener('click', function () {
        if (!st.source.trim()) { toast('출처를 입력해 주세요.', true); source.focus(); return; }
        if (!st.consent) { toast('개인정보 동의 여부를 선택해 주세요.', true); consent.focus(); return; }
        if (!ready) { toast('전화번호 열을 연결해 주세요.', true); return; }
        if (!confirm('출처 "' + st.source.trim() + '" (' + (st.consent === '동의' ? '동의 받은 자료' : '동의 미확인') + ') 으로 ' + rows.length + '줄을 올립니다. 계속할까요?')) return;
        runBusy(up, function () { return upload(rows, prog, status, again); });
      });
      wrap.appendChild(h('div', { class: 'card step-card' }, h('h2', null, '열 연결과 미리보기'),
        h('p', { class: 'muted' }, '머리글 이름으로 자동 연결했습니다. 틀린 곳은 바꿔 주세요. 같은 전화번호의 고객이 이미 있으면 새로 만들지 않고 비어 있는 항목만 채웁니다.'), grid, preview,
        h('div', { class: 'chips', style: 'margin:12px 0' }, h('span', { class: 'badge info' }, '전체 ' + rows.length.toLocaleString('ko-KR') + '줄'),
          h('span', { class: 'badge ' + (bad ? 'danger' : 'ok') }, '전화번호 오류 ' + bad + '줄' + (bad ? ' (건너뜀)' : '')), dup ? h('span', { class: 'badge warn' }, '파일 안 중복 ' + dup + '줄 (한 고객으로)') : null,
          rows.length > 8 ? h('span', { class: 'muted' }, '위 표는 처음 8줄만 보여 줍니다.') : null),
        h('div', { class: 'toolbar', style: 'margin:0' }, up, status), prog));
    }

    // 4) 업로드 기록
    var hrows = hist.map(function (x) {
      var cancel = null;
      if (x.status === '완료') {
        cancel = h('button', { type: 'button', class: 'btn small danger' }, '업로드 취소');
        cancel.addEventListener('click', function () {
          if (!confirm('이 업로드로 새로 생긴 고객과 상담 기록을 지웁니다 (설문·방문에도 있는 고객은 남습니다). 되돌릴 수 없습니다. 계속할까요?')) return;
          runBusy(cancel, async function () { var r = await Api.call('customer.importDelete', { importId: x.id }); toast('고객 ' + r.customers + '명, 상담 기록 ' + r.notes + '건을 지웠습니다.'); await again(); });
        });
      }
      return h('tr', null, h('td', null, x.createdAt.slice(0, 16)), h('td', null, h('strong', null, x.source), h('div', { class: 'cust-sub' }, x.fileName)), h('td', null, x.kind),
        h('td', null, h('span', { class: 'badge ' + (x.consent === '동의' ? 'ok' : 'warn') }, x.consent)), h('td', null, x.total.toLocaleString('ko-KR')),
        h('td', null, '새 고객 ' + x.added + ' · 기존 ' + x.updated + (x.notes ? ' · 상담 기록 ' + x.notes : '') + (x.skipped ? ' · 건너뜀 ' + x.skipped : '')),
        h('td', null, x.createdBy), h('td', null, x.status === '완료' ? cancel : h('span', { class: 'badge' }, '취소됨')));
    });
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '업로드 기록'), simpleTable(['올린 때', '출처 · 파일', '종류', '동의', '줄 수', '결과', '올린 사람', ''], hrows)));
  }

  async function upload(rows, prog, status, again) {
    prog.classList.remove('hidden');
    var bar = prog.firstChild;
    var total = { added: 0, updated: 0, notes: 0, skipped: 0 }, errors = [], importId = '';
    var base = { kind: st.kind, source: st.source.trim(), consent: st.consent, fileName: st.fileName };
    for (var i = 0; i < rows.length; i += CHUNK) {
      var part = rows.slice(i, i + CHUNK).map(function (r) { var o = Object.assign({}, r); delete o._bad; return o; });
      var res = await Api.call('customer.import', Object.assign({ importId: importId, rows: part }, base));
      importId = res.importId || importId;
      ['added', 'updated', 'notes', 'skipped'].forEach(function (k) { total[k] += res[k]; });
      errors = errors.concat(res.errors || []);
      bar.style.width = Math.round(Math.min(i + CHUNK, rows.length) / rows.length * 100) + '%';
      status.textContent = Math.min(i + CHUNK, rows.length).toLocaleString('ko-KR') + ' / ' + rows.length.toLocaleString('ko-KR') + '줄';
    }
    st.header = []; st.data = []; st.fileName = ''; st.map = {};
    await again();
    var body = h('div', null,
      h('div', { class: 'summary' }, Hub.statCard('새 고객', total.added + '명'), Hub.statCard('기존 고객', total.updated + '명', '빈 항목만 채움'), Hub.statCard('상담 기록', total.notes + '건'), Hub.statCard('건너뜀', total.skipped + '줄')),
      errors.length ? [h('p', { class: 'muted' }, '건너뛴 줄 (처음 ' + Math.min(errors.length, 50) + '건). 파일을 고쳐 그 줄만 다시 올리면 됩니다.'),
        simpleTable(['줄', '사유'], errors.slice(0, 50).map(function (e) { return h('tr', null, h('td', null, String(e.line)), h('td', null, e.reason)); }))] : null);
    var buttons = errors.length ? [{ label: '건너뛴 줄 내려받기', onClick: function () { downloadCsv('업로드_건너뛴줄.csv', [['줄', '사유']].concat(errors.map(function (e) { return [e.line, e.reason]; }))); } }] : [];
    modal('업로드 결과', body, buttons, { wide: errors.length > 0 });
  }

  Hub.section('customer-import', { render: render });
})();
