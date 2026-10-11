// 최초 1회 실행: 구글시트 2개(A 운영, B 급여)와 시트·헤더를 만들고, 관리자 계정을 만든다.
// 여러 번 실행해도 안전하다 (있는 것은 건드리지 않고 없는 것만 채움).

var SCHEMA_A = {
  '설정': ['항목', '값', '설명'],
  '조직': ['조직ID', '구분', '이름', '상위조직ID', '순서', '사용여부'],
  '직원': ['직원ID', '성명', '예명', '휴대폰', '직군', '본부ID', '팀ID', '상태', '반려사유', 'PIN해시', '실패횟수', '기기키', '기기변경요청', '텔레그램ID', '텔레그램연결코드', '가입일시', '승인일시'],
  // 비번변경필요: 명세에 없는 열. "첫 로그인 시 비밀번호 변경 강제"를 구현하려고 추가
  '계정': ['계정ID', '아이디', '비밀번호해시', '역할', '이름', '실패횟수', '사용여부', '비번변경필요'],
  '세션': ['토큰', '사용자구분', '사용자ID', '만료일시'],
  'QR발급': ['날짜', 'QR값', '기준위도', '기준경도', '정확도m', '발급계정ID', '발급일시'],
  '근태': ['근태ID', '날짜', '직원ID', '시각', '위도', '경도', '정확도m', '거리m', '기기키', '셀카링크', '결과', '실패사유'],
  '예약': ['예약ID', '뒤5자리', '성별', '방문예정일', '직원ID', '메모', '상태', '등록일시'],
  '방문': ['방문ID', '방문일시', '뒤5자리', '성별', '예약ID', '담당직원ID', '구분', '호출일시', '확인일시', '데스크계정ID'],
  '로그': ['일시', '사용자', '행위', '대상', '내용']
};

var SCHEMA_B = {
  '급여정보': ['직원ID', '성명', '주민번호', '은행', '계좌번호', '예금주', '동의일시']
};

var DEFAULT_SETTINGS = [
  ['현장명', '', '화면 상단에 표시되는 현장 이름'],
  ['GPS허용거리m', '200', '출근 QR 기준점에서 이 거리(m) 안이어야 출근 인정'],
  ['예약중복기준', '뒤5자리', '뒤5자리 / 뒤5자리+성별'],
  ['출근셀카사용', 'N', 'Y 이면 출근 시 셀카 촬영'],
  ['텔레그램봇이름', '', '@ 없이 봇 사용자명 (예: my_site_bot)']
];

// 처음 쓸 수 있도록 예시 본부·팀을 넣어 둔다. 실제 조직에 맞게 관리자 화면 > 설정 > 조직 에서 고치면 된다.
var DEFAULT_JOBS = ['영업', '홍보단', '상담사', '도우미', '아르바이트'];
var DEFAULT_HEADS = { '1본부': ['1팀', '2팀'], '2본부': ['1팀', '2팀'] };

function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SALT')) {
    // 한 번 정해지면 절대 바꾸면 안 된다 (바꾸면 모든 PIN·비밀번호가 무효가 됨)
    props.setProperty('SALT', Utilities.getUuid() + Utilities.getUuid());
  }
  var urls = {};
  [['A', SCHEMA_A, '근태관리_A_운영데이터'], ['B', SCHEMA_B, '근태관리_B_급여정보(공유금지)']].forEach(function (def) {
    var key = 'SHEET_' + def[0] + '_ID';
    var ss = props.getProperty(key) ? SpreadsheetApp.openById(props.getProperty(key)) : SpreadsheetApp.create(def[2]);
    props.setProperty(key, ss.getId());
    ensureSheets_(ss, def[1]);
    urls[def[0]] = ss.getUrl();
  });
  ssMemo_ = {};

  seedSettings_();
  seedOrgs_();
  var initialPassword = seedAdmin_();

  Logger.log('=== Setup 완료 ===');
  Logger.log('시트 A (운영 데이터): ' + urls.A);
  Logger.log('시트 B (급여정보, 절대 공유 금지): ' + urls.B);
  if (initialPassword) {
    Logger.log('관리자 아이디: admin');
    Logger.log('초기 비밀번호: ' + initialPassword + '   (첫 로그인 때 바꾸게 됩니다. 이 로그는 다른 곳에 옮기지 마세요)');
  } else {
    Logger.log('관리자 계정은 이미 있어 새로 만들지 않았습니다. (비밀번호를 잊었다면 resetAdminPassword 실행)');
  }
}

function ensureSheets_(ss, schema) {
  Object.keys(schema).forEach(function (name) {
    var headers = schema[name];
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var existing = sh.getLastRow() === 0 ? [] : sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String).filter(String);
    var toAdd = headers.filter(function (h) { return existing.indexOf(h) < 0; }); // 기존 열 순서는 존중하고 빠진 열만 뒤에 추가
    if (toAdd.length) {
      if (existing.length + toAdd.length > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), existing.length + toAdd.length - sh.getMaxColumns());
      sh.getRange(1, existing.length + 1, 1, toAdd.length).setValues([toAdd]);
    }
    var n = existing.length + toAdd.length;
    // 전화번호 앞자리 0, 날짜 문자열이 숫자·날짜로 자동 변환되지 않도록 전체를 텍스트 서식으로
    sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).setNumberFormat('@');
    sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#eef2f7');
    sh.setFrozenRows(1);
  });
  ['Sheet1', '시트1'].forEach(function (n) {
    var d = ss.getSheetByName(n);
    if (d && ss.getSheets().length > 1 && d.getLastRow() === 0) ss.deleteSheet(d);
  });
}

