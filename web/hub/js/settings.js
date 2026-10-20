// 설정: 선택한 현장의 기본 설정(관리자만 변경), 전체 계정·권한(관리자 전용)
(function () {
  var state = Hub.state;
  var ROLES = [
    ['관리자', '관리자 — 모든 현장'],
    ['보조관리자', '보조관리자 — 지정한 현장만'],
    ['계약담당', '계약담당 — 지정한 현장의 계약 입력 (계약 연동 단계에서 사용)'],
    ['열람', '열람 — 지정한 현장의 조회 전용 (레포트 단계에서 사용)'],
    ['데스크', '데스크 — 현장 1개에 고정'],
    ['방명록', '방명록 — 고객 입력 태블릿, 현장 1개에 고정']
  ];
  var FIXED = ['데스크', '방명록'];
  var NEEDS_PROJECT = ['보조관리자', '계약담당', '열람'];
  var root = null;

  async function render(r) {
    root = r;
    var calls = [Api.call('admin.settings')];
    if (Hub.isAdmin()) calls.push(Api.call('admin.accounts'));
    var results = await Promise.all(calls);
    state.settings = results[0].settings;
    state.accounts = results[1] ? results[1].accounts : [];
    root.innerHTML = '';
    root.appendChild(basicSettingsCard());
    if (Hub.isAdmin()) root.appendChild(accountsCard());
  }

  function basicSettingsCard() {
    var st = state.settings;
    var canEdit = Hub.isAdmin();
    var dist = h('input', { type: 'number', value: st['GPS허용거리m'] || '200', min: 10, max: 5000, disabled: !canEdit });
    var dup = h('select', { disabled: !canEdit }, option('뒤5자리', '뒤5자리', st['예약중복기준'] === '뒤5자리'), option('뒤5자리+성별', '뒤5자리 + 성별', st['예약중복기준'] === '뒤5자리+성별'));
    var bot = h('input', { type: 'text', value: st['텔레그램봇이름'] || '', placeholder: 'my_site_bot', disabled: !canEdit });
    var save = h('button', { type: 'button', class: 'btn primary', style: 'max-width:200px' }, '저장');
    save.addEventListener('click', function () {
      runBusy(save, async function () {
        await Api.call('admin.saveSettings', { values: { 'GPS허용거리m': dist.value, '예약중복기준': dup.value, '텔레그램봇이름': bot.value } });
        toast('설정을 저장했습니다.');
      });
    });
    var p = Hub.currentProject();
    return h('div', { class: 'card' }, h('h2', null, '현장 설정 — ' + (p ? p.name : '')),
      canEdit ? null : h('p', { class: 'muted' }, '설정 변경은 관리자만 할 수 있습니다.'),
      field('GPS 허용거리 (m)', dist, '출근 QR 기준점에서 이 거리 안에서만 출근 인정 (이 현장에만 적용)'),
      field('예약 중복 기준', dup, '같은 고객의 중복 예약을 막는 기준 (이 현장에만 적용)'),
      field('텔레그램 봇 이름', bot, '@ 없이. 직원 호출 알림에 사용. 모든 현장이 같은 봇을 씁니다.'),
      canEdit ? save : null);
  }

  // ----- 계정 -----
  function projectName(id) {
    var p = state.projects.filter(function (x) { return x.id === id; })[0];
    return p ? p.name : id;
  }

  function accountsCard() {
    var addBtn = h('button', { type: 'button', class: 'btn small' }, '+ 계정 추가');
    addBtn.addEventListener('click', function () { openAccountForm(null); });
    var tbody = h('tbody', null, state.accounts.map(function (a) {
      var editBtn = h('button', { type: 'button', class: 'btn small' }, '수정 / 비밀번호 재설정');
      editBtn.addEventListener('click', function () { openAccountForm(a); });
      var badges = [h('span', { class: 'badge ' + (a.active ? 'ok' : '') }, a.active ? '사용' : '중지')];
      if (a.locked) badges.push(' ', h('span', { class: 'badge danger' }, '잠김'));
      var scope = a.role === '관리자' ? '모든 현장' : a.projectIds.map(projectName).join(', ');
      var perms = [];
      if (a.allowPayroll) perms.push('급여 원문 보기');
      if (a.allowPayConfirm) perms.push('지급 확정');
      return h('tr', null, h('td', null, a.loginId), h('td', null, a.name), h('td', null, a.role), h('td', null, scope),
        h('td', { class: 'muted' }, perms.join(', ') || (a.role === '관리자' ? (a.email || '이메일 없음') : '')), h('td', null, badges), h('td', null, editBtn));
    }));
    return h('div', { class: 'card' }, h('h2', null, '계정 ', addBtn),
      h('p', { class: 'muted' }, '관리자·보조관리자·데스크·방명록 계정입니다. 비밀번호를 새로 정하면 상대방이 첫 로그인 때 직접 바꾸게 되고, 잠김도 풀립니다. 담당 현장을 바꾸면 바로 적용됩니다.'),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['아이디', '이름', '역할', '담당 현장', '권한 / 이메일', '상태', ''].map(function (t) { return h('th', null, t); }))), tbody)));
  }

  function openAccountForm(a) {
    var loginId = h('input', { type: 'text', value: a ? a.loginId : '', autocomplete: 'off' });
    var name = h('input', { type: 'text', value: a ? a.name : '' });
    var role = h('select', null, ROLES.map(function (r) { return option(r[0], r[1], a ? a.role === r[0] : r[0] === '보조관리자'); }));
    var pw = h('input', { type: 'text', autocomplete: 'off', placeholder: a ? '바꾸지 않으려면 비워 두세요' : '8자 이상, 영문+숫자' });
    var email = h('input', { type: 'text', autocomplete: 'off', value: a ? a.email : '', placeholder: 'name@example.com' });
    var emailField = field('이메일 (비밀번호 초기화 인증 코드를 받는 주소)', email, '관리자 계정만 입력합니다. 비밀번호를 잊었을 때 로그인 화면의 [비밀번호를 잊으셨나요?]에서 이 주소로 인증 코드가 갑니다.');
    var active = h('select', null, option('Y', '사용', !a || a.active), option('N', '사용 중지', a && !a.active));

    // 담당 현장: 데스크·방명록은 1개(라디오), 보조관리자 등은 여러 개(체크박스), 관리자는 전체라 지정 없음
    var projectBox = h('div');
    var selected = {};
    ((a && a.projectIds) || []).forEach(function (id) { selected[id] = true; });
    function drawProjects() {
      var fixed = FIXED.indexOf(role.value) >= 0;
      projectBox.innerHTML = '';
      projectField.classList.toggle('hidden', role.value === '관리자');
      var ids = Object.keys(selected).filter(function (k) { return selected[k]; });
      if (fixed && ids.length > 1) { selected = {}; selected[ids[0]] = true; } // 1개 고정 역할로 바꾸면 첫 현장만 남긴다
      state.projects.forEach(function (p) {
        var input = h('input', { type: fixed ? 'radio' : 'checkbox', name: 'acc-project', checked: !!selected[p.id] });
        input.addEventListener('change', function () {
          if (fixed) selected = {};
          selected[p.id] = input.checked;
        });
        projectBox.appendChild(h('label', { class: 'check' }, input, ' ' + p.name + (p.status === '종료' ? ' (종료)' : '')));
      });
    }
    var projectField = h('div', { class: 'field' }, h('span', { class: 'field-label' }, '담당 현장'), projectBox); // 라벨 안에 라벨을 넣지 않으려고 div

    var allowPayroll = h('input', { type: 'checkbox', checked: !!(a && a.allowPayroll) });
    var allowConfirm = h('input', { type: 'checkbox', checked: !!(a && a.allowPayConfirm) });
    var permBox = h('div', null,
      h('label', { class: 'check' }, allowPayroll, ' 급여정보(주민번호·계좌) 원문 보기 허용 — 열람할 때마다 기록됩니다'),
      h('label', { class: 'check' }, allowConfirm, ' 지급 확정 허용 (지급 기능 단계에서 사용)'));

    function sync() {
      emailField.classList.toggle('hidden', role.value !== '관리자');
      permBox.classList.toggle('hidden', role.value !== '보조관리자');
      drawProjects();
    }
    role.addEventListener('change', sync);
    sync();

    modal(a ? '계정 수정' : '계정 추가', h('div', null, field('아이디', loginId), field('이름', name), field('역할', role), projectField, permBox,
      field(a ? '새 비밀번호 (선택)' : '임시 비밀번호', pw, '직접 전달해 주세요. 방명록 태블릿 계정을 뺀 나머지는 첫 로그인 때 바꾸게 됩니다.'), emailField, field('상태', active)), [
      {
        label: '저장', primary: true, onClick: async function (close) {
          var ids = Object.keys(selected).filter(function (k) { return selected[k]; });
          if (NEEDS_PROJECT.indexOf(role.value) >= 0 && !ids.length) throw new Error('담당 현장을 1개 이상 선택해 주세요.');
          await Api.call('admin.saveAccount', {
            id: a ? a.id : '', loginId: loginId.value, name: name.value, role: role.value, password: pw.value, active: active.value === 'Y', email: email.value,
            projectIds: role.value === '관리자' ? [] : ids, allowPayroll: allowPayroll.checked, allowPayConfirm: allowConfirm.checked
          });
          close(); await render(root); toast('저장했습니다.');
        }
      }]);
  }

  Hub.register({ key: 'settings', label: '설정', render: render });
})();
