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
    if ($('#screen-app').classList.contains('hidden') || $('#dtab-visit').classList.contains('hidden') || /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''))) return;
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
    if (!text.trim()) { box.innerHTML = ''; return; }
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

  // 호출 결과 안내 (방문 접수·예약 명단·직원 검색 탭이 함께 쓴다)
  function callResultNodes(res) {
    if (res.kind === '담당없음') return [h('h2', null, '✅ 담당 없음으로 기록했습니다')];
    if (res.called) {
      return [h('h2', { style: 'color:var(--ok)' }, '✅ ' + res.staffName + ' 님을 호출했습니다'),
        h('p', { class: 'muted' }, '직원이 텔레그램에서 [확인]을 누르면 아래 목록에 확인함으로 표시됩니다. 담당 팀장·본부장에게도 알렸습니다.')];
    }
    return [h('h2', { style: 'color:var(--danger)' }, '⚠ ' + res.staffName + ' 님께 호출을 보내지 못했습니다'),
      h('p', null, res.notLinked ? '텔레그램이 연결되지 않은 직원입니다. 직접 연락해 주세요.' : '텔레그램 발송에 실패했습니다. 직접 연락해 주세요.'),
      h('div', { class: 'bigphone' }, res.phone)];
  }

  async function register(extra) {
    var res = await Api.call('desk.registerVisit', Object.assign({ last5: digits, gender: gender }, extra));
    var items = callResultNodes(res);
    var done = h('button', { type: 'button', class: 'btn primary' }, '다음 고객');
    done.addEventListener('click', resetInput);
    items.push(h('div', { class: 'panel-actions' }, done));
    digits = '';
    renderDigits();
    panel(items);
    await loadVisits();
  }

  // ---------- 탭: 방문 접수 / 예약 명단 / 직원 검색 ----------
  $$('#desk-tabs .tab').forEach(function (t) {
    t.addEventListener('click', function () {
      $$('#desk-tabs .tab').forEach(function (x) { x.classList.toggle('active', x === t); });
      ['visit', 'reservations', 'staff'].forEach(function (k) { $('#dtab-' + k).classList.toggle('hidden', t.dataset.dtab !== k); });
      if (t.dataset.dtab === 'reservations') runBusy(null, renderReservationsTab);
      if (t.dataset.dtab === 'staff') runBusy(null, renderStaffTab);
    });
  });

  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  var INPUT_STYLE = 'height:44px;border:1px solid var(--line);border-radius:8px;padding:0 10px;font:inherit';
  function tableOf(headers, bodyEl) {
    return h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, h('tr', null, headers.map(function (t) { return h('th', null, t); }))), bodyEl));
  }
  function shiftDate(date, days) {
    var d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  // --- 예약 명단: 날짜별, 본부 → 팀 순. 번호·직원·전화번호 등으로 검색
  var resState = { date: '', q: '', rows: [] };

  async function renderReservationsTab() {
    resState.date = resState.date || todayLocal();
    var root = $('#dtab-reservations');
    root.innerHTML = '';
    var flash = h('div');
    var dateIn = h('input', { type: 'date', value: resState.date, style: INPUT_STYLE });
    var prev = h('button', { type: 'button', class: 'btn small' }, '◀ 전날');
    var next = h('button', { type: 'button', class: 'btn small' }, '다음날 ▶');
    var today = h('button', { type: 'button', class: 'btn small' }, '오늘');
    var q = h('input', { type: 'text', placeholder: '검색: 예약번호(뒤5자리)·직원명·전화번호·본부·팀', value: resState.q, style: INPUT_STYLE + ';min-width:300px' });
    var count = h('span', { class: 'muted' });
    var body = h('tbody');

    function renderRows() {
      resState.q = q.value;
      var key = q.value.trim().toLowerCase();
      var keyDigits = key.replace(/[^0-9]/g, '');
      var rows = resState.rows.filter(function (r) {
        if (!key) return true;
        var st = r.staff || {};
        var hay = [r.last5, r.gender, r.status, st.name, st.nickname, st.headName, st.teamName, st.job].join(' ').toLowerCase();
        return hay.indexOf(key) >= 0 || (keyDigits.length >= 2 && (st.phone || '').replace(/[^0-9]/g, '').indexOf(keyDigits) >= 0);
      });
      count.textContent = rows.length + '건 / 전체 ' + resState.rows.length + '건';
      body.innerHTML = '';
      if (!rows.length) body.appendChild(h('tr', null, h('td', { colspan: 9, class: 'muted' }, '예약이 없습니다.')));
      rows.forEach(function (r) {
        var st = r.staff;
        var act = h('td');
        if (r.callable) {
          var b = h('button', { type: 'button', class: 'btn small primary' }, '호출');
          b.addEventListener('click', function () {
            runBusy(b, async function () {
              var res = await Api.call('desk.registerVisit', { kind: '예약', reservationId: r.id, last5: r.last5, gender: r.gender });
              flash.innerHTML = '';
              flash.appendChild(h('div', { class: 'card' }, callResultNodes(res)));
              await Promise.all([loadReservations(), loadVisits()]);
            });
          });
          act.appendChild(b);
        }
        body.appendChild(h('tr', null,
          h('td', null, h('strong', { style: 'font-size:18px' }, r.last5)), h('td', null, r.gender),
          h('td', null, st ? st.headName : ''), h('td', null, st ? st.teamName : ''),
          h('td', null, st ? st.name + (st.nickname ? ' (' + st.nickname + ')' : '') + (st.grade && st.grade !== '직원' ? ' ' + st.grade : '') : '(삭제된 직원)'),
          h('td', null, st ? st.phone : ''), h('td', null, h('span', { class: 'badge ' + (r.status === '방문' ? 'ok' : r.status === '예정' ? 'warn' : '') }, r.status)),
          h('td', { class: 'muted' }, r.memo || ''), act));
      });
    }

    async function loadReservations() {
      resState.date = dateIn.value || todayLocal();
      var res = await Api.call('desk.reservationList', { date: resState.date });
      resState.rows = res.reservations;
      renderRows();
    }

    function goto(date) { dateIn.value = date; runBusy(null, loadReservations); }
    dateIn.addEventListener('change', function () { runBusy(null, loadReservations); });
    prev.addEventListener('click', function () { goto(shiftDate(dateIn.value || todayLocal(), -1)); });
    next.addEventListener('click', function () { goto(shiftDate(dateIn.value || todayLocal(), 1)); });
    today.addEventListener('click', function () { goto(todayLocal()); });
    q.addEventListener('input', renderRows);

    root.appendChild(flash);
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '예약 명단'),
      h('div', { class: 'toolbar' }, prev, dateIn, next, today, q, count),
      tableOf(['예약번호', '성별', '본부', '팀', '직원', '직원 전화번호', '상태', '메모', ''], body)));
    await loadReservations();
  }

  // --- 직원 검색: 이름·예명·전화번호 일부·본부/팀. 비워 두면 전체(본부 → 팀 순). 검색 후 호출
  async function renderStaffTab() {
    var root = $('#dtab-staff');
    root.innerHTML = '';
    var flash = h('div');
    var cust = h('input', { type: 'tel', inputMode: 'numeric', maxLength: 5, placeholder: '고객 뒤 5자리', style: INPUT_STYLE + ';width:160px;font-size:20px;font-weight:700' });
    bindFormat(cust, onlyDigits);
    var q = h('input', { type: 'text', placeholder: '검색: 이름·예명·전화번호 일부·본부·팀 (비우면 전체)', style: INPUT_STYLE + ';min-width:320px' });
    var count = h('span', { class: 'muted' });
    var body = h('tbody');
    var timer;

    async function load() {
      var res = await Api.call('desk.searchStaff', { q: q.value });
      count.textContent = res.staff.length + '명' + (res.staff.length >= 500 ? ' (최대 500명까지 표시)' : '');
      body.innerHTML = '';
      if (!res.staff.length) body.appendChild(h('tr', null, h('td', { colspan: 8, class: 'muted' }, '찾는 직원이 없습니다.')));
      res.staff.forEach(function (st) {
        var b = h('button', { type: 'button', class: 'btn small primary' }, '호출');
        b.addEventListener('click', function () {
          if (cust.value.length !== 5) { toast('먼저 위의 고객 뒤 5자리를 입력해 주세요.', true); cust.focus(); return; }
          if (!confirm('뒤 ' + cust.value + ' 고객 도착: ' + st.name + ' 님을 호출할까요?')) return;
          runBusy(b, async function () {
            var out = await Api.call('desk.registerVisit', { kind: '지명', staffId: st.id, last5: cust.value });
            flash.innerHTML = '';
            flash.appendChild(h('div', { class: 'card' }, callResultNodes(out)));
            cust.value = '';
            await loadVisits();
          });
        });
        body.appendChild(h('tr', null,
          h('td', null, st.headName), h('td', null, st.teamName),
          h('td', null, h('strong', null, st.name), st.nickname ? ' (' + st.nickname + ')' : ''),
          h('td', null, st.grade && st.grade !== '직원' ? h('span', { class: 'badge ok' }, st.grade) : ''),
          h('td', null, st.job), h('td', null, st.phone),
          h('td', null, st.telegramLinked ? h('span', { class: 'badge ok' }, '연결') : h('span', { class: 'badge danger' }, '미연결')), h('td', null, b)));
      });
    }

    q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(function () { runBusy(null, load); }, 250); });
    root.appendChild(flash);
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '직원 검색'),
      h('div', { class: 'toolbar' }, h('span', { class: 'field-label', style: 'align-self:center' }, '호출할 고객'), cust, q, count),
      tableOf(['본부', '팀', '직원', '직급', '직군', '전화번호', '텔레그램', ''], body)));
    await load();
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
