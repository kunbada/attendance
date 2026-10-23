// 계약관리: 계약앱 현황 요약, 계약 담당자 ↔ 직원 매칭 (계약앱 자체는 ../contract/ 에서 쓴다)
(function () {
  var simpleTable = Hub.simpleTable, statCard = Hub.statCard;
  var num = function (n) { return Number(n || 0).toLocaleString('ko-KR'); };
  var pct = function (a, b) { return b ? (a / b * 100).toFixed(1) + '%' : '-'; };

  function appLink() {
    var a = h('a', { class: 'btn small primary', href: '../contract/', target: '_blank', rel: 'noopener' }, '계약앱 열기 ↗');
    return a;
  }

  async function renderSummary(root) {
    root.innerHTML = '';
    var s = (await Api.call('contract.summary')) || {};
    var label = s.moneyLabel || '분양대금';
    var refresh = h('button', { type: 'button', class: 'btn small' }, '새로 고침');
    refresh.addEventListener('click', function () { runBusy(refresh, function () { return renderSummary(root); }); });
    root.appendChild(h('div', { class: 'toolbar' }, appLink(), refresh,
      h('span', { class: 'muted' }, '기준일 ' + s.asOf + ' · 계약앱의 대시보드와 같은 계산입니다. 입력·수정은 계약앱에서 합니다.')));
    if (!s.units) {
      root.appendChild(h('div', { class: 'card' }, h('h2', null, '아직 계약 데이터가 없습니다'),
        h('p', { class: 'muted' }, '계약앱을 열어 로그인한 뒤, 설정에서 기존 백업 파일을 불러와 서버에 올리면 여기에 나타납니다.')));
      return;
    }
    root.appendChild(h('div', { class: 'summary' },
      statCard('총 세대', num(s.units)),
      statCard('계약', num(s.contract), '계약률 ' + s.contractRate + '%'),
      statCard('가계약', num(s.pre), '가계약 포함 ' + s.withPreRate + '%'),
      statCard('잠금', num(s.lock)),
      statCard('잔여', num(s.remain)),
      statCard('오늘 계약', num(s.todayContracts) + '건'),
      statCard('총 수납액 (' + label + ')', num(s.totalIn) + '원', '오늘 입금 ' + num(s.todayDeposits) + '건 · ' + num(s.todayDepositAmount) + '원'),
      statCard('미분류 입금', num(s.unclassified) + '건', s.unclassified ? '계약앱에서 구분을 지정해 주세요' : '')));

    root.appendChild(h('div', { class: 'card' }, h('h2', null, '회차별 납부 (계약 세대 기준)'),
      simpleTable(['회차', '납부기한', '대상', '완납', '일부납', '미납', '약정액', '수납액', '수납률'], (s.stages || []).map(function (r) {
        return h('tr', null, h('td', null, r.stage + (r.active ? '' : ' (예정)')), h('td', null, r.due || '-'), h('td', null, num(r.targets)), h('td', null, num(r.done)),
          h('td', null, num(r.part)), h('td', null, num(r.none)), h('td', null, num(r.req)), h('td', null, num(r.paid)), h('td', null, pct(r.paid, r.req)));
      }))));

    root.appendChild(h('div', { class: 'card' }, h('h2', null, '타입별 현황'),
      simpleTable(['타입', '세대', '계약', '가계약', '잠금', '계약률'], (s.types || []).map(function (t) {
        return h('tr', null, h('td', null, t.type || '-'), h('td', null, num(t.supply)), h('td', null, num(t.contract)), h('td', null, num(t.pre)), h('td', null, num(t.lock)), h('td', null, pct(t.contract, t.supply)));
      }))));
  }

  var onlyUnlinked = true;

  async function renderMatch(root) {
    root.innerHTML = '';
    var d = await Api.call('contract.matchList');
    var groups = d.groups || [], staff = d.staff || [];
    var staffText = function (x) { return x.name + (x.nickname ? ' (' + x.nickname + ')' : '') + ' · ' + (x.head || '') + ' ' + (x.team || '') + (x.status !== '활동' ? ' [' + x.status + ']' : ''); };

    var chk = h('input', { type: 'checkbox' });
    chk.checked = onlyUnlinked;
    chk.addEventListener('change', function () { onlyUnlinked = chk.checked; runBusy(null, function () { return renderMatch(root); }); });
    var auto = h('button', { type: 'button', class: 'btn small primary' }, '추천 일괄 연결 (후보가 1명인 것만)');
    auto.addEventListener('click', function () {
      var todo = groups.filter(function (g) { return g.unlinked > 0 && g.suggestions.length === 1; });
      if (!todo.length) { toast('후보가 1명인 미연결 항목이 없습니다.', true); return; }
      if (!confirm(todo.length + '개 묶음(' + todo.reduce(function (a, g) { return a + g.unlinked; }, 0) + '건)을 추천 직원으로 연결합니다. 진행할까요?')) return;
      runBusy(auto, async function () {
        var n = 0;
        for (var i = 0; i < todo.length; i++) {
          var r = await Api.call('contract.matchSave', { team: todo[i].team, staff: todo[i].staff, staffId: todo[i].suggestions[0].id });
          n += r.updated;
        }
        toast(n + '건 연결했습니다.');
        await renderMatch(root);
      });
    });
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '계약 담당자 ↔ 직원 연결'),
      h('p', { class: 'muted' }, '계약앱의 팀·담당자는 글자로만 적혀 있습니다. 직원과 연결해 두면 수수료 계산(5단계)의 기준이 됩니다. 같은 팀·담당자 글자의 계약은 한꺼번에 연결됩니다. 계약 1건의 담당자는 한 명입니다.'),
      h('div', { class: 'toolbar' }, h('label', null, chk, ' 미연결만 보기'), auto,
        h('span', { class: 'muted' }, '연결 ' + num(d.linked) + ' / 전체 계약 ' + num(d.total) + '건'))));

    var shown = groups.filter(function (g) { return !onlyUnlinked || g.unlinked > 0; });
    var rows = shown.map(function (g) {
      var sel = h('select');
      sel.appendChild(option('', '(직원 선택)'));
      var sugIds = {};
      g.suggestions.forEach(function (x) { sugIds[x.id] = 1; sel.appendChild(option(x.id, '★ ' + staffText(x), g.linkedStaff.length === 1 && g.linkedStaff[0].id === x.id)); });
      staff.filter(function (x) { return !sugIds[x.id]; }).forEach(function (x) { sel.appendChild(option(x.id, staffText(x), g.linkedStaff.length === 1 && g.linkedStaff[0].id === x.id)); });
      var save = h('button', { type: 'button', class: 'btn small primary' }, '연결');
      save.addEventListener('click', function () {
        if (!sel.value) { toast('직원을 선택해 주세요.', true); return; }
        runBusy(save, async function () {
          var r = await Api.call('contract.matchSave', { team: g.team, staff: g.staff, staffId: sel.value });
          toast(r.updated + '건 연결했습니다.' + (r.failed ? ' (' + r.failed + '건은 동시에 수정 중이라 건너뜀, 다시 눌러 주세요)' : ''));
          await renderMatch(root);
        });
      });
      var cut = h('button', { type: 'button', class: 'btn small' }, '해제');
      cut.addEventListener('click', function () {
        runBusy(cut, async function () {
          var r = await Api.call('contract.matchSave', { team: g.team, staff: g.staff, staffId: '' });
          toast(r.updated + '건 연결을 풀었습니다.');
          await renderMatch(root);
        });
      });
      var state = g.linkedStaff.length ? g.linkedStaff.map(function (x) { return x.name; }).join(', ') + (g.unlinked ? ' (미연결 ' + g.unlinked + '건 남음)' : '') : '미연결';
      return h('tr', null, h('td', null, g.team || '-'), h('td', null, g.staff || '(비어 있음)'), h('td', null, num(g.total)), h('td', null, state), h('td', null, sel), h('td', null, save, ' ', g.linked ? cut : ''));
    });
    root.appendChild(h('div', { class: 'card' }, simpleTable(['팀(계약앱 글자)', '담당자(계약앱 글자)', '계약 수', '연결 상태', '직원', ''], rows)));
  }

  Hub.section('contract-summary', { render: renderSummary });
  Hub.section('contract-match', { render: renderMatch });
})();
