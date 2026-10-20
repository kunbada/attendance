// 방명록 태블릿(고객 입력용). 방명록 계정으로 한 번 로그인해 두면 30일 유지된다.
// 고객은 성명·전화번호·동반 인원·개인정보 동의만 입력한다. 성별과 담당 본부/팀/직원은 데스크 안내직원이 나중에 입력한다.
(function () {
  Api.setScope('kiosk');
  var IDLE_MS = 90 * 1000;      // 입력 중 아무도 만지지 않으면 비워서 개인정보가 화면에 남지 않게 한다
  var DONE_MS = 7 * 1000;       // 완료 화면은 자동으로 닫는다
  var party = '단독', companions = 1, consent = false;
  var idleTimer = null, doneTimer = null;
  var pending = null;           // 로그인이 풀려서 제출하지 못한 입력 (다시 로그인하면 이어서 제출)

  function show(name) {
    $$('.screen').forEach(function (s) { s.classList.add('hidden'); });
    $('#screen-' + name).classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  // ---------- 입력 화면 ----------
  function renderChoices() {
    $$('#g-party .choice').forEach(function (b) { b.classList.toggle('active', b.dataset.v === party); });
    $('#g-companion-box').classList.toggle('hidden', party !== '동반');
    $('#g-companions').textContent = companions;
    $('#g-consent-box').textContent = consent ? '✔' : '';
    $('#g-consent-btn').classList.toggle('on', consent);
  }

  function resetForm() {
    $('#form-guest').reset();
    party = '단독'; companions = 1; consent = false;
    renderChoices();
  }

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { if (!$('#screen-form').classList.contains('hidden')) resetForm(); }, IDLE_MS);
  }

  $('#g-party').addEventListener('click', function (e) {
    var b = e.target.closest('.choice'); if (!b) return;
    party = b.dataset.v; renderChoices();
  });
  $('#g-minus').addEventListener('click', function () { companions = Math.max(1, companions - 1); renderChoices(); });
  $('#g-plus').addEventListener('click', function () { companions = Math.min(30, companions + 1); renderChoices(); });
  $('#g-consent-btn').addEventListener('click', function () { consent = !consent; renderChoices(); });
  bindFormat($('#g-phone'), formatPhone);
  ['input', 'click', 'touchstart', 'keydown'].forEach(function (ev) { document.addEventListener(ev, touch, { passive: true }); });

  function collect() {
    return {
      name: $('#g-name').value, phone: $('#g-phone').value,
      companions: party === '동반' ? companions : 0, consent: consent
    };
  }

  async function submit(data) {
    try {
      await Api.call('guest.submit', data);
    } catch (err) {
      if (err.code === 'AUTH' || err.code === 'FORBIDDEN') {
        pending = data;         // 고객이 입력한 내용은 지키고, 로그인 화면으로
        show('login');
        throw new Error('태블릿 로그인이 풀렸습니다. 직원이 다시 로그인해 주세요.');
      }
      throw err;
    }
    pending = null;
    resetForm();
    show('done');
    clearTimeout(doneTimer);
    doneTimer = setTimeout(function () { show('form'); }, DONE_MS);
  }

  $('#form-guest').addEventListener('submit', function (e) {
    e.preventDefault();
    runBusy($('#form-guest button[type=submit]'), async function () {
      if (!$('#g-name').value.trim()) throw new Error('성명을 입력해 주세요.');
      if (onlyDigits($('#g-phone').value).length < 9) throw new Error('전화번호를 입력해 주세요.');
      if (!consent) throw new Error('개인정보 수집·이용에 동의해 주세요.');
      await submit(collect());
    });
  });

  // 완료 화면의 [처음 화면으로 돌아가기]: 자동으로 돌아가기를 기다리지 않고 바로 다음 고객이 쓸 수 있게
  $('#g-back').addEventListener('click', function () {
    clearTimeout(doneTimer);
    show('form');
  });

  // 계정에 고정된 현장 이름을 제목에 보여 준다 (로그인한 뒤에만 알 수 있다)
  function loadTitle() {
    Api.call('desk.orgs').then(function (o) { if (o.siteName) $('#siteName').textContent = o.siteName + ' 방명록'; }).catch(function () { /* 현장명 표시는 생략 */ });
  }

  // ---------- 태블릿 로그인 ----------
  $('#form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    runBusy($('#form-login button[type=submit]'), async function () {
      var res = await Api.call('account.login', { loginId: $('#login-id').value.trim(), password: $('#login-pw').value });
      if (res.account.role !== '방명록' && res.account.role !== '데스크') throw new Error('사용할 수 없는 계정입니다. 방명록 계정(또는 데스크 계정)으로 로그인해 주세요.');
      Api.setToken(res.token);
      $('#login-pw').value = '';
      show('form');
      loadTitle();
      if (pending) await submit(pending); // 로그인이 풀려서 못 보낸 입력이 있으면 이어서 제출
    });
  });

  // 제목을 3초 길게 누르면 이 태블릿의 로그인을 해제한다 (고객이 실수로 누르지 않게)
  var holdTimer = null;
  function holdStart() {
    holdTimer = setTimeout(function () {
      if (!confirm('이 태블릿의 방명록 로그인을 해제할까요?')) return;
      runBusy(null, async function () {
        try { await Api.call('auth.logout'); } catch (e) { /* 이미 만료 */ }
        Api.setToken('');
        resetForm();
        show('login');
      });
    }, 3000);
  }
  function holdEnd() { clearTimeout(holdTimer); }
  ['mousedown', 'touchstart'].forEach(function (ev) { $('#siteName').addEventListener(ev, holdStart); });
  ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(function (ev) { $('#siteName').addEventListener(ev, holdEnd); });

  renderChoices();
  show(Api.getToken() ? 'form' : 'login');
  if (Api.getToken()) loadTitle();
  touch();
})();
