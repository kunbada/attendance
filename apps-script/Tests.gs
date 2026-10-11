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
