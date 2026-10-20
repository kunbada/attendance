// 프로젝트(현장): 목록, 만들기·수정(관리자 전용). 보조관리자는 담당 현장만 보인다.
(function () {
  var STATUS_BADGE = { '준비': 'warn', '진행': 'ok', '종료': '' };
  var root = null;

  async function render(r) {
    root = r;
    await Hub.reloadProjects();
    root.innerHTML = '';
    var head = h('div', { class: 'toolbar' }, h('strong', null, '프로젝트 (' + Hub.state.projects.length + ')'));
    if (Hub.isAdmin()) {
      var add = h('button', { type: 'button', class: 'btn small primary' }, '+ 새 프로젝트');
      add.addEventListener('click', function () { openForm(null); });
      head.appendChild(add);
    }
    root.appendChild(head);
    if (!Hub.state.projects.length) root.appendChild(h('div', { class: 'card' }, h('p', { class: 'muted' }, '아직 프로젝트가 없습니다. [+ 새 프로젝트]로 첫 현장을 만들어 주세요.')));
    Hub.state.projects.forEach(function (p) { root.appendChild(card(p)); });
  }

  function card(p) {
    var cur = p.id === Api.getProject();
    var actions = h('div');
    var open = h('button', { type: 'button', class: 'btn small' + (cur ? '' : ' primary') }, cur ? '선택됨' : '이 현장 선택');
    open.disabled = cur;
    open.addEventListener('click', function () {
      Api.setProject(p.id);
      Hub.state.staff = []; Hub.state.orgs = []; Hub.state.settings = {};
      document.getElementById('project-select').value = p.id;
      document.getElementById('project-select').dispatchEvent(new Event('change'));
    });
    actions.appendChild(open);
    if (Hub.isAdmin()) {
      var edit = h('button', { type: 'button', class: 'btn small' }, '수정');
      edit.addEventListener('click', function () { openForm(p); });
      actions.appendChild(document.createTextNode(' '));
      actions.appendChild(edit);
    }
    var meta = [p.kind, p.client, p.address, (p.startDate || p.endDate) ? (p.startDate || '') + ' ~ ' + (p.endDate || '') : ''].filter(Boolean).join(' · ');
    return h('div', { class: 'card project-card' },
      h('div', null,
        h('h3', { style: 'margin:0 0 4px' }, p.name + ' ', h('span', { class: 'badge ' + STATUS_BADGE[p.status] }, p.status)),
        h('div', { class: 'meta' }, meta || '(상세 정보 없음)'),
        h('div', { class: 'meta' }, '활동 ' + p.activeStaff + '명 · 승인 대기 ' + p.pendingStaff + '명 · 가입 코드 ' + p.code)),
      actions);
  }

  function openForm(p) {
    var name = h('input', { type: 'text', value: p ? p.name : '', maxLength: 40 });
    var code = h('input', { type: 'text', value: p ? p.code : '', maxLength: 20, placeholder: '비워 두면 자동 생성' });
    var kind = h('input', { type: 'text', value: p ? p.kind : '', maxLength: 20, list: 'kind-list', placeholder: 'APT, 오피스텔, 상가, 임대 …' });
    var kindList = h('datalist', { id: 'kind-list' }, ['APT', '오피스텔', '상가', '임대', '지식산업센터', '기타'].map(function (k) { return h('option', { value: k }); }));
    var client = h('input', { type: 'text', value: p ? p.client : '', maxLength: 60, placeholder: '시행사·시공사' });
    var address = h('input', { type: 'text', value: p ? p.address : '', maxLength: 100 });
    var status = h('select', null, ['준비', '진행', '종료'].map(function (s) { return option(s, s, (p ? p.status : '준비') === s); }));
    var start = h('input', { type: 'date', value: p ? p.startDate : '' });
    var end = h('input', { type: 'date', value: p ? p.endDate : '' });
    var money = h('select', null, ['분양가', '임대보증금'].map(function (s) { return option(s, s, (p ? p.moneyLabel : '분양가') === s); }));
    var codeHint = p ? '직원 가입 링크에 쓰이는 코드입니다. 바꾸면 이미 보낸 가입 링크는 쓸 수 없게 됩니다.' : '직원 가입 링크에 쓰이는 영문 소문자·숫자 3~20자 코드입니다.';
    modal(p ? '프로젝트 수정' : '새 프로젝트', h('div', null, field('현장 이름', name), field('현장 코드', code, codeHint), field('유형', kind), kindList, field('시행·시공사', client), field('주소', address),
      field('상태', status, '종료하면 새 직원 가입을 받지 않습니다.'), field('시작일', start), field('종료일', end), field('금액 명칭', money, '분양 현장은 분양가, 임대 현장은 임대보증금')), [{
        label: '저장', primary: true, onClick: async function (close) {
          var res = await Api.call('project.save', {
            id: p ? p.id : '', name: name.value, code: code.value, kind: kind.value, client: client.value, address: address.value,
            status: status.value, startDate: start.value, endDate: end.value, moneyLabel: money.value
          });
          close();
          await Hub.reloadProjects();
          if (!p && !Api.getProject()) { Api.setProject(res.id); document.getElementById('project-select').value = res.id; document.getElementById('project-select').dispatchEvent(new Event('change')); }
          await render(root);
          toast(p ? '저장했습니다.' : '프로젝트를 만들었습니다. 기본 직군이 함께 만들어졌습니다. [인력 > 조직]에서 본부·팀을 추가해 주세요.');
        }
      }]);
  }

  Hub.register({ key: 'projects', label: '프로젝트', needsProject: false, render: render });
})();
