// 편집기에서 함수를 골라 ▶ 실행 → 아래 "실행 로그"에서 결과를 확인한다. (배포 없이 바로 가능)
// 테스트용 가짜 직원(010-0000-0000)은 끝나면 자동으로 지워진다. 주민번호도 가짜 값.

var TEST_PHONE_ = '01000000000';

function testCall_(token, deviceKey, action, data) {
  return JSON.parse(doPost({ postData: { contents: JSON.stringify({ action: action, token: token, deviceKey: deviceKey, data: data || {} }) } }).getContent());
}

function testExpect_(label, res, wantOk, wantCode) {
  var pass = res.ok === wantOk && (wantCode === undefined || res.code === wantCode);
  Logger.log((pass ? '[통과] ' : '[실패] ') + label + (res.ok ? '' : ' → ' + res.error));
  return pass;
}

function testCleanup_() {
  var staff = filterRows('직원', function (r) { return s_(r.휴대폰) === TEST_PHONE_; });
  staff.forEach(function (r) {
    destroyUserSessions_('직원', s_(r.직원ID));
    filterRows('급여정보', function (p) { return s_(p.직원ID) === s_(r.직원ID); }).forEach(function (p) { deleteRows('급여정보', [p._row]); });
  });
  deleteRows('직원', staff.map(function (r) { return r._row; }));
}

// 1단계 전체 흐름: 가입 → 승인 전 로그인 거부 → 승인 → 로그인 → 다른 폰 거부 → 기기 변경 승인
function test_stage1() {
  testCleanup_();
  // 실제 관리자 계정을 건드리지 않도록 임시 관리자 계정을 만들어 쓰고 끝나면 지운다
  var tmpId = newId_('A');
  appendRow('계정', { 계정ID: tmpId, 아이디: 'test_tmp_admin', 비밀번호해시: hashSecret_('unused1234'), 역할: '관리자', 이름: '임시', 실패횟수: 0, 사용여부: 'Y', 비번변경필요: 'N' });
  var adminToken = createSession_('계정', tmpId);
  var devA = 'test-device-AAAA', devB = 'test-device-BBBB';
  var ok = true;
  try {
    var orgs = testCall_('', '', 'public.orgs').data;
    var sales = orgs.jobs.filter(function (j) { return j.name === SALES_JOB; })[0];
    ok = testExpect_('가입 화면용 조직 목록', { ok: !!sales && orgs.heads.length > 0 }, true) && ok;

    var signup = {
      name: '테스트직원', nickname: '테스트', phone: '010-0000-0000', pin: '1234', job: '상담사',
      rrn: '000101-3000000', bank: '국민', accountNo: '000-000-000000', holder: '테스트직원', consent: true
    };
    ok = testExpect_('동의 없이 가입 → 거부', testCall_('', devA, 'staff.signup', Object.assign({}, signup, { consent: false })), false) && ok;
    ok = testExpect_('가입 신청', testCall_('', devA, 'staff.signup', signup), true) && ok;
    ok = testExpect_('같은 번호 중복 가입 → 거부', testCall_('', devB, 'staff.signup', signup), false) && ok;
    ok = testExpect_('승인 전 로그인 → 거부', testCall_('', devA, 'staff.login', { phone: TEST_PHONE_, pin: '1234' }), false) && ok;

    var staffId = s_(findOne('직원', function (r) { return s_(r.휴대폰) === TEST_PHONE_; }).직원ID);
    ok = testExpect_('직원 토큰으로 관리자 action → 거부', testCall_('x', devA, 'admin.staffList'), false, 'AUTH') && ok;
    ok = testExpect_('관리자 승인', testCall_(adminToken, '', 'admin.approve', { staffId: staffId }), true) && ok;

    ok = testExpect_('틀린 PIN → 거부', testCall_('', devA, 'staff.login', { phone: TEST_PHONE_, pin: '9999' }), false) && ok;
    var login = testCall_('', devA, 'staff.login', { phone: TEST_PHONE_, pin: '1234' });
    ok = testExpect_('등록된 폰에서 로그인', login, true) && ok;
    ok = testExpect_('로그인 후 내 정보', testCall_(login.data.token, devA, 'staff.me'), true) && ok;
    ok = testExpect_('토큰은 맞지만 다른 폰 → 거부', testCall_(login.data.token, devB, 'staff.me'), false, 'DEVICE_MISMATCH') && ok;
    ok = testExpect_('다른 폰에서 같은 PIN 로그인 → 거부', testCall_('', devB, 'staff.login', { phone: TEST_PHONE_, pin: '1234' }), false, 'DEVICE_MISMATCH') && ok;

    ok = testExpect_('기기 변경 요청', testCall_('', devB, 'staff.requestDeviceChange', { phone: TEST_PHONE_, pin: '1234' }), true) && ok;
    ok = testExpect_('승인 전 새 폰 로그인 → 거부', testCall_('', devB, 'staff.login', { phone: TEST_PHONE_, pin: '1234' }), false, 'DEVICE_PENDING') && ok;
    ok = testExpect_('기기 변경 승인', testCall_(adminToken, '', 'admin.approveDevice', { staffId: staffId }), true) && ok;
    ok = testExpect_('승인 후 새 폰 로그인', testCall_('', devB, 'staff.login', { phone: TEST_PHONE_, pin: '1234' }), true) && ok;
    ok = testExpect_('승인 후 이전 폰 로그인 → 거부', testCall_('', devA, 'staff.login', { phone: TEST_PHONE_, pin: '1234' }), false, 'DEVICE_MISMATCH') && ok;

    var pay = testCall_(adminToken, '', 'admin.payrollGet', { staffId: staffId });
    ok = testExpect_('급여정보 마스킹 조회', pay, true) && ok;
    Logger.log('   마스킹 결과: ' + pay.data.rrn + ' / ' + pay.data.accountNo);
    ok = testExpect_('직원 응답에 주민번호 없음', { ok: JSON.stringify(testCall_(login.data.token, devA, 'staff.me')).indexOf('000101') < 0 }, true) && ok;
  } finally {
    destroySession_(adminToken);
    deleteRows('계정', filterRows('계정', function (a) { return s_(a.계정ID) === tmpId; }).map(function (a) { return a._row; }));
    testCleanup_();
  }
  Logger.log(ok ? '=== 1단계 테스트 전체 통과 ===' : '=== 실패한 항목이 있습니다. 위 [실패] 줄을 확인하세요 ===');
}

