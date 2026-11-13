// 고객관리 > 상담고객: 상담고객 앱에서 상담사가 등록·상담한 고객 모음 (상담사별 현황, 중복 상담, 담당 변경은 고객 상세에서)
(function () {
  var simpleTable = Hub.simpleTable;
  var GRADE_BADGE = { A: 'danger', B: 'warn', C: 'ok', D: '' };
  var F = { q: '', ownerId: '', grade: '', rank: '', duplicate: false };

  async function render(root) {
    var r = await Api.call('counsel.adminList', F);
    var again = function () { return render(root); };
    root.innerHTML = '';
    var appLink = h('a', { class: 'btn small primary', href: '../counsel.html', target: '_blank', rel: 'noopener' }, '상담고객 앱 열기 ↗');
    root.appendChild(h('div', { class: 'toolbar' }, h('strong', null, '상담고객 ' + r.total + '명'), appLink,
      h('span', { class: 'muted' }, '상담사가 상담고객 앱(PC)에서 등록·상담한 고객입니다. 고객 DB 에도 "상담" 경로로 합쳐집니다. 이번 달 상담 ' + r.summary.monthNotes + '건 · 중복 ' + r.summary.duplicate + '명 · 담당 없음 ' + r.summary.unowned + '명')));

    // 상담사별 현황
    root.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '상담사별 현황'),
      r.perStaff.length ? simpleTable(['상담사', '담당 고객', 'A·B 등급', '이번 달 상담', '전체 상담', ''], r.perStaff.map(function (p) {
        var b = h('button', { type: 'button', class: 'btn small' }, '이 상담사 고객');
        b.addEventListener('click', function () { F.ownerId = p.id; runBusy(b, again); });
        return h('tr', null, h('td', null, h('strong', null, p.name)), h('td', null, p.owned + '명'), h('td', null, p.ab + '명'), h('td', null, p.month + '건'), h('td', null, p.notes + '건'), h('td', null, b));
      })) : h('p', { class: 'muted' }, '아직 상담 기록이 없습니다.')));

    // 조건
    var q = h('input', { type: 'search', value: F.q, placeholder: '이름 또는 전화 뒤 4자리' });
    var owner = h('select', null, option('', '담당 전체'), option('-', '담당 없음', F.ownerId === '-'), r.perStaff.map(function (p) { return option(p.id, p.name, F.ownerId === p.id); }));
    var grade = h('select', null, option('', '등급 전체'), ['A', 'B', 'C', 'D'].map(function (g) { return option(g, g + '등급', F.grade === g); }));
    var rank = h('select', null, option('', '청약 순위 전체'), r.ranks.map(function (x) { return option(x, x, F.rank === x); }));
    var dup = h('input', { type: 'checkbox', checked: F.duplicate });
    var run = function () { F = { q: q.value, ownerId: owner.value, grade: grade.value, rank: rank.value, duplicate: dup.checked }; return runBusy(null, again); };
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    [owner, grade, rank, dup].forEach(function (el) { el.addEventListener('change', run); });
    var reset = h('button', { type: 'button', class: 'btn small' }, '조건 지우기');
    reset.addEventListener('click', function () { F = { q: '', ownerId: '', grade: '', rank: '', duplicate: false }; runBusy(reset, again); });
    root.appendChild(h('div', { class: 'toolbar filterbar' }, q, owner, grade, rank, h('label', { class: 'check', style: 'margin:0' }, dup, ' 중복 상담만'), reset));

    var rows = r.customers.map(function (c) {
      var tr = h('tr', { class: 'clickable' },
        h('td', null, h('div', { class: 'cust-name' }, c.name || '(이름 없음)'), h('div', { class: 'cust-sub' }, c.phone)),
        h('td', null, c.grade ? h('span', { class: 'badge ' + GRADE_BADGE[c.grade] }, c.grade) : '-'),
        h('td', null, c.rank || '-', c.special ? h('div', { class: 'cust-sub' }, c.special) : null),
        h('td', null, c.interest || '-'),
        h('td', null, c.owner || h('span', { class: 'muted' }, '담당 없음')),
        h('td', null, c.counselors.join(', ') || '-', c.duplicate ? [' ', h('span', { class: 'badge warn' }, '중복')] : null),
        h('td', null, c.notes + '회'), h('td', null, String(c.last || '').slice(0, 10)));
      tr.addEventListener('click', function () { if (Hub.openCustomer) runBusy(null, function () { return Hub.openCustomer(c.id, again); }); });
      return tr;
    });
    root.appendChild(simpleTable(['고객', '등급', '청약 순위', '관심 평형', '담당', '상담한 상담사', '상담', '최근'], rows));
    root.appendChild(h('p', { class: 'muted' }, '줄을 누르면 고객 상세(고객 DB)가 열립니다. 담당 상담사를 바꾸거나 전체 이력을 볼 수 있습니다. 조건에 맞는 ' + r.matched + '명' + (r.matched > 500 ? ' 중 500명 표시' : '')));
  }

  Hub.section('counsel', { render: render });
})();
