// 고객관리 > 데이터통합관리: 같은 전화번호(해시)로 설문·방문 데이터를 한 고객으로 묶어 본다
(function () {
  var simpleTable = Hub.simpleTable, statCard = Hub.statCard;
  var filter = { q: '', stage: '전체' };
  var INTENT = { '1': '1점', '2': '2점', '3': '3점', '4': '4점', '5': '5점' };

  async function render(root) {
    var res = await Api.call('customer.list', { q: filter.q, stage: filter.stage });
    root.innerHTML = '';
    var f = res.funnel;
    var rate = f.highIntent ? Math.round(f.highIntentVisited / f.highIntent * 100) + '%' : '-';
    root.appendChild(h('div', { class: 'summary' },
      statCard('설문 고객', f.surveyCustomers + '명'), statCard('방문 고객', f.visitCustomers + '명'),
      statCard('설문+방문', f.both + '명'), statCard('의향 높음(4~5점)', f.highIntent + '명'),
      statCard('의향 높음 → 방문', f.highIntentVisited + '명', '전환 ' + rate)));
    root.appendChild(h('p', { class: 'muted' }, '개인정보에 동의하고 전화번호를 남긴 설문 응답과 방명록(방문)을 같은 전화번호로 묶었습니다. 동의하지 않은 응답은 여기에 나오지 않고 설문 통계에만 반영됩니다. 전화번호는 마스킹되어 보입니다.'));

    var q = h('input', { type: 'search', value: filter.q, placeholder: '이름 또는 전화번호 (3자리 이상)', style: 'max-width:240px' });
    var stage = h('select', null, ['전체', '설문+방문', '설문만', '방문만'].map(function (s) { return option(s, s, filter.stage === s); }));
    var go = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    function run() { filter = { q: q.value, stage: stage.value }; return runBusy(go, function () { return render(root); }); }
    go.addEventListener('click', run);
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    root.appendChild(h('div', { class: 'toolbar' }, q, stage, go, h('span', { class: 'muted' }, '묶인 고객 ' + res.total + '명 중 ' + res.shown + '명 표시')));

    var rows = res.customers.map(function (c) {
      var cls = c.stage === '설문+방문' ? 'ok' : c.stage === '설문만' ? 'warn' : '';
      return h('tr', null, h('td', null, h('strong', null, c.name || '(이름 없음)')), h('td', null, c.phone),
        h('td', null, h('span', { class: 'badge ' + cls }, c.stage)),
        h('td', null, c.surveys ? c.surveys + '회 · ' + c.lastSurveyAt.slice(0, 10) : '-'),
        h('td', null, c.intent ? (INTENT[c.intent] || c.intent) : '-'),
        h('td', null, c.visits ? c.visits + '회 · ' + c.lastVisit + (c.people > c.visits ? ' (동반 포함 ' + c.people + '명)' : '') : '-'));
    });
    root.appendChild(simpleTable(['이름', '전화번호', '구분', '설문', '분양 의향', '방문'], rows));
  }

  Hub.section('customers', { render: render });
})();