// 관리자 로그인이 되는지 직접 확인 (비밀번호를 아래 따옴표 안에 넣고 실행. 확인 후 지우세요)
function test_adminLogin() {
  var res = testCall_('', '', 'account.login', { loginId: 'admin', password: '여기에_비밀번호' });
  Logger.log(res.ok ? '로그인 성공 (비밀번호 변경 필요: ' + res.data.account.mustChangePassword + ')' : '실패: ' + res.error);
  if (res.ok) destroySession_(res.data.token);
}

// 2단계: QR 발급 → 출근 성공 / 중복 / 한 폰 두 직원 / 틀린 QR / 거리 초과 / 현황 조회
// 오늘 이미 발급한 진짜 QR 이 있으면 테스트가 끝난 뒤 그대로 복원한다.
function test_stage2() {
  var tmpAdmin = newId_('A');
  appendRow('계정', { 계정ID: tmpAdmin, 아이디: 'test_tmp_admin', 비밀번호해시: hashSecret_('unused1234'), 역할: '관리자', 이름: '임시', 실패횟수: 0, 사용여부: 'Y', 비번변경필요: 'N' });
  var adminToken = createSession_('계정', tmpAdmin);
  var savedQr = todayQrRow_();
  var savedQrValues = savedQr ? JSON.parse(JSON.stringify(savedQr)) : null;
  var ids = [newId_('S'), newId_('S')];
  var devA = 'test-device-AAAA', devB = 'test-device-BBBB';
  ids.forEach(function (id, i) {
    appendRow('직원', { 직원ID: id, 성명: '테스트' + (i + 1), 휴대폰: '0100000000' + i, 직군: '상담사', 상태: '활동', PIN해시: hashSecret_('1234'), 실패횟수: 0, 기기키: i === 0 ? devA : devB, 가입일시: nowStr() });
  });
  var tokA = createSession_('직원', ids[0]), tokB = createSession_('직원', ids[1]);
  var ok = true;
  var check = function (label, res, wantOk, msgPart) {
    var pass = testExpect_(label, res, wantOk) && (!msgPart || (res.error || '').indexOf(msgPart) >= 0);
    if (!pass && msgPart) Logger.log('   (기대한 문구: ' + msgPart + ')');
    ok = pass && ok;
  };
  try {
    var base = { lat: 37.5000, lng: 127.0000 };
    var issued = testCall_(adminToken, '', 'admin.issueQr', { lat: base.lat, lng: base.lng, accuracy: 12 });
    check('QR 발급', issued, true);
    var qr = issued.data.qr;
    check('QR 형식', { ok: /^WN-ATT\|\d{4}-\d{2}-\d{2}\|[A-Z0-9]{16}$/.test(qr) }, true);
    check('직원이 QR 발급 시도 → 거부', testCall_(tokA, devA, 'admin.issueQr', base), false);

    var near = { qr: qr, lat: 37.5003, lng: 127.0003, accuracy: 10 }; // 약 45m
    check('틀린 QR → 실패', testCall_(tokA, devA, 'attendance.checkin', Object.assign({}, near, { qr: 'WN-ATT|2000-01-01|XXXXXXXXXXXXXXXX' })), false, '오늘 QR이 아닙니다');
    check('200m 밖 → 실패', testCall_(tokA, devA, 'attendance.checkin', { qr: qr, lat: 37.5035, lng: 127.0000, accuracy: 10 }), false, '떨어져 있습니다');
    var good = testCall_(tokA, devA, 'attendance.checkin', near);
    check('현장에서 출근 성공', good, true);
    Logger.log('   거리 ' + (good.data && good.data.distance) + 'm, 시각 ' + (good.data && good.data.time));
    check('같은 직원 두 번째 출근 → 거부', testCall_(tokA, devA, 'attendance.checkin', near), false, '이미 출근');
    // 직원 2가 직원 1의 폰으로 (기기키를 도용하려면 자기 토큰 + 직원 1의 기기키는 일치하지 않아 이미 막힘)
    check('다른 직원 토큰 + 남의 기기키 → 거부', testCall_(tokB, devA, 'attendance.checkin', near), false, '등록된 휴대폰이 아닙니다');
    // 한 폰 두 직원: 직원 2의 등록 기기를 직원 1과 같게 만들어 판정 3을 직접 확인
    updateRow('직원', findOne('직원', function (r) { return s_(r.직원ID) === ids[1]; })._row, { 기기키: devA });
    check('한 폰으로 두 번째 직원 → 실패', testCall_(tokB, devA, 'attendance.checkin', near), false, '다른 직원이 출근');

    var day = testCall_(adminToken, '', 'admin.attendance', { date: todayStr() });
    check('일별 현황', day, true);
    var presentIds = day.data.present.map(function (p) { return p.id; });
    check('출근자 목록에 직원1', { ok: presentIds.indexOf(ids[0]) >= 0 && presentIds.indexOf(ids[1]) < 0 }, true);
    check('실패 기록이 남음 (3건)', { ok: day.data.failures.filter(function (f) { return /테스트/.test(f.name); }).length === 3 }, true);
    var mon = testCall_(adminToken, '', 'admin.attendance', { month: todayStr().slice(0, 7) });
    check('월별 현황', mon, true);
    check('직원 응답에 다른 직원 정보 없음', { ok: JSON.stringify(testCall_(tokA, devA, 'staff.me')).indexOf('테스트2') < 0 }, true);
  } finally {
    destroySession_(adminToken);
    deleteRows('계정', filterRows('계정', function (a) { return s_(a.계정ID) === tmpAdmin; }).map(function (a) { return a._row; }));
    ids.forEach(function (id) {
      destroyUserSessions_('직원', id);
      deleteRows('근태', filterRows('근태', function (r) { return s_(r.직원ID) === id; }).map(function (r) { return r._row; }));
      deleteRows('직원', filterRows('직원', function (r) { return s_(r.직원ID) === id; }).map(function (r) { return r._row; }));
    });
    var cur = todayQrRow_();
    if (savedQrValues) updateRow('QR발급', cur._row, savedQrValues);
    else if (cur) deleteRows('QR발급', [cur._row]);
  }
  Logger.log(ok ? '=== 2단계 테스트 전체 통과 ===' : '=== 실패한 항목이 있습니다. 위 [실패] 줄을 확인하세요 ===');
}

