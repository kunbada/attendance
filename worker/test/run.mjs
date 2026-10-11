// 통합 테스트: 로컬에서 띄운 서버(wrangler dev)를 실제 HTTP 로 호출한다.
//   1) node scripts/make-seed.mjs  → 출력된 초기 비밀번호를 ADMIN_PW 로 넘긴다
//   2) wrangler dev --local --port 8787 --var TELEGRAM_API_BASE:http://127.0.0.1:9999 --var TELEGRAM_TOKEN:testtoken
//   3) ADMIN_PW=... node test/run.mjs
// 가짜 텔레그램 서버(포트 9999)를 이 스크립트가 직접 띄워서 호출 메시지를 가로챈다. 실제 텔레그램으로는 보내지 않는다.
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const ADMIN_PW = process.env.ADMIN_PW;
if (!ADMIN_PW) { console.error('ADMIN_PW 환경변수에 초기 관리자 비밀번호를 넣어 주세요.'); process.exit(1); }
const vars = Object.fromEntries(readFileSync(join(root, '.dev.vars'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('=')));
const SECRET = vars.TELEGRAM_SECRET;

// ---------- 가짜 텔레그램 ----------
const sent = [];
const fake = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => { b += d; });
  req.on('end', () => {
    sent.push({ method: req.url.split('/').pop(), payload: JSON.parse(b || '{}') });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result: {} }));
  });
});
await new Promise((r) => fake.listen(9999, '127.0.0.1', r));

// ---------- 도우미 ----------
let pass = 0, failed = 0;
const call = async (action, data, token = '', deviceKey = '') =>
  (await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token, deviceKey, data: data || {} }) })).json();
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('[통과] ' + label + (extra ? ' → ' + extra : '')); }
  else { failed++; console.log('[실패] ' + label + (extra ? ' → ' + extra : '')); }
};
const expectErr = (label, res, part, code) => check(label, res.ok === false && (!part || res.error.includes(part)) && (!code || res.code === code), res.error || '(성공해 버림)');
const expectOk = (label, res) => check(label, res.ok === true, res.ok ? '' : res.error);
const webhook = (body, secret = SECRET) => fetch(BASE + '/?tg=' + secret, { method: 'POST', body: JSON.stringify(body) });
const sql = (command) => {
  writeFileSync(join(root, '.test.sql'), command + ';');
  execFileSync('npx', ['wrangler@4', 'd1', 'execute', 'DB', '--local', '--file=.test.sql'], { cwd: root, shell: true, stdio: 'pipe', windowsHide: true });
};

const rnd = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
const uniq = rnd();
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const NEWDEV = 'other-' + uniq + '-xxxx';
const last5 = () => String(Math.floor(Math.random() * 1e5)).padStart(5, '0');
const person = (i) => ({
  phone: '010' + rnd(), name: '테스트' + i + uniq.slice(0, 3), dev: 'dev-' + i + '-' + uniq + '-xxxx', pin: '1234'
});