function seedSettings_() {
  var rows = readAll('설정');
  DEFAULT_SETTINGS.forEach(function (d) {
    if (!rows.some(function (r) { return s_(r.항목) === d[0]; })) appendRow('설정', { 항목: d[0], 값: d[1], 설명: d[2] });
  });
}

function seedOrgs_() {
  if (readAll('조직').length) return;
  DEFAULT_JOBS.forEach(function (name, i) {
    appendRow('조직', { 조직ID: newId_('O'), 구분: '직군', 이름: name, 상위조직ID: '', 순서: i + 1, 사용여부: 'Y' });
  });
  Object.keys(DEFAULT_HEADS).forEach(function (head, i) {
    var headId = newId_('O');
    appendRow('조직', { 조직ID: headId, 구분: '본부', 이름: head, 상위조직ID: '', 순서: i + 1, 사용여부: 'Y' });
    DEFAULT_HEADS[head].forEach(function (team, j) {
      appendRow('조직', { 조직ID: newId_('O'), 구분: '팀', 이름: team, 상위조직ID: headId, 순서: j + 1, 사용여부: 'Y' });
    });
  });
}

function randomPassword_() {
  var letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  var digits = '23456789';
  var out = '';
  for (var i = 0; i < 8; i++) out += letters.charAt(Math.floor(Math.random() * letters.length));
  for (var j = 0; j < 2; j++) out += digits.charAt(Math.floor(Math.random() * digits.length));
  return out;
}

// 관리자 계정이 없을 때만 만들고 초기 비밀번호를 돌려준다
function seedAdmin_() {
  if (findOne('계정', function (a) { return s_(a.역할) === '관리자'; })) return null;
  var pw = randomPassword_();
  appendRow('계정', {
    계정ID: newId_('A'), 아이디: 'admin', 비밀번호해시: hashSecret_(pw), 역할: '관리자', 이름: '관리자',
    실패횟수: 0, 사용여부: 'Y', 비번변경필요: 'Y'
  });
  return pw;
}

// 관리자 비밀번호를 잊었거나 5회 실패로 잠겼을 때: 편집기에서 이 함수를 실행하면 admin 의 새 비밀번호가 로그에 나온다
function resetAdminPassword() {
  var acc = findOne('계정', function (a) { return s_(a.아이디) === 'admin'; });
  if (!acc) throw new Error('admin 계정이 없습니다. setup 을 먼저 실행하세요.');
  var pw = randomPassword_();
  updateRow('계정', acc._row, { 비밀번호해시: hashSecret_(pw), 비번변경필요: 'Y', 실패횟수: 0, 사용여부: 'Y' });
  destroyUserSessions_('계정', s_(acc.계정ID));
  Logger.log('admin 새 비밀번호: ' + pw + '   (로그인하면 바로 바꾸게 됩니다)');
}

// ---------- 텔레그램 (3단계) ----------
// 순서: 1) 스크립트 속성에 TELEGRAM_TOKEN 입력  2) (선택) WEBAPP_URL 입력  3) 이 함수 한 번 실행
// 웹훅 주소 끝에 비밀값(?tg=...)을 붙여, 텔레그램이 아닌 곳에서 보낸 가짜 요청은 무시한다.
function setTelegramWebhook() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_TOKEN');
  if (!token) throw new Error('스크립트 속성 TELEGRAM_TOKEN 이 비어 있습니다. 배포가이드의 텔레그램 단계를 먼저 하세요.');
  var base = props.getProperty('WEBAPP_URL') || ScriptApp.getService().getUrl();
  if (!base || !/\/exec$/.test(base)) throw new Error('웹앱 주소(/exec 로 끝나는 URL)를 찾지 못했습니다. 스크립트 속성 WEBAPP_URL 에 배포 주소를 넣고 다시 실행하세요.');
  if (!props.getProperty('TELEGRAM_SECRET')) props.setProperty('TELEGRAM_SECRET', Utilities.getUuid().replace(/-/g, ''));
  var url = base + '?tg=' + props.getProperty('TELEGRAM_SECRET');
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/setWebhook', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    // drop_pending_updates: 응답이 302 라서 텔레그램에 쌓인 재전송 대기분을 비운다
    payload: JSON.stringify({ url: url, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true })
  });
  Logger.log('setWebhook 결과: ' + res.getContentText());
}

// 봇이 잘 연결됐는지 확인 (봇 이름, 웹훅 상태). 토큰 값은 출력하지 않는다.
function test_telegramInfo() {
  var me = telegramApi_('getMe', {});
  Logger.log(me.ok ? '봇 이름: @' + me.result.username + '  (설정 > 텔레그램 봇 이름에 이 값을 넣으세요)' : '봇 확인 실패: ' + me.description);
  var info = telegramApi_('getWebhookInfo', {});
  if (info.ok) {
    Logger.log('웹훅 등록: ' + (info.result.url ? '됨' : '안 됨') + ' / 대기 중 업데이트: ' + info.result.pending_update_count);
    if (info.result.last_error_message) Logger.log('마지막 오류: ' + info.result.last_error_message + ' (302 는 정상적으로 나올 수 있음)');
  }
}