// 3단계: 예약 중복 규칙(두 가지 기준), 텔레그램 연결·호출·확인(가짜 텔레그램으로), 데스크 조회·방문 기록
// 실제 텔레그램으로는 아무것도 보내지 않는다. 설정값은 끝나면 원래대로 복원된다.
function test_stage3() {
  var props = PropertiesService.getScriptProperties();
  var hadSecret = !!props.getProperty('TELEGRAM_SECRET');
  if (!hadSecret) props.setProperty('TELEGRAM_SECRET', 'testsecret');
  var secret = props.getProperty('TELEGRAM_SECRET');
  var settings = getSettings_();
  var saved = { dup: settings['예약중복기준'], bot: settings['텔레그램봇이름'] };
  var setSetting = function (k, v) {
    var row = findOne('설정', function (r) { return s_(r.항목) === k; });
    if (row) updateRow('설정', row._row, { 값: v }); else appendRow('설정', { 항목: k, 값: v });
  };
  var tmpDesk = newId_('A'), tmpAdmin = newId_('A');
  appendRow('계정', { 계정ID: tmpDesk, 아이디: 'test_tmp_desk', 비밀번호해시: hashSecret_('unused1234'), 역할: '데스크', 이름: '임시데스크', 실패횟수: 0, 사용여부: 'Y', 비번변경필요: 'N' });
  appendRow('계정', { 계정ID: tmpAdmin, 아이디: 'test_tmp_admin', 비밀번호해시: hashSecret_('unused1234'), 역할: '관리자', 이름: '임시', 실패횟수: 0, 사용여부: 'Y', 비번변경필요: 'N' });
  var deskTok = createSession_('계정', tmpDesk), adminTok = createSession_('계정', tmpAdmin);
  var ids = [newId_('S'), newId_('S')];
  var devA = 'test-device-AAAA', devB = 'test-device-BBBB';
  ids.forEach(function (id, i) {
    appendRow('직원', { 직원ID: id, 성명: '테스트' + (i + 1), 예명: '별' + (i + 1), 휴대폰: '0100000000' + i, 직군: '상담사', 상태: '활동', PIN해시: hashSecret_('1234'), 실패횟수: 0, 기기키: i === 0 ? devA : devB, 가입일시: nowStr() });
  });
  var tokA = createSession_('직원', ids[0]), tokB = createSession_('직원', ids[1]);
  var sent = [];
  telegramStub_ = function (method, payload) { sent.push({ method: method, payload: payload }); return { ok: true }; };
  var ok = true;
  var check = function (label, res, wantOk, msgPart) {
    var pass = testExpect_(label, res, wantOk) && (!msgPart || (res.error || '').indexOf(msgPart) >= 0);
    if (!pass && msgPart) Logger.log('   (기대한 문구: ' + msgPart + ', 실제: ' + res.error + ')');
    ok = pass && ok;
  };
  var webhook = function (body) {
    doPost({ postData: { contents: JSON.stringify(body) }, parameter: { tg: secret } });
  };
  var uid = Date.now(); // 캐시에 남은 이전 테스트의 update_id 와 겹치지 않게
  var today = todayStr();
  var staffRow = function (id) { return findOne('직원', function (r) { return s_(r.직원ID) === id; }); };
  try {
    // --- 예약 중복 (뒤5자리 기준)
    setSetting('예약중복기준', '뒤5자리');
    var r1 = testCall_(tokA, devA, 'reservation.create', { last5: '12345', date: today, gender: '남', memo: '테스트' });
    check('예약 등록', r1, true);
    check('다른 직원이 같은 뒤5자리 → 차단', testCall_(tokB, devB, 'reservation.create', { last5: '12345', date: today, gender: '여' }), false, '이미 예약된 고객입니다.');
    check('본인이 또 등록 → 내 예약 안내', testCall_(tokA, devA, 'reservation.create', { last5: '12345', date: today }), false, '이미 내 예약이 있습니다');
    check('뒤5자리 형식 오류', testCall_(tokA, devA, 'reservation.create', { last5: '123', date: today }), false);
    check('지난 날짜 → 거부', testCall_(tokA, devA, 'reservation.create', { last5: '22222', date: '2000-01-01' }), false);
    // --- 예약 중복 (뒤5자리+성별 기준)
    setSetting('예약중복기준', '뒤5자리+성별');
    check('성별 기준: 성별 없으면 거부', testCall_(tokB, devB, 'reservation.create', { last5: '33333', date: today }), false, '성별');
    check('성별 기준: 번호는 같고 성별이 다르면 허용', testCall_(tokB, devB, 'reservation.create', { last5: '12345', date: today, gender: '여' }), true);
    check('성별 기준: 번호·성별 모두 같으면 차단', testCall_(tokB, devB, 'reservation.create', { last5: '12345', date: today, gender: '남' }), false, '이미 예약된 고객입니다.');
    // --- 목록·수정·취소
    var list = testCall_(tokA, devA, 'reservation.list', { tab: '예정' });
    check('내 예약 목록', { ok: list.ok && list.data.reservations.length === 1 }, true);
    check('남의 예약 취소 시도 → 거부', testCall_(tokB, devB, 'reservation.cancel', { id: r1.data.id }), false);
    var r2 = testCall_(tokA, devA, 'reservation.create', { last5: '44444', date: today, gender: '여' });
    check('예약 수정', testCall_(tokA, devA, 'reservation.update', { id: r2.data.id, date: today, memo: '변경' }), true);
    check('예약 취소', testCall_(tokA, devA, 'reservation.cancel', { id: r2.data.id }), true);
    check('취소 후 같은 번호 다시 등록 가능', testCall_(tokB, devB, 'reservation.create', { last5: '44444', date: today, gender: '여' }), true);

    // --- 텔레그램 연결
    setSetting('텔레그램봇이름', '');
    check('봇 이름 없으면 연결 불가', testCall_(tokA, devA, 'staff.telegramLink'), false);
    setSetting('텔레그램봇이름', 'test_bot');
    var link = testCall_(tokA, devA, 'staff.telegramLink');
    check('연결 링크 발급', link, true);
    var code = link.ok ? link.data.url.split('start=')[1] : '';
    doPost({ postData: { contents: JSON.stringify({ update_id: uid + 1, message: { text: '/start ' + code, chat: { id: 777001, type: 'private' } } }) }, parameter: { tg: 'wrong' } });
    check('틀린 비밀값의 웹훅은 무시', { ok: !s_(staffRow(ids[0]).텔레그램ID) }, true);
    webhook({ update_id: uid + 2, message: { text: '/start ' + code, chat: { id: 777001, type: 'private' } } });
    check('웹훅으로 텔레그램 연결', { ok: s_(staffRow(ids[0]).텔레그램ID) === '777001' }, true);
    check('연결 코드는 한 번만', { ok: !s_(staffRow(ids[0]).텔레그램연결코드) }, true);

    // --- 데스크
    check('직원 토큰으로 데스크 action → 거부', testCall_(tokA, devA, 'desk.lookup', { last5: '12345' }), false);
    var look = testCall_(deskTok, '', 'desk.lookup', { last5: '12345' });
    check('데스크 조회 (같은 번호 2건: 남/여)', { ok: look.ok && look.data.reservations.length === 2 }, true);
    var mine = look.data.reservations.filter(function (x) { return x.gender === '남'; })[0];
    check('성별로 좁혀 조회', { ok: testCall_(deskTok, '', 'desk.lookup', { last5: '12345', gender: '남' }).data.reservations.length === 1 }, true);
    var reg = testCall_(deskTok, '', 'desk.registerVisit', { kind: '예약', reservationId: mine.id, last5: '12345' });
    check('예약 고객 호출', reg, true);
    check('호출 메시지가 텔레그램으로 나감', { ok: sent.some(function (m) { return m.method === 'sendMessage' && m.payload.chat_id === '777001' && m.payload.text.indexOf('[호출] 12345 고객(남)') === 0 && m.payload.reply_markup.inline_keyboard[0][0].callback_data === 'ack:' + reg.data.visitId; }) }, true);
    check('같은 예약 중복 접수 → 거부', testCall_(deskTok, '', 'desk.registerVisit', { kind: '예약', reservationId: mine.id, last5: '12345' }), false, '이미 방문 처리');
    var vis = function () { return testCall_(deskTok, '', 'desk.todayVisits').data.visits.filter(function (v) { return v.id === reg.data.visitId; })[0]; };
    check('확인 전 상태는 호출함', { ok: vis().status === '호출함' }, true);
    webhook({ update_id: uid + 3, callback_query: { id: 'cb1', from: { id: 999999 }, data: 'ack:' + reg.data.visitId, message: { text: '[호출]', chat: { id: 777001 }, message_id: 5 } } });
    check('다른 사람이 [확인]을 눌러도 무시', { ok: vis().status === '호출함' }, true);
    webhook({ update_id: uid + 4, callback_query: { id: 'cb2', from: { id: 777001 }, data: 'ack:' + reg.data.visitId, message: { text: '[호출] 12345 고객(남) 도착', chat: { id: 777001 }, message_id: 5 } } });
    check('본인이 [확인] → 확인함', { ok: vis().status === '확인함' }, true);
    check('메시지에 "확인됨"이 덧붙음', { ok: sent.some(function (m) { return m.method === 'editMessageText' && /확인됨 \d\d:\d\d$/.test(m.payload.text); }) }, true);
    check('확인된 호출 재호출 → 거부', testCall_(deskTok, '', 'desk.recall', { visitId: reg.data.visitId }), false, '이미 확인');

    // 텔레그램 미연결 직원 지명 → 번호 안내
    var named = testCall_(deskTok, '', 'desk.registerVisit', { kind: '지명', staffId: ids[1], last5: '55555', gender: '여' });
    check('미연결 직원 지명 → 호출 없이 번호 안내', { ok: named.ok && named.data.called === false && /^010-/.test(named.data.phone) }, true);
    check('미연결 직원 재호출 → 전화 안내', testCall_(deskTok, '', 'desk.recall', { visitId: named.data.visitId }), false, '전화로');
    var search = testCall_(deskTok, '', 'desk.searchStaff', { q: '별2' });
    check('예명으로 직원 검색', { ok: search.ok && search.data.staff.length === 1 && search.data.staff[0].id === ids[1] }, true);
    check('담당 없음 기록', testCall_(deskTok, '', 'desk.registerVisit', { kind: '담당없음', last5: '66666' }), true);
    var today3 = testCall_(deskTok, '', 'desk.todayVisits').data.visits.filter(function (v) { return ['12345', '55555', '66666'].indexOf(v.last5) >= 0; });
    check('오늘 방문 목록 3건', { ok: today3.length === 3 }, true);
    check('관리자 예약 현황', testCall_(adminTok, '', 'admin.reservations', { from: today, to: today }), true);
    check('관리자 방문 현황', testCall_(adminTok, '', 'admin.visits', { from: today, to: today }), true);
    check('데스크 응답에 주민번호·계좌 없음', { ok: !/주민|rrn|accountNo/.test(JSON.stringify(look) + JSON.stringify(search)) }, true);
  } finally {
    telegramStub_ = null;
    setSetting('예약중복기준', saved.dup || '뒤5자리');
    setSetting('텔레그램봇이름', saved.bot || '');
    if (!hadSecret) props.deleteProperty('TELEGRAM_SECRET');
    [deskTok, adminTok].forEach(destroySession_);
    deleteRows('계정', filterRows('계정', function (a) { return a.계정ID === tmpDesk || a.계정ID === tmpAdmin; }).map(function (a) { return a._row; }));
    deleteRows('방문', filterRows('방문', function (r) { return ids.indexOf(s_(r.담당직원ID)) >= 0 || (s_(r.구분) === '담당없음' && s_(r.뒤5자리) === '66666'); }).map(function (r) { return r._row; }));
    ids.forEach(function (id) {
      destroyUserSessions_('직원', id);
      deleteRows('예약', filterRows('예약', function (r) { return s_(r.직원ID) === id; }).map(function (r) { return r._row; }));
      deleteRows('직원', filterRows('직원', function (r) { return s_(r.직원ID) === id; }).map(function (r) { return r._row; }));
    });
  }
  Logger.log(ok ? '=== 3단계 테스트 전체 통과 ===' : '=== 실패한 항목이 있습니다. 위 [실패] 줄을 확인하세요 ===');
}
