// 영업직원 화면: 가입, 로그인, 기기 변경 요청, 홈
(function () {
  Api.setScope('staff');
  var BANKS = ['국민', '신한', '우리', '하나', '농협', '기업', 'SC제일', '카카오뱅크', '토스뱅크', '케이뱅크', '새마을금고', '우체국', '신협', '수협', '부산', '대구', '광주', '전북', '경남', '제주', '기타'];
  var orgs = null;
  var selfieRequired = false;
  var genderRequired = false;

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
    selfieRequired = me.selfieRequired;
    genderRequired = me.genderRequired;
    $('#tg-status').textContent = me.telegramLinked ? '연결됨' : '연결 안 됨';
    $('#tg-status').style.color = me.telegramLinked ? 'var(--ok)' : 'var(--danger)';
    $('#btn-telegram').textContent = me.telegramLinked ? '텔레그램 다시 연결' : '텔레그램 연결';
    $('#btn-checkin').disabled = me.checkedInToday;
    $('#btn-checkin').textContent = me.checkedInToday ? '오늘 출근 완료' : '출근하기';
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

  // ---------- 출근 ----------
  var scanner = null;
  var scanHandled = false;
  var lastWarn = 0;
  var positionPromise = null;
  var selfieData = '';

  async function stopScanner() {
    if (!scanner) return;
    try { await scanner.stop(); scanner.clear(); } catch (e) { /* 이미 멈춤 */ }
    scanner = null;
  }

  async function startCheckin() {
    if (!window.Html5Qrcode) { toast('QR 스캔 기능을 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.', true); return; }
    show('scan');
    scanHandled = false;
    selfieData = '';
    scanner = new Html5Qrcode('qr-reader');
    try {
      await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, onScan, function () { /* 인식 실패 프레임은 무시 */ });
    } catch (e) {
      scanner = null;
      toast('카메라를 사용할 수 없습니다. 브라우저의 카메라 권한을 허용해 주세요.', true);
      show('home');
    }
  }

  async function onScan(text) {
    if (scanHandled) return;
    if (text.indexOf('WN-ATT|') !== 0) {
      if (Date.now() - lastWarn > 2500) { lastWarn = Date.now(); toast('출근 QR이 아닙니다.', true); }
      return;
    }
    scanHandled = text; // 셀카 단계에서 다시 쓰려고 QR 값을 보관
    await stopScanner();
    // QR 을 읽자마자 위치 측정을 시작한다 (셀카를 찍는 동안에도 측정 계속)
    positionPromise = getPosition();
    positionPromise.catch(function () { /* 제출할 때 처리 */ });
    if (selfieRequired) show('selfie');
    else submitCheckin(text);
  }

  // 긴 변 640px JPEG 로 줄여 base64 만 돌려준다 (전송량 절약)
  function resizeToJpeg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, 640 / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', 0.8).split(',')[1]);
      };
      img.onerror = function () { reject(new Error('사진을 읽을 수 없습니다. 다시 촬영해 주세요.')); };
      img.src = url;
    });
  }

  function showResult(ok, title, detail) {
    $('#result-icon').textContent = ok ? '✅' : '❌';
    $('#result-title').textContent = title;
    $('#result-title').style.color = ok ? 'var(--ok)' : 'var(--danger)';
    $('#result-detail').textContent = detail || '';
    show('result');
  }

  async function submitCheckin(qr) {
    showLoading(true);
    try {
      var pos = await positionPromise;
      var res = await Api.call('attendance.checkin', {
        qr: qr, lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, selfie: selfieData
      });
      showResult(true, '출근 완료', res.time + ' · 현장에서 ' + res.distance + 'm');
    } catch (e) {
      showResult(false, '출근하지 못했습니다', e.message);
    } finally {
      showLoading(false);
    }
  }

  $('#btn-checkin').addEventListener('click', function () { startCheckin(); });
  $('#btn-scan-cancel').addEventListener('click', async function () { await stopScanner(); show('home'); });
  $('#btn-result-home').addEventListener('click', function () { runBusy($('#btn-result-home'), showHome); });
  $('#selfie-input').addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    runBusy(null, async function () {
      selfieData = await resizeToJpeg(file);
      await submitCheckin(scanHandled);
    });
  });

  // ---------- 텔레그램 연결 ----------
  $('#btn-telegram').addEventListener('click', function () {
    var btn = $('#btn-telegram');
    runBusy(btn, async function () {
      var res = await Api.call('staff.telegramLink');
      // 텔레그램 앱이 열린다. 봇 화면에서 [시작]을 누르면 연결 완료 → 이 화면으로 돌아와 새로고침
      toast('텔레그램에서 [시작]을 누른 뒤, 이 화면으로 돌아와 주세요.');
      window.location.href = res.url;
    });
  });

  // ---------- 예약 ----------
  var rvTab = '예정';

  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function openReserve() {
    var date = $('#rv-date');
    date.min = todayLocal();
    if (!date.value) date.value = todayLocal();
    $('#rv-gender-label').textContent = genderRequired ? '성별 (필수)' : '성별 (선택)';
    $('#rv-gender').required = genderRequired;
    show('reserve');
    return loadReservations();
  }

  async function loadReservations() {
    $$('#rv-tabs .tab').forEach(function (t) { t.classList.toggle('active', t.dataset.rtab === rvTab); });
    var res = await Api.call('reservation.list', { tab: rvTab });
    var box = $('#rv-list');
    box.innerHTML = '';
    if (!res.reservations.length) { box.appendChild(h('p', { class: 'muted' }, '예약이 없습니다.')); return; }
    res.reservations.forEach(function (r) {
      var meta = r.date + ' · 뒤 ' + r.last5 + (r.gender ? ' (' + r.gender + ')' : '');
      var line = h('div', { class: 'stat', style: 'align-items:center;flex-wrap:wrap;gap:8px' },
        h('div', null, h('strong', null, meta), r.memo ? h('div', { class: 'muted' }, r.memo) : null,
          rvTab === '미방문·취소' ? h('span', { class: 'badge' }, r.status) : null));
      if (r.status === '예정') {
        var edit = h('button', { type: 'button', class: 'btn small' }, '수정');
        edit.addEventListener('click', function () { editReservation(r); });
        var cancel = h('button', { type: 'button', class: 'btn small danger' }, '취소');
        cancel.addEventListener('click', function () {
          if (!confirm('뒤 ' + r.last5 + ' 예약을 취소할까요?')) return;
          runBusy(cancel, async function () { await Api.call('reservation.cancel', { id: r.id }); await loadReservations(); toast('취소했습니다.'); });
        });
        line.appendChild(h('div', null, edit, ' ', cancel));
      }
      box.appendChild(line);
    });
  }

  function editReservation(r) {
    var date = h('input', { type: 'date', value: r.date, min: todayLocal(), style: 'width:100%;height:48px;border:1px solid var(--line);border-radius:8px;padding:0 12px;font:inherit' });
    var memo = h('input', { type: 'text', value: r.memo, maxLength: 100 });
    modal('예약 수정 (뒤 ' + r.last5 + ')', h('div', null, field('방문 예정일', date), field('메모', memo)), [{
      label: '저장', primary: true, onClick: async function (close) {
        await Api.call('reservation.update', { id: r.id, date: date.value, memo: memo.value });
        close(); await loadReservations(); toast('수정했습니다.');
      }
    }]);
  }

  bindFormat($('#rv-last5'), onlyDigits);
  $('#btn-reserve').addEventListener('click', function () { runBusy($('#btn-reserve'), openReserve); });
  $('#btn-reserve-back').addEventListener('click', function () { runBusy($('#btn-reserve-back'), showHome); });
  $('#rv-tabs').addEventListener('click', function (e) {
    var t = e.target.closest('.tab');
    if (!t) return;
    rvTab = t.dataset.rtab;
    runBusy(null, loadReservations);
  });
  $('#form-reserve').addEventListener('submit', function (e) {
    e.preventDefault();
    runBusy($('#form-reserve button[type=submit]'), async function () {
      await Api.call('reservation.create', {
        last5: $('#rv-last5').value, date: $('#rv-date').value, gender: $('#rv-gender').value, memo: $('#rv-memo').value
      });
      $('#rv-last5').value = ''; $('#rv-memo').value = ''; $('#rv-gender').value = '';
      toast('예약을 등록했습니다.');
      rvTab = '예정';
      await loadReservations();
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
