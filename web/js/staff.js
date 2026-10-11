// 영업직원 화면: 가입, 로그인, 기기 변경 요청, 홈
(function () {
  Api.setScope('staff');
  var BANKS = ['국민', '신한', '우리', '하나', '농협', '기업', 'SC제일', '카카오뱅크', '토스뱅크', '케이뱅크', '새마을금고', '우체국', '신협', '수협', '부산', '대구', '광주', '전북', '경남', '제주', '기타'];
  var orgs = null;

  function show(name) {
    $$('.screen').forEach(function (s) { s.classList.add('hidden'); });
    $('#screen-' + name).classList.remove('hidden');
    window.scrollTo(0, 0);
  }

  async function loadOrgs() {
    if (orgs) return orgs;
    orgs = await Api.call('public.orgs');
    if (orgs.siteName) $('#siteName').textContent = orgs.siteName;
    return orgs;
  }

  // ---------- 화면 전환 ----------
  async function route() {
    var screen = (location.hash || '').replace('#', '');
    if (Api.getToken() && screen !== 'signup' && screen !== 'device') {
      try { await showHome(); return; } catch (e) { /* 토큰 만료·다른 폰 → 로그인 화면 */ }
    }
    if (screen === 'signup') { show('signup'); await prepareSignup(); }
    else if (screen === 'device') show('device');
    else show('login');
  }

  async function showHome() {
    var me = await Api.call('staff.me');
    $('#home-name').textContent = me.staff.name + (me.staff.nickname ? ' (' + me.staff.nickname + ')' : '');
    $('#home-job').textContent = me.staff.job;
    $('#home-today').textContent = me.checkedInToday ? '출근 ' + me.checkedInAt : '아직 출근 전';
    $('#home-month').textContent = me.monthDays + '일';
    show('home');
  }

  // ---------- 가입 ----------
  async function prepareSignup() {
    var o;
    try { o = await loadOrgs(); } catch (e) { toast(e.message, true); return; }
    var job = $('#su-job');
    if (!job.options.length) {
      job.appendChild(option('', '선택해 주세요'));
      o.jobs.forEach(function (j) { job.appendChild(option(j.name, j.name)); });
      var bank = $('#su-bank');
      bank.appendChild(option('', '선택해 주세요'));
      BANKS.forEach(function (b) { bank.appendChild(option(b, b)); });
      var head = $('#su-head');
      head.appendChild(option('', '선택해 주세요'));
      o.heads.forEach(function (x) { head.appendChild(option(x.id, x.name)); });
    }
    onJobOrHeadChange();
  }

  function onJobOrHeadChange() {
    var isSales = $('#su-job').value === orgs.salesJob;
    $('#su-org').classList.toggle('hidden', !isSales);
    var headId = $('#su-head').value;
    var team = $('#su-team');
    var prev = team.value;
    team.innerHTML = '';
    team.appendChild(option('', headId ? '선택해 주세요' : '본부를 먼저 선택'));
    orgs.teams.filter(function (t) { return t.parentId === headId; }).forEach(function (t) {
      team.appendChild(option(t.id, t.name, t.id === prev));
    });
  }

  $('#su-job').addEventListener('change', onJobOrHeadChange);
  $('#su-head').addEventListener('change', onJobOrHeadChange);
  [$('#login-phone'), $('#su-phone'), $('#dv-phone')].forEach(function (i) { bindFormat(i, formatPhone); });
  bindFormat($('#su-rrn'), formatRrn);
  ['#login-pin', '#su-pin', '#su-pin2', '#dv-pin'].forEach(function (s) { bindFormat($(s), onlyDigits); });

  $('#form-signup').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#form-signup button[type=submit]');
    runBusy(btn, async function () {
      if ($('#su-pin').value !== $('#su-pin2').value) throw new Error('PIN이 서로 다릅니다.');
      if (!$('#su-consent').checked) throw new Error('개인정보 수집·이용에 동의해 주세요.');
      await Api.call('staff.signup', {
        name: $('#su-name').value, nickname: $('#su-nickname').value, phone: $('#su-phone').value,
        job: $('#su-job').value, headId: $('#su-head').value, teamId: $('#su-team').value,
        rrn: $('#su-rrn').value, bank: $('#su-bank').value, accountNo: $('#su-account').value, holder: $('#su-holder').value,
        pin: $('#su-pin').value, consent: true
      });
      $('#form-signup').reset();
      show('signup-done');
    });
  });

  // ---------- 로그인 ----------
  $('#form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#form-login button[type=submit]');
    $('#login-device-help').classList.add('hidden');
    runBusy(btn, async function () {
      try {
        var res = await Api.call('staff.login', { phone: $('#login-phone').value, pin: $('#login-pin').value });
        Api.setToken(res.token);
        $('#login-pin').value = '';
        await showHome();
      } catch (err) {
        if (err.code === 'DEVICE_MISMATCH' || err.code === 'DEVICE_PENDING') {
          $('#login-device-help').classList.remove('hidden');
          $('#dv-phone').value = $('#login-phone').value;
        }
        throw err;
      }
    });
  });

  // ---------- 기기 변경 ----------
  $('#form-device').addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('#form-device button[type=submit]');
    runBusy(btn, async function () {
      await Api.call('staff.requestDeviceChange', { phone: $('#dv-phone').value, pin: $('#dv-pin').value });
      $('#dv-pin').value = '';
      toast('요청했습니다. 관리자 승인 후 로그인해 주세요.');
      location.hash = '#login';
    });
  });

  // ---------- 로그아웃 ----------
  $('#btn-logout').addEventListener('click', function () {
    runBusy($('#btn-logout'), async function () {
      try { await Api.call('auth.logout'); } catch (e) { /* 이미 만료됐어도 화면에서는 로그아웃 */ }
      Api.setToken('');
      show('login');
    });
  });

  window.addEventListener('hashchange', route);
  loadOrgs().catch(function () { /* 현장명 표시용 — 실패해도 무시 */ });
  route();
})();
