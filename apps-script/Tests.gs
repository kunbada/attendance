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
