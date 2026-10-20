// 인력: 직원 관리(승인·수정·급여정보·현장 이동), 조직(직군·본부·팀), 가입 링크. 모두 선택한 현장 기준이다.
(function () {
  var state = Hub.state, orgsOf = Hub.orgsOf;
  var STATUS_ORDER = { '대기': 0, '활동': 1, '반려': 2, '퇴사': 3 };
  var STATUS_BADGE = { '대기': 'warn', '활동': 'ok', '반려': 'danger', '퇴사': '' };
  var view = 'staff';
  var box = null;
  function fmtPhone(p) { return formatPhone(p); }

  // ====================================================================
  // 직원 관리
  // ====================================================================
  var filter = { q: '', status: '', job: '', tg: '' };

  var staffRoot = null;

  function renderStaff(root) {
    staffRoot = root;
    root.innerHTML = '';

    var pendingCount = state.staff.filter(function (s) { return s.status === '대기'; }).length;
    var deviceCount = state.staff.filter(function (s) { return s.deviceChangePending; }).length;
    if (pendingCount || deviceCount) {
      root.appendChild(h('div', { class: 'card' },
        pendingCount ? h('div', null, '승인 대기 ', h('span', { class: 'badge warn' }, pendingCount + '명')) : null,
        deviceCount ? h('div', null, '기기 변경 요청 ', h('span', { class: 'badge warn' }, deviceCount + '명')) : null));
    }

    var search = h('input', { type: 'text', placeholder: '이름·예명·휴대폰 검색', value: filter.q });
    var statusSel = h('select', null, option('', '상태 전체'), ['대기', '활동', '반려', '퇴사'].map(function (s) { return option(s, s, filter.status === s); }));
    var jobSel = h('select', null, option('', '직군 전체'), orgsOf('직군').map(function (o) { return option(o.name, o.name, filter.job === o.name); }));
    var tgSel = h('select', null, option('', '텔레그램 전체'), option('linked', '연결됨', filter.tg === 'linked'), option('unlinked', '미연결', filter.tg === 'unlinked'));
    var tbody = h('tbody');

    function renderRows() {
      filter.q = search.value; filter.status = statusSel.value; filter.job = jobSel.value; filter.tg = tgSel.value;
      var q = filter.q.trim().toLowerCase();
      var qd = onlyDigits(q);
      var rows = state.staff.filter(function (s) {
        if (filter.status && s.status !== filter.status) return false;
        if (filter.job && s.job !== filter.job) return false;
        if (filter.tg === 'linked' && !s.telegramLinked) return false;
        if (filter.tg === 'unlinked' && s.telegramLinked) return false;
        if (!q) return true;
        return s.name.toLowerCase().indexOf(q) >= 0 || s.nickname.toLowerCase().indexOf(q) >= 0 || (qd && s.phone.indexOf(qd) >= 0);
      }).sort(function (a, b) {
        var d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        return d || a.name.localeCompare(b.name, 'ko');
      });
      tbody.innerHTML = '';
      if (!rows.length) tbody.appendChild(h('tr', null, h('td', { colspan: 8, class: 'muted' }, '해당하는 직원이 없습니다.')));
      rows.forEach(function (s) { tbody.appendChild(staffRow(s)); });
    }
    [search, statusSel, jobSel, tgSel].forEach(function (el) { el.addEventListener('input', renderRows); });

    root.appendChild(h('div', { class: 'toolbar' }, search, statusSel, jobSel, tgSel,
      h('span', { class: 'muted', style: 'align-self:center' }, '총 ' + state.staff.length + '명')));
    root.appendChild(h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['성명(예명)', '휴대폰', '현장', '직급', '직군 / 소속', '상태', '가입일', '관리'].map(function (t) { return h('th', null, t); }))),
      tbody)));
    renderRows();
  }

  function fmtPhone(p) { return formatPhone(p); }

  function staffRow(s) {
    var org = s.job + (s.headName ? ' / ' + s.headName + ' ' + s.teamName : '');
    var badges = [h('span', { class: 'badge ' + STATUS_BADGE[s.status] }, s.status)];
    if (s.status === '반려' && s.rejectReason) badges.push(' ', h('span', { class: 'muted' }, s.rejectReason));
    if (s.deviceChangePending) badges.push(' ', h('span', { class: 'badge warn' }, '기기변경 요청'));
    if (s.locked) badges.push(' ', h('span', { class: 'badge danger' }, 'PIN 잠김'));
    if (s.status === '활동') badges.push(' ', h('span', { class: 'badge ' + (s.telegramLinked ? 'ok' : 'danger') }, s.telegramLinked ? '텔레그램 연결' : '텔레그램 미연결'));

    var btns = [];
    var act = function (label, fn, cls) {
      var b = h('button', { type: 'button', class: 'btn small ' + (cls || '') }, label);
      b.addEventListener('click', function () { runBusy(b, fn); });
      btns.push(b, ' ');
    };
    if (s.status === '대기') {
      act('승인', async function () { await Api.call('admin.approve', { staffId: s.id }); await refreshStaff(); toast(s.name + ' 승인 완료'); }, 'primary');
      act('반려', async function () {
        var reason = prompt(s.name + ' 반려 사유를 입력해 주세요.');
        if (!reason || !reason.trim()) return;
        await Api.call('admin.reject', { staffId: s.id, reason: reason.trim() });
        await refreshStaff();
      }, 'danger');
    }
    if (s.deviceChangePending) {
      act('기기변경 승인', async function () {
        if (!confirm(s.name + ' 님의 휴대폰을 새 기기로 교체할까요?\n(이전 휴대폰은 로그인할 수 없게 됩니다)')) return;
        await Api.call('admin.approveDevice', { staffId: s.id });
        await refreshStaff(); toast('기기 변경 승인 완료');
      }, 'primary');
    }
    if (s.status !== '퇴사') {
      act('수정', async function () { openEditStaff(s); });
      act('PIN 초기화', async function () {
        if (!confirm(s.name + ' 님의 PIN을 초기화할까요?\n새 PIN이 한 번만 표시됩니다.')) return;
        var res = await Api.call('admin.resetPin', { staffId: s.id });
        await refreshStaff();
        modal('PIN 초기화 완료', h('div', null, h('p', null, s.name + ' 님의 새 PIN'), h('p', { style: 'font-size:32px;font-weight:700;letter-spacing:6px' }, res.pin),
          h('p', { class: 'muted' }, '직원에게 전달해 주세요. 이 창을 닫으면 다시 볼 수 없습니다.')));
      });
    }
    act('급여정보', async function () { await openPayroll(s); });
    if (Hub.isAdmin() && s.status !== '퇴사') act('현장 이동', async function () { await openMoveStaff(s); });
    if (s.status === '활동') {
      act('퇴사', async function () {
        if (!confirm(s.name + ' 님을 퇴사 처리할까요?\n로그인이 즉시 차단됩니다.')) return;
        await Api.call('admin.retire', { staffId: s.id });
        await refreshStaff();
      }, 'danger');
    }

    var cur = Hub.currentProject();
    return h('tr', null,
      h('td', null, h('strong', null, s.name), s.nickname ? ' (' + s.nickname + ')' : ''),
      h('td', null, fmtPhone(s.phone)),
      h('td', null, cur ? cur.name : ''),
      h('td', null, s.grade || '직원', s.canApprove ? [' ', h('span', { class: 'badge ok' }, '승인권한')] : null),
      h('td', null, org),
      h('td', null, badges),
      h('td', { class: 'muted' }, (s.joinedAt || '').slice(0, 10)),
      h('td', null, btns));
  }

  async function refreshStaff() { await Hub.loadStaff(); renderStaff(staffRoot); }

  // 직군 → 본부 → 팀 연쇄 선택 칸 만들기
  function orgSelectors(job, headId, teamId, orgs) {
    var orgsOf = function (kind) { return (orgs || state.orgs).filter(function (o) { return o.kind === kind; }); };
    var jobSel = h('select', null, orgsOf('직군').filter(function (o) { return o.active || o.name === job; }).map(function (o) { return option(o.name, o.name, o.name === job); }));
    var headSel = h('select', null, option('', '선택'), orgsOf('본부').filter(function (o) { return o.active; }).map(function (o) { return option(o.id, o.name, o.id === headId); }));
    var teamSel = h('select');
    var orgBox = h('div', null, field('본부', headSel), field('팀', teamSel));
    function sync() {
      orgBox.classList.toggle('hidden', jobSel.value !== '영업');
      var keep = teamSel.value || teamId;
      teamSel.innerHTML = '';
      teamSel.appendChild(option('', '선택'));
      orgsOf('팀').filter(function (t) { return t.active && t.parentId === headSel.value; })
        .forEach(function (t) { teamSel.appendChild(option(t.id, t.name, t.id === keep)); });
    }
    jobSel.addEventListener('change', sync);
    headSel.addEventListener('change', function () { teamId = ''; teamSel.value = ''; sync(); });
    sync();
    return { jobSel: jobSel, headSel: headSel, teamSel: teamSel, box: orgBox };
  }

  function openEditStaff(s) {
    var name = h('input', { type: 'text', value: s.name, maxLength: 20 });
    var nick = h('input', { type: 'text', value: s.nickname, maxLength: 20 });
    var phone = h('input', { type: 'tel', value: fmtPhone(s.phone) });
    bindFormat(phone, formatPhone);
    var sel = orgSelectors(s.job, s.headId, s.teamId);
    var grade = h('select', null, ['직원', '팀장', '본부장'].map(function (g) { return option(g, g, g === (s.grade || '직원')); }));
    var canApprove = h('input', { type: 'checkbox', checked: !!s.canApprove, style: 'width:22px;height:22px' });
    var approveRow = h('label', { class: 'check' }, canApprove, ' 직원 가입 승인·퇴사 처리 권한 부여');
    function syncGrade() { approveRow.classList.toggle('hidden', grade.value === '직원'); }
    grade.addEventListener('change', syncGrade);
    syncGrade();
    modal('직원 수정', h('div', null, field('성명', name), field('예명', nick), field('휴대폰', phone), field('직군', sel.jobSel), sel.box,
      field('직급', grade, '팀장은 소속 팀, 본부장은 소속 본부가 필요합니다. "영업" 직군만 지정할 수 있습니다.'), approveRow), [
      {
        label: '저장', primary: true, onClick: async function (close) {
          await Api.call('admin.update', {
            staffId: s.id, name: name.value, nickname: nick.value, phone: phone.value,
            job: sel.jobSel.value, headId: sel.headSel.value, teamId: sel.teamSel.value,
            grade: grade.value, canApprove: canApprove.checked
          });
          close(); await refreshStaff(); toast('저장했습니다.');
        }
      }]);
  }

  async function openPayroll(s) {
    var p = await Api.call('admin.payrollGet', { staffId: s.id });
    var rrn = h('strong', null, p.rrn);
    var acct = h('strong', null, p.accountNo);
    var canReveal = Hub.isAdmin() || !!(state.me && state.me.allowPayroll);
    var revealBtn = h('button', { type: 'button', class: 'btn small danger' }, '원문 보기 (기록됨)');
    revealBtn.addEventListener('click', function () {
      if (!confirm('주민번호·계좌 원문을 표시합니다. 열람 기록이 남습니다. 계속할까요?')) return;
      runBusy(revealBtn, async function () {
        var r = await Api.call('admin.payrollReveal', { staffId: s.id });
        rrn.textContent = r.rrn; acct.textContent = r.accountNo;
        revealBtn.remove();
      });
    });
    modal('급여정보 — ' + s.name, h('div', null,
      h('div', { class: 'stat' }, h('span', null, '주민등록번호'), rrn),
      h('div', { class: 'stat' }, h('span', null, '은행'), h('strong', null, p.bank)),
      h('div', { class: 'stat' }, h('span', null, '계좌번호'), acct),
      h('div', { class: 'stat' }, h('span', null, '예금주'), h('strong', null, p.holder)),
      h('div', { class: 'stat' }, h('span', null, '동의일시'), h('span', null, p.consentAt)),
      h('div', { style: 'margin-top:10px' }, canReveal ? revealBtn : h('span', { class: 'muted' }, '원문 보기는 관리자가 허용한 계정만 할 수 있습니다.'))));
  }


  // 현장 이동: 다른 현장으로 소속을 옮기고 그 현장의 직군·본부·팀을 다시 고른다 (관리자 전용)
  // fromId: 직원이 지금 소속된 현장 (전체 현장 검색 결과에서는 선택한 현장과 다를 수 있다)
  async function openMoveStaff(s, fromId) {
    fromId = fromId || Api.getProject();
    var targets = state.projects.filter(function (p) { return p.id !== fromId && p.status !== '종료'; });
    if (!targets.length) { toast('이동할 수 있는 다른 현장이 없습니다.', true); return; }
    var info = await Api.call('admin.moveInfo', { staffId: s.id }, { projectId: fromId });
    var target = h('select', null, option('', '선택해 주세요'), targets.map(function (p) { return option(p.id, p.name); }));
    var holder = h('div');
    var sel = null;
    target.addEventListener('change', function () {
      holder.innerHTML = '';
      sel = null;
      if (!target.value) return;
      runBusy(null, async function () {
        var res = await Api.call('admin.orgs', {}, { projectId: target.value });
        sel = orgSelectors('', '', '', res.orgs);
        holder.appendChild(field('직군', sel.jobSel));
        holder.appendChild(sel.box);
      });
    });
    modal('현장 이동 — ' + s.name, h('div', null,
      h('p', { class: 'muted' }, '이동하면 직급(팀장·본부장)과 승인 권한은 "직원"으로 되돌아가고, 이 직원은 다시 로그인해야 합니다. 지난 출근·예약 기록은 지금 현장에 그대로 남고, 정산도 그 현장 기록으로 처리됩니다.'),
      h('p', null, '이번 달 지금 현장 출근 ', h('strong', null, info.attendanceDaysThisMonth + '일'), ' · 아직 방문하지 않은 예약 ', h('strong', null, info.upcomingReservations + '건'),
        info.upcomingReservations ? ' (이동하면 취소됩니다)' : ''),
      field('이동할 현장', target), holder), [{
        label: '이동', primary: true, onClick: async function (close) {
          if (!sel) throw new Error('이동할 현장을 선택해 주세요.');
          var mv = await Api.call('admin.moveStaff', { staffId: s.id, toProjectId: target.value, job: sel.jobSel.value, headId: sel.headSel.value, teamId: sel.teamSel.value }, { projectId: fromId });
          close();
          if (view === 'all') await runSearchAll(); else await refreshStaff();
          toast(s.name + ' 님을 이동했습니다.' + (mv.canceledReservations ? ' (예약 ' + mv.canceledReservations + '건 취소)' : ''));
        }
      }]);
  }

  // ====================================================================
  // 가입 링크: 현장 코드가 들어 있어, 이 링크로 가입하면 이 현장 소속이 된다
  // ====================================================================
  function signupLinkCard() {
    var p = Hub.currentProject();
    var url = location.href.replace(/hub\/.*$/, '') + 'staff.html?p=' + encodeURIComponent(p.code) + '#signup';
    var qrBox = h('div', { class: 'qr-box' });
    var card = h('div', { class: 'card' }, h('h2', null, '가입 링크 — ' + p.name),
      h('p', { class: 'muted' }, '직원에게 이 QR이나 주소를 보내 주세요. 이 링크로 가입한 직원은 이 현장 소속이 됩니다. 현장 코드를 바꾸면 이전에 보낸 링크는 쓸 수 없게 됩니다.'), qrBox,
      h('p', null, h('code', { style: 'word-break:break-all' }, url)));
    if (window.QRCode) new QRCode(qrBox, { text: url, width: 180, height: 180 });
    else qrBox.textContent = 'QR 라이브러리를 불러오지 못했습니다. 위 주소를 직접 전달해 주세요.';
    return card;
  }

  // ====================================================================
  // 조직
  // ====================================================================
  // ----- 조직 -----
  function orgsCard() {
    var card = h('div', { class: 'card' }, h('h2', null, '조직 (직군·본부·팀)'),
      h('p', { class: 'muted' }, '"영업" 직군을 고른 직원만 본부→팀을 선택합니다. 순서는 숫자가 작을수록 위에 나옵니다.'));
    ['직군', '본부', '팀'].forEach(function (kind) {
      var list = orgsOf(kind);
      var addBtn = h('button', { type: 'button', class: 'btn small' }, '+ ' + kind + ' 추가');
      addBtn.addEventListener('click', function () { openOrgForm(kind, null); });
      var tbody = h('tbody', null, list.map(function (o) {
        var editBtn = h('button', { type: 'button', class: 'btn small' }, '수정');
        editBtn.addEventListener('click', function () { openOrgForm(kind, o); });
        var parent = kind === '팀' ? (state.orgs.filter(function (p) { return p.id === o.parentId; })[0] || {}).name : '';
        return h('tr', null, h('td', null, o.name), kind === '팀' ? h('td', null, parent || '-') : null, h('td', null, o.order),
          h('td', null, h('span', { class: 'badge ' + (o.active ? 'ok' : '') }, o.active ? '사용' : '중지')), h('td', null, editBtn));
      }));
      card.appendChild(h('h3', { style: 'margin:16px 0 8px' }, kind + ' ', addBtn));
      card.appendChild(h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, [h('th', null, '이름'), kind === '팀' ? h('th', null, '소속 본부') : null, h('th', null, '순서'), h('th', null, '상태'), h('th', null, '')])),
        tbody)));
    });
    return card;
  }

  function openOrgForm(kind, org) {
    var name = h('input', { type: 'text', value: org ? org.name : '', maxLength: 30 });
    var order = h('input', { type: 'number', value: org ? org.order : orgsOf(kind).length + 1 });
    var active = h('select', null, option('Y', '사용', !org || org.active), option('N', '사용 중지', org && !org.active));
    var parent = null;
    if (kind === '팀') {
      parent = h('select', null, option('', '선택'), orgsOf('본부').map(function (o) { return option(o.id, o.name, org && org.parentId === o.id); }));
    }
    modal(kind + (org ? ' 수정' : ' 추가'), h('div', null, field('이름', name), parent ? field('소속 본부', parent) : null, field('순서', order), field('상태', active)), [
      {
        label: '저장', primary: true, onClick: async function (close) {
          await Api.call('admin.saveOrg', {
            id: org ? org.id : '', kind: kind, name: name.value, parentId: parent ? parent.value : '',
            order: Number(order.value) || 0, active: active.value === 'Y'
          });
          close(); await showView(); toast('저장했습니다.');
        }
      }]);
  }


  // ====================================================================
  // 전체 현장 검색: 이름·전화번호 일부로 모든 현장(보조관리자는 담당 현장)에서 직원을 찾는다
  // ====================================================================
  var allBox = null, allInput = null;

  function searchAllView() {
    allInput = h('input', { type: 'text', placeholder: '이름·예명·전화번호 일부 (예: 홍길동, 1234)', style: 'min-width:280px' });
    var go = h('button', { type: 'button', class: 'btn small primary' }, '검색');
    allBox = h('div');
    go.addEventListener('click', function () { runBusy(go, runSearchAll); });
    allInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); runBusy(go, runSearchAll); } });
    return h('div', null,
      h('div', { class: 'card' }, h('h2', null, '전체 현장 직원 검색'),
        h('p', { class: 'muted' }, Hub.isAdmin() ? '모든 현장에서 찾습니다. 다른 현장에 가입된 직원을 확인하거나 현장 이동을 처리할 수 있습니다.' : '담당 현장 안에서 찾습니다.'),
        h('div', { class: 'toolbar' }, allInput, go)),
      allBox);
  }

  async function runSearchAll() {
    var q = allInput.value.trim();
    if (!q) { toast('검색어를 입력해 주세요.', true); return; }
    var res = await Api.call('admin.staffSearchAll', { q: q });
    allBox.innerHTML = '';
    var rows = res.staff.map(function (s) {
      var cell = [];
      var openBtn = h('button', { type: 'button', class: 'btn small' }, '그 현장 보기');
      openBtn.addEventListener('click', function () {
        var sel = document.getElementById('project-select');
        sel.value = s.projectId;
        sel.dispatchEvent(new Event('change'));
      });
      cell.push(openBtn);
      if (Hub.isAdmin() && s.status !== '퇴사') {
        var mv = h('button', { type: 'button', class: 'btn small' }, '현장 이동');
        mv.addEventListener('click', function () { runBusy(mv, function () { return openMoveStaff(s, s.projectId); }); });
        cell.push(' ', mv);
      }
      return h('tr', null,
        h('td', null, h('strong', null, s.name), s.nickname ? ' (' + s.nickname + ')' : ''),
        h('td', null, fmtPhone(s.phone)), h('td', null, s.projectName), h('td', null, s.grade),
        h('td', null, s.job + (s.headName ? ' / ' + s.headName + ' ' + s.teamName : '')),
        h('td', null, h('span', { class: 'badge ' + STATUS_BADGE[s.status] }, s.status)), h('td', null, cell));
    });
    allBox.appendChild(h('div', { class: 'card' }, h('div', { class: 'muted' }, res.staff.length + '명' + (res.staff.length >= 100 ? ' (최대 100명까지 표시)' : '')),
      Hub.simpleTable(['성명(예명)', '휴대폰', '현장', '직급', '직군 / 소속', '상태', ''], rows)));
  }

  async function showView() {
    await Promise.all([Hub.loadStaff(), Hub.loadOrgs()]);
    box.innerHTML = '';
    if (view === 'staff') renderStaff(box);
    else if (view === 'orgs') box.appendChild(orgsCard());
    else if (view === 'all') box.appendChild(searchAllView());
    else box.appendChild(signupLinkCard());
  }

  Hub.register({
    key: 'people', label: '인력',
    render: async function (root) {
      root.innerHTML = '';
      box = h('div');
      var tabs = h('div', { class: 'sub-tabs no-print' });
      [['staff', '직원'], ['all', '전체 현장 검색'], ['orgs', '조직 (직군·본부·팀)'], ['link', '가입 링크']].forEach(function (t) {
        var b = h('button', { type: 'button', class: 'btn' + (view === t[0] ? ' active' : '') }, t[1]);
        b.addEventListener('click', function () {
          view = t[0];
          $$('.btn', tabs).forEach(function (x) { x.classList.toggle('active', x === b); });
          runBusy(null, showView);
        });
        tabs.appendChild(b);
      });
      root.appendChild(tabs);
      root.appendChild(box);
      await showView();
    }
  });
})();