try {
  // ===== 관리자 로그인 + 비밀번호 변경 강제 =====
  const login1 = await call('account.login', { loginId: 'admin', password: ADMIN_PW });
  expectOk('관리자 로그인', login1);
  check('첫 로그인은 비밀번호 변경 필요', login1.data.account.mustChangePassword === true);
  let admin = login1.data.token;
  expectErr('변경 전에는 다른 기능 차단', await call('admin.staffList', {}, admin), '비밀번호를 먼저', 'MUST_CHANGE_PW');
  expectErr('약한 새 비밀번호 거부', await call('account.changePassword', { oldPassword: ADMIN_PW, newPassword: 'abc' }, admin), '8자 이상');
  expectOk('비밀번호 변경', await call('account.changePassword', { oldPassword: ADMIN_PW, newPassword: 'TestPass' + uniq.slice(0, 4) + 'a1' }, admin));
  expectOk('변경 후 관리자 기능', await call('admin.staffList', {}, admin));
  expectErr('틀린 비밀번호', await call('account.login', { loginId: 'admin', password: 'wrongpass1' }), '올바르지 않습니다');
  const orgs = (await call('public.orgs')).data;
  check('가입용 조직 목록 (영업 직군, 본부·팀)', orgs.jobs.some((j) => j.name === '영업') && orgs.heads.length >= 1 && orgs.teams.length >= 1);

  // ===== 1단계: 가입·승인·로그인·기기 =====
  const A = person(1), B = person(2);
  const base = (p, extra) => ({ name: p.name, nickname: '별' + p.name.slice(-3), phone: p.phone, pin: p.pin, job: '상담사', rrn: '000101-3000000', bank: '국민', accountNo: '000-000-000000', holder: p.name, consent: true, ...extra });
  expectErr('동의 없이 가입 거부', await call('staff.signup', base(A, { consent: false }), '', A.dev), '동의');
  expectErr('영업 직군인데 팀 없음 → 거부', await call('staff.signup', base(A, { job: '영업' }), '', A.dev), '본부');
  expectOk('가입 신청', await call('staff.signup', base(A), '', A.dev));
  expectErr('같은 번호 중복 가입 거부', await call('staff.signup', base(A), '', NEWDEV), '승인 대기');
  expectErr('같은 기기로 다른 번호 가입 거부', await call('staff.signup', base(B), '', A.dev), '다른 직원으로 등록');
  expectErr('승인 전 로그인 거부', await call('staff.login', { phone: A.phone, pin: A.pin }, '', A.dev), '승인을 기다리는');
  expectErr('직원 토큰 없이 관리자 action 거부', await call('admin.staffList', {}, 'x'), '로그인이 필요', 'AUTH');
  const list = (await call('admin.staffList', {}, admin)).data.staff;
  const idA = list.find((s) => s.phone === A.phone).id;
  expectOk('관리자 승인', await call('admin.approve', { staffId: idA }, admin));
  expectErr('틀린 PIN', await call('staff.login', { phone: A.phone, pin: '9999' }, '', A.dev), '1/5');
  const loginA = await call('staff.login', { phone: A.phone, pin: A.pin }, '', A.dev);
  expectOk('등록된 폰에서 로그인', loginA);
  const tokA = loginA.data.token;
  expectOk('내 정보', await call('staff.me', {}, tokA, A.dev));
  expectErr('토큰은 맞지만 다른 폰 → 거부', await call('staff.me', {}, tokA, NEWDEV), '등록된 휴대폰이 아닙니다', 'DEVICE_MISMATCH');
  expectErr('다른 폰에서 같은 PIN 로그인 → 거부', await call('staff.login', { phone: A.phone, pin: A.pin }, '', NEWDEV), '등록된 휴대폰이 아닙니다', 'DEVICE_MISMATCH');
  expectOk('기기 변경 요청', await call('staff.requestDeviceChange', { phone: A.phone, pin: A.pin }, '', NEWDEV));
  expectErr('승인 전 새 폰 로그인 → 거부', await call('staff.login', { phone: A.phone, pin: A.pin }, '', NEWDEV), '승인을 기다리는', 'DEVICE_PENDING');
  expectOk('기기 변경 승인', await call('admin.approveDevice', { staffId: idA }, admin));
  expectOk('승인 후 새 폰 로그인', await call('staff.login', { phone: A.phone, pin: A.pin }, '', NEWDEV));
  expectErr('승인 후 이전 폰 로그인 거부', await call('staff.login', { phone: A.phone, pin: A.pin }, '', A.dev), '등록된 휴대폰이 아닙니다');
  expectErr('기기 교체 시 이전 폰 토큰 무효', await call('staff.me', {}, tokA, A.dev), null);
  A.dev = NEWDEV;
  const pay = await call('admin.payrollGet', { staffId: idA }, admin);
  check('급여정보는 마스킹되어 나옴', pay.ok && pay.data.rrn === '000101-3******' && pay.data.accountNo === '******0000', pay.ok ? pay.data.rrn + ' / ' + pay.data.accountNo : pay.error);
  const rev = await call('admin.payrollReveal', { staffId: idA }, admin);
  check('원문 보기', rev.ok && rev.data.rrn === '000101-3000000' && rev.data.accountNo === '000-000-000000');
  const loginA2 = await call('staff.login', { phone: A.phone, pin: A.pin }, '', A.dev);
  const meText = JSON.stringify(await call('staff.me', {}, loginA2.data.token, A.dev));
  check('직원 응답에 주민번호·계좌 없음', !/000101|rrn|account/i.test(meText));
  for (let i = 0; i < 5; i++) await call('staff.login', { phone: B.phone, pin: '0000' }, '', B.dev); // 없는 번호는 계속 같은 메시지
  expectOk('PIN 5회 실패 잠금 준비: 직원 B 가입', await call('staff.signup', base(B), '', B.dev));
  const idB = (await call('admin.staffList', {}, admin)).data.staff.find((s) => s.phone === B.phone).id;
  await call('admin.approve', { staffId: idB }, admin);
  for (let i = 0; i < 5; i++) await call('staff.login', { phone: B.phone, pin: '0000' }, '', B.dev);
  expectErr('5회 실패 후 맞는 PIN도 잠김', await call('staff.login', { phone: B.phone, pin: B.pin }, '', B.dev), '잠겼습니다', 'LOCKED');
  const reset = await call('admin.resetPin', { staffId: idB }, admin);
  expectOk('PIN 초기화', reset);
  expectOk('초기화된 PIN으로 로그인', await call('staff.login', { phone: B.phone, pin: reset.data.pin }, '', B.dev));
  B.pin = reset.data.pin;
  const deskPw = 'Desk' + uniq.slice(0, 4) + 'a9';
  expectOk('데스크 계정 추가', await call('admin.saveAccount', { loginId: 'desk' + uniq.slice(0, 4), name: '데스크', role: '데스크', password: deskPw, active: true }, admin));
  const deskLogin = await call('account.login', { loginId: 'desk' + uniq.slice(0, 4), password: deskPw });
  expectOk('데스크 로그인', deskLogin);
  expectOk('데스크 비밀번호 변경', await call('account.changePassword', { oldPassword: deskPw, newPassword: 'DeskNew' + uniq.slice(0, 4) + 'x1' }, deskLogin.data.token));
  const desk = deskLogin.data.token;
  expectErr('데스크가 관리자 action → 거부', await call('admin.staffList', {}, desk), '권한이 없습니다', 'FORBIDDEN');
  expectErr('설정 규칙 검사', await call('admin.saveSettings', { values: { 'GPS허용거리m': '3' } }, admin), '10~5000');

  // ===== 2단계: 근태 =====
  const tokB = (await call('staff.login', { phone: B.phone, pin: B.pin }, '', B.dev)).data.token;
  if (!(await call('admin.currentQr', {}, admin)).data.issued) { // 로컬 DB 에 오늘 QR 이 이미 있으면 건너뜀
    expectErr('QR 없이 출근 → 실패', await call('attendance.checkin', { qr: 'x', lat: 37.5, lng: 127 }, tokB, B.dev), '아직 발급되지 않았습니다');
  }
  const issued = await call('admin.issueQr', { lat: 37.5, lng: 127.0, accuracy: 12 }, admin);
  expectOk('QR 발급', issued);
  const qr = issued.data.qr;
  check('QR 형식', /^WN-ATT\|\d{4}-\d{2}-\d{2}\|[A-Z0-9]{16}$/.test(qr));
  expectErr('직원이 QR 발급 → 거부', await call('admin.issueQr', { lat: 37.5, lng: 127 }, tokB, B.dev), '권한');
  const tokA3 = (await call('staff.login', { phone: A.phone, pin: A.pin }, '', A.dev)).data.token;
  const near = { qr, lat: 37.5003, lng: 127.0003, accuracy: 10 };
  expectErr('틀린 QR → 실패', await call('attendance.checkin', { ...near, qr: 'WN-ATT|2000-01-01|XXXXXXXXXXXXXXXX' }, tokA3, A.dev), '오늘 QR이 아닙니다');
  expectErr('200m 밖 → 실패', await call('attendance.checkin', { qr, lat: 37.5035, lng: 127, accuracy: 10 }, tokA3, A.dev), '떨어져 있습니다');
  expectErr('위치 없이 출근 → 거부', await call('attendance.checkin', { qr }, tokA3, A.dev), '위치');
  const [c1, c2] = await Promise.all([call('attendance.checkin', near, tokA3, A.dev), call('attendance.checkin', near, tokA3, A.dev)]);
  check('동시에 두 번 눌러도 출근은 한 번만 성공', [c1, c2].filter((r) => r.ok).length === 1, JSON.stringify([c1.ok, c2.ok]));
  const good = [c1, c2].find((r) => r.ok);
  check('성공 시 시각·거리 반환', good && /^\d\d:\d\d$/.test(good.data.time) && good.data.distance < 100, good ? good.data.time + ' ' + good.data.distance + 'm' : '');
  expectErr('같은 직원 두 번째 출근 → 거부', await call('attendance.checkin', near, tokA3, A.dev), '이미 출근');
  // 한 폰 두 직원: API 로는 기기 중복 등록이 막혀 있으므로 DB 에서 직접 같은 기기로 맞춘다
  sql(`UPDATE staff SET device_key = '${A.dev}' WHERE id = '${idB}'`);
  expectErr('한 폰으로 두 번째 직원 → 실패', await call('attendance.checkin', near, tokB, A.dev), '다른 직원이 출근했습니다');
  sql(`UPDATE staff SET device_key = '${B.dev}' WHERE id = '${idB}'`);
  const day = await call('admin.attendance', { date: today }, admin);
  expectOk('일별 현황', day);
  check('출근자에 직원 A, 미출근자에 직원 B', day.data.present.some((p) => p.id === idA) && day.data.absent.some((p) => p.id === idB));
  check('실패 기록이 남음', day.data.failures.filter((f) => f.name === A.name).length >= 2, String(day.data.failures.length));
  const mon = await call('admin.attendance', { month: today.slice(0, 7) }, admin);
  check('월별 현황에 출근일수', mon.ok && mon.data.staff.find((p) => p.id === idA).days.length === 1);
  check('내 정보에 출근 반영', (await call('staff.me', {}, tokA3, A.dev)).data.checkedInToday === true);
  expectOk('GPS 허용거리 변경', await call('admin.saveSettings', { values: { 'GPS허용거리m': '2000' } }, admin));
  await call('admin.saveSettings', { values: { 'GPS허용거리m': '200' } }, admin);

  // ===== 3단계: 예약 =====
  const r5 = last5(), r5b = last5();
  await call('admin.saveSettings', { values: { '예약중복기준': '뒤5자리' } }, admin);
  const r1 = await call('reservation.create', { last5: r5, date: today, gender: '남', memo: '테스트' }, tokA3, A.dev);
  expectOk('예약 등록', r1);
  expectErr('다른 직원이 같은 뒤5자리 → 차단', await call('reservation.create', { last5: r5, date: today, gender: '여' }, tokB, B.dev), '이미 예약된 고객입니다.');
  expectErr('본인이 또 등록 → 내 예약 안내', await call('reservation.create', { last5: r5, date: today }, tokA3, A.dev), '이미 내 예약이 있습니다');
  expectErr('형식 오류', await call('reservation.create', { last5: '123', date: today }, tokA3, A.dev), '5자리');
  expectErr('지난 날짜', await call('reservation.create', { last5: r5b, date: '2000-01-01' }, tokA3, A.dev), '오늘 이후');
  const race = last5();
  const [x, y] = await Promise.all([
    call('reservation.create', { last5: race, date: today }, tokA3, A.dev), call('reservation.create', { last5: race, date: today }, tokB, B.dev)
  ]);
  check('동시에 같은 고객을 등록해도 한 명만 성공', [x, y].filter((r) => r.ok).length === 1, JSON.stringify([x.ok, y.ok]));
  await call('admin.saveSettings', { values: { '예약중복기준': '뒤5자리+성별' } }, admin);
  expectErr('성별 기준: 성별 없으면 거부', await call('reservation.create', { last5: last5(), date: today }, tokB, B.dev), '성별');
  expectOk('성별 기준: 같은 번호·다른 성별 허용', await call('reservation.create', { last5: r5, date: today, gender: '여' }, tokB, B.dev));
  expectErr('성별 기준: 같은 번호·같은 성별 차단', await call('reservation.create', { last5: r5, date: today, gender: '남' }, tokB, B.dev), '이미 예약된 고객입니다.');
  check('내 예약 목록', (await call('reservation.list', { tab: '예정' }, tokA3, A.dev)).data.reservations.some((r) => r.id === r1.data.id));
  expectErr('남의 예약 취소 → 거부', await call('reservation.cancel', { id: r1.data.id }, tokB, B.dev), '찾을 수 없습니다');
  const r2 = await call('reservation.create', { last5: r5b, date: today, gender: '여' }, tokA3, A.dev);
  expectOk('예약 수정', await call('reservation.update', { id: r2.data.id, date: today, memo: '변경' }, tokA3, A.dev));
  expectOk('예약 취소', await call('reservation.cancel', { id: r2.data.id }, tokA3, A.dev));
  expectOk('취소 후 같은 번호 다른 직원 등록 가능', await call('reservation.create', { last5: r5b, date: today, gender: '여' }, tokB, B.dev));

  // ===== 3단계: 텔레그램 + 데스크 =====
  await call('admin.saveSettings', { values: { '텔레그램봇이름': '' } }, admin);
  expectErr('봇 이름 없으면 연결 불가', await call('staff.telegramLink', {}, tokA3, A.dev), '봇이 아직 설정되지 않았습니다');
  await call('admin.saveSettings', { values: { '텔레그램봇이름': 'test_bot' } }, admin);
  const link = await call('staff.telegramLink', {}, tokA3, A.dev);
  expectOk('연결 링크 발급', link);
  const code = link.data.url.split('start=')[1];
  const chat = 700000 + Number(uniq.slice(0, 5));
  const uid = Date.now();
  await webhook({ update_id: uid + 1, message: { text: '/start ' + code, chat: { id: chat, type: 'private' } } }, 'wrong-secret');
  check('틀린 비밀값의 웹훅은 무시', !sent.some((m) => m.method === 'sendMessage'));
  await webhook({ update_id: uid + 2, message: { text: '/start ' + code, chat: { id: chat, type: 'private' } } });
  check('웹훅으로 연결되고 "연결되었습니다" 안내', sent.some((m) => m.method === 'sendMessage' && m.payload.text.startsWith('연결되었습니다')));
  const before = sent.length;
  await webhook({ update_id: uid + 2, message: { text: '/start ' + code, chat: { id: chat, type: 'private' } } });
  await webhook({ update_id: uid + 3, message: { text: '/start ' + code, chat: { id: chat, type: 'private' } } });
  check('텔레그램이 같은 요청을 다시 보내도 추가 메시지 없음', sent.length === before, String(sent.length - before));
  check('앱에서 연결됨으로 표시', (await call('staff.me', {}, tokA3, A.dev)).data.telegramLinked === true);

  expectErr('직원 토큰으로 데스크 action → 거부', await call('desk.lookup', { last5: r5 }, tokA3, A.dev), '권한');
  const look = await call('desk.lookup', { last5: r5 }, desk);
  check('데스크 조회: 같은 번호 2건(남/여)', look.ok && look.data.reservations.length === 2);
  check('성별로 좁혀 조회', (await call('desk.lookup', { last5: r5, gender: '남' }, desk)).data.reservations.length === 1);
  const mine = look.data.reservations.find((r) => r.gender === '남');
  const reg = await call('desk.registerVisit', { kind: '예약', reservationId: mine.id, last5: r5 }, desk);
  expectOk('예약 고객 호출', reg);
  const call1 = sent.find((m) => m.method === 'sendMessage' && m.payload.text.includes('[호출] ' + r5));
  check('호출 메시지 + [확인] 버튼', !!call1 && call1.payload.chat_id === String(chat) && call1.payload.reply_markup.inline_keyboard[0][0].callback_data === 'ack:' + reg.data.visitId);
  expectErr('같은 예약 중복 접수 → 거부', await call('desk.registerVisit', { kind: '예약', reservationId: mine.id, last5: r5 }, desk), '이미 방문 처리');
  const status = async () => (await call('desk.todayVisits', {}, desk)).data.visits.find((v) => v.id === reg.data.visitId).status;
  check('확인 전 상태는 호출함', (await status()) === '호출함');
  await webhook({ update_id: uid + 4, callback_query: { id: 'cb1', from: { id: 999999 }, data: 'ack:' + reg.data.visitId, message: { text: '[호출]', chat: { id: chat }, message_id: 5 } } });
  check('다른 사람이 [확인]을 눌러도 무시', (await status()) === '호출함');
  await webhook({ update_id: uid + 5, callback_query: { id: 'cb2', from: { id: chat }, data: 'ack:' + reg.data.visitId, message: { text: '[호출] x 도착', chat: { id: chat }, message_id: 5 } } });
  check('본인이 [확인] → 확인함', (await status()) === '확인함');
  check('텔레그램 메시지에 "확인됨" 덧붙임', sent.some((m) => m.method === 'editMessageText' && /✅ 확인됨 \d\d:\d\d$/.test(m.payload.text)));
  expectErr('확인된 호출 재호출 → 거부', await call('desk.recall', { visitId: reg.data.visitId }, desk), '이미 확인');

  const named = await call('desk.registerVisit', { kind: '지명', staffId: idB, last5: last5(), gender: '여' }, desk);
  check('미연결 직원 지명 → 호출 없이 번호 안내', named.ok && named.data.called === false && /^010-/.test(named.data.phone) && named.data.notLinked === true);
  expectErr('미연결 직원 재호출 → 전화 안내', await call('desk.recall', { visitId: named.data.visitId }, desk), '전화로');
  const nick = '별' + B.name.slice(-3);
  const srch = await call('desk.searchStaff', { q: nick }, desk);
  check('예명으로 직원 검색', srch.ok && srch.data.staff.some((s) => s.id === idB));
  check('검색 응답에 급여정보 없음', !/rrn|accountNo|주민/.test(JSON.stringify(srch) + JSON.stringify(look)));
  expectOk('담당 없음 기록', await call('desk.registerVisit', { kind: '담당없음', last5: last5() }, desk));
  const visitsToday = (await call('desk.todayVisits', {}, desk)).data.visits;
  check('오늘 방문 목록 3건 이상', visitsToday.length >= 3);
  check('관리자 예약 현황', (await call('admin.reservations', { from: today, to: today }, admin)).data.reservations.length >= 3);
  check('관리자 방문 현황', (await call('admin.visits', { from: today, to: today }, admin)).data.visits.length >= 3);
  expectOk('퇴사 처리', await call('admin.retire', { staffId: idB }, admin));
  expectErr('퇴사 후 로그인 차단', await call('staff.login', { phone: B.phone, pin: B.pin }, '', B.dev), '로그인할 수 없는');
  expectErr('퇴사 후 기존 토큰 무효', await call('staff.me', {}, tokB, B.dev), null, 'AUTH');
  expectOk('로그아웃', await call('auth.logout', {}, desk));
  expectErr('로그아웃 후 토큰 무효', await call('desk.todayVisits', {}, desk), null, 'AUTH');
  const cors = await fetch(BASE, { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  check('허용되지 않은 사이트에는 CORS 허용 헤더 없음', !cors.headers.get('access-control-allow-origin'));
  const cors2 = await fetch(BASE, { method: 'OPTIONS', headers: { Origin: 'https://kunbada.github.io' } });
  check('GitHub Pages 주소는 허용', cors2.headers.get('access-control-allow-origin') === 'https://kunbada.github.io');
} catch (e) {
  failed++;
  console.log('[실패] 테스트 중 예외: ' + (e && e.stack ? e.stack : e));
} finally {
  fake.close();
}
console.log(failed ? `=== 실패 ${failed}건 (통과 ${pass}건) ===` : `=== 전체 통과 (${pass}건) ===`);
process.exit(failed ? 1 : 0);
