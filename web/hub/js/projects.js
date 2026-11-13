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
    // 현장마다 주택형 요약 (설문·상담 앱의 관심 타입 기준표)
    var typeInfo = await Promise.all(Hub.state.projects.map(function (p) { return Api.call('project.typesGet', {}, { projectId: p.id }).catch(function () { return null; }); }));
    Hub.state.projects.forEach(function (p, i) { root.appendChild(card(p, typeInfo[i])); });
  }

  // 주택형·세대수 편집: 주택형(84A) · 타입군(84, 비우면 자동) · 전용면적 · 세대수. 순서 = 설문·상담 앱에 보이는 순서
  function openTypes(p, info) {
    var rows = (info && info.types || []).map(function (t) { return { code: t.code, grp: t.grp, area: t.area || '', units: t.units || '' }; });
    var used = (info && info.used) || {};
    var box = h('div'), total = h('strong');
    var guess = function (code) { var m = String(code || '').match(/^\d+(\.\d+)?/); return m ? m[0] : String(code || ''); };
    function draw() {
      box.innerHTML = '';
      var tbody = h('tbody', null, rows.map(function (r, i) {
        var code = h('input', { type: 'text', value: r.code, maxLength: 12, placeholder: '84A', style: 'width:100px' });
        var grp = h('input', { type: 'text', value: r.grp, maxLength: 12, placeholder: guess(r.code) || '84', style: 'width:80px' });
        var area = h('input', { type: 'number', value: r.area, step: '0.01', min: 0, placeholder: '84.97', style: 'width:100px' });
        var units = h('input', { type: 'number', value: r.units, min: 0, placeholder: '0', style: 'width:90px' });
        code.addEventListener('input', function () { r.code = code.value.toUpperCase(); grp.placeholder = guess(r.code); });
        grp.addEventListener('input', function () { r.grp = grp.value; });
        area.addEventListener('input', function () { r.area = area.value; });
        units.addEventListener('input', function () { r.units = units.value; sum(); });
        var mv = function (label, d) { var b = h('button', { type: 'button', class: 'btn small' }, label); b.addEventListener('click', function () { var j = i + d; if (j < 0 || j >= rows.length) return; var x = rows[i]; rows[i] = rows[j]; rows[j] = x; draw(); }); return b; };
        var del = h('button', { type: 'button', class: 'btn small danger' }, '✕');
        del.addEventListener('click', function () {
          if (used[r.code] && !confirm(r.code + ' 은(는) 고객 ' + used[r.code] + '명의 관심 타입에 쓰였습니다. 지워도 고객 기록은 남지만 통계에서 빠집니다. 지울까요?')) return;
          rows.splice(i, 1); draw();
        });
        return h('tr', null, h('td', null, code), h('td', null, grp), h('td', null, area), h('td', null, units), h('td', { class: 'muted' }, used[r.code] ? '고객 ' + used[r.code] : ''), h('td', null, mv('↑', -1), ' ', mv('↓', 1), ' ', del));
      }));
      box.appendChild(h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, ['주택형', '타입군', '전용면적(㎡)', '세대수', '사용', ''].map(function (x) { return h('th', null, x); }))), tbody)));
      sum();
    }
    function sum() { total.textContent = '합계 ' + rows.reduce(function (a, r) { return a + (Number(r.units) || 0); }, 0).toLocaleString('ko-KR') + '세대 · 주택형 ' + rows.length + '개'; }
    var add = h('button', { type: 'button', class: 'btn small' }, '+ 주택형 추가');
    add.addEventListener('click', function () { rows.push({ code: '', grp: '', area: '', units: '' }); draw(); });
    // 엑셀에서 복사한 "84A 120" 또는 "84A 84.97 120" 줄들을 한꺼번에
    var paste = h('textarea', { rows: 3, placeholder: '엑셀에서 붙여넣기 (한 줄에 하나: 주택형 [전용면적] 세대수)  예) 84A 84.97 120' });
    var pasteBtn = h('button', { type: 'button', class: 'btn small' }, '붙여넣은 줄 추가');
    pasteBtn.addEventListener('click', function () {
      paste.value.split(/\r?\n/).forEach(function (line) {
        var c = line.trim().split(/[\t ,]+/).filter(Boolean); if (!c.length) return;
        var r = { code: c[0].toUpperCase(), grp: '', area: c.length >= 3 ? c[1] : '', units: c.length >= 3 ? c[2] : (c[1] || '') };
        var ex = rows.filter(function (x) { return x.code === r.code; })[0];
        if (ex) Object.assign(ex, { area: r.area || ex.area, units: r.units || ex.units }); else rows.push(r);
      });
      paste.value = ''; draw();
    });
    draw();
    modal('주택형·세대수 — ' + p.name, h('div', null,
      h('p', { class: 'muted', style: 'margin-top:0' }, '설문(사전판촉)은 "타입군"만 묻고(예: 84타입), 상담고객 앱은 세부 주택형(84A·84B)까지 고릅니다. 고객 DB·통계는 타입군으로 묶어 셉니다. 계약관리(계약앱 세대표)와는 별개입니다. 타입군을 비워 두면 주택형 앞의 숫자로 정해집니다(84A → 84).'),
      box, h('div', { class: 'toolbar' }, add, total), h('div', { style: 'margin-top:8px' }, paste, pasteBtn)), [{
      label: '저장', primary: true, onClick: async function (close) {
        var list = rows.filter(function (r) { return String(r.code).trim(); }).map(function (r) { return { code: r.code, grp: r.grp, area: Number(r.area) || 0, units: Number(r.units) || 0 }; });
        await Api.call('project.typesSave', { types: list }, { projectId: p.id });
        close(); toast('저장했습니다. 설문의 관심 타입 보기와 상담고객 앱에 바로 반영됩니다.'); await render(root);
      }
    }], { wide: true });
  }

  function card(p, info) {
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
    var tbtn = h('button', { type: 'button', class: 'btn small' }, '주택형·세대수');
    tbtn.addEventListener('click', function () { runBusy(tbtn, async function () { openTypes(p, await Api.call('project.typesGet', {}, { projectId: p.id })); }); });
    actions.appendChild(document.createTextNode(' '));
    actions.appendChild(tbtn);
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
        h('div', { class: 'meta' }, '활동 ' + p.activeStaff + '명 · 승인 대기 ' + p.pendingStaff + '명 · 가입 코드 ' + p.code),
        h('div', { class: 'meta' }, '출근 허용거리 ' + p.gpsDistance + 'm · 예약 중복 기준 ' + (p.dupRule === '뒤5자리+성별' ? '뒤5자리 + 성별' : '뒤5자리')),
        h('div', { class: 'meta' }, info && info.types.length ? '주택형 ' + info.types.map(function (t) { return t.code + (t.units ? '(' + t.units + ')' : ''); }).join(' · ') + ' — 총 ' + info.totalUnits.toLocaleString('ko-KR') + '세대'
          : '주택형 미입력 — [주택형·세대수]에서 입력하면 설문·상담 앱의 관심 타입에 쓰입니다')),
      actions);
  }

  function openForm(p) {
    var name = h('input', { type: 'text', value: p ? p.name : '', maxLength: 40 });
    var code = h('input', { type: 'text', value: p ? p.code : '', maxLength: 20, placeholder: '비워 두면 자동 생성' });
    var kind = h('select', null, option('', '선택해 주세요'), ['아파트', '오피스텔', '상가', '기타'].map(function (k) { return option(k, k, p && p.kind === k); }));
    var client = h('input', { type: 'text', value: p ? p.client : '', maxLength: 60, placeholder: '시행사·시공사' });
    var address = h('input', { type: 'text', value: p ? p.address : '', maxLength: 100 });
    var status = h('select', null, ['준비', '진행', '종료'].map(function (s) { return option(s, s, (p ? p.status : '준비') === s); }));
    var start = h('input', { type: 'date', value: p ? p.startDate : '' });
    var end = h('input', { type: 'date', value: p ? p.endDate : '' });
    var gps = h('input', { type: 'number', value: p ? p.gpsDistance : 200, min: 10, max: 5000 });
    var dup = h('select', null, option('뒤5자리', '뒤5자리', !p || p.dupRule === '뒤5자리'), option('뒤5자리+성별', '뒤5자리 + 성별', p && p.dupRule === '뒤5자리+성별'));
    var money = h('select', null, ['분양가', '임대보증금'].map(function (s) { return option(s, s, (p ? p.moneyLabel : '분양가') === s); }));
    var codeHint = p ? '직원 가입 링크에 쓰이는 코드입니다. 바꾸면 이미 보낸 가입 링크는 쓸 수 없게 됩니다.' : '직원 가입 링크에 쓰이는 영문 소문자·숫자 3~20자 코드입니다.';
    modal(p ? '프로젝트 수정' : '새 프로젝트', h('div', null, field('현장 이름', name), field('현장 코드', code, codeHint), field('유형', kind), field('시행·시공사', client), field('주소', address),
      field('상태', status, '종료하면 새 직원 가입을 받지 않습니다.'), field('시작일', start), field('종료일', end), field('금액 명칭', money, '분양 현장은 분양가, 임대 현장은 임대보증금'),
      h('h4', { style: 'margin:14px 0 4px' }, '현장 설정'),
      field('출근 허용거리 (m)', gps, '출근 QR 기준점에서 이 거리 안에서만 출근 인정 (10~5000)'),
      field('예약 중복 기준', dup, '같은 고객의 중복 예약을 막는 기준 (현장별)')), [{
        label: '저장', primary: true, onClick: async function (close) {
          var res = await Api.call('project.save', {
            id: p ? p.id : '', name: name.value, code: code.value, kind: kind.value, client: client.value, address: address.value,
            status: status.value, startDate: start.value, endDate: end.value, moneyLabel: money.value,
            gpsDistance: gps.value, dupRule: dup.value
          });
          close();
          await Hub.reloadProjects();
          if (!p && !Api.getProject()) { Api.setProject(res.id); document.getElementById('project-select').value = res.id; document.getElementById('project-select').dispatchEvent(new Event('change')); }
          await render(root);
          toast(p ? '저장했습니다.' : '프로젝트를 만들었습니다. 기본 직군이 함께 만들어졌습니다. [인력 > 조직]에서 본부·팀을 추가해 주세요.');
        }
      }]);
  }

  Hub.section('projects', { render: render });
})();
