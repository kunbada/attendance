// 안내데스크 화면: 뒤 5자리 조회 → 호출 / 직원 찾기 / 담당 없음, 오늘 방문 현황(15초 자동 새로고침)
(function () {
  Api.setScope('desk');
  var digits = '';
  var gender = '';
  var refreshTimer = null;
  var REFRESH_MS = 15000;

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
      stopRefresh();
      try { await Api.call('auth.logout'); } catch (e) { /* 이미 만료 */ }
      Api.setToken('');
      show('login');
    });
  });

  async function enterApp() {
    var o = await Api.call('public.orgs');
    if (o.siteName) $('#siteName').textContent = o.siteName + ' · 안내데스크';
    show('app');
    resetInput();
    await loadVisits();
    startRefresh();
  }

  async function boot() {
    if (!Api.getToken()) { show('login'); return; }
    try { await enterApp(); }
    catch (e) {
      if (e.code === 'MUST_CHANGE_PW') show('changepw');
      else { Api.setToken(''); show('login'); }
    }
  }

  // ---------- 입력 ----------
  function renderDigits() {
    var d = $('#digits');
    d.textContent = (digits + '•••••').slice(0, 5).split('').join(' ');
    d.style.color = digits.length ? 'var(--text)' : '#c4cbd4';
  }

  function resetInput() {
    digits = '';
    renderDigits();
    renderIdle();
  }

  function pressDigit(n) {
    if (digits.length >= 5) return;
    digits += n;
    renderDigits();
    if (digits.length === 5) runBusy(null, lookup);
  }

  function backspace() {
    digits = digits.slice(0, -1);
    renderDigits();
    if (digits.length < 5) renderIdle();
  }

  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '지움', '0', '전체삭제'].forEach(function (k) {
    var btn = h('button', { type: 'button', class: 'btn', style: /\d/.test(k) ? '' : 'font-size:16px' }, k);
    btn.addEventListener('click', function () {
      if (k === '지움') backspace();
      else if (k === '전체삭제') resetInput();
      else pressDigit(k);
    });
    $('#keypad').appendChild(btn);
  });

  $('#gender-row').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    gender = b.dataset.g;
    $$('#gender-row .btn').forEach(function (x) { x.classList.toggle('active', x === b); });
    if (digits.length === 5) runBusy(null, lookup);
  });

  // 숫자판 대신 키보드로 입력해도 되게
  document.addEventListener('keydown', function (e) {
    if ($('#screen-app').classList.contains('hidden') || /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) return;
    if (/^\d$/.test(e.key)) pressDigit(e.key);
    else if (e.key === 'Backspace') backspace();
  });

  // ---------- 오른쪽 패널 ----------
  function panel(content) {
    var p = $('#panel');
    p.innerHTML = '';
    [].concat(content).forEach(function (c) { p.appendChild(c); });
  }

  function renderIdle() {
    panel([h('h2', null, '안내'), h('p', { class: 'muted' }, '고객 전화번호 뒤 5자리를 누르면 오늘 예약을 찾습니다.')]);
  }

  function staffLabel(s) {
    return s.name + (s.nickname ? ' (' + s.nickname + ')' : '');
  }

  function orgLabel(s) {
    return s.job + (s.headName ? ' · ' + s.headName + ' ' + s.teamName : '');
  }

  function actionButtons() {
    var find = h('button', { type: 'button', class: 'btn' }, '직원 찾기 (고객이 지명)');
    find.addEventListener('click', renderSearch);
    var none = h('button', { type: 'button', class: 'btn' }, '담당 없음으로 기록');
    none.addEventListener('click', function () {
      if (!confirm('뒤 ' + digits + ' 고객을 "담당 없음"으로 기록할까요?')) return;
      runBusy(none, function () { return register({ kind: '담당없음' }); });
    });
    return h('div', { class: 'panel-actions' }, find, none);
  }

  async function lookup() {
    var res = await Api.call('desk.lookup', { last5: digits, gender: gender });
    var items = [h('h2', null, '뒤 ' + digits + (gender ? ' (' + gender + ')' : '') + ' — 오늘 예약 ' + res.reservations.length + '건')];
    if (!res.reservations.length) items.push(h('p', { class: 'muted' }, '오늘 예약이 없습니다. 고객이 직원을 지명하면 [직원 찾기], 없으면 [담당 없음]을 누르세요.'));
    res.reservations.forEach(function (r) {
      var info = h('div', null,
        h('strong', { style: 'font-size:20px' }, r.staff ? staffLabel(r.staff) : '(담당 직원 없음)'),
        h('div', { class: 'muted' }, (r.gender ? r.gender + ' · ' : '') + (r.staff ? orgLabel(r.staff) : '')));
      var action;
      if (r.status === '방문') {
        action = h('span', { class: 'badge' }, '이미 방문 처리됨');
      } else if (!r.staffActive) {
        action = h('span', { class: 'badge danger' }, '담당 직원 퇴사·비활동');
      } else {
        action = h('button', { type: 'button', class: 'btn primary' }, '담당 ' + r.staff.name + ' 호출');
        action.addEventListener('click', function () {
          runBusy(action, function () { return register({ kind: '예약', reservationId: r.id }); });
        });
      }
      items.push(h('div', { class: 'res-card' }, info, action));
    });
    items.push(actionButtons());
    panel(items);
  }

  function renderSearch() {
    var q = h('input', { type: 'text', placeholder: '성명 또는 예명', style: 'height:56px;font-size:20px' });
    var results = h('div');
    var timer;
    q.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () { runBusy(null, async function () { await doSearch(q.value, results); }); }, 300);
    });
    var back = h('button', { type: 'button', class: 'btn' }, '← 돌아가기');
    back.addEventListener('click', function () { if (digits.length === 5) runBusy(null, lookup); else renderIdle(); });
    panel([h('h2', null, '직원 찾기'), q, h('div', { style: 'margin-top:12px' }, results), h('div', { class: 'panel-actions' }, back)]);
    q.focus();
  }

  async function doSearch(text, box) {
    var res = await Api.call('desk.searchStaff', { q: text });
    box.innerHTML = '';
    if (!res.staff.length) { box.appendChild(h('p', { class: 'muted' }, text.trim() ? '찾는 직원이 없습니다.' : '')); return; }
    res.staff.forEach(function (s) {
      var btn = h('button', { type: 'button', class: 'btn primary' }, '호출');
      btn.addEventListener('click', function () {
        if (digits.length !== 5) { toast('먼저 고객 뒤 5자리를 입력해 주세요.', true); return; }
        runBusy(btn, function () { return register({ kind: '지명', staffId: s.id }); });
      });
      box.appendChild(h('div', { class: 'res-card' },
        h('div', null, h('strong', { style: 'font-size:18px' }, staffLabel(s)), h('div', { class: 'muted' }, orgLabel(s) + (s.telegramLinked ? '' : ' · 텔레그램 미연결'))), btn));
    });
  }

  async function register(extra) {
    var res = await Api.call('desk.registerVisit', Object.assign({ last5: digits, gender: gender }, extra));
    var items;
    if (res.kind === '담당없음') {
      items = [h('h2', null, '✅ "담당 없음"으로 기록했습니다')];
    } else if (res.called) {
      items = [h('h2', { style: 'color:var(--ok)' }, '✅ ' + res.staffName + ' 님을 호출했습니다'), h('p', { class: 'muted' }, '직원이 텔레그램에서 [확인]을 누르면 아래 목록에 "확인함"으로 표시됩니다.')];
    } else {
      items = [h('h2', { style: 'color:var(--danger)' }, '⚠ ' + res.staffName + ' 님께 호출을 보내지 못했습니다'),
        h('p', null, res.notLinked ? '텔레그램이 연결되지 않은 직원입니다. 직접 연락해 주세요.' : '텔레그램 발송에 실패했습니다. 직접 연락해 주세요.'),
        h('div', { class: 'bigphone' }, res.phone)];
    }
    var done = h('button', { type: 'button', class: 'btn primary' }, '다음 고객');
    done.addEventListener('click', resetInput);
    items.push(h('div', { class: 'panel-actions' }, done));
    digits = '';
    renderDigits();
    panel(items);
    await loadVisits();
  }

  // ---------- 오늘 방문 목록 ----------
  async function loadVisits() {
    var res = await Api.call('desk.todayVisits');
    var body = $('#visits');
    body.innerHTML = '';
    if (!res.visits.length) body.appendChild(h('tr', null, h('td', { colspan: 6, class: 'muted' }, '오늘 방문 기록이 없습니다.')));
    res.visits.forEach(function (v) {
      var cell = h('td');
      if (v.staffName && v.status !== '확인함') {
        var re = h('button', { type: 'button', class: 'btn small' }, '재호출');
        re.addEventListener('click', function () { runBusy(re, async function () { await Api.call('desk.recall', { visitId: v.id }); toast('다시 호출했습니다.'); await loadVisits(); }); });
        cell.appendChild(re);
      }
      var status = v.status === '확인함' ? '확인함 ' + v.ackedAt : v.status;
      body.appendChild(h('tr', null,
        h('td', null, v.time), h('td', null, v.last5 + (v.gender ? ' (' + v.gender + ')' : '')), h('td', null, v.kind),
        h('td', null, v.staffName || '-'),
        h('td', null, h('span', { class: 'st-' + v.status }, status), v.phone ? h('div', { class: 'bigphone', style: 'font-size:22px;margin:0' }, v.phone) : null),
        cell));
    });
    $('#refresh-note').textContent = '(15초마다 자동 갱신 · ' + res.now.slice(11, 16) + ')';
  }

  function startRefresh() {
    stopRefresh();
    refreshTimer = setInterval(function () {
      if (document.hidden) return;
      loadVisits().catch(function (e) {
        if (e.code === 'AUTH') { stopRefresh(); show('login'); toast('다시 로그인해 주세요.', true); }
      });
    }, REFRESH_MS);
  }

  function stopRefresh() { clearInterval(refreshTimer); refreshTimer = null; }

  renderDigits();
  runBusy(null, boot);
})();
