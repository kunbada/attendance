// 고객관리 > 부동산고객: 중개업소 조사 링크·QR(현장당 1개), 중개업소 목록(같은 곳은 묶음), 조사 이력·수정, 내보내기
(function () {
  var simpleTable = Hub.simpleTable, downloadCsv = Hub.downloadCsv;
  var EMPTY = { q: '', market: '', consent: '', sort: '최근', page: 1 };
  var filter = Object.assign({}, EMPTY);
  var TONE = { 5: 'ok', 4: 'ok', 3: '', 2: 'warn', 1: 'danger' };

  function linkUrl(code) { return location.href.replace(/hub\/.*$/, '') + 'r/?c=' + code; }
  function scaleBadge(scale, k, n) { return n ? h('span', { class: 'badge ' + (TONE[n] || '') }, scale[k][n]) : h('span', { class: 'muted' }, '-'); }
  function avgLabel(scale, k, v) { return v === null ? '-' : v.toFixed(1) + ' (' + scale[k][Math.round(v)] + ')'; }

  async function render(root) {
    var fg = await Api.call('realtor.formGet');
    var res = await Api.call('realtor.list', filter);
    var sm = res.summary, scale = res.scale;
    var again = function () { return render(root); };
    var go = function (patch) { filter = Object.assign({}, filter, { page: 1 }, patch); return runBusy(null, again); };
    root.innerHTML = '';

    // 1) 조사 링크·QR (현장당 1개)
    root.appendChild(linkCard(fg, again));

    // 2) 숫자 카드
    var kpi = function (label, value, sub) { return h('div', { class: 'kpi' }, label, h('b', null, value), sub ? h('small', null, sub) : null); };
    root.appendChild(h('div', { class: 'kpis' },
      kpi('중개업소', sm.offices.toLocaleString('ko-KR') + '곳', '조사 ' + sm.responses + '건 · 오늘 ' + sm.today + '건'),
      kpi('시장 동향 평균', avgLabel(scale, 'market', sm.marketAvg), '5점 = 매우 좋음'),
      kpi('분양 의향 높음 이상', sm.intentHigh + '곳', '평균 ' + avgLabel(scale, 'intent', sm.intentAvg)),
      kpi('소개 의향 높음 이상', sm.referHigh + '곳', '평균 ' + avgLabel(scale, 'refer', sm.referAvg)),
      kpi('소개 가능 고객', sm.referTotal.toLocaleString('ko-KR') + '명', '중개업소별 최근 조사 합계')));

    // 3) 시장 동향 바로가기 + 동의 조건
    var chip = function (label, n, active, patch) {
      var b = h('button', { type: 'button', class: 'chip' + (active ? ' active' : '') }, label, h('i', null, String(n)));
      b.addEventListener('click', function () { go(patch); });
      return b;
    };
    root.appendChild(h('div', { class: 'chips' }, h('span', { class: 'muted', style: 'margin-right:4px' }, '시장 동향'),
      sm.market.map(function (m) { return chip(m.label, m.count, String(filter.market) === String(m.n), { market: String(filter.market) === String(m.n) ? '' : m.n }); }),
      h('span', { class: 'sep' }),
      chip('동의', sm.consent, filter.consent === '동의', { consent: filter.consent === '동의' ? '' : '동의' }),
      chip('미동의', sm.offices - sm.consent, filter.consent === '미동의', { consent: filter.consent === '미동의' ? '' : '미동의' })));

    // 4) 검색
    var q = h('input', { type: 'search', value: filter.q, placeholder: '상호, 이름, 주소, 전화번호' });
    var sort = h('select', null, [['최근', '최근 조사순'], ['소개', '소개 가능 고객 많은 순'], ['상호', '상호순']].map(function (x) { return option(x[0], x[1], filter.sort === x[0]); }));
    var find = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    var reset = h('button', { type: 'button', class: 'btn small' }, '조건 지우기');
    var run = function () { return go({ q: q.value, sort: sort.value }); };
    find.addEventListener('click', run);
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    sort.addEventListener('change', run);
    reset.addEventListener('click', function () { filter = Object.assign({}, EMPTY); runBusy(reset, again); });
    var exp = h('button', { type: 'button', class: 'btn small' }, '내보내기 (CSV)');
    exp.addEventListener('click', function () {
      if (!confirm('지금 조건에 맞는 중개업소 ' + res.matched + '곳의 조사 기록을 휴대폰 원문과 함께 내려받습니다. 내려받은 기록이 남습니다. 계속할까요?')) return;
      runBusy(exp, exportCsv);
    });
    root.appendChild(h('div', { class: 'toolbar filterbar' }, q, sort, find, reset, h('span', { style: 'flex:1' }), exp));

    // 5) 목록
    var rows = res.offices.map(function (o) {
      var tr = h('tr', { class: 'clickable' },
        h('td', null, h('div', { class: 'cust-name' }, o.officeName), h('div', { class: 'cust-sub' }, o.address || '-')),
        h('td', null, o.name ? o.name + (o.position ? ' ' + o.position : '') : h('span', { class: 'muted' }, o.consent ? '-' : '(미동의)'), o.phone ? h('div', { class: 'cust-sub' }, o.phone) : null),
        h('td', null, o.officeTel || h('span', { class: 'muted' }, '-')),
        h('td', null, scaleBadge(scale, 'market', o.market)),
        h('td', null, scaleBadge(scale, 'intent', o.intent)),
        h('td', null, scaleBadge(scale, 'refer', o.refer)),
        h('td', null, o.referCount + '명'),
        h('td', null, o.count + '회', h('div', { class: 'cust-sub' }, o.last.slice(0, 10))));
      tr.addEventListener('click', function () { openDetail(o.id, scale, again); });
      return tr;
    });
    root.appendChild(simpleTable(['중개업소', '대표·담당', '사무실 전화', '시장 동향', '분양 의향', '소개 의향', '소개 가능', '조사'], rows));

    var from = res.matched ? (res.page - 1) * res.pageSize + 1 : 0, to = Math.min(res.page * res.pageSize, res.matched);
    var prev = h('button', { type: 'button', class: 'btn small', disabled: res.page <= 1 }, '← 이전');
    var next = h('button', { type: 'button', class: 'btn small', disabled: to >= res.matched }, '다음 →');
    prev.addEventListener('click', function () { filter.page = res.page - 1; runBusy(prev, again); });
    next.addEventListener('click', function () { filter.page = res.page + 1; runBusy(next, again); });
    root.appendChild(h('div', { class: 'pager' }, h('span', null, '중개업소 ' + res.matched.toLocaleString('ko-KR') + '곳 중 ' + from + '–' + to + ' · 줄을 누르면 조사 이력이 열립니다'), h('span', null, prev, ' ', next)));
    root.appendChild(h('p', { class: 'muted' }, '같은 휴대폰 번호나 사무실 전화로 여러 번 조사하면 한 중개업소로 묶이고, 표의 값은 가장 최근 조사 기준입니다. ' +
      '개인정보 제공에 동의하지 않은 조사는 이름·직함·휴대폰을 저장하지 않습니다. 휴대폰은 가려서 보이고 원문은 상세의 [연락처 보기]에서 확인합니다(기록됨).'));
  }

  function linkCard(fg, again) {
    var f = fg.form;
    var ocrInfo = fg.ocr.enabled ? '명함 인식: 오늘 ' + fg.ocr.today + '건 / 하루 ' + fg.ocr.limit + '건까지' : '명함 인식이 아직 설정되지 않았습니다 (배포가이드 5-10 참고). 그동안은 직접 입력으로 쓸 수 있습니다.';
    if (!f) {
      var make = h('button', { type: 'button', class: 'btn primary', style: 'max-width:220px' }, '조사 링크 만들기');
      make.addEventListener('click', function () { runBusy(make, async function () { await Api.call('realtor.formSave', {}); toast('조사 링크를 만들었습니다.'); await again(); }); });
      return h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '중개업소 조사 링크'),
        h('p', { class: 'muted' }, '이 현장의 중개업소 조사 링크(QR)를 만듭니다. 현장마다 하나이며, 직원이 휴대폰으로 열어 명함을 찍고 조사 내용을 입력합니다.'), make, h('p', { class: 'muted' }, ocrInfo));
    }
    var url = linkUrl(f.code);
    var qrBox = h('div', { style: 'width:132px;height:132px;flex:none;background:#fff;padding:6px;border:1px solid #e3e7ee;border-radius:10px' });
    var copy = h('button', { type: 'button', class: 'btn small primary' }, '링크 복사');
    copy.addEventListener('click', function () { if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('복사했습니다.'); }); else prompt('링크를 복사하세요', url); });
    var big = h('button', { type: 'button', class: 'btn small' }, 'QR 크게·인쇄');
    big.addEventListener('click', function () { showQr(url); });
    var open = h('button', { type: 'button', class: 'btn small' }, '조사 화면 열기');
    open.addEventListener('click', function () { window.open(url, '_blank'); });
    var tg = h('button', { type: 'button', class: 'btn small' + (f.active ? '' : ' primary') }, f.active ? '사용 중지' : '다시 사용');
    tg.addEventListener('click', function () {
      if (f.active && !confirm('조사 링크를 중지하면 이 링크로 더 이상 입력할 수 없습니다. 중지할까요?')) return;
      runBusy(tg, async function () { await Api.call('realtor.formSave', { active: !f.active, consentText: f.consentText }); await again(); });
    });
    var edit = h('button', { type: 'button', class: 'btn small' }, '동의 문구 수정');
    edit.addEventListener('click', function () {
      var ta = h('textarea', { rows: 10, maxLength: 3000 }, f.consentText);
      var def = h('button', { type: 'button', class: 'btn small' }, '기본 문구로');
      def.addEventListener('click', function () { ta.value = fg.defaultConsentText; });
      modal('개인정보 제공 동의 문구', h('div', null, h('p', { class: 'muted' }, '조사 화면 맨 위에 나옵니다. 기본 문구는 임시 문구이므로 운영 전에 회사에서 확정한 문구로 바꿔 주세요.'), ta, def), [{
        label: '저장', primary: true, onClick: async function (close) { await Api.call('realtor.formSave', { consentText: ta.value }); close(); toast('저장했습니다.'); await again(); }
      }], { wide: true });
    });
    var card = h('div', { class: 'card', style: 'display:flex;gap:18px;align-items:center;flex-wrap:wrap' }, qrBox,
      h('div', { style: 'flex:1;min-width:260px' },
        h('div', { class: 'toolbar', style: 'margin:0 0 6px' }, h('strong', null, '중개업소 조사 링크'), h('span', { class: 'badge ' + (f.active ? 'ok' : 'warn') }, f.active ? '사용 중' : '중지됨')),
        h('p', { style: 'margin:0 0 8px' }, h('code', { style: 'word-break:break-all' }, url)),
        h('div', { class: 'toolbar', style: 'margin:0' }, copy, big, open, edit, tg),
        h('p', { class: 'muted', style: 'margin:8px 0 0' }, '직원에게 링크를 보내거나 QR 을 찍게 하세요. 휴대폰으로 열어 명함을 찍으면 상호·이름·전화·주소가 채워집니다. ' + ocrInfo)));
    if (window.QRCode) new QRCode(qrBox, { text: url, width: 120, height: 120 });
    return card;
  }

  function showQr(url) {
    var qrBox = h('div', { class: 'qr-box' });
    var print = h('button', { type: 'button', class: 'btn small' }, '인쇄');
    print.addEventListener('click', function () { window.print(); });
    modal('중개업소 조사 QR', h('div', { class: 'qr-big' }, qrBox, h('p', { class: 'qr-title' }, ((Hub.currentProject() || {}).name || '') + ' 중개업소 조사'), h('p', null, h('code', { style: 'word-break:break-all' }, url)), h('div', null, print)), []);
    if (window.QRCode) new QRCode(qrBox, { text: url, width: 220, height: 220 });
  }

  async function exportCsv() {
    var ex = await Api.call('realtor.export', filter);
    var sc = ex.scale;
    downloadCsv('부동산고객_' + Hub.todayLocal() + '.csv', [['중개업소 번호', '조사 일시', '상호', '사무실 전화', '주소', '개인정보 동의', '이름', '직함', '휴대폰', '시장 동향', '분양 의향', '소개 의향', '소개 가능 고객 수', '기타 의견', '명함 인식', '메모']].concat(
      ex.rows.map(function (r) {
        return [r.office, r.at, r.officeName, r.officeTel, r.address, r.consent ? '동의' : '미동의', r.name, r.position, r.phone, sc.market[r.market], sc.intent[r.intent], sc.refer[r.refer], r.referCount, r.opinion, r.ocr ? '사용' : '', r.memo];
      })));
    toast(ex.rows.length + '건을 내려받았습니다. 개인정보가 들어 있으니 안전하게 보관해 주세요.');
  }

  // 중개업소 상세: 대표 정보 + 조사 이력 (건마다 수정·삭제)
  async function openDetail(id, scale, again) {
    var d = await Api.call('realtor.get', { id: id });
    var o = d.office;
    var dirty = false;
    var phoneEl = h('span', null, o.phone || '-');
    var reveal = h('button', { type: 'button', class: 'btn small' }, '연락처 보기');
    reveal.addEventListener('click', function () { runBusy(reveal, async function () { var r = await Api.call('realtor.reveal', { id: id }); phoneEl.textContent = r.phone || '-'; reveal.remove(); }); });
    var hist = h('div');
    function drawHist(list) {
      hist.innerHTML = '';
      list.forEach(function (r) {
        var ed = h('button', { type: 'button', class: 'btn small' }, '수정');
        ed.addEventListener('click', function () { openEdit(r, scale, async function () { dirty = true; var nd = await Api.call('realtor.get', { id: id }); drawHist(nd.responses); }); });
        var del = h('button', { type: 'button', class: 'btn small danger' }, '삭제');
        del.addEventListener('click', function () {
          if (!confirm(r.at.slice(0, 16) + ' 조사 기록을 삭제할까요? 되돌릴 수 없습니다.')) return;
          runBusy(del, async function () {
            await Api.call('realtor.delete', { id: r.id }); dirty = true; toast('삭제했습니다.');
            var rest = list.filter(function (x) { return x.id !== r.id; });
            if (!rest.length) { m.close(); return; }
            drawHist(rest);
          });
        });
        hist.appendChild(h('div', { class: 'card', style: 'background:#fafbfd;margin:0 0 10px' },
          h('div', { class: 'toolbar', style: 'margin:0 0 6px' }, h('strong', null, r.at.slice(0, 16)), r.ocr ? h('span', { class: 'badge info' }, '명함 인식') : null,
            h('span', { class: 'badge ' + (r.consent ? 'ok' : '') }, r.consent ? '동의' : '미동의'), h('span', { style: 'flex:1' }), ed, del),
          h('div', { class: 'toolbar', style: 'margin:0 0 6px;gap:6px' }, '시장 동향 ', scaleBadge(scale, 'market', r.market), ' 분양 의향 ', scaleBadge(scale, 'intent', r.intent), ' 소개 의향 ', scaleBadge(scale, 'refer', r.refer), ' 소개 가능 ' + r.referCount + '명'),
          h('div', { class: 'cust-sub' }, [r.officeName, r.name ? r.name + (r.position ? ' ' + r.position : '') : '', r.phone, r.officeTel, r.address].filter(Boolean).join(' · ')),
          h('p', { style: 'margin:6px 0 0;white-space:pre-wrap' }, r.opinion),
          r.memo ? h('p', { class: 'muted', style: 'margin:4px 0 0' }, '메모: ' + r.memo) : null,
          r.updatedAt ? h('p', { class: 'muted', style: 'margin:4px 0 0' }, '수정 ' + r.updatedAt.slice(0, 16) + ' · ' + r.updatedBy) : null));
      });
    }
    drawHist(d.responses);
    var body = h('div', null,
      h('div', { class: 'profile' }, h('div', { class: 'big' }, o.officeName),
        h('p', { style: 'margin:4px 0' }, o.name ? o.name + (o.position ? ' ' + o.position : '') : (o.consent ? '' : '개인정보 미동의')),
        h('p', { style: 'margin:4px 0' }, '휴대폰 ', phoneEl, ' ', o.phone ? reveal : null),
        h('p', { style: 'margin:4px 0' }, '사무실 ' + (o.officeTel || '-')),
        h('p', { class: 'muted', style: 'margin:4px 0' }, o.address || '주소 없음'),
        h('p', { class: 'muted', style: 'margin:4px 0' }, '조사 ' + o.count + '회 · 처음 ' + o.first.slice(0, 10) + ' · 최근 ' + o.last.slice(0, 10))),
      h('h3', null, '조사 이력'), hist);
    var m = modal('중개업소 상세', body, [], { wide: true });
    // 창을 닫을 때 바뀐 것이 있으면 목록을 새로 그린다
    var overlay = document.querySelector('.modal-overlay:last-of-type');
    if (overlay) new MutationObserver(function (_, ob) { if (!document.body.contains(overlay)) { ob.disconnect(); if (dirty) runBusy(null, again); } }).observe(document.body, { childList: true });
    return m;
  }

  // 조사 한 건 수정 (명함 인식 오류 고치기 등)
  function openEdit(r, scale, done) {
    var inp = function (v, max, ph) { return h('input', { type: 'text', value: v || '', maxLength: max, placeholder: ph || '' }); };
    var officeName = inp(r.officeName, 60), name = inp(r.name, 30), position = inp(r.position, 30), officeTel = inp(r.officeTel, 14), address = inp(r.address, 150);
    var mobile = inp('', 13, r.hasPhone ? r.phone + ' (바꿀 때만 입력)' : '010-0000-0000');
    var consent = h('select', null, option('Y', '동의', r.consent), option('N', '미동의', !r.consent));
    var pick = function (k, v) { return h('select', null, [5, 4, 3, 2, 1].map(function (n) { return option(String(n), scale[k][n], n === v); })); };
    var market = pick('market', r.market), intent = pick('intent', r.intent), refer = pick('refer', r.refer);
    var referCount = h('input', { type: 'number', min: 0, max: 9999, value: r.referCount });
    var opinion = h('textarea', { rows: 3, maxLength: 1000 }, r.opinion);
    var memo = inp(r.memo, 500, '관리자 메모 (조사 화면에는 보이지 않음)');
    modal('조사 기록 수정 — ' + r.at.slice(0, 16), h('div', { class: 'edit-grid' },
      h('div', null, field('상호', officeName), field('개인정보 제공 동의', consent), field('이름', name), field('직함', position), field('휴대폰', mobile), field('사무실 전화', officeTel), field('주소', address)),
      h('div', null, field('시장 동향', market), field('분양 의향', intent), field('소개 의향', refer), field('소개 가능 고객 수', referCount), field('기타 의견', opinion), field('메모', memo),
        h('p', { class: 'muted' }, '동의를 "미동의"로 바꾸면 이름·직함·휴대폰이 지워집니다. 미동의 → 동의로 바꾸는 것은 실제로 동의를 받은 경우에만 해 주세요(기록됨).'))), [{
      label: '저장', primary: true, onClick: async function (close) {
        await Api.call('realtor.save', {
          id: r.id, officeName: officeName.value, consent: consent.value === 'Y', name: name.value, position: position.value, mobile: mobile.value, officeTel: officeTel.value, address: address.value,
          market: Number(market.value), intent: Number(intent.value), refer: Number(refer.value), referCount: String(referCount.value), opinion: opinion.value, memo: memo.value
        });
        close(); toast('저장했습니다.'); await done();
      }
    }], { wide: true });
  }

  Hub.section('realtors', { render: render });
})();
