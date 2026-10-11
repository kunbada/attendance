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
  return waitReady();
};
// DB 파일이 바뀌면 개발 서버가 잠깐 다시 시작되므로 응답할 때까지 기다린다
async function waitReady() {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(BASE)).ok) return; } catch (e) { /* 아직 재시작 중 */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}


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
  await sql(`UPDATE staff SET device_key = '${A.dev}' WHERE id = '${idB}'`);
  expectErr('한 폰으로 두 번째 직원 → 실패', await call('attendance.checkin', near, tokB, A.dev), '다른 직원이 출근했습니다');
  await sql(`UPDATE staff SET device_key = '${B.dev}' WHERE id = '${idB}'`);
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
  const call1 = sent.find((m) => m.method === 'sendMessage' && m.payload.text.includes('[' + r5 + '] 고객 도착'));
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
  // ===== 직급(팀장·본부장), 승인 권한, 호출 알림, 예약명단, 직원 검색 =====
  const sales = (p, head, team) => base(p, { job: '영업', headId: head, teamId: team });
  const L = person(11), M = person(12), O = person(13), X = person(14), H = person(15);
  const signupSales = async (p, head, team) => {
    expectOk('영업 직원 가입 ' + p.name, await call('staff.signup', sales(p, head, team), '', p.dev));
    return (await call('admin.staffList', {}, admin)).data.staff.find((x) => x.phone === p.phone).id;
  };
  const idL = await signupSales(L, 'OH01', 'OT011');   // 1본부 1팀 (팀장 예정)
  const idM = await signupSales(M, 'OH01', 'OT011');   // 1본부 1팀 직원
  const idO = await signupSales(O, 'OH01', 'OT012');   // 1본부 2팀 직원
  const idX = await signupSales(X, 'OH02', 'OT021');   // 2본부 직원
  const idH = await signupSales(H, 'OH01', 'OT011');   // 1본부 (본부장 예정)
  await call('admin.approve', { staffId: idL }, admin);
  await call('admin.approve', { staffId: idH }, admin);
  expectErr('상담사는 팀장 지정 불가', await call('admin.update', { staffId: idA, name: A.name, phone: A.phone, job: '상담사', grade: '팀장' }, admin), '영업');
  expectErr('팀장 지정은 소속 팀 필요', await call('admin.update', { staffId: idH, name: H.name, phone: H.phone, job: '영업', headId: 'OH01', teamId: '', grade: '팀장' }, admin), '팀을 선택');
  expectOk('팀장 지정 + 승인 권한', await call('admin.update', { staffId: idL, name: L.name, phone: L.phone, job: '영업', headId: 'OH01', teamId: 'OT011', grade: '팀장', canApprove: true }, admin));
  expectOk('본부장 지정(팀 없이) + 승인 권한', await call('admin.update', { staffId: idH, name: H.name, phone: H.phone, job: '영업', headId: 'OH01', teamId: '', grade: '본부장', canApprove: true }, admin));
  const listed = (await call('admin.staffList', {}, admin)).data.staff;
  check('관리자 목록에 직급·권한 표시', listed.find((x) => x.id === idL).grade === '팀장' && listed.find((x) => x.id === idH).canApprove === true);
  const tokL = (await call('staff.login', { phone: L.phone, pin: L.pin }, '', L.dev)).data.token;
  const tokH = (await call('staff.login', { phone: H.phone, pin: H.pin }, '', H.dev)).data.token;
  check('내 정보에 승인 권한 표시', (await call('staff.me', {}, tokL, L.dev)).data.canApprove === true);
  const ids = (r) => r.data.pending.map((x) => x.id);
  const lv1 = await call('leader.staffList', {}, tokL, L.dev);
  check('팀장: 자기 팀 대기자(M)만 보임', lv1.ok && ids(lv1).includes(idM) && !ids(lv1).includes(idO) && !ids(lv1).includes(idX), lv1.ok ? ids(lv1).length + '명' : lv1.error);
  expectErr('팀장: 다른 팀 직원 승인 불가', await call('leader.approve', { staffId: idO }, tokL, L.dev), '관리할 수 있는');
  expectOk('팀장: 자기 팀 직원 승인', await call('leader.approve', { staffId: idM }, tokL, L.dev));
  const lv2 = await call('leader.staffList', {}, tokH, H.dev);
  check('본부장: 본부 안 대기자(O) 보이고 다른 본부(X)는 안 보임', ids(lv2).includes(idO) && !ids(lv2).includes(idX));
  expectErr('본부장: 다른 본부 직원 승인 불가', await call('leader.approve', { staffId: idX }, tokH, H.dev), '관리할 수 있는');
  expectErr('반려 사유 필수', await call('leader.reject', { staffId: idO, reason: '' }, tokH, H.dev), '사유');
  expectOk('본부장: 승인', await call('leader.approve', { staffId: idO }, tokH, H.dev));
  expectErr('관리자가 지정하지 않은 일반 직원은 승인 불가', await call('leader.staffList', {}, tokA3, A.dev), '권한', 'FORBIDDEN');
  await call('admin.update', { staffId: idL, name: L.name, phone: L.phone, job: '영업', headId: 'OH01', teamId: 'OT011', grade: '팀장', canApprove: false }, admin);
  expectErr('승인 권한을 뺀 팀장은 불가', await call('leader.staffList', {}, tokL, L.dev), '권한', 'FORBIDDEN');
  await call('admin.update', { staffId: idL, name: L.name, phone: L.phone, job: '영업', headId: 'OH01', teamId: 'OT011', grade: '팀장', canApprove: true }, admin);

  // 호출 알림: 담당 직원 + 담당 팀장·본부장
  const chatOf = (n) => 800000 + Number(uniq.slice(0, 4)) * 10 + n;
  const linkTelegram = async (p, id, n) => {
    const t = (await call('staff.login', { phone: p.phone, pin: p.pin }, '', p.dev)).data.token;
    const code = (await call('staff.telegramLink', {}, t, p.dev)).data.url.split('start=')[1];
    await webhook({ update_id: Date.now() * 10 + n, message: { text: '/start ' + code, chat: { id: chatOf(n), type: 'private' } } });
    return t;
  };
  const tokM = await linkTelegram(M, idM, 1);
  await linkTelegram(L, idL, 2);
  await linkTelegram(H, idH, 3);
  const r5m = last5();
  expectOk('직원 M 예약', await call('reservation.create', { last5: r5m, date: today, gender: '남' }, tokM, M.dev));
  const lookM = await call('desk.lookup', { last5: r5m }, desk);
  const sentBefore = sent.length;
  const regM = await call('desk.registerVisit', { kind: '예약', reservationId: lookM.data.reservations[0].id, last5: r5m }, desk);
  expectOk('M 호출', regM);
  const batch = sent.slice(sentBefore).filter((m) => m.method === 'sendMessage');
  const toM = batch.find((m) => m.payload.chat_id === String(chatOf(1)));
  check('직원 메시지 형식: [호출] 1본부 1팀 이름님 [번호] 고객 도착 / 안내데스크로 와주세요.',
    toM && toM.payload.text === '[호출] 1본부 1팀 ' + M.name + '님 [' + r5m + '] 고객 도착\n안내데스크로 와주세요.', toM ? toM.payload.text : '(없음)');
  check('직원 메시지에 [확인] 버튼', toM && toM.payload.reply_markup.inline_keyboard[0][0].callback_data === 'ack:' + regM.data.visitId);
  const toL = batch.find((m) => m.payload.chat_id === String(chatOf(2)));
  const toH = batch.find((m) => m.payload.chat_id === String(chatOf(3)));
  check('담당 팀장에게도 알림 (확인 버튼 없음)', toL && toL.payload.text.startsWith('[호출 알림] 1본부 1팀 ' + M.name + '님께 [' + r5m + ']') && !toL.payload.reply_markup, toL ? toL.payload.text : '(없음)');
  check('담당 본부장에게도 알림', !!toH && toH.payload.text.startsWith('[호출 알림]'));
  check('호출받은 직원에게는 정확히 한 통만 (알림과 중복 안 됨)', batch.filter((m) => m.payload.chat_id === String(chatOf(1))).length === 1);
  const sentBeforeRecall = sent.length;
  expectOk('재호출', await call('desk.recall', { visitId: regM.data.visitId }, desk));
  const rec = sent.slice(sentBeforeRecall).filter((m) => m.method === 'sendMessage');
  check('재호출은 직원에게만', rec.length === 1 && rec[0].payload.chat_id === String(chatOf(1)));

  // 예약명단
  const rl = await call('desk.reservationList', { date: today }, desk);
  expectOk('예약명단 조회', rl);
  const mine2 = rl.data.reservations.find((r) => r.last5 === r5m);
  check('예약명단: 번호·본부/팀·직원명·전화번호 표시', mine2 && mine2.staff.name === M.name && mine2.staff.headName === '1본부' && mine2.staff.teamName === '1팀' && mine2.staff.phone.replace(/\D/g, '') === M.phone, mine2 ? mine2.staff.phone : '');
  check('방문 처리된 예약은 호출 버튼 없음(callable=false)', mine2 && mine2.status === '방문' && mine2.callable === false);
  const rl2 = rl.data.reservations.filter((r) => r.staff);
  const hk = (r) => (r.staff.headName ? '0' + r.staff.headName : '1');  // 본부 없는 직군은 맨 뒤
  check('예약명단은 본부 → 팀 순으로 정렬', rl2.every((r, i) => i === 0 || hk(rl2[i - 1]) <= hk(r)));
  expectErr('날짜 형식 검사', await call('desk.reservationList', { date: '2026/10/1' }, desk), '날짜');
  expectErr('직원은 예약명단 조회 불가', await call('desk.reservationList', { date: today }, tokA3, A.dev), '권한');

  // 직원 검색
  const all0 = await call('desk.searchStaff', { q: '' }, desk);
  check('직원 전체 리스트 (활동 직원, 전화번호 포함)', all0.ok && all0.data.staff.length >= 5 && all0.data.staff.every((x) => /^010-/.test(x.phone)), all0.ok ? String(all0.data.staff.length) : all0.error);
  const heads = all0.data.staff.map((x) => x.headName);
  check('전체 리스트는 본부 → 팀 → 이름 순', heads.every((h, i) => i === 0 || (heads[i - 1] || '힣') <= (h || '힣') || (heads[i - 1] !== '' && h === '')));
  check('이름으로 검색', (await call('desk.searchStaff', { q: M.name }, desk)).data.staff.some((x) => x.id === idM));
  check('전화번호 일부(뒤 5자리)로 검색', (await call('desk.searchStaff', { q: M.phone.slice(-5) }, desk)).data.staff.some((x) => x.id === idM));
  const byOrg = await call('desk.searchStaff', { q: '1본부' }, desk);
  check('본부 이름으로 검색', byOrg.data.staff.length >= 3 && byOrg.data.staff.every((x) => x.headName === '1본부'));
  check('검색 응답에 급여정보 없음', !/rrn|account|주민/.test(JSON.stringify(all0)));
  const sentBeforeNamed = sent.length;
  const byName = await call('desk.registerVisit', { kind: '지명', staffId: idO, last5: last5() }, desk);
  expectOk('검색 후 호출(지명)', byName);
  check('텔레그램 미연결 직원 지명은 호출 없이 번호 안내', byName.data.called === false && byName.data.notLinked === true && sent.length === sentBeforeNamed);

  // 직원 검색 호출: 고객 번호 없이도 호출
  const sentNoNum = sent.length;
  const noNum = await call('desk.registerVisit', { kind: '지명', staffId: idM }, desk);
  expectOk('고객 번호 없이 지명 호출', noNum);
  const noNumMsg = sent.slice(sentNoNum).find((m) => m.method === 'sendMessage' && m.payload.chat_id === String(chatOf(1)));
  check('번호 없는 호출 메시지: [호출] 1본부 1팀 이름님 고객 도착', noNumMsg && noNumMsg.payload.text === '[호출] 1본부 1팀 ' + M.name + '님 고객 도착\n안내데스크로 와주세요.', noNumMsg ? noNumMsg.payload.text : '(없음)');
  expectErr('번호를 입력했다면 형식 검사', await call('desk.registerVisit', { kind: '지명', staffId: idM, last5: '12' }, desk), '5자리');
  expectErr('예약 호출은 번호 필수', await call('desk.registerVisit', { kind: '담당없음' }, desk), '5자리');

  // 방명록: 태블릿(방명록 계정) 입력 → 데스크 확인·수정·담당 지정 → 호출
  const kioskPw = 'Kiosk' + uniq.slice(0, 4) + 'z7';
  expectOk('방명록 계정 추가', await call('admin.saveAccount', { loginId: 'kiosk' + uniq.slice(0, 4), name: '태블릿', role: '방명록', password: kioskPw, active: true }, admin));
  const kLogin = await call('account.login', { loginId: 'kiosk' + uniq.slice(0, 4), password: kioskPw });
  expectOk('방명록 계정 로그인 (비밀번호 변경 강제 없음)', kLogin);
  check('방명록 계정은 변경 강제 없음', kLogin.data.account.mustChangePassword === false);
  const kiosk = kLogin.data.token;
  const gPhone = '010' + rnd();
  expectErr('동의 없이 제출 불가', await call('guest.submit', { name: '고객A', phone: gPhone, gender: '남', companions: 0, consent: false }, kiosk), '동의');
  expectErr('전화번호 형식 검사', await call('guest.submit', { name: '고객A', phone: '123', gender: '남', consent: true }, kiosk), '전화번호');
  expectOk('고객이 방명록 입력 (성별 없이, 동반 2명)', await call('guest.submit', { name: '고객' + uniq, phone: gPhone, companions: 2, consent: true }, kiosk));
  expectOk('같은 사람이 다시 눌러도 에러 없이 한 건만', await call('guest.submit', { name: '고객' + uniq, phone: gPhone, companions: 2, consent: true }, kiosk));
  expectErr('방명록 계정은 데스크 기능 사용 불가', await call('desk.guestList', {}, kiosk), '권한', 'FORBIDDEN');
  expectErr('방명록 계정은 관리자 기능 사용 불가', await call('admin.staffList', {}, kiosk), '권한', 'FORBIDDEN');
  expectErr('직원은 방명록 제출 불가', await call('guest.submit', { name: 'x', phone: gPhone, consent: true }, tokA3, A.dev), '권한');
  const gl = await call('desk.guestList', {}, desk);
  const g1 = gl.ok && gl.data.guests.filter((g) => g.name === '고객' + uniq);
  check('데스크 방명록: 한 건, 확인 필요, 동반 2명, 호출 불가', g1 && g1.length === 1 && g1[0].category === '확인 필요' && g1[0].party === '동반 2명' && g1[0].gender === '' && g1[0].canCall === false && g1[0].consent === true, g1 && g1[0] ? g1[0].category + '/' + g1[0].party : gl.error);
  expectErr('수정 전 호출 불가(담당자 없음)', await call('desk.guestCall', { id: g1[0].id }, desk), '담당자가 지정되지 않았습니다');
  const orgStaff = await call('desk.staffByOrg', { headId: 'OH01', teamId: 'OT011' }, desk);
  check('담당자 선택 목록: 팀 직원 + 본부장', orgStaff.ok && orgStaff.data.staff.some((x) => x.id === idM) && orgStaff.data.staff.some((x) => x.id === idH), orgStaff.ok ? String(orgStaff.data.staff.length) : orgStaff.error);
  check('담당자 목록에 다른 본부 직원 없음', !orgStaff.data.staff.some((x) => x.id === idX));
  const gBase = { id: g1[0].id, name: '고객' + uniq, phone: gPhone, gender: '여', companions: 2, consent: true };
  expectErr('본부 선택 후 담당자 미선택 → 거부', await call('desk.guestSave', { ...gBase, headId: 'OH01', teamId: 'OT011' }, desk), '담당자');
  expectErr('다른 본부 직원 선택 → 거부', await call('desk.guestSave', { ...gBase, headId: 'OH01', teamId: 'OT011', staffId: idX }, desk), '담당자가 아닙니다');
  expectErr('본부 없이 팀만 → 거부', await call('desk.guestSave', { ...gBase, teamId: 'OT011' }, desk), '본부');
  expectOk('담당 본부/팀/직원 지정', await call('desk.guestSave', { ...gBase, headId: 'OH01', teamId: 'OT011', staffId: idM }, desk));
  const g2 = (await call('desk.guestList', {}, desk)).data.guests.find((g) => g.id === g1[0].id);
  check('지정 후: 분양, 본부/팀/담당자 표시, 호출 가능', g2.category === '분양' && g2.headName === '1본부' && g2.teamName === '1팀' && g2.staffId === idM && g2.canCall === true && g2.reviewed === true);
  const sentG = sent.length;
  const gc = await call('desk.guestCall', { id: g1[0].id }, desk);
  expectOk('방명록에서 호출', gc);
  const gMsgs = sent.slice(sentG).filter((m) => m.method === 'sendMessage');
  const gToM = gMsgs.find((m) => m.payload.chat_id === String(chatOf(1)));
  check('호출 메시지에 고객 전화 뒤 5자리 사용', gToM && gToM.payload.text === '[호출] 1본부 1팀 ' + M.name + '님 [' + gPhone.slice(-5) + '] 고객 도착\n안내데스크로 와주세요.', gToM ? gToM.payload.text : '(없음)');
  check('방명록 호출도 팀장·본부장에게 알림', gMsgs.some((m) => m.payload.chat_id === String(chatOf(2)) && m.payload.text.startsWith('[호출 알림]')) && gMsgs.some((m) => m.payload.chat_id === String(chatOf(3))));
  const sentG2 = sent.length;
  expectOk('다시 호출(재호출)', await call('desk.guestCall', { id: g1[0].id }, desk));
  check('재호출은 직원에게만', sent.slice(sentG2).filter((m) => m.method === 'sendMessage').length === 1);
  check('호출 상태가 방명록 목록에 표시', ['호출함', '미확인'].includes((await call('desk.guestList', {}, desk)).data.guests.find((g) => g.id === g1[0].id).callStatus));
  await webhook({ update_id: Date.now() * 10 + 7, callback_query: { id: 'cbg', from: { id: chatOf(1) }, data: 'ack:' + gc.data.visitId, message: { text: '[호출] x', chat: { id: chatOf(1) }, message_id: 9 } } });
  check('직원이 [확인] → 방명록 목록에 확인함', (await call('desk.guestList', {}, desk)).data.guests.find((g) => g.id === g1[0].id).callStatus === '확인함');
  expectErr('확인된 호출은 다시 호출 불가', await call('desk.guestCall', { id: g1[0].id }, desk), '이미 확인');
  check('방문 목록에 방명록 구분으로 기록', (await call('desk.todayVisits', {}, desk)).data.visits.some((v) => v.id === gc.data.visitId && v.kind === '방명록'));

  const walkIn = await call('desk.guestSave', { name: '워킹고객', phone: '010' + rnd(), gender: '', companions: 0, consent: false }, desk);
  expectOk('데스크가 직접 입력 (본부/팀 없음 = 워킹, 단독, 동의 안 함)', walkIn);
  const g3 = (await call('desk.guestList', {}, desk)).data.guests.find((g) => g.id === walkIn.data.id);
  check('워킹으로 분류, 단독, 동의 아님, 호출 불가', g3.category === '워킹' && g3.party === '단독' && g3.consent === false && g3.canCall === false && g3.source === '데스크');
  const noStaff = await call('desk.guestSave', { id: walkIn.data.id, name: '워킹고객', phone: '010' + rnd(), companions: 1, headId: 'OH02', teamId: 'OT021', staffNone: true, consent: true }, desk);
  expectOk('담당자 없음으로 저장', noStaff);
  const g4 = (await call('desk.guestList', {}, desk)).data.guests.find((g) => g.id === walkIn.data.id);
  check('본부/팀 있고 담당자 없음 → 분양, 호출 불가', g4.category === '분양' && g4.staffNone === true && g4.canCall === false && g4.consent === true);
  expectErr('담당자 없는 건 호출 불가', await call('desk.guestCall', { id: walkIn.data.id }, desk), '담당자가 지정되지 않았습니다');
  expectOk('방명록 삭제', await call('desk.guestDelete', { id: walkIn.data.id }, desk));
  check('삭제 후 목록에 없음', !(await call('desk.guestList', {}, desk)).data.guests.some((g) => g.id === walkIn.data.id));
  const yesterday = new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10);
  check('다른 날짜 조회', (await call('desk.guestList', { date: yesterday }, desk)).ok);
  expectErr('날짜 형식 검사', await call('desk.guestList', { date: 'abc' }, desk), '날짜');

  // ===== 방명록 자동 매칭: 예약 있음 / 방문이력 있음 / 담당자 자동 입력 =====
  const guestsNow = async () => (await call('desk.guestList', {}, desk)).data.guests;
  const gPhone2 = '010' + rnd();
  const r5g = gPhone2.slice(-5);
  expectOk('직원 M 이 같은 뒤5자리로 예약', await call('reservation.create', { last5: r5g, date: today, gender: '여' }, tokM, M.dev));
  expectOk('고객 방명록 제출 (예약 있는 번호)', await call('guest.submit', { name: '예약고객' + uniq, phone: gPhone2, companions: 0, consent: true }, kiosk));
  const gRes = (await guestsNow()).find((g) => g.name === '예약고객' + uniq);
  check('예약 있음 표시 (예정, 담당 M)', gRes && gRes.reservation && gRes.reservation.status === '예정' && gRes.reservation.staffName === M.name, JSON.stringify(gRes && gRes.reservation));
  check('담당 본부/팀/직원 자동 입력(예약), 확인 필요 유지, 호출 가능', gRes.staffId === idM && gRes.headId === 'OH01' && gRes.teamId === 'OT011' && gRes.autoSource === '예약' && gRes.category === '확인 필요' && gRes.canCall === true);
  const sg1 = await call('desk.guestSuggest', { phone: gPhone2 }, desk);
  check('추천 API: 예약 → 담당자', sg1.ok && sg1.data.reservation && sg1.data.suggest && sg1.data.suggest.source === '예약' && sg1.data.suggest.staffId === idM);
  expectOk('자동 입력된 담당자 호출', await call('desk.guestCall', { id: gRes.id }, desk));
  const rl3 = (await call('desk.reservationList', { date: today }, desk)).data.reservations.find((r) => r.last5 === r5g);
  check('호출하면 그 예약이 방문 처리됨', rl3 && rl3.status === '방문');

  expectOk('같은 번호로 다시 방명록 (이름만 다름)', await call('guest.submit', { name: '재방문' + uniq, phone: gPhone, companions: 0, consent: true }, kiosk));
  const gHist = (await guestsNow()).find((g) => g.name === '재방문' + uniq);
  check('방문이력 있음 (동일 번호, 이전 담당 M)', gHist && gHist.history && gHist.history.count >= 1 && gHist.history.exact === true && gHist.history.staffName === M.name, JSON.stringify(gHist && gHist.history));
  check('이력의 담당자가 자동 입력됨 (방문이력)', gHist.staffId === idM && gHist.autoSource === '방문이력' && gHist.reservation === null);
  check('자기 자신은 이력으로 세지 않음', !(await guestsNow()).find((g) => g.name === '고객' + uniq).history || (await guestsNow()).find((g) => g.name === '고객' + uniq).history.count === 0);
  const gWeakPhone = '019' + gPhone.slice(3);
  expectOk('뒤 5자리만 같은 다른 번호로 방명록', await call('guest.submit', { name: '뒤5일치' + uniq, phone: gWeakPhone, companions: 0, consent: true }, kiosk));
  const gWeak = (await guestsNow()).find((g) => g.name === '뒤5일치' + uniq);
  check('뒤 5자리 일치는 방문이력으로 표시하되 동일 번호 아님', gWeak && gWeak.history && gWeak.history.exact === false && gWeak.history.count >= 1);
  const gNew = '010' + rnd();
  expectOk('이력·예약 없는 새 고객', await call('guest.submit', { name: '새고객' + uniq, phone: gNew, companions: 0, consent: true }, kiosk));
  const gNone = (await guestsNow()).find((g) => g.name === '새고객' + uniq);
  check('일치 없음: 표시·자동 입력 없음', gNone && gNone.reservation === null && gNone.history === null && gNone.suggest === null && gNone.staffId === '' && gNone.autoSource === '', JSON.stringify([gNone && gNone.history, gNone && gNone.staffId]));
  const sg0 = await call('desk.guestSuggest', { phone: gNew, id: gNone.id }, desk);
  check('추천 API: 일치 없음', sg0.ok && sg0.data.reservation === null && sg0.data.history === null && sg0.data.suggest === null);
  expectOk('자동 입력을 데스크가 수동으로 다른 담당자(팀장 L)로 변경', await call('desk.guestSave', { id: gHist.id, name: gHist.name, phone: gPhone, gender: '남', companions: 0, headId: 'OH01', teamId: 'OT011', staffId: idL, consent: true }, desk));
  const gHist2 = (await guestsNow()).find((g) => g.id === gHist.id);
  check('수동 변경 후: 담당 L, 확인함, 자동 입력 표시 사라짐', gHist2.staffId === idL && gHist2.reviewed === true && gHist2.autoSource === '' && gHist2.category === '분양');
  // 예약 담당자가 아닌 다른 직원을 부르면 예약은 그대로 남는다
  const r5h = last5();
  expectOk('M 의 다른 예약', await call('reservation.create', { last5: r5h, date: today, gender: '남' }, tokM, M.dev));
  const gPhone3 = '010' + rnd().slice(0, 3) + r5h;
  expectOk('그 예약 번호로 방명록', await call('guest.submit', { name: '타담당' + uniq, phone: gPhone3, companions: 0, consent: true }, kiosk));
  const gOther = (await guestsNow()).find((g) => g.name === '타담당' + uniq);
  expectOk('데스크가 예약 담당자 대신 팀장 L 로 지정', await call('desk.guestSave', { id: gOther.id, name: gOther.name, phone: gPhone3, gender: '남', companions: 0, headId: 'OH01', teamId: 'OT011', staffId: idL, consent: true }, desk));
  expectOk('L 호출', await call('desk.guestCall', { id: gOther.id }, desk));
  const rl4 = (await call('desk.reservationList', { date: today }, desk)).data.reservations.find((r) => r.last5 === r5h);
  check('예약 담당자와 다른 직원을 불렀으면 예약은 예정 그대로', rl4 && rl4.status === '예정');

  // ===== 4단계: 대시보드, 방명록 통계·내보내기 =====
  const dash = await call('admin.dashboard', {}, admin);
  expectOk('대시보드', dash);
  const d0 = dash.data;
  check('오늘 카드: 출근·활동 인원·출근율', d0.today.attendance >= 1 && d0.today.activeStaff >= d0.today.attendance && d0.today.attendanceRate > 0, JSON.stringify([d0.today.attendance, d0.today.activeStaff, d0.today.attendanceRate]));
  check('오늘 카드: 예약·방문·담당없음·방명록', d0.today.reservations >= 3 && d0.today.visits >= 3 && d0.today.noStaffVisits >= 1 && d0.today.guestTeams >= 1 && d0.today.guestPeople >= 3, JSON.stringify(d0.today));
  check('최근 14일 추이 (오늘 값 반영)', d0.trend.length === 14 && d0.trend[13].date === today && d0.trend[13].attendance === d0.today.attendance && d0.trend[13].visits === d0.today.visits && d0.trend[13].guestPeople === d0.today.guestPeople);
  check('본부·팀·직군별 출근율', d0.attendanceRate.byHead.some((x) => x.name === '1본부') && d0.attendanceRate.byTeam.some((x) => x.name === '1본부 1팀') && d0.attendanceRate.byJob.some((x) => x.name === '영업') && d0.attendanceRate.byJob.every((x) => x.rate >= 0 && x.rate <= 100));
  check('직원별 예약·방문 TOP 10 (방문 많은 순)', d0.topStaff.length >= 1 && d0.topStaff.length <= 10 && d0.topStaff.every((t, i) => i === 0 || d0.topStaff[i - 1].visited >= t.visited));
  check('예약 대비 방문율', d0.visitRate.reservations >= 1 && d0.visitRate.visited >= 1 && d0.visitRate.rate > 0 && d0.visitRate.rate <= 100, JSON.stringify(d0.visitRate));
  expectErr('월 형식 검사', await call('admin.dashboard', { month: '2026-13' }, admin), '월 형식');
  expectErr('대시보드는 관리자만', await call('admin.dashboard', {}, desk), '권한');
  const gs = await call('admin.guestStats', { from: today, to: today }, admin);
  expectOk('방명록 통계', gs);
  const gt = gs.data.total;
  check('방문 팀수·방문객수 구분 (동반 2명 건 → 3명)', gt.teams >= 1 && gt.people >= gt.teams + 2 && gt.groupTeams >= 1, JSON.stringify(gt));
  check('분양/워킹/확인 필요 구분 합계', gt.assignedTeams + gt.walkInTeams + gt.pending === gt.teams);
  check('성별 합계', gt.male + gt.female + gt.genderUnknown === gt.teams);
  check('일별·본부/팀별 집계', gs.data.byDay.length >= 1 && gs.data.byDay[0].people >= gs.data.byDay[0].teams && Array.isArray(gs.data.byOrg));
  const gb = await call('admin.guestbook', { from: today, to: today }, admin);
  expectOk('방명록 내보내기 데이터', gb);
  check('내보내기: 개인정보·분류·호출 상태 포함', gb.data.guests.length === gt.teams && gb.data.guests.some((g) => g.name === '고객' + uniq && g.phone.startsWith('010-') && g.category === '분양' && g.people === 3 && g.party === '동반' && g.consent === true && g.status === '확인함'));
  expectErr('방명록 통계는 관리자만', await call('admin.guestStats', {}, desk), '권한');
  expectErr('방명록 내보내기는 관리자만', await call('admin.guestbook', {}, kiosk), '권한');
  expectErr('기간 검사 (시작일이 더 늦음)', await call('admin.guestStats', { from: '2026-12-31', to: '2026-01-01' }, admin), '시작일');
  expectErr('날짜 형식 검사', await call('admin.guestbook', { from: 'x' }, admin), '날짜');

  // 퇴사 처리: 팀장 → 자기 팀 직원, 본부장 → 팀장
  expectErr('팀장: 본부장은 처리 불가', await call('leader.retire', { staffId: idH }, tokL, L.dev), '관리할 수 있는');
  expectOk('팀장: 자기 팀 직원 퇴사 처리', await call('leader.retire', { staffId: idM }, tokL, L.dev));
  expectErr('퇴사한 직원의 토큰은 무효', await call('staff.me', {}, tokM, M.dev), null, 'AUTH');
  expectErr('이미 퇴사한 직원 재처리 불가', await call('leader.retire', { staffId: idM }, tokL, L.dev), '활동 중인');
  expectOk('본부장: 소속 팀장 퇴사 처리', await call('leader.retire', { staffId: idL }, tokH, H.dev));
  expectErr('본부장: 다른 본부 직원 퇴사 불가', await call('leader.retire', { staffId: idX }, tokH, H.dev), '관리할 수 있는');

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
