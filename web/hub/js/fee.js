// 용역관리 > 수수료: 수수료 규칙·지급 시점 설정, 해약·환수, 합산 명세. 수수료 정산 회차의 만들기·명세 화면은
// pay.js 의 회차 화면이 Hub.fee 를 불러 쓴다.
(function () {
  var simpleTable = Hub.simpleTable, downloadCsv = Hub.downloadCsv, DATE_STYLE = Hub.DATE_STYLE;
  var won = function (n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; };
  var ROLE_TEXT = { '직원': '직원', '팀장': '팀장', '본부장': '본부장', '본부장일괄': '본부장(일괄)' };

  function pad(n) { return ('0' + n).slice(-2); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  // ====================================================================
  // 수수료 정산 회차 (pay.js 가 불러 쓴다)
  // ====================================================================
  function openCreate(root, onCreated) {
    var now = new Date();
    var first = new Date(now.getFullYear(), now.getMonth() - 1, 1), last = new Date(now.getFullYear(), now.getMonth(), 0);
    var from = h('input', { type: 'date', value: ymd(first), style: DATE_STYLE });
    var to = h('input', { type: 'date', value: ymd(last), style: DATE_STYLE });
    var title = h('input', { type: 'text', maxLength: 40, placeholder: '비우면 자동 (예: 2026-09-01 ~ 2026-09-30 수수료)' });
    modal('새 수수료 정산', h('div', null,
      h('p', { class: 'muted' }, '[수수료 규칙]에서 정한 지급 시점(계약금을 낸 날)이 "정산 시작일 ~ 종료일" 사이이고, 아직 수수료를 주지 않은 계약이 대상입니다. 처음 만들 때는 시작일이 "정산 시작일"로 저장되어, 그 이전 계약은 예전 방식으로 이미 지급한 것으로 봅니다.'),
      field('시작일', from), field('종료일', to), field('회차 이름', title)), [{
      label: '만들기', primary: true, onClick: async function (close) {
        var res = await Api.call('fee.runCreate', { from: from.value, to: to.value, title: title.value });
        close();
        toast(res.people + '명 분을 작성했습니다.' + (res.held ? ' (보류된 계약 ' + res.held + '건 — 회차 화면에서 확인)' : ''));
        await onCreated(res.id);
      }
    }]);
  }

  // 회차 화면 위쪽 안내 카드: 보류 / 제외된 몫 / 이월 / 포함되지 않은 사람
  function extraCards(fee) {
    var cards = [];
    if (!fee) return cards;
    if (fee.held.length) {
      cards.push(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '보류된 계약 (' + fee.held.length + '건) — 아직 정산에 넣지 않았습니다'),
        h('p', { class: 'muted' }, '원인을 고친 뒤 [다시 계산]하면 들어옵니다. (예: 수수료 규칙 추가, 팀장·본부장 직급 지정, 받는 사람의 지급 설정)'),
        simpleTable(['동호', '고객', '담당 직원', '사유'], fee.held.map(function (x) { return h('tr', null, h('td', null, x.dongho), h('td', null, x.customer), h('td', null, x.staff), h('td', null, x.reason)); }))));
    }
    if (fee.dropped.length) {
      cards.push(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '지급하지 않는 몫 (' + fee.dropped.length + '건)'),
        simpleTable(['동호', '받을 사람', '몫', '금액', '사유'], fee.dropped.map(function (x) { return h('tr', null, h('td', null, x.dongho), h('td', null, x.staff), h('td', null, ROLE_TEXT[x.role] || x.role), h('td', null, won(x.amount)), h('td', null, x.reason)); }))));
    }
    if (fee.carried.length) {
      cards.push(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '다음 정산으로 넘긴 환수 (' + fee.carried.length + '건)'),
        h('p', { class: 'muted' }, '받는 사람의 이번 지급액보다 커서 차감하지 않았습니다 (지급액이 마이너스가 되지 않게). 다음 정산에서 이어서 차감합니다.'),
        simpleTable(['받을 사람', '동호', '몫', '환수 금액', '사유'], fee.carried.map(function (x) { return h('tr', null, h('td', null, x.staff), h('td', null, x.dongho), h('td', null, ROLE_TEXT[x.role] || x.role), h('td', null, won(x.amount)), h('td', null, x.reason)); }))));
    }
    if (fee.notIncluded.length) {
      cards.push(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '포함되지 않은 사람 (' + fee.notIncluded.length + '명)'),
        simpleTable(['성명', '이유'], fee.notIncluded.map(function (n) { return h('tr', null, h('td', null, n.name), h('td', null, n.reason)); }))));
    }
    return cards;
  }

  // 받는 사람별 명세 표
  function itemsTable(r, d, editable, again, openAdjust) {
    var rows = d.items.map(function (i) {
      var cells = [];
      var detailBtn = h('button', { type: 'button', class: 'btn small no-print' }, '명세');
      detailBtn.addEventListener('click', function () { openDetail(r, i); });
      cells.push(detailBtn);
      if (editable) {
        var adj = h('button', { type: 'button', class: 'btn small no-print' }, '조정');
        adj.addEventListener('click', function () { openAdjust(r, i, again); });
        cells.push(' ', adj);
      }
      var viaSup = i.payMode === '업체일괄';
      return h('tr', null, h('td', null, h('strong', null, i.name), viaSup ? [' ', h('span', { class: 'badge' }, '업체 ' + i.supplierName)] : null), h('td', null, i.count + '건'), h('td', null, won(i.baseAmount)),
        h('td', null, i.adjustAmount ? won(i.adjustAmount) + ' (' + i.adjustMemo + ')' : ''), h('td', null, viaSup ? won(i.gross) + ' (공급가)' : won(i.gross)),
        h('td', null, viaSup ? '-' : won(i.incomeTax)), h('td', null, viaSup ? '-' : won(i.localTax)), h('td', null, viaSup ? '업체 지급' : h('strong', null, won(i.net))), h('td', null, cells));
    });
    rows.push(h('tr', null, h('td', null, h('strong', null, '개인 지급 합계')), h('td'), h('td'), h('td'), h('td', null, h('strong', null, won(d.totals.gross))),
      h('td', { colspan: 2 }, h('strong', null, won(d.totals.tax))), h('td', null, h('strong', null, won(d.totals.net))), h('td')));
    return simpleTable(['성명', '계약 건수', '수수료 합계(환수 반영)', '조정', '지급액', '소득세 3%', '지방소득세 0.3%', '실지급액', ''], rows);
  }

  // 개인 명세: 계약(동호)별 내역
  function openDetail(r, i) {
    var rows = i.detail.map(function (x) {
      var refund = x.t === '환수';
      return h('tr', null, h('td', null, x.dongho), h('td', null, refund ? h('span', { class: 'badge warn' }, '해약 환수') : '지급'), h('td', null, ROLE_TEXT[x.role] || x.role),
        h('td', null, x.date || ''), h('td', null, won(x.amount)));
    });
    modal('개인 명세 — ' + i.name, h('div', null,
      h('p', { class: 'muted' }, r.title + ' (' + r.from + ' ~ ' + r.to + ') · 날짜는 지급은 계약금 완납일, 환수는 해약일입니다.'),
      simpleTable(['동호', '구분', '몫', '날짜', '금액'], rows),
      h('div', { class: 'stat' }, h('span', null, '수수료 합계 (' + i.count + '건)'), h('strong', null, won(i.baseAmount))),
      i.adjustAmount ? h('div', { class: 'stat' }, h('span', null, '조정 (' + i.adjustMemo + ')'), h('strong', null, won(i.adjustAmount))) : null,
      h('div', { class: 'stat' }, h('span', null, '지급액'), h('strong', null, won(i.gross))),
      h('div', { class: 'stat' }, h('span', null, '소득세 3%'), h('span', null, '-' + won(i.incomeTax))),
      h('div', { class: 'stat' }, h('span', null, '지방소득세 0.3%'), h('span', null, '-' + won(i.localTax))),
      h('div', { class: 'stat' }, h('span', null, '실지급액'), h('strong', null, won(i.net)))), [{ label: '인쇄', onClick: function () { window.print(); } }]);
  }

  function csv(r, items) {
    var rows = [['성명', '지급 방식', '업체', '동호', '구분', '몫', '날짜', '금액', '', '수수료 합계', '조정', '조정 사유', '지급액(업체는 공급가)', '소득세', '지방소득세', '실지급액']];
    items.forEach(function (i) {
      i.detail.forEach(function (x, n) {
        rows.push([i.name, i.payMode, i.supplierName, x.dongho, x.t, ROLE_TEXT[x.role] || x.role, x.date || '', x.amount, '', n === 0 ? i.baseAmount : '', n === 0 ? i.adjustAmount : '', n === 0 ? i.adjustMemo : '', n === 0 ? i.gross : '', n === 0 ? i.incomeTax : '', n === 0 ? i.localTax : '', n === 0 ? i.net : '']);
      });
    });
    downloadCsv('수수료명세_' + r.from + '_' + r.to + '.csv', rows);
  }

  Hub.fee = { openCreate: openCreate, extraCards: extraCards, itemsTable: itemsTable, openDetail: openDetail, downloadCsv: csv };

  // ====================================================================
  // 수수료 규칙 · 지급 시점 설정
  // ====================================================================
  async function renderRules(root) {
    var results = await Promise.all([Api.call('fee.ruleList'), Api.call('fee.settingsGet')]);
    var res = results[0], set = results[1].settings;
    root.innerHTML = '';

    // 1) 현장 설정
    var after = h('select', null, option('계약금전체', '계약금을 모두 낸 뒤 (계약금 1차·2차 …)', set.after === '계약금전체'), option('계약금1차', '계약금 1차를 낸 뒤', set.after === '계약금1차'));
    var start = h('input', { type: 'date', value: set.start, style: DATE_STYLE });
    var months = h('input', { type: 'number', min: 0, max: 36, step: 1, value: set.months, style: 'width:80px' });
    var missing = h('select', null, option('보류', '그 계약을 보류 (직급을 지정하면 정산됨)', set.missing === '보류'), option('건너뜀', '그 몫만 건너뛰고 나머지는 지급', set.missing === '건너뜀'));
    var save = h('button', { type: 'button', class: 'btn small primary' }, '설정 저장');
    save.addEventListener('click', function () {
      runBusy(save, async function () {
        await Api.call('fee.settingsSave', { after: after.value, start: start.value, months: Number(months.value), missing: missing.value });
        toast('저장했습니다.');
        await renderRules(root);
      });
    });
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '수수료 지급 설정'),
      h('p', { class: 'muted' }, '"지급 시점"에 해당하는 날(계약금을 낸 날)이 정산 기간 안인 계약부터 수수료가 발생합니다. 한 번 지급한 계약은 다시 지급되지 않으며, 해약되면 환수 대상이 됩니다.'),
      field('지급 시점', after), field('정산 시작일', start, '이 날 이후에 계약금을 낸 계약만 수수료 대상입니다. 비워 두면 첫 정산을 만들 때 그 시작일로 정해집니다. (예전 방식으로 이미 지급한 계약이 다시 나오지 않게 하는 선입니다)'),
      field('재판매 대기 기간 (개월)', months, '해약된 계약의 환수를 "재판매 대기"로 두면 해약일로부터 이 기간 안에 원 담당자가 다시 계약할 때 환수하지 않습니다. 기간이 지나면 자동으로 환수됩니다.'),
      field('팀장·본부장이 지정되지 않았을 때', missing), h('div', { class: 'toolbar' }, save)));

    // 2) 규칙 표
    var add = h('button', { type: 'button', class: 'btn small primary' }, '+ 규칙 추가');
    add.addEventListener('click', function () { openRule(null, res, root); });
    var rows = res.rules.map(function (r) {
      var edit = h('button', { type: 'button', class: 'btn small' }, '수정');
      edit.addEventListener('click', function () { openRule(r, res, root); });
      var del = h('button', { type: 'button', class: 'btn small danger' }, '삭제');
      del.addEventListener('click', function () {
        if (!confirm('이 규칙을 삭제할까요? (이미 확정된 정산은 그대로입니다)')) return;
        runBusy(del, async function () { await Api.call('fee.ruleDelete', { id: r.id }); toast('삭제했습니다.'); await renderRules(root); });
      });
      var scope = r.scope === '기본' ? '기본(모든 계약)' : r.scope + ': ' + r.scopeValue;
      return h('tr', { class: r.active ? '' : 'muted' }, h('td', null, h('strong', null, scope), r.feeBasis ? [' ', h('span', { class: 'badge' }, '수수료기준 ' + r.feeBasis)] : null),
        h('td', null, won(r.staffAmount)), h('td', null, won(r.leaderAmount)), h('td', null, won(r.headAmount)),
        h('td', null, r.payMode === '본부장일괄' ? '본부장 일괄 (' + won(r.staffAmount + r.leaderAmount + r.headAmount) + ')' : '구분 지급'),
        h('td', null, r.dateFrom || r.dateTo ? (r.dateFrom || '처음') + ' ~ ' + (r.dateTo || '계속') : '제한 없음'),
        h('td', null, r.active ? '사용' : '중지'), h('td', null, edit, ' ', del));
    });
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '수수료 규칙 ', add),
      h('p', { class: 'muted' }, '계약 1건마다 직원·팀장·본부장에게 정액을 발생시킵니다. 한 계약에 여러 규칙이 맞으면 동호 > 동 > 타입 > 기본 순으로 하나만 적용하고, 같은 범위에서는 "수수료기준"을 지정한 규칙이 먼저입니다. 팀장·본부장이 직접 계약하면 본인 몫(직원)과 본인 직급 몫을 모두 받고, 본부장이 직접 계약하면 팀장 몫은 없습니다.'),
      simpleTable(['적용 범위', '직원 몫', '팀장 몫', '본부장 몫', '지급 방식', '계약일 기간', '상태', ''], rows)));
  }

  function openRule(r, res, root) {
    var scope = h('select', null, ['기본', '타입', '동', '동호'].map(function (x) { return option(x, x === '기본' ? '기본 (모든 계약)' : x, r ? r.scope === x : x === '기본'); }));
    var value = h('input', { type: 'text', value: r ? r.scopeValue : '', placeholder: '' });
    var typeSel = h('select', null, option('', '타입 선택'), res.types.map(function (x) { return option(x, x, r && r.scope === '타입' && r.scopeValue === x); }));
    var dongSel = h('select', null, option('', '동 선택'), res.dongs.map(function (x) { return option(x, x + '동', r && r.scope === '동' && r.scopeValue === x); }));
    var valField = field('범위 값', value, '');
    var typeField = field('타입', typeSel), dongField = field('동', dongSel);
    function syncScope() {
      valField.classList.toggle('hidden', scope.value !== '동호');
      typeField.classList.toggle('hidden', scope.value !== '타입');
      dongField.classList.toggle('hidden', scope.value !== '동');
      var lab = valField.querySelector('.field-label');
      if (lab) lab.textContent = '동호 목록 (쉼표로 구분, 예: 101-1203, 101-1204)';
    }
    scope.addEventListener('change', syncScope);
    syncScope();
    var basis = h('input', { type: 'text', value: r ? r.feeBasis : '', maxLength: 20, placeholder: '비우면 전체 (계약앱의 수수료기준 값, 예: 조직 / 일반)' });
    basis.setAttribute('list', 'fee-basis-list');
    var bl = h('datalist', { id: 'fee-basis-list' }, res.feeBases.map(function (x) { return h('option', { value: x }); }));
    var staff = h('input', { type: 'number', min: 0, step: 1000, value: r ? r.staffAmount : '' });
    var leader = h('input', { type: 'number', min: 0, step: 1000, value: r ? r.leaderAmount : '' });
    var head = h('input', { type: 'number', min: 0, step: 1000, value: r ? r.headAmount : '' });
    var mode = h('select', null, option('구분', '구분 지급 (직원·팀장·본부장에게 각각)', !r || r.payMode === '구분'), option('본부장일괄', '본부장 일괄 (세 몫을 합쳐 본부장에게)', r && r.payMode === '본부장일괄'));
    var df = h('input', { type: 'date', value: r ? r.dateFrom : '', style: DATE_STYLE });
    var dt = h('input', { type: 'date', value: r ? r.dateTo : '', style: DATE_STYLE });
    var active = h('select', null, option('Y', '사용', !r || r.active), option('N', '사용 중지', r && !r.active));
    var memo = h('input', { type: 'text', maxLength: 100, value: r ? r.memo : '' });
    modal(r ? '수수료 규칙 수정' : '수수료 규칙 추가', h('div', null,
      field('적용 범위', scope), typeField, dongField, valField, field('수수료기준 조건', basis, ''), bl,
      field('직원 몫 (원)', staff), field('팀장 몫 (원)', leader), field('본부장 몫 (원)', head), field('지급 방식', mode),
      field('계약일 시작', df, '비우면 제한 없음. 판매 시점·차수마다 금액이 다를 때 씁니다.'), field('계약일 종료', dt), field('상태', active), field('메모', memo)), [{
      label: '저장', primary: true, onClick: async function (close) {
        var v = scope.value === '타입' ? typeSel.value : scope.value === '동' ? dongSel.value : value.value;
        await Api.call('fee.ruleSave', { id: r ? r.id : '', scope: scope.value, scopeValue: v, feeBasis: basis.value, staffAmount: Number(staff.value || 0), leaderAmount: Number(leader.value || 0), headAmount: Number(head.value || 0),
          payMode: mode.value, dateFrom: df.value, dateTo: dt.value, active: active.value === 'Y', memo: memo.value });
        close(); await renderRules(root); toast('저장했습니다.');
      }
    }]);
  }

  // ====================================================================
  // 해약 · 환수
  // ====================================================================
  async function renderCancel(root) {
    var res = await Api.call('fee.cancelList');
    root.innerHTML = '';
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '해약된 계약의 수수료'),
      h('p', { class: 'muted' }, '이미 지급한 수수료의 계약이 해약되면 여기에 나타납니다. 처리 방법을 고르세요. [환수]는 다음 정산에서 받은 사람의 지급액에서 차감합니다. [재판매 대기]는 같은 호실을 원 담당자가 ' + res.months + '개월 안에 다시 계약하면 환수하지 않고(새 계약의 수수료도 다시 주지 않음), 다른 직원이 재판매하거나 기한이 지나면 자동으로 환수합니다.')));
    var rows = res.pending.map(function (g) {
      var decided = g.decision === '환수' ? h('span', { class: 'badge warn' }, g.deducted ? '차감됨' : '환수 (다음 정산에서 차감)') : g.decision === '재판매대기' ? h('span', { class: 'badge' }, '재판매 대기 ~ ' + g.resaleUntil) : h('span', { class: 'badge warn' }, '결정 필요');
      var cells = [];
      if (g.decision !== '환수') {
        var refund = h('button', { type: 'button', class: 'btn small danger' }, '환수');
        refund.addEventListener('click', function () {
          if (!confirm(g.dongho + ' 의 수수료 ' + won(-g.total) + ' 을(를) 다음 정산에서 차감합니다. 계속할까요?')) return;
          runBusy(refund, async function () { await Api.call('fee.cancelDecide', { contractId: g.contractId, decision: '환수' }); await renderCancel(root); toast('환수로 결정했습니다.'); });
        });
        cells.push(refund, ' ');
        if (g.decision !== '재판매대기') {
          var wait = h('button', { type: 'button', class: 'btn small' }, '재판매 대기');
          wait.addEventListener('click', function () {
            runBusy(wait, async function () { var x = await Api.call('fee.cancelDecide', { contractId: g.contractId, decision: '재판매대기' }); await renderCancel(root); toast('재판매 대기로 두었습니다. 기한: ' + x.resaleUntil); });
          });
          cells.push(wait);
        }
      }
      return h('tr', null, h('td', null, h('strong', null, g.dongho)), h('td', null, g.customer), h('td', null, g.owner), h('td', null, g.cancelDate),
        h('td', null, g.lines.map(function (l) { return h('div', null, l.staffName + ' (' + (ROLE_TEXT[l.role] || l.role) + ') ' + won(l.amount)); })),
        h('td', null, h('strong', null, won(g.total))), h('td', null, decided), h('td', null, cells));
    });
    root.appendChild(simpleTable(['동호', '고객', '원 담당자', '해약일', '환수 대상', '합계', '상태', ''], rows));
    var hist = res.history.map(function (x) { return h('tr', null, h('td', null, x.dongho), h('td', null, x.staffName + ' (' + (ROLE_TEXT[x.role] || x.role) + ')'), h('td', null, won(x.amount)), h('td', null, x.state), h('td', { class: 'muted' }, x.note)); });
    root.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '처리된 환수 (최근)'), simpleTable(['동호', '받은 사람', '금액', '상태', '메모'], hist)));
  }

  // ====================================================================
  // 합산 명세: 기간 안에 확정된 일급 + 수수료를 사람별로
  // ====================================================================
  var stRange = { from: '', to: '' };

  async function renderStatement(root) {
    var now = new Date();
    stRange.from = stRange.from || ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1));
    stRange.to = stRange.to || ymd(new Date(now.getFullYear(), now.getMonth(), 0));
    root.innerHTML = '';
    var from = h('input', { type: 'date', value: stRange.from, style: DATE_STYLE });
    var to = h('input', { type: 'date', value: stRange.to, style: DATE_STYLE });
    var go = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    var box = h('div');
    go.addEventListener('click', function () { stRange = { from: from.value, to: to.value }; runBusy(go, function () { return load(box); }); });
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '합산 명세'), h('p', { class: 'muted' }, '회차의 종료일이 이 기간 안이고 확정(또는 지급완료)된 일급·수수료 정산을 사람별로 합칩니다.'),
      h('div', { class: 'toolbar' }, from, '~', to, go)));
    root.appendChild(box);
    await load(box);
  }

  async function load(box) {
    var res = await Api.call('pay.statement', stRange);
    box.innerHTML = '';
    var t = res.totals;
    var csvBtn = h('button', { type: 'button', class: 'btn small' }, 'CSV 다운로드');
    csvBtn.addEventListener('click', function () {
      downloadCsv('합산명세_' + stRange.from + '_' + stRange.to + '.csv', [['성명', '일급 지급액', '일급 실지급', '수수료 지급액', '수수료 실지급', '합계 지급액', '공제', '합계 실지급', '비고']].concat(res.people.map(function (p) {
        return [p.name, p.daily.gross, p.daily.net, p.fee.gross, p.fee.net, p.total.gross, p.total.tax, p.total.net, p.supplier ? '업체 ' + p.supplier + ' 일괄 포함' : ''];
      })));
    });
    box.appendChild(h('div', { class: 'summary' }, Hub.statCard('일급 지급액', won(t.daily.gross)), Hub.statCard('수수료 지급액', won(t.fee.gross)), Hub.statCard('합계 지급액', won(t.total.gross)), Hub.statCard('공제 합계', won(t.total.tax)), Hub.statCard('개인 실지급액', won(t.total.net))));
    box.appendChild(h('div', { class: 'toolbar' }, csvBtn));
    box.appendChild(simpleTable(['성명', '일급', '수수료', '합계 지급액', '공제', '실지급액', '비고'], res.people.map(function (p) {
      return h('tr', null, h('td', null, h('strong', null, p.name)), h('td', null, won(p.daily.gross)), h('td', null, won(p.fee.gross)), h('td', null, won(p.total.gross)), h('td', null, won(p.total.tax)),
        h('td', null, h('strong', null, won(p.total.net))), h('td', { class: 'muted' }, p.supplier ? '업체 ' + p.supplier + ' 일괄분은 공급가로 포함' : ''));
    })));
  }

  Hub.section('feerules', { render: renderRules });
  Hub.section('feecancel', { render: renderCancel });
  Hub.section('paystatement', { render: renderStatement });
})();
