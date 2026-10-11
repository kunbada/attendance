// 관리자 화면: 로그인, 직원 관리, 설정(기본 설정·가입 링크·조직·데스크 계정)
(function () {
  Api.setScope('admin');
  var state = { staff: [], orgs: [], settings: {}, accounts: [] };
  var STATUS_ORDER = { '대기': 0, '활동': 1, '반려': 2, '퇴사': 3 };
  var STATUS_BADGE = { '대기': 'warn', '활동': 'ok', '반려': 'danger', '퇴사': '' };

  function show(name) {
    $$('.screen').forEach(function (s) { s.classList.add('hidden'); });
    $('#screen-' + name).classList.remove('hidden');
    $('#btn-logout').classList.toggle('hidden', name === 'login');
  }

  // ---------- 로그인 ----------
  $('#form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    runBusy($('#form-login button[type=submit]'), async function () {
      var res = await Api.call('account.login', { loginId: $('#login-id').value.trim(), password: $('#login-pw').value });
      if (res.account.role !== '관리자') {
        Api.setToken(res.token);
        try { await Api.call('auth.logout'); } catch (err) { /* 무시 */ }
        Api.setToken('');
        throw new Error('관리자 계정이 아닙니다. 데스크 계정은 데스크 화면에서 로그인해 주세요.');
      }
      Api.setToken(res.token);
      $('#login-pw').value = '';
      if (res.account.mustChangePassword) show('changepw');
      else await enterApp();
    });
  });

  $('#form-changepw').addEventListener('submit', function (e) {
    e.preventDefault();
    runBusy($('#form-changepw button[type=submit]'), async function () {
      if ($('#cp-new').value !== $('#cp-new2').value) throw new Error('새 비밀번호가 서로 다릅니다.');
      await Api.call('account.changePassword', { oldPassword: $('#cp-old').value, newPassword: $('#cp-new').value });
      $('#form-changepw').reset();
      toast('비밀번호를 변경했습니다.');
      await enterApp();
    });
  });

  $('#btn-logout').addEventListener('click', function () {
    runBusy($('#btn-logout'), async function () {
      try { await Api.call('auth.logout'); } catch (e) { /* 이미 만료 */ }
      Api.setToken('');
      show('login');
    });
  });

  async function enterApp() {
    var orgs = await Api.call('public.orgs');
    if (orgs.siteName) $('#siteName').textContent = orgs.siteName + ' · 관리자';
    show('app');
    await Promise.all([loadStaff(), loadOrgs()]);
    renderStaffTab();
  }

  // 세션이 살아 있으면 바로 들어간다 (비밀번호 변경 대기 상태면 그 화면으로)
  async function boot() {
    if (!Api.getToken()) { show('login'); return; }
    try { await enterApp(); }
    catch (e) {
      if (e.code === 'MUST_CHANGE_PW') show('changepw');
      else { Api.setToken(''); show('login'); }
    }
  }

  // ---------- 탭 ----------
  var TAB_LOADERS = {
    staff: async function () { await loadStaff(); renderStaffTab(); },
    qr: renderQrTab,
    attendance: renderAttendanceTab,
    visits: renderVisitsTab,
    settings: renderSettingsTab
  };
  $$('.tab').forEach(function (t) {
    t.addEventListener('click', function () {
      $$('.tab').forEach(function (x) { x.classList.toggle('active', x === t); });
      Object.keys(TAB_LOADERS).forEach(function (k) { $('#tab-' + k).classList.toggle('hidden', t.dataset.tab !== k); });
      runBusy(null, TAB_LOADERS[t.dataset.tab]);
    });
  });

  async function loadStaff() { state.staff = (await Api.call('admin.staffList')).staff; }
  async function loadOrgs() { state.orgs = (await Api.call('admin.orgs')).orgs; }

  function orgsOf(kind) { return state.orgs.filter(function (o) { return o.kind === kind; }); }

  // ====================================================================
  // 직원 관리
  // ====================================================================
  var filter = { q: '', status: '', job: '' };

  function renderStaffTab() {
    var root = $('#tab-staff');
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
    var tbody = h('tbody');

    function renderRows() {
      filter.q = search.value; filter.status = statusSel.value; filter.job = jobSel.value;
      var q = filter.q.trim().toLowerCase();
      var qd = onlyDigits(q);
      var rows = state.staff.filter(function (s) {
        if (filter.status && s.status !== filter.status) return false;
        if (filter.job && s.job !== filter.job) return false;
        if (!q) return true;
        return s.name.toLowerCase().indexOf(q) >= 0 || s.nickname.toLowerCase().indexOf(q) >= 0 || (qd && s.phone.indexOf(qd) >= 0);
      }).sort(function (a, b) {
        var d = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
        return d || a.name.localeCompare(b.name, 'ko');
      });
      tbody.innerHTML = '';
      if (!rows.length) tbody.appendChild(h('tr', null, h('td', { colspan: 6, class: 'muted' }, '해당하는 직원이 없습니다.')));
      rows.forEach(function (s) { tbody.appendChild(staffRow(s)); });
    }
    [search, statusSel, jobSel].forEach(function (el) { el.addEventListener('input', renderRows); });

    root.appendChild(h('div', { class: 'toolbar' }, search, statusSel, jobSel,
      h('span', { class: 'muted', style: 'align-self:center' }, '총 ' + state.staff.length + '명')));
    root.appendChild(h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, ['성명(예명)', '휴대폰', '직군 / 소속', '상태', '가입일', '관리'].map(function (t) { return h('th', null, t); }))),
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
    if (s.status === '활동') {
      act('퇴사', async function () {
        if (!confirm(s.name + ' 님을 퇴사 처리할까요?\n로그인이 즉시 차단됩니다.')) return;
        await Api.call('admin.retire', { staffId: s.id });
        await refreshStaff();
      }, 'danger');
    }

    return h('tr', null,
      h('td', null, h('strong', null, s.name), s.nickname ? ' (' + s.nickname + ')' : '',
        s.grade && s.grade !== '직원' ? [' ', h('span', { class: 'badge ok' }, s.grade + (s.canApprove ? '·승인권한' : ''))] : null),
      h('td', null, fmtPhone(s.phone)),
      h('td', null, org),
      h('td', null, badges),
      h('td', { class: 'muted' }, (s.joinedAt || '').slice(0, 10)),
      h('td', null, btns));
  }

  async function refreshStaff() { await loadStaff(); renderStaffTab(); }

  // 직군 → 본부 → 팀 연쇄 선택 칸 만들기
  function orgSelectors(job, headId, teamId) {
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
      h('div', { style: 'margin-top:10px' }, revealBtn)));
  }

  // ====================================================================
  // QR 생성
  // ====================================================================
  async function renderQrTab() {
    var info = await Api.call('admin.currentQr');
    var root = $('#tab-qr');
    root.innerHTML = '';
    var issueBtn = h('button', { type: 'button', class: 'btn primary', style: 'max-width:260px' }, info.issued ? '오늘 QR 다시 만들기' : '오늘 QR 만들기');
    issueBtn.addEventListener('click', function () {
      runBusy(issueBtn, async function () {
        if (info.issued && !confirm('QR을 다시 만들면 이미 인쇄한 QR은 쓸 수 없게 됩니다. 계속할까요?')) return;
        var pos = await getPosition();
        var acc = Math.round(pos.coords.accuracy);
        if (acc > 100 && !confirm('위치 정확도가 낮습니다 (오차 약 ' + acc + 'm).\n실외나 창가에서 다시 시도하는 것을 권장합니다.\n그래도 이 위치를 기준으로 만들까요?')) return;
        await Api.call('admin.issueQr', { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: acc });
        toast('오늘 QR을 만들었습니다. (위치 오차 약 ' + acc + 'm)');
        await renderQrTab();
      });
    });
    var card = h('div', { class: 'card' }, h('h2', null, '오늘 출근 QR'),
      h('p', { class: 'muted no-print' }, '이 버튼을 누른 곳의 위치가 오늘 출근의 기준점이 됩니다. 반드시 현장에서 누르세요.'),
      h('div', { class: 'no-print' }, issueBtn));
    root.appendChild(card);

    if (info.issued) {
      var box = h('div', { class: 'qr-box' });
      var printBtn = h('button', { type: 'button', class: 'btn no-print', style: 'max-width:160px;margin:12px auto 0' }, '인쇄');
      printBtn.addEventListener('click', function () {
        document.body.classList.add('print-qr');
        window.print();
        document.body.classList.remove('print-qr');
      });
      var big = h('div', { class: 'qr-big' }, box, h('p', { class: 'qr-title' }, info.date + ' 출근 QR'),
        h('p', { class: 'muted' }, '발급 ' + info.issuedAt + ' · 위치 오차 약 ' + info.accuracy + 'm'), printBtn);
      card.appendChild(h('hr', { class: 'no-print', style: 'border:0;border-top:1px solid var(--line);margin:16px 0' }));
      card.appendChild(big);
      if (window.QRCode) new QRCode(box, { text: info.qr, width: 280, height: 280 });
      else box.textContent = 'QR 라이브러리를 불러오지 못했습니다.';
    } else {
      card.appendChild(h('p', { class: 'badge warn no-print', style: 'margin-top:12px' }, '오늘 QR이 아직 없습니다'));
    }
  }

  // ====================================================================
  // 근태 현황
  // ====================================================================
  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  // 엑셀에서 수식으로 실행되지 않도록 = + - @ 로 시작하는 값 앞에 ' 를 붙인다
  function csvCell(v) {
    var t = String(v === null || v === undefined ? '' : v);
    if (/^[=+\-@]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  }

  function downloadCsv(filename, rows) {
    var text = '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'); // BOM: 엑셀 한글 깨짐 방지
    var a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function simpleTable(headers, rows) {
    return h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, headers.map(function (t) { return h('th', null, t); }))),
      h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: headers.length, class: 'muted' }, '없음')))));
  }

  function nameCell(p) { return p.name + (p.nickname ? ' (' + p.nickname + ')' : ''); }
  function orgCell(p) { return p.job + (p.headName ? ' / ' + p.headName + ' ' + p.teamName : ''); }

  var attView = { date: '', month: '' };
  var DATE_STYLE = 'height:40px;border:1px solid var(--line);border-radius:8px;padding:0 8px;font:inherit';

  async function renderAttendanceTab() {
    attView.date = attView.date || todayLocal();
    attView.month = attView.month || todayLocal().slice(0, 7);
    var root = $('#tab-attendance');
    root.innerHTML = '';
    var dayBox = h('div'), monthBox = h('div');

    var dateIn = h('input', { type: 'date', value: attView.date, style: DATE_STYLE });
    var dayBtn = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    dayBtn.addEventListener('click', function () { runBusy(dayBtn, function () { attView.date = dateIn.value; return loadDay(dayBox); }); });
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '일별 근태'), h('div', { class: 'toolbar' }, dateIn, dayBtn), dayBox));

    var monthIn = h('input', { type: 'month', value: attView.month, style: DATE_STYLE });
    var monthBtn = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    monthBtn.addEventListener('click', function () { runBusy(monthBtn, function () { attView.month = monthIn.value; return loadMonth(monthBox); }); });
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '월별 근태'), h('div', { class: 'toolbar' }, monthIn, monthBtn), monthBox));

    await Promise.all([loadDay(dayBox), loadMonth(monthBox)]);
  }

  async function loadDay(box) {
    var d = await Api.call('admin.attendance', { date: attView.date });
    box.innerHTML = '';
    box.appendChild(h('div', { class: 'summary' },
      h('div', { class: 'card' }, h('span', { class: 'num' }, d.present.length + ' / ' + d.activeCount), '출근 / 활동 인원'),
      h('div', { class: 'card' }, h('span', { class: 'num' }, d.failures.length), '실패 기록')));
    box.appendChild(h('h3', null, '출근자'));
    box.appendChild(simpleTable(['성명(예명)', '직군 / 소속', '시각', '거리'], d.present.map(function (p) {
      return h('tr', null, h('td', null, nameCell(p)), h('td', null, orgCell(p)), h('td', null, p.time), h('td', null, p.distance + 'm'));
    })));
    box.appendChild(h('h3', null, '미출근자 (' + d.absent.length + '명)'));
    box.appendChild(simpleTable(['성명(예명)', '직군 / 소속'], d.absent.map(function (p) {
      return h('tr', null, h('td', null, nameCell(p)), h('td', null, orgCell(p)));
    })));
    box.appendChild(h('h3', null, '실패 기록'));
    box.appendChild(simpleTable(['시각', '성명', '사유'], d.failures.map(function (f) {
      return h('tr', null, h('td', null, f.time), h('td', null, f.name), h('td', null, f.reason));
    })));
  }

  async function loadMonth(box) {
    var m = await Api.call('admin.attendance', { month: attView.month });
    box.innerHTML = '';
    var csvBtn = h('button', { type: 'button', class: 'btn small' }, 'CSV 다운로드');
    csvBtn.addEventListener('click', function () {
      var head = ['성명', '예명', '직군', '본부', '팀', '출근일수'];
      for (var d = 1; d <= m.daysInMonth; d++) head.push(d + '일');
      var rows = [head].concat(m.staff.map(function (p) {
        var r = [p.name, p.nickname, p.job, p.headName, p.teamName, p.days.length];
        for (var d = 1; d <= m.daysInMonth; d++) r.push(p.days.indexOf(d) >= 0 ? 'O' : '');
        return r;
      }));
      downloadCsv('근태_' + m.month + '.csv', rows);
    });
    box.appendChild(h('div', { class: 'toolbar' }, csvBtn));
    box.appendChild(simpleTable(['성명(예명)', '직군 / 소속', '출근일수', '출근한 날'], m.staff.map(function (p) {
      return h('tr', null, h('td', null, nameCell(p)), h('td', null, orgCell(p)), h('td', null, p.days.length + '일'),
        h('td', { class: 'muted' }, p.days.join(', ')));
    })));
  }

  // ====================================================================
  // 예약·방문 현황
  // ====================================================================
  var visitFilter = { from: '', to: '', headId: '', teamId: '', staffId: '' };

  async function renderVisitsTab() {
    visitFilter.from = visitFilter.from || todayLocal().slice(0, 8) + '01';
    visitFilter.to = visitFilter.to || todayLocal();
    if (!state.staff.length) await loadStaff();
    var root = $('#tab-visits');
    root.innerHTML = '';
    var from = h('input', { type: 'date', value: visitFilter.from, style: DATE_STYLE });
    var to = h('input', { type: 'date', value: visitFilter.to, style: DATE_STYLE });
    var head = h('select', null, option('', '본부 전체'), orgsOf('본부').map(function (o) { return option(o.id, o.name, o.id === visitFilter.headId); }));
    var team = h('select');
    var staffSel = h('select', null, option('', '직원 전체'), state.staff.filter(function (s) { return s.status !== '반려'; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); })
      .map(function (s) { return option(s.id, s.name + (s.nickname ? ' (' + s.nickname + ')' : ''), s.id === visitFilter.staffId); }));
    function syncTeams() {
      team.innerHTML = '';
      team.appendChild(option('', '팀 전체'));
      orgsOf('팀').filter(function (t) { return !head.value || t.parentId === head.value; })
        .forEach(function (t) { team.appendChild(option(t.id, t.name, t.id === visitFilter.teamId)); });
    }
    head.addEventListener('change', function () { visitFilter.teamId = ''; syncTeams(); });
    syncTeams();
    var go = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    var box = h('div');
    go.addEventListener('click', function () {
      visitFilter = { from: from.value, to: to.value, headId: head.value, teamId: team.value, staffId: staffSel.value };
      runBusy(go, function () { return loadVisitsTab(box); });
    });
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '조건'), h('div', { class: 'toolbar' }, from, '~', to, head, team, staffSel, go)));
    root.appendChild(box);
    await loadVisitsTab(box);
  }

  async function loadVisitsTab(box) {
    var q = { from: visitFilter.from, to: visitFilter.to, headId: visitFilter.headId, teamId: visitFilter.teamId, staffId: visitFilter.staffId };
    var results = await Promise.all([Api.call('admin.reservations', q), Api.call('admin.visits', q)]);
    var rs = results[0].reservations, vs = results[1].visits;
    box.innerHTML = '';

    var resCsv = h('button', { type: 'button', class: 'btn small' }, 'CSV 다운로드');
    resCsv.addEventListener('click', function () {
      downloadCsv('예약_' + q.from + '_' + q.to + '.csv', [['방문예정일', '뒤5자리', '성별', '직원', '직군', '본부', '팀', '메모', '상태', '등록일시']].concat(
        rs.map(function (r) { return [r.date, r.last5, r.gender, r.staff ? r.staff.name : '', r.staff ? r.staff.job : '', r.staff ? r.staff.headName : '', r.staff ? r.staff.teamName : '', r.memo, r.status, r.createdAt]; })));
    });
    box.appendChild(h('div', { class: 'card' }, h('h2', null, '예약 (' + rs.length + '건) '), h('div', { class: 'toolbar' }, resCsv),
      simpleTable(['방문예정일', '뒤5자리', '성별', '직원', '소속', '메모', '상태'], rs.map(function (r) {
        return h('tr', null, h('td', null, r.date), h('td', null, r.last5), h('td', null, r.gender), h('td', null, r.staff ? nameCell(r.staff) : '-'),
          h('td', null, r.staff ? orgCell(r.staff) : ''), h('td', null, r.memo), h('td', null, r.status));
      }))));

    var visCsv = h('button', { type: 'button', class: 'btn small' }, 'CSV 다운로드');
    visCsv.addEventListener('click', function () {
      downloadCsv('방문_' + q.from + '_' + q.to + '.csv', [['방문일시', '뒤5자리', '성별', '구분', '담당직원', '직군', '본부', '팀', '호출일시', '확인일시']].concat(
        vs.map(function (v) { return [v.at, v.last5, v.gender, v.kind, v.staff ? v.staff.name : '', v.staff ? v.staff.job : '', v.staff ? v.staff.headName : '', v.staff ? v.staff.teamName : '', v.calledAt, v.ackedAt]; })));
    });
    box.appendChild(h('div', { class: 'card' }, h('h2', null, '방문 (' + vs.length + '건) '), h('div', { class: 'toolbar' }, visCsv),
      simpleTable(['방문일시', '뒤5자리', '성별', '구분', '담당직원', '호출', '확인'], vs.map(function (v) {
        return h('tr', null, h('td', null, v.at), h('td', null, v.last5), h('td', null, v.gender), h('td', null, v.kind),
          h('td', null, v.staff ? nameCell(v.staff) : '-'), h('td', null, v.calledAt.slice(11, 16)), h('td', null, v.ackedAt.slice(11, 16)));
      }))));
  }

  // ====================================================================
  // 설정
  // ====================================================================
  async function renderSettingsTab() {
    var results = await Promise.all([Api.call('admin.settings'), Api.call('admin.accounts'), loadOrgs()]);
    state.settings = results[0].settings;
    state.accounts = results[1].accounts;
    var root = $('#tab-settings');
    root.innerHTML = '';
    root.appendChild(basicSettingsCard());
    root.appendChild(signupLinkCard());
    root.appendChild(orgsCard());
    root.appendChild(accountsCard());
  }

  function basicSettingsCard() {
    var st = state.settings;
    var site = h('input', { type: 'text', value: st['현장명'] || '', maxLength: 40 });
    var dist = h('input', { type: 'number', value: st['GPS허용거리m'] || '200', min: 10, max: 5000 });
    var dup = h('select', null, option('뒤5자리', '뒤5자리', st['예약중복기준'] === '뒤5자리'), option('뒤5자리+성별', '뒤5자리 + 성별', st['예약중복기준'] === '뒤5자리+성별'));
    var bot = h('input', { type: 'text', value: st['텔레그램봇이름'] || '', placeholder: 'my_site_bot' });
    var save = h('button', { type: 'button', class: 'btn primary', style: 'max-width:200px' }, '저장');
    save.addEventListener('click', function () {
      runBusy(save, async function () {
        await Api.call('admin.saveSettings', { values: {
          '현장명': site.value, 'GPS허용거리m': dist.value, '예약중복기준': dup.value, '텔레그램봇이름': bot.value
        } });
        toast('설정을 저장했습니다.');
        $('#siteName').textContent = (site.value || '관리자') + (site.value ? ' · 관리자' : '');
      });
    });
    return h('div', { class: 'card' }, h('h2', null, '기본 설정'),
      field('현장명', site), field('GPS 허용거리 (m)', dist, '출근 QR 기준점에서 이 거리 안에서만 출근 인정'),
      field('예약 중복 기준', dup, '같은 고객의 중복 예약을 막는 기준'),
      field('텔레그램 봇 이름', bot, '@ 없이. 직원 호출 알림에 사용'), save);
  }

  function signupLinkCard() {
    var url = location.href.replace(/admin\.html.*$/, 'staff.html#signup');
    var qrBox = h('div', { class: 'qr-box' });
    var card = h('div', { class: 'card' }, h('h2', null, '가입 링크'),
      h('p', { class: 'muted' }, '직원에게 이 QR이나 주소를 보내 주세요.'), qrBox,
      h('p', null, h('code', { style: 'word-break:break-all' }, url)));
    if (window.QRCode) new QRCode(qrBox, { text: url, width: 180, height: 180 });
    else qrBox.textContent = 'QR 라이브러리를 불러오지 못했습니다. 위 주소를 직접 전달해 주세요.';
    return card;
  }

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
          close(); await renderSettingsTab(); toast('저장했습니다.');
        }
      }]);
  }

  // ----- 계정 -----
  function accountsCard() {
    var addBtn = h('button', { type: 'button', class: 'btn small' }, '+ 계정 추가');
    addBtn.addEventListener('click', function () { openAccountForm(null); });
    var tbody = h('tbody', null, state.accounts.map(function (a) {
      var editBtn = h('button', { type: 'button', class: 'btn small' }, '수정 / 비밀번호 재설정');
      editBtn.addEventListener('click', function () { openAccountForm(a); });
      var badges = [h('span', { class: 'badge ' + (a.active ? 'ok' : '') }, a.active ? '사용' : '중지')];
      if (a.locked) badges.push(' ', h('span', { class: 'badge danger' }, '잠김'));
      return h('tr', null, h('td', null, a.loginId), h('td', null, a.name), h('td', null, a.role), h('td', null, badges), h('td', null, editBtn));
    }));
    return h('div', { class: 'card' }, h('h2', null, '계정 ', addBtn),
      h('p', { class: 'muted' }, '관리자·데스크 계정입니다. 비밀번호를 새로 정하면 상대방이 첫 로그인 때 직접 바꾸게 되고, 잠김도 풀립니다.'),
      h('div', { class: 'table-wrap' }, h('table', null,
        h('thead', null, h('tr', null, ['아이디', '이름', '역할', '상태', ''].map(function (t) { return h('th', null, t); }))), tbody)));
  }

  function openAccountForm(a) {
    var loginId = h('input', { type: 'text', value: a ? a.loginId : '', autocomplete: 'off' });
    var name = h('input', { type: 'text', value: a ? a.name : '' });
    var role = h('select', null, option('데스크', '데스크', !a || a.role === '데스크'), option('방명록', '방명록 (고객 입력 태블릿 전용)', a && a.role === '방명록'), option('관리자', '관리자', a && a.role === '관리자'));
    var pw = h('input', { type: 'text', autocomplete: 'off', placeholder: a ? '바꾸지 않으려면 비워 두세요' : '8자 이상, 영문+숫자' });
    var active = h('select', null, option('Y', '사용', !a || a.active), option('N', '사용 중지', a && !a.active));
    modal(a ? '계정 수정' : '계정 추가', h('div', null, field('아이디', loginId), field('이름', name), field('역할', role),
      field(a ? '새 비밀번호 (선택)' : '임시 비밀번호', pw, '직접 전달해 주세요. 관리자·데스크는 첫 로그인 때 바꾸게 됩니다. 방명록 태블릿 계정은 변경 없이 그대로 씁니다.'), field('상태', active)), [
      {
        label: '저장', primary: true, onClick: async function (close) {
          await Api.call('admin.saveAccount', {
            id: a ? a.id : '', loginId: loginId.value, name: name.value, role: role.value, password: pw.value, active: active.value === 'Y'
          });
          close(); await renderSettingsTab(); toast('저장했습니다.');
        }
      }]);
  }

  runBusy(null, boot);
})();
