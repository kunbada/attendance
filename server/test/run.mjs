// 통합 테스트: 로컬에서 띄운 서버(wrangler dev)를 실제 HTTP 로 호출한다.
//   0) (다시 돌릴 때) npx wrangler@4 d1 execute DB --local --file=scripts/reset-local.sql  → 이어서 --file=schema.sql
//   1) node scripts/make-seed.mjs  → npx wrangler@4 d1 execute DB --local --file=.seed.sql  → 출력된 초기 비밀번호를 ADMIN_PW 로 넘긴다
//   2) wrangler dev --local --port 8787 --var TELEGRAM_API_BASE:http://127.0.0.1:9999 --var TELEGRAM_TOKEN:testtoken --var RESEND_API_BASE:http://127.0.0.1:9998 --var RESEND_API_KEY:testkey
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

// ---------- 가짜 메일 서비스 (Resend 자리) ----------
const mails = [];
const fakeMail = http.createServer((req, res) => {
  let b = '';
  req.on('data', (d) => { b += d; });
  req.on('end', () => {
    mails.push(JSON.parse(b || '{}'));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'fake' }));
  });
});
await new Promise((r) => fakeMail.listen(9998, '127.0.0.1', r));

// ---------- 도우미 ----------
let pass = 0, failed = 0;
// projectId 를 따로 주지 않으면 첫 현장(P01). 다른 현장이나 "현장 없음"(null)을 시험할 때만 직접 넘긴다
const P1 = 'P01';
const call = async (action, data, token = '', deviceKey = '', projectId = P1) =>
  (await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token, deviceKey, projectId: projectId || undefined, data: data || {} }) })).json();
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('[통과] ' + label + (extra ? ' → ' + extra : '')); }
  else { failed++; console.log('[실패] ' + label + (extra ? ' → ' + extra : '')); }
};
const expectErr = (label, res, part, code) => check(label, res.ok === false && (!part || res.error.includes(part)) && (!code || res.code === code), res.error || '(성공해 버림)');
const expectOk = (label, res) => check(label, res.ok === true, res.ok ? '' : res.error);
const webhook = (body, secret = SECRET) => fetch(BASE + '/?tg=' + secret, { method: 'POST', body: JSON.stringify(body) });
// 로컬 DB 를 직접 조회한다 (로그처럼 API 로 볼 수 없는 값 확인용)
const query = async (command) => {
  let out;
  for (let i = 0; ; i++) {
    try {
      out = execFileSync('npx', ['wrangler@4', 'd1', 'execute', 'DB', '--local', '--json', '--command', JSON.stringify(command)], { cwd: root, shell: true, stdio: 'pipe', windowsHide: true }).toString();
      break;
    } catch (e) {
      if (i >= 2) throw new Error('DB 조회 실패: ' + (e.stderr || e.stdout || e.message));
      await waitReady();
    }
  }
  await waitReady(); // DB 파일에 접근하면 개발 서버가 잠깐 다시 시작될 수 있다
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
};
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
  // 현장 값(출근 허용거리·예약 중복 기준)은 프로젝트 저장(project.save)으로 바꾼다
  const projList = async () => (await call('project.list', {}, admin, '', null)).data.projects;
  const projSet = async (pid, patch) => {
    const cur = (await projList()).find((x) => x.id === pid);
    return call('project.save', { id: pid, name: cur.name, code: cur.code, kind: cur.kind, status: cur.status, moneyLabel: cur.moneyLabel, ...patch }, admin, '', null);
  };
  const orgs = (await call('public.orgs', { projectCode: 'site1' })).data;
  check('가입용 조직 목록 (영업 직군, 본부·팀)', orgs.jobs.some((j) => j.name === '영업') && orgs.heads.length >= 1 && orgs.teams.length >= 1);

  // ===== 1단계: 가입·승인·로그인·기기 =====
  const A = person(1), B = person(2);
  const base = (p, extra) => ({ projectCode: 'site1', name: p.name, nickname: '별' + p.name.slice(-3), phone: p.phone, pin: p.pin, job: '상담사', rrn: '000101-3000000', bank: '국민', accountNo: '000-000-000000', holder: p.name, consent: true, ...extra });
  expectErr('동의 없이 가입 거부', await call('staff.signup', base(A, { consent: false }), '', A.dev), '동의');
  expectErr('영업 직군인데 팀 없음 → 거부', await call('staff.signup', base(A, { job: '영업' }), '', A.dev), '본부');
  expectOk('가입 신청', await call('staff.signup', base(A), '', A.dev));
  expectErr('같은 번호 중복 가입 거부', await call('staff.signup', base(A), '', NEWDEV), '승인 대기');
  expectErr('같은 기기로 다른 번호 가입 거부', await call('staff.signup', base(B), '', A.dev), '한 명만 가입할 수 있습니다');
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
  expectOk('데스크 계정 추가', await call('admin.saveAccount', { loginId: 'desk' + uniq.slice(0, 4), name: '데스크', role: '데스크', password: deskPw, active: true, projectIds: [P1] }, admin));
  const deskLogin = await call('account.login', { loginId: 'desk' + uniq.slice(0, 4), password: deskPw });
  expectOk('데스크 로그인', deskLogin);
  expectOk('데스크 비밀번호 변경', await call('account.changePassword', { oldPassword: deskPw, newPassword: 'DeskNew' + uniq.slice(0, 4) + 'x1' }, deskLogin.data.token));
  const desk = deskLogin.data.token;
  expectErr('데스크가 관리자 action → 거부', await call('admin.staffList', {}, desk), '권한이 없습니다', 'FORBIDDEN');
  expectErr('설정 규칙 검사 (현장 저장)', await projSet(P1, { gpsDistance: '3' }), '10~5000');
  expectErr('현장 값은 공통 설정 저장으로는 못 바꿈', await call('admin.saveSettings', { values: { 'GPS허용거리m': '300' } }, admin, '', null), '프로젝트 메뉴');
  expectErr('예약 중복 기준 검사', await projSet(P1, { dupRule: '아무거나' }), '예약 중복');

  // ===== 관리자 비밀번호 이메일 인증 초기화 =====
  const rAdmin = 'resetadm' + uniq.slice(0, 4), rAdmin2 = 'resetad2' + uniq.slice(0, 4);
  const rpw0 = 'First' + uniq.slice(0, 4) + 'a1', rpw1 = 'Second' + uniq.slice(0, 4) + 'b2';
  expectErr('이메일 형식 검사', await call('admin.saveAccount', { loginId: 'bademail' + uniq.slice(0, 3), name: 'x', role: '관리자', password: rpw0, active: true, email: 'abc' }, admin), '이메일');
  expectOk('이메일 있는 관리자 계정 추가', await call('admin.saveAccount', { loginId: rAdmin, name: '리셋관리자', role: '관리자', password: rpw0, active: true, email: 'Reset@Test.Example' }, admin));
  expectOk('두 번째 관리자 계정 추가', await call('admin.saveAccount', { loginId: rAdmin2, name: '리셋관리자2', role: '관리자', password: rpw0, active: true, email: 'reset2@test.example' }, admin));
  const accList0 = (await call('admin.accounts', {}, admin)).data.accounts;
  check('이메일은 소문자로 저장', accList0.find((a) => a.loginId === rAdmin).email === 'reset@test.example');
  const deskAcc = accList0.find((a) => a.loginId === 'desk' + uniq.slice(0, 4));
  expectOk('데스크 계정에 이메일을 넣어도', await call('admin.saveAccount', { id: deskAcc.id, loginId: deskAcc.loginId, name: deskAcc.name, role: '데스크', active: true, email: 'desk@test.example', projectIds: deskAcc.projectIds }, admin));
  check('데스크 계정에는 이메일이 저장되지 않음', (await call('admin.accounts', {}, admin)).data.accounts.find((a) => a.id === deskAcc.id).email === '');

  const m0 = mails.length;
  expectOk('없는 아이디도 같은 응답 (계정 존재 여부를 알려주지 않음)', await call('account.resetRequest', { loginId: 'nobody' + uniq }));
  expectOk('데스크 계정도 같은 응답', await call('account.resetRequest', { loginId: deskAcc.loginId }));
  check('위 두 경우에는 메일이 가지 않음', mails.length === m0);
  const oldSession = await call('account.login', { loginId: rAdmin, password: rpw0 });
  expectOk('인증 코드 요청', await call('account.resetRequest', { loginId: rAdmin }));
  check('등록된 이메일로 6자리 코드 발송', mails.length === m0 + 1 && mails[m0].to[0] === 'reset@test.example' && /\d{6}/.test(mails[m0].text), mails[m0] ? mails[m0].to[0] : '(없음)');
  const code1 = /(\d{6})/.exec(mails[m0].text)[1];
  expectOk('1분 안에 다시 요청해도 같은 응답', await call('account.resetRequest', { loginId: rAdmin }));
  check('연속 요청은 메일을 또 보내지 않음', mails.length === m0 + 1);
  expectErr('틀린 코드', await call('account.resetConfirm', { loginId: rAdmin, code: '000000', newPassword: rpw1 }), '올바르지 않');
  expectErr('코드가 맞아도 약한 새 비밀번호는 거부', await call('account.resetConfirm', { loginId: rAdmin, code: code1, newPassword: 'abc' }), '8자 이상');
  expectOk('인증 코드로 새 비밀번호 설정', await call('account.resetConfirm', { loginId: rAdmin, code: code1, newPassword: rpw1 }));
  check('변경 알림 메일 발송', mails.length === m0 + 2 && /변경/.test(mails[m0 + 1].subject));
  expectErr('이전 비밀번호는 거부', await call('account.login', { loginId: rAdmin, password: rpw0 }), '올바르지 않');
  const relog = await call('account.login', { loginId: rAdmin, password: rpw1 });
  expectOk('새 비밀번호로 로그인', relog);
  check('본인이 정한 비밀번호라 변경 강제 없음', relog.data.account.mustChangePassword === false);
  expectErr('초기화 전에 로그인해 둔 세션은 무효', await call('auth.logout', {}, oldSession.data.token), null, 'AUTH');
  expectErr('같은 코드는 다시 쓸 수 없음', await call('account.resetConfirm', { loginId: rAdmin, code: code1, newPassword: rpw0 }), '올바르지 않');

  const m1 = mails.length;
  expectOk('두 번째 계정 코드 요청', await call('account.resetRequest', { loginId: rAdmin2 }));
  const code2 = /(\d{6})/.exec(mails[m1].text)[1];
  for (let i = 1; i <= 4; i++) expectErr('틀린 코드 ' + i + '회', await call('account.resetConfirm', { loginId: rAdmin2, code: '000000', newPassword: rpw1 }), '올바르지 않');
  expectErr('5회째 틀리면 잠김', await call('account.resetConfirm', { loginId: rAdmin2, code: '000000', newPassword: rpw1 }), '잠겼습니다', 'LOCKED');
  expectErr('잠긴 뒤에는 맞는 코드도 거부', await call('account.resetConfirm', { loginId: rAdmin2, code: code2, newPassword: rpw1 }), '잠겼습니다', 'LOCKED');
  expectOk('잠긴 동안 다시 요청해도 같은 응답', await call('account.resetRequest', { loginId: rAdmin2 }));
  check('잠긴 동안에는 메일을 보내지 않음', mails.length === m1 + 1);
  expectOk('두 번째 계정은 기존 비밀번호가 그대로', await call('account.login', { loginId: rAdmin2, password: rpw0 }));

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
  expectOk('GPS 허용거리 변경', await projSet(P1, { gpsDistance: '2000' }));
  check('프로젝트 목록에 현장 설정이 보임', (await projList()).find((x) => x.id === P1).gpsDistance === 2000);
  await projSet(P1, { gpsDistance: '200' });

  // ===== 3단계: 예약 =====
  const r5 = last5(), r5b = last5();
  await projSet(P1, { dupRule: '뒤5자리' });
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
  await projSet(P1, { dupRule: '뒤5자리+성별' });
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
  check('검색어가 없으면 아무 직원도 보여 주지 않음', (await call('desk.searchStaff', { q: '' }, desk)).data.staff.length === 0 && (await call('desk.searchStaff', {}, desk)).data.staff.length === 0);
  const all0 = await call('desk.searchStaff', { q: '테스트' }, desk);
  check('이름 일부로 검색한 리스트 (활동 직원, 전화번호 포함)', all0.ok && all0.data.staff.length >= 3 && all0.data.staff.every((x) => /^010-/.test(x.phone)), all0.ok ? String(all0.data.staff.length) : all0.error);
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
  expectOk('방명록 계정 추가', await call('admin.saveAccount', { loginId: 'kiosk' + uniq.slice(0, 4), name: '태블릿', role: '방명록', password: kioskPw, active: true, projectIds: [P1] }, admin));
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
  // ===== 1단계: 현장(프로젝트) 범위 — 다른 현장의 데이터에는 접근할 수 없다 =====
  const plist = await call('project.list', {}, admin, '', null);
  expectOk('관리자: 현장 목록', plist);
  check('첫 현장(P01, 코드 site1)이 있음', plist.data.projects.some((p) => p.id === P1 && p.code === 'site1'));
  expectErr('현장 코드 형식 검사', await call('project.save', { name: 'B현장', code: 'A_B' }, admin, '', null), '현장 코드');
  expectErr('현장 이름 필수', await call('project.save', { name: ' ' }, admin, '', null), '이름');
  expectErr('유형은 목록에서만 선택', await call('project.save', { name: 'x', kind: '우주기지' }, admin, '', null), '유형');
  expectErr('현장 상태 검사', await call('project.save', { name: 'x', status: '??' }, admin, '', null), '상태');
  const codeB = 'siteb' + uniq.slice(0, 3);
  const pB = await call('project.save', { name: 'B현장', code: codeB, kind: '아파트', status: '진행', moneyLabel: '분양가' }, admin, '', null);
  expectOk('현장 생성 (B현장)', pB);
  const P2 = pB.data.id;
  expectErr('현장 코드 중복 거부', await call('project.save', { name: 'C현장', code: codeB }, admin, '', null), '이미 사용');
  const orgsB0 = (await call('admin.orgs', {}, admin, '', P2)).data.orgs;
  check('새 현장에는 기본 직군만 만들어짐 (영업 포함, 본부·팀 없음)', orgsB0.filter((o) => o.kind === '직군').length === 5 && orgsB0.some((o) => o.name === '영업') && !orgsB0.some((o) => o.kind !== '직군'));
  const pBv = (await projList()).find((x) => x.id === P2);
  check('새 현장 기본 설정 (허용거리 200, 예약 중복 기준 뒤5자리)', pBv.gpsDistance === 200 && pBv.dupRule === '뒤5자리');
  const pD = await call('project.save', { name: '입력설정현장', code: 'cfg' + uniq.slice(0, 3), gpsDistance: '350', dupRule: '뒤5자리+성별' }, admin, '', null);
  expectOk('새 현장 만들면서 현장 설정 입력', pD);
  const pDv = (await projList()).find((x) => x.id === pD.data.id);
  check('입력한 현장 설정이 저장됨', pDv.gpsDistance === 350 && pDv.dupRule === '뒤5자리+성별');
  expectOk('현장 설정을 비워 저장하면 그대로 유지', await call('project.save', { id: pD.data.id, name: '입력설정현장', code: 'cfg' + uniq.slice(0, 3) }, admin, '', null));
  check('유지 확인', (await projList()).find((x) => x.id === pD.data.id).gpsDistance === 350);
  expectErr('존재하지 않는 현장을 가리키면 거부', await call('admin.staffList', {}, admin, '', 'PNOPE'), '접근할 수 없습니다', 'FORBIDDEN');
  expectErr('현장 없이 현장 업무 action → 거부', await call('admin.staffList', {}, admin, '', null), '현장을 선택', 'NO_PROJECT');

  // --- 계정: 역할별 현장 지정 규칙 ---
  const acctBase = (loginId, role, projectIds, extra) => ({ loginId, name: loginId, role, password: 'Pw' + uniq.slice(0, 4) + 'x1', active: true, projectIds, ...extra });
  const sfx = uniq.slice(0, 4);
  expectErr('보조관리자는 담당 현장 필수', await call('admin.saveAccount', acctBase('subx' + sfx, '보조관리자', []), admin, '', null), '현장');
  expectErr('데스크는 현장 1개만 지정', await call('admin.saveAccount', acctBase('deskx' + sfx, '데스크', [P1, P2]), admin, '', null), '1개');
  expectErr('없는 현장 지정 거부', await call('admin.saveAccount', acctBase('subx' + sfx, '보조관리자', ['PNOPE']), admin, '', null), '존재하지 않는');
  expectOk('보조관리자 A (P01 담당)', await call('admin.saveAccount', acctBase('suba' + sfx, '보조관리자', [P1]), admin, '', null));
  expectOk('보조관리자 B (B현장 담당)', await call('admin.saveAccount', acctBase('subb' + sfx, '보조관리자', [P2]), admin, '', null));
  expectOk('열람 계정 (P01)', await call('admin.saveAccount', acctBase('view' + sfx, '열람', [P1]), admin, '', null));
  expectOk('데스크 A (P01)', await call('admin.saveAccount', acctBase('deska' + sfx, '데스크', [P1]), admin, '', null));
  expectOk('데스크 B (B현장)', await call('admin.saveAccount', acctBase('deskb' + sfx, '데스크', [P2]), admin, '', null));
  expectOk('방명록 B (B현장)', await call('admin.saveAccount', acctBase('kiosb' + sfx, '방명록', [P2]), admin, '', null));
  const loginAs = async (loginId) => {
    const r = await call('account.login', { loginId, password: 'Pw' + sfx + 'x1' });
    if (r.ok && r.data.account.mustChangePassword) await call('account.changePassword', { oldPassword: 'Pw' + sfx + 'x1', newPassword: 'Pw' + sfx + 'y2' }, r.data.token, '', null);
    return r;
  };
  const lSubA = await loginAs('suba' + sfx), lSubB = await loginAs('subb' + sfx), lView = await loginAs('view' + sfx);
  const subA = lSubA.data.token, subB = lSubB.data.token, viewer = lView.data.token;
  const deskA = (await loginAs('deska' + sfx)).data.token, deskB = (await loginAs('deskb' + sfx)).data.token, kioskB = (await loginAs('kiosb' + sfx)).data.token;
  const meA = await call('account.me', {}, subA, '', null);
  check('내 정보(account.me): 역할과 담당 현장', meA.ok && meA.data.account.role === '보조관리자' && meA.data.projects.length === 1 && meA.data.projects[0].id === P1);
  check('보조관리자 A 로그인 응답에는 담당 현장(P01)만', lSubA.data.projects.length === 1 && lSubA.data.projects[0].id === P1, JSON.stringify(lSubA.data.projects));
  check('보조관리자는 급여 원문·지급 확정 권한 기본 불가', lSubA.data.account.allowPayroll === false && lSubA.data.account.allowPayConfirm === false);
  check('관리자 로그인 응답에는 전체 현장', (await call('account.login', { loginId: rAdmin2, password: rpw0 })).data.projects.length >= 2);

  // --- 보조관리자: 담당 현장만 ---
  expectOk('보조관리자 A: 자기 현장 직원 목록', await call('admin.staffList', {}, subA, '', P1));
  expectErr('보조관리자 A: 다른 현장(B현장) 직원 목록 → 거부', await call('admin.staffList', {}, subA, '', P2), '접근할 수 없습니다', 'FORBIDDEN');
  expectErr('보조관리자 B: P01 직원 목록 → 거부', await call('admin.staffList', {}, subB, '', P1), '접근할 수 없습니다', 'FORBIDDEN');
  expectErr('보조관리자: 현장 미선택 → 거부', await call('admin.staffList', {}, subA, '', null), '현장을 선택', 'NO_PROJECT');
  const plistA = await call('project.list', {}, subA, '', null);
  check('보조관리자 현장 목록에는 담당 현장만', plistA.ok && plistA.data.projects.length === 1 && plistA.data.projects[0].id === P1);
  for (const [label, action, data] of [
    ['현장 생성', 'project.save', { name: '무단 현장' }], ['계정 목록', 'admin.accounts', {}], ['계정 저장', 'admin.saveAccount', acctBase('hack' + sfx, '관리자', [])],
    ['설정 저장', 'admin.saveSettings', { values: { '텔레그램봇이름': 'hack_bot' } }], ['직원 현장 이동', 'admin.moveStaff', { staffId: idA, toProjectId: P2, job: '상담사' }]
  ]) expectErr('보조관리자는 관리자 전용 action 불가: ' + label, await call(action, data, subA, '', action.startsWith('project.') || action.startsWith('admin.acc') ? null : P1), '권한이 없습니다', 'FORBIDDEN');
  expectErr('열람 계정은 아직 직원 관리 불가', await call('admin.staffList', {}, viewer, '', P1), '권한이 없습니다', 'FORBIDDEN');
  check('열람 계정도 담당 현장 목록은 받음', (await call('project.list', {}, viewer, '', null)).data.projects.length === 1);

  // --- B현장 조직·가입 ---
  expectOk('보조관리자 B: B현장에 본부 추가', await call('admin.saveOrg', { kind: '본부', name: 'B본부', order: 1 }, subB, '', P2));
  const headB = (await call('admin.orgs', {}, subB, '', P2)).data.orgs.find((o) => o.kind === '본부').id;
  expectOk('보조관리자 B: B현장에 팀 추가', await call('admin.saveOrg', { kind: '팀', name: 'B팀', parentId: headB, order: 1 }, subB, '', P2));
  const orgsB = (await call('admin.orgs', {}, subB, '', P2)).data.orgs;
  const teamB = orgsB.find((o) => o.kind === '팀').id;
  expectErr('B현장에서 P01 조직(OH01)을 수정할 수 없음', await call('admin.saveOrg', { id: 'OH01', kind: '본부', name: '탈취', order: 1 }, subB, '', P2), '찾을 수 없습니다');
  expectErr('B현장 팀을 P01 본부(OH01) 아래에 만들 수 없음', await call('admin.saveOrg', { kind: '팀', name: '잘못된팀', parentId: 'OH01', order: 1 }, subB, '', P2), '소속 본부');
  expectErr('P01에서 B현장 조직을 수정할 수 없음', await call('admin.saveOrg', { id: headB, kind: '본부', name: '탈취', order: 1 }, subA, '', P1), '찾을 수 없습니다');
  const pubB = (await call('public.orgs', { projectCode: codeB })).data;
  const pubA = (await call('public.orgs', { projectCode: 'site1' })).data;
  check('가입 화면 조직은 현장별 (B현장: B본부만, P01 조직 없음)', pubB.siteName === 'B현장' && pubB.heads.length === 1 && pubB.heads[0].name === 'B본부' && !pubB.heads.some((x) => x.id === 'OH01'));
  check('가입 화면 조직은 현장별 (P01: B본부 없음)', !pubA.heads.some((x) => x.id === headB) && pubA.heads.some((x) => x.id === 'OH01'));
  expectErr('틀린 현장 코드 → 가입 링크 오류', await call('public.orgs', { projectCode: 'nopecode' }), '가입 링크가 올바르지');
  expectErr('현장 코드 없이 가입 화면 조회 불가', await call('public.orgs', {}), '가입 링크가 올바르지');

  const S1 = person(21), S2 = person(22);
  expectErr('B현장 가입에 P01 본부를 고르면 거부', await call('staff.signup', base(S1, { projectCode: codeB, job: '영업', headId: 'OH01', teamId: 'OT011' }), '', S1.dev), '본부');
  expectErr('가입 링크 없이는 가입 불가', await call('staff.signup', base(S1, { projectCode: '' }), '', S1.dev), '가입 링크가 올바르지');
  expectOk('B현장 가입 (영업, B본부/B팀)', await call('staff.signup', base(S1, { projectCode: codeB, job: '영업', headId: headB, teamId: teamB }), '', S1.dev));
  const listB = (await call('admin.staffList', {}, subB, '', P2)).data.staff;
  const idS1 = listB.find((x) => x.phone === S1.phone).id;
  check('B현장 직원 목록에 S1 (B본부/B팀)', listB.length === 1 && listB[0].id === idS1 && listB[0].headName === 'B본부' && listB[0].teamName === 'B팀');
  check('P01 직원 목록에는 S1 없음', !(await call('admin.staffList', {}, subA, '', P1)).data.staff.some((x) => x.id === idS1) && !(await call('admin.staffList', {}, admin, '', P1)).data.staff.some((x) => x.id === idS1));

  // --- 다른 현장 직원 번호(id)를 알아내도 건드릴 수 없다 ---
  for (const [label, action, data] of [
    ['승인', 'admin.approve', {}], ['반려', 'admin.reject', { reason: '탈취' }], ['퇴사', 'admin.retire', {}], ['PIN 초기화', 'admin.resetPin', {}],
    ['기기변경 승인', 'admin.approveDevice', {}], ['급여정보 보기', 'admin.payrollGet', {}],
    ['수정', 'admin.update', { name: '탈취', phone: '010' + rnd(), job: '영업', headId: 'OH01', teamId: 'OT011', grade: '직원' }]
  ]) {
    const arg = { staffId: idS1, ...data };
    check('보조관리자 A(P01)가 B현장 직원 ' + label + ' 불가', (await call(action, arg, subA, '', P1)).ok === false);
    check('관리자도 P01 화면에서는 B현장 직원 ' + label + ' 불가', (await call(action, arg, admin, '', P1)).ok === false);
  }
  expectErr('P01 화면에서 B현장 직원 승인 → 찾을 수 없음', await call('admin.approve', { staffId: idS1 }, subA, '', P1), '직원을 찾을 수 없습니다');
  expectErr('급여정보 원문: 허용 안 된 보조관리자는 자기 현장이어도 불가', await call('admin.payrollReveal', { staffId: idA }, subA, '', P1), '권한', 'FORBIDDEN');
  expectErr('급여정보 원문: 관리자도 다른 현장 직원은 못 봄', await call('admin.payrollReveal', { staffId: idS1 }, admin, '', P1), '급여정보가 없습니다');
  check('B현장 직원은 여전히 승인 대기', (await call('admin.staffList', {}, subB, '', P2)).data.staff[0].status === '대기');

  expectOk('보조관리자 B: B현장 직원 승인', await call('admin.approve', { staffId: idS1 }, subB, '', P2));
  const payB = await call('admin.payrollGet', { staffId: idS1 }, subB, '', P2);
  check('보조관리자 급여정보는 마스킹', payB.ok && payB.data.rrn === '000101-3******' && payB.data.accountNo === '******0000');
  expectErr('보조관리자 B: 원문 보기 권한 없음', await call('admin.payrollReveal', { staffId: idS1 }, subB, '', P2), '권한', 'FORBIDDEN');
  const accB = (await call('admin.accounts', {}, admin, '', null)).data.accounts.find((a) => a.loginId === 'subb' + sfx);
  check('계정 목록에 담당 현장·권한 표시', accB.projectIds.length === 1 && accB.projectIds[0] === P2 && accB.allowPayroll === false);
  expectOk('관리자가 보조관리자 B에게 급여 원문 보기 허용', await call('admin.saveAccount', { id: accB.id, loginId: accB.loginId, name: accB.name, role: '보조관리자', active: true, projectIds: [P2], allowPayroll: true }, admin, '', null));
  const revB = await call('admin.payrollReveal', { staffId: idS1 }, subB, '', P2);
  check('허용된 보조관리자는 원문 보기 가능', revB.ok && revB.data.rrn === '000101-3000000');
  expectErr('허용돼도 다른 현장 직원의 원문은 못 봄', await call('admin.payrollReveal', { staffId: idA }, subB, '', P2), '급여정보가 없습니다');
  const logRows = (await query(`SELECT user, project_id FROM logs WHERE action = '급여정보열람' AND target = '${idS1}'`));
  check('원문 열람이 현장·사용자와 함께 기록됨', logRows.length === 1 && logRows[0].user === 'subb' + sfx && logRows[0].project_id === P2, JSON.stringify(logRows));
  check('현장 생성이 기록됨', (await query(`SELECT 1 AS x FROM logs WHERE action = '현장생성' AND project_id = '${P2}'`)).length === 1);

  // --- 직원앱: 소속 현장으로 들어가고, 다른 현장은 접근 불가 ---
  const loginS1 = await call('staff.login', { phone: S1.phone, pin: S1.pin }, '', S1.dev, null);
  expectOk('B현장 직원 로그인', loginS1);
  check('로그인 응답에 소속 현장 (B현장)', loginS1.data.project && loginS1.data.project.id === P2 && loginS1.data.project.name === 'B현장');
  const tokS1 = loginS1.data.token;
  check('내 정보에 소속 현장', (await call('staff.me', {}, tokS1, S1.dev, null)).data.project.id === P2);
  expectErr('직원이 다른 현장(P01)을 가리키면 거부', await call('reservation.list', { tab: '예정' }, tokS1, S1.dev, P1), '접근할 수 없습니다', 'FORBIDDEN');
  expectOk('직원이 자기 현장을 가리키면 허용', await call('reservation.list', { tab: '예정' }, tokS1, S1.dev, P2));

  // --- 근태: QR·거리 기준·출근 기록이 현장별 ---
  const qrA = (await call('admin.currentQr', {}, admin, '', P1)).data.qr;
  check('B현장은 아직 QR 없음', (await call('admin.currentQr', {}, subB, '', P2)).data.issued === false);
  expectErr('QR 이 없으면 출근 실패 (P01 QR 이 있어도 B현장에는 무효)', await call('attendance.checkin', { qr: qrA, lat: 35.1, lng: 129.0, accuracy: 5 }, tokS1, S1.dev, null), '아직 발급되지 않았습니다');
  const issuedB = await call('admin.issueQr', { lat: 35.1, lng: 129.0, accuracy: 8 }, subB, '', P2);
  expectOk('보조관리자 B: B현장 QR 발급', issuedB);
  check('P01 QR 은 그대로', (await call('admin.currentQr', {}, admin, '', P1)).data.qr === qrA);
  expectErr('B현장 직원이 P01 QR 로 출근 → 실패', await call('attendance.checkin', { qr: qrA, lat: 35.1003, lng: 129.0003, accuracy: 5 }, tokS1, S1.dev, null), '오늘 QR이 아닙니다');
  const ckB = await call('attendance.checkin', { qr: issuedB.data.qr, lat: 35.1003, lng: 129.0003, accuracy: 5 }, tokS1, S1.dev, null);
  expectOk('B현장 QR 로 출근', ckB);
  const dayB = (await call('admin.attendance', { date: today }, subB, '', P2)).data;
  const dayA = (await call('admin.attendance', { date: today }, admin, '', P1)).data;
  check('B현장 출근 현황에는 S1 만', dayB.present.length === 1 && dayB.present[0].id === idS1 && dayB.activeCount === 1);
  check('P01 출근 현황에는 S1 없음', !dayA.present.some((p) => p.id === idS1) && !dayA.absent.some((p) => p.id === idS1));
  check('출근 기록에 현장이 저장됨', (await query(`SELECT project_id FROM attendance WHERE staff_id = '${idS1}' AND result = '성공'`))[0].project_id === P2);
  expectOk('B현장 GPS 허용거리 변경', await projSet(P2, { gpsDistance: '2000' }));
  check('설정은 현장별 (B현장 2000, P01 은 그대로 200)', (await projList()).find((x) => x.id === P2).gpsDistance === 2000 && (await projList()).find((x) => x.id === P1).gpsDistance === 200);
  check('보조관리자 목록에도 담당 현장의 설정이 보임', (await call('project.list', {}, subA, '', null)).data.projects[0].gpsDistance === 200);

  // --- 예약: 같은 뒤 5자리도 현장이 다르면 별개 ---
  expectOk('P01 에 예약된 번호를 B현장에서도 예약 가능 (현장별 중복 판정)', await call('reservation.create', { last5: r5, date: today }, tokS1, S1.dev, null));
  const resB = (await call('reservation.list', { tab: '예정' }, tokS1, S1.dev, null)).data.reservations;
  check('B현장 직원 예약 목록에는 자기 것만', resB.length === 1 && resB[0].last5 === r5);
  check('관리자 예약 현황은 현장별 (B현장 1건, P01 은 B현장 건 제외)',
    (await call('admin.reservations', { from: today, to: today }, subB, '', P2)).data.reservations.length === 1
    && (await call('admin.reservations', { from: today, to: today }, admin, '', P1)).data.reservations.every((r) => !r.staff || r.staff.name !== S1.name));

  // --- 데스크·방명록: 계정에 고정된 현장 ---
  expectErr('데스크 A(P01 고정)가 B현장을 가리키면 거부', await call('desk.todayVisits', {}, deskA, '', P2), '접근할 수 없습니다', 'FORBIDDEN');
  expectErr('데스크 B(B현장 고정)가 P01 을 가리키면 거부', await call('desk.todayVisits', {}, deskB, '', P1), '접근할 수 없습니다', 'FORBIDDEN');
  const lookB = await call('desk.lookup', { last5: r5 }, deskB, '', null);
  check('데스크 B 조회: B현장 예약(S1)만', lookB.ok && lookB.data.reservations.length === 1 && lookB.data.reservations[0].staff.id === idS1, JSON.stringify(lookB.data));
  const lookA = await call('desk.lookup', { last5: r5 }, deskA, '', null);
  check('데스크 A 조회: P01 예약만 (S1 없음)', lookA.ok && lookA.data.reservations.length >= 1 && lookA.data.reservations.every((r) => r.staff && r.staff.id !== idS1));
  const orgB = (await call('desk.orgs', {}, deskB, '', null)).data;
  check('데스크 화면 조직은 자기 현장 것', orgB.siteName === 'B현장' && orgB.heads.length === 1 && orgB.heads[0].id === headB);
  check('방명록 계정도 자기 현장 조직', (await call('desk.orgs', {}, kioskB, '', null)).data.siteName === 'B현장');
  expectErr('데스크 B 가 P01 직원을 지명 호출 → 거부', await call('desk.registerVisit', { kind: '지명', staffId: idA }, deskB, '', null), '활동 중이 아닙니다');
  expectErr('데스크 B 가 P01 방문 기록을 재호출 → 거부', await call('desk.recall', { visitId: reg.data.visitId }, deskB, '', null), '방문 기록을 찾을 수 없습니다');
  expectErr('데스크 B 가 P01 예약으로 방문 접수 → 거부', await call('desk.registerVisit', { kind: '예약', reservationId: mine.id, last5: r5 }, deskB, '', null), '오늘 예약을 찾을 수 없습니다');
  const srB = (await call('desk.searchStaff', { q: '테스트' }, deskB, '', null)).data.staff;
  check('데스크 B 직원 검색에는 B현장 직원만', srB.length === 1 && srB[0].id === idS1);
  check('데스크 B 예약명단에는 B현장 예약만', (await call('desk.reservationList', { date: today }, deskB, '', null)).data.reservations.every((x) => x.staff && x.staff.id === idS1));
  const gB = '010' + rnd();
  expectOk('방명록 B 제출', await call('guest.submit', { name: 'B고객' + uniq, phone: gB, companions: 0, consent: true }, kioskB, '', null));
  const glB = (await call('desk.guestList', {}, deskB, '', null)).data.guests;
  const glA = (await call('desk.guestList', {}, deskA, '', null)).data.guests;
  check('B현장 방명록 목록에는 B현장 건만', glB.length === 1 && glB[0].name === 'B고객' + uniq);
  check('P01 방명록 목록에는 B현장 건 없음', !glA.some((g) => g.name === 'B고객' + uniq));
  expectErr('데스크 B 가 P01 방명록 건을 수정 → 거부', await call('desk.guestSave', { id: g1[0].id, name: '탈취', phone: gPhone, companions: 0 }, deskB, '', null), '찾을 수 없습니다');
  expectErr('데스크 B 가 P01 방명록 건을 삭제 → 거부', await call('desk.guestDelete', { id: g1[0].id }, deskB, '', null), '찾을 수 없습니다');
  expectErr('데스크 B 가 P01 방명록 건을 호출 → 거부', await call('desk.guestCall', { id: g1[0].id }, deskB, '', null), '찾을 수 없습니다');
  expectErr('방명록 담당 지정에 P01 본부 사용 → 거부', await call('desk.guestSave', { id: glB[0].id, name: 'B고객' + uniq, phone: gB, companions: 0, headId: 'OH01', staffNone: true }, deskB, '', null), '본부를 확인');
  expectErr('방명록 담당 지정에 P01 직원 사용 → 거부', await call('desk.guestSave', { id: glB[0].id, name: 'B고객' + uniq, phone: gB, companions: 0, headId: headB, teamId: teamB, staffId: idA }, deskB, '', null), '담당자가 아닙니다');
  expectOk('방명록 담당 지정(B현장 직원)', await call('desk.guestSave', { id: glB[0].id, name: 'B고객' + uniq, phone: gB, companions: 0, headId: headB, teamId: teamB, staffId: idS1 }, deskB, '', null));
  const gsB = (await call('admin.guestStats', { from: today, to: today }, subB, '', P2)).data.total;
  const gsA = (await call('admin.guestStats', { from: today, to: today }, admin, '', P1)).data.total;
  check('방명록 통계는 현장별 (B현장 1팀, P01 은 B현장 건 제외)', gsB.teams === 1 && gsA.teams === gt.teams);
  check('방명록 내보내기는 현장별 + 기록됨', (await call('admin.guestbook', { from: today, to: today }, subB, '', P2)).data.guests.length === 1
    && (await query(`SELECT 1 AS x FROM logs WHERE action = '방명록내보내기' AND project_id = '${P2}'`)).length === 1);
  const dashB = (await call('admin.dashboard', {}, subB, '', P2)).data;
  check('대시보드는 현장별 (B현장: 활동 1명, 출근 1명)', dashB.today.activeStaff === 1 && dashB.today.attendance === 1 && dashB.today.reservations === 1, JSON.stringify(dashB.today));

  // --- 담당 현장 변경은 즉시 반영 ---
  const accA = (await call('admin.accounts', {}, admin, '', null)).data.accounts.find((a) => a.loginId === 'suba' + sfx);
  expectOk('보조관리자 A 에게 B현장도 지정', await call('admin.saveAccount', { id: accA.id, loginId: accA.loginId, name: accA.name, role: '보조관리자', active: true, projectIds: [P1, P2] }, admin, '', null));
  expectOk('지정 직후 B현장 접근 가능', await call('admin.staffList', {}, subA, '', P2));
  expectOk('다시 P01 만 지정', await call('admin.saveAccount', { id: accA.id, loginId: accA.loginId, name: accA.name, role: '보조관리자', active: true, projectIds: [P1] }, admin, '', null));
  expectErr('회수 직후 B현장 접근 불가', await call('admin.staffList', {}, subA, '', P2), '접근할 수 없습니다', 'FORBIDDEN');

  // --- 종료된 현장은 가입을 받지 않는다 ---
  const pC = await call('project.save', { name: '종료현장', code: 'done' + uniq.slice(0, 3), status: '종료' }, admin, '', null);
  expectOk('종료 상태 현장 생성', pC);
  expectErr('종료된 현장 가입 링크 → 거부', await call('public.orgs', { projectCode: 'done' + uniq.slice(0, 3) }), '종료된 현장');

  // --- 현장 이동 (관리자 전용): 소속·조직 재지정, 직급 초기화, 기록 보존 ---
  const attA = (await query(`SELECT COUNT(*) AS n FROM attendance WHERE staff_id = '${idA}' AND project_id = '${P1}'`))[0].n;
  expectErr('같은 현장으로는 이동 불가', await call('admin.moveStaff', { staffId: idA, toProjectId: P1, job: '상담사' }, admin, '', P1), '이미 이 현장');
  expectErr('퇴사한 직원은 이동 불가', await call('admin.moveStaff', { staffId: idB, toProjectId: P2, job: '상담사' }, admin, '', P1), '퇴사');
  expectErr('종료된 현장으로는 이동 불가', await call('admin.moveStaff', { staffId: idA, toProjectId: pC.data.id, job: '상담사' }, admin, '', P1), '종료된 현장');
  expectErr('이동할 현장에 없는 직군 → 거부', await call('admin.moveStaff', { staffId: idA, toProjectId: P2, job: '없는직군' }, admin, '', P1), '직군');
  expectErr('영업 직군은 새 현장의 본부/팀을 골라야 함', await call('admin.moveStaff', { staffId: idA, toProjectId: P2, job: '영업', headId: 'OH01', teamId: 'OT011' }, admin, '', P1), '본부');

  // --- 가입 안내 메시지 / 전체 현장 검색 / 이동 시 예약 처리 ---
  const A2x = () => ({ ...A, dev: 'dev-a2-' + uniq + '-xxxx' });
  const SX = person(31);
  expectErr('다른 현장에 가입된 번호로 가입 → 어느 현장인지 안내', await call('staff.signup', base(S1, { projectCode: 'site1' }), '', 'dev-new-' + uniq + '-xxxx'), 'B현장에 가입되어 있습니다');
  expectErr('같은 번호가 다른 현장 링크로 가입 시도 → 이동 안내', await call('staff.signup', base(A2x(), { projectCode: codeB }), '', 'dev-new2-' + uniq + '-xxxx'), '현장 이동을 요청');
  expectErr('같은 휴대폰으로 다른 번호 가입 → 기존 번호(마스킹)와 현장 안내', await call('staff.signup', base(SX, { projectCode: 'site1' }), '', S1.dev), '010-****-' + S1.phone.slice(-4));
  const srAdmin = await call('admin.staffSearchAll', { q: S1.name }, admin, '', null);
  check('전체 현장 검색 (관리자): 현장명·직급 포함', srAdmin.ok && srAdmin.data.staff.length === 1 && srAdmin.data.staff[0].projectName === 'B현장' && srAdmin.data.staff[0].grade === '직원');
  check('전체 현장 검색은 전화번호 일부로도 가능', (await call('admin.staffSearchAll', { q: S1.phone.slice(-6) }, admin, '', null)).data.staff.some((x) => x.id === idS1));
  expectErr('전체 현장 검색은 검색어 필수', await call('admin.staffSearchAll', { q: ' ' }, admin, '', null), '검색어');
  check('보조관리자 A 는 담당 외 현장(B현장) 직원이 검색되지 않음', (await call('admin.staffSearchAll', { q: S1.name }, subA, '', null)).data.staff.length === 0);
  check('보조관리자 B 는 자기 현장 직원을 검색함', (await call('admin.staffSearchAll', { q: S1.name }, subB, '', null)).data.staff.length === 1);
  expectErr('데스크는 전체 현장 검색 불가', await call('admin.staffSearchAll', { q: S1.name }, deskA, '', null), '권한');
  // 이동: 아직 방문하지 않은 예약은 취소, 지난/방문 기록은 이름만 남김
  const rMv = last5();
  expectOk('이동 전 직원 A 의 새 예약', await call('reservation.create', { last5: rMv, date: today, gender: '남' }, tokA3, A.dev));
  const mvInfo = await call('admin.moveInfo', { staffId: idA }, admin, '', P1);
  check('이동 전 요약: 이번 달 출근일수와 예정 예약 수', mvInfo.ok && mvInfo.data.attendanceDaysThisMonth >= 1 && mvInfo.data.upcomingReservations >= 1, JSON.stringify(mvInfo.data));
  const mvRes = await call('admin.moveStaff', { staffId: idA, toProjectId: P2, job: '상담사' }, admin, '', P1);
  expectOk('직원 A 를 B현장으로 이동', mvRes);
  check('이동 응답에 취소된 예약 수', mvRes.data.canceledReservations >= 1);
  const rlMv = (await call('desk.reservationList', { date: today }, deskA, '', null)).data.reservations;
  const cancelled = rlMv.find((r) => r.last5 === rMv);
  check('이동 전 방문하지 않은 예약은 취소 처리되고 호출 불가·전화번호 없음', cancelled && cancelled.status === '취소' && cancelled.callable === false && (!cancelled.staff || cancelled.staff.phone === ''), JSON.stringify(cancelled));
  check('이동한 직원의 지난 예약(방문 완료)은 이름만 보이고 호출·전화번호 없음', rlMv.filter((r) => r.staff && r.staff.id === idA).every((r) => r.callable === false && r.staff.phone === '' && /타 현장 이전/.test(r.staff.name)));
  check('조회에서는 이동한 직원이 담당자로 나오지 않음', (await call('desk.lookup', { last5: rMv }, deskA, '', null)).data.reservations.every((r) => !r.staff || r.staff.id !== idA));
  check('관리자 예약 현황: 이동한 직원은 이름 + (타 현장 이전)', (await call('admin.reservations', { from: today, to: today }, admin, '', P1)).data.reservations.some((r) => r.staff && /타 현장 이전/.test(r.staff.name)));
  expectErr('이동하면 이전 로그인은 무효', await call('staff.me', {}, tokA3, A.dev, null), null, 'AUTH');
  const reA = await call('staff.login', { phone: A.phone, pin: A.pin }, '', A.dev, null);
  check('다시 로그인하면 B현장으로 들어감', reA.ok && reA.data.project.id === P2 && reA.data.staff.grade === '직원');
  check('이동한 직원이 B현장 목록에 있고 P01 에는 없음', (await call('admin.staffList', {}, subB, '', P2)).data.staff.some((x) => x.id === idA) && !(await call('admin.staffList', {}, admin, '', P1)).data.staff.some((x) => x.id === idA));
  check('지난 출근 기록은 이전 현장(P01)에 그대로', (await query(`SELECT COUNT(*) AS n FROM attendance WHERE staff_id = '${idA}' AND project_id = '${P1}'`))[0].n === attA && attA >= 1, String(attA));
  check('이동이 기록됨', (await query(`SELECT content FROM logs WHERE action = '직원현장이동' AND target = '${idA}'`)).length === 1);
  expectErr('이동 후 P01 화면에서는 그 직원을 건드릴 수 없음', await call('admin.resetPin', { staffId: idA }, subA, '', P1), '직원을 찾을 수 없습니다');
  // ===== 2단계: 근태 보정 + 용역관리(일급 정산) =====
  // 금액은 아래 주석의 수작업 계산과 대조한다 (일당 × 일수, 소득세 3%·지방소득세 0.3% 각각 원 단위 절사)
  const codePP = 'pay' + uniq.slice(0, 4);
  const pPP = await call('project.save', { name: '정산현장', code: codePP, status: '진행' }, admin, '', null);
  expectOk('정산 시험용 현장 생성', pPP);
  const PP = pPP.data.id;
  const pmk = async (i, extra) => {
    const p = person(40 + i);
    expectOk('정산 시험 직원 가입 ' + i, await call('staff.signup', base(p, { projectCode: codePP, job: '상담사', ...extra }), '', p.dev));
    const id = (await call('admin.staffList', {}, admin, '', PP)).data.staff.find((x) => x.phone === p.phone).id;
    await call('admin.approve', { staffId: id }, admin, '', PP);
    return { ...p, id };
  };
  const W1 = await pmk(1), W2 = await pmk(2), W3 = await pmk(3), W4 = await pmk(4), W5 = await pmk(5), W6 = await pmk(6), W7 = await pmk(7);
  let tcount = 0;
  const patt = (pid, w, days) => days.map((d) => `INSERT INTO attendance (id, project_id, date, staff_id, time, device_key, result, distance_m) VALUES ('TT${uniq.slice(0, 3)}${++tcount}', '${pid}', '2026-09-${String(d).padStart(2, '0')}', '${w.id}', '09:00:00', '${w.dev}', '성공', 10)`).join(';\n');
  const prange = (a, b) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
  await sql([patt(PP, W1, prange(1, 20)), patt(PP, W2, prange(1, 7)), patt(PP, W3, [1, 2, 3]), patt(PP, W4, prange(7, 11)), patt(PP, W5, [1]), patt(PP, W6, [1]), patt(PP, W7, [1, 2, 3])].join(';\n'));

  const setPay = (w, o) => call('pay.settingSave', { staffId: w.id, effectiveFrom: '2026-01-01', cycle: '월', dailyEnabled: true, feeEnabled: false, withhold: true, ...o }, admin, '', PP);
  expectErr('일당은 0 이상 정수', await setPay(W1, { dailyWage: -5 }), '일당');
  expectErr('일당은 정수', await setPay(W1, { dailyWage: 1000.5 }), '일당');
  expectErr('일급 대상인데 일당 0 → 거부', await setPay(W1, { dailyWage: 0 }), '일당을 입력');
  expectErr('지급 주기 검사', await setPay(W1, { dailyWage: 100000, cycle: '년' }), '주기');
  expectErr('적용 시작일 형식 검사', await setPay(W1, { dailyWage: 100000, effectiveFrom: '2026/01/01' }), '적용 시작일');
  expectOk('W1 일당 100,000 월', await setPay(W1, { dailyWage: 100000 }));
  expectOk('W2 일당 85,000 월', await setPay(W2, { dailyWage: 85000 }));
  expectOk('W3 일당 33,333 월', await setPay(W3, { dailyWage: 33333 }));
  expectOk('W4 일당 150,000 주, 공제 없음', await setPay(W4, { dailyWage: 150000, cycle: '주', withhold: false }));
  expectOk('W6 일급 대상 아님', await setPay(W6, { dailyWage: 0, dailyEnabled: false }));
  expectOk('W7 일당 50,000 월', await setPay(W7, { dailyWage: 50000 }));
  const psl = (await call('pay.settingList', {}, subA, '', P1)).data.staff;
  check('지급 설정 목록은 그 현장 직원만 (P01 화면에 정산현장 직원 없음)', !psl.some((x) => x.id === W1.id));
  const slPP = (await call('pay.settingList', {}, admin, '', PP)).data.staff;
  const w1s = slPP.find((x) => x.id === W1.id);
  check('지급 설정 목록: 현재 설정과 기본값(상담사는 수수료 대상 아님)', w1s.current.dailyWage === 100000 && w1s.current.cycle === '월' && w1s.defaults.feeEnabled === false && slPP.find((x) => x.id === W5.id).current === null);
  expectOk('설정 이력: 같은 직원 다른 적용일', await setPay(W1, { dailyWage: 100000, effectiveFrom: '2099-01-01' }));
  check('미래 적용 설정은 upcoming 으로 분리', (await call('pay.settingList', {}, admin, '', PP)).data.staff.find((x) => x.id === W1.id).upcoming.length === 1);
  expectErr('다른 현장 직원 설정은 못 바꿈', await call('pay.settingSave', { staffId: W1.id, dailyWage: 1, cycle: '월' }, admin, '', P1), '직원을 찾을 수 없습니다');

  // --- 근태 보정 ---
  const padj = (w, date, kind, reason, pid = PP, tk = admin) => call('admin.adjustSave', { staffId: w.id, date, kind, reason }, tk, '', pid);
  expectErr('보정 구분 검사', await padj(W1, '2026-09-05', '결근', ''), '보정 구분');
  expectErr('오늘 이후 날짜는 보정 불가', await padj(W1, '2999-01-01', '인정', ''), '오늘 이후');
  expectErr('다른 현장 직원은 보정 불가', await padj(W1, '2026-09-05', '인정', '', P1), '직원을 찾을 수 없습니다');
  expectOk('W1 9/5 불인정 (출근 기록은 그대로, 인정 일수만 0)', await padj(W1, '2026-09-05', '불인정', '현장 이탈'));
  expectOk('W1 9/10 반일', await padj(W1, '2026-09-10', '반일', '오후 조퇴'));
  expectOk('W1 9/21 인정 (출근 기록 없음)', await padj(W1, '2026-09-21', '인정', '출근 QR 오류'));
  expectOk('W2 9/4 반일', await padj(W2, '2026-09-04', '반일', ''));
  expectOk('W3 9/2 반일', await padj(W3, '2026-09-02', '반일', ''));
  expectOk('보정 임시 등록', await padj(W3, '2026-09-30', '인정', '임시'));
  expectOk('보정 해제', await call('admin.adjustDelete', { staffId: W3.id, date: '2026-09-30' }, admin, '', PP));
  const pmA = (await call('admin.attendance', { month: '2026-09' }, admin, '', PP)).data;
  const mW1 = pmA.staff.find((x) => x.id === W1.id);
  check('월별 근태: 보정 반영 인정 근무일수 19.5일, 보정 표시, 원본 출근일수 20일', mW1.workDays === 19.5 && mW1.adjusts[5].kind === '불인정' && mW1.adjusts[21].kind === '인정' && mW1.days.length === 20, JSON.stringify([mW1.workDays, mW1.days.length]));
  const psa = await call('admin.adjustSave', { staffId: W1.id, date: '2026-09-05', kind: '인정' }, subA, '', PP);
  expectErr('P01 보조관리자는 정산현장 근태 보정 불가', psa, '접근할 수 없습니다', 'FORBIDDEN');

  // --- 현장 이동 직후에도 이전 현장 실적은 이전 현장 정산에 남는다 ---
  expectOk('W7 을 B현장(P2)으로 이동', await call('admin.moveStaff', { staffId: W7.id, toProjectId: P2, job: '상담사' }, admin, '', PP));
  await sql(patt(P2, W7, [20, 21]));
  expectOk('W7 B현장 일당 70,000 월', await call('pay.settingSave', { staffId: W7.id, effectiveFrom: '2026-01-01', dailyWage: 70000, cycle: '월', dailyEnabled: true, withhold: true }, admin, '', P2));
  const mAfter = (await call('admin.attendance', { month: '2026-09' }, admin, '', PP)).data.staff.find((x) => x.id === W7.id);
  check('정산현장 월별 근태에 이동한 W7 이 이름 + (타 현장 이전)으로 남음 (3일)', mAfter && /타 현장 이전/.test(mAfter.name) && mAfter.workDays === 3);

  // --- 정산 회차 만들기 ---
  const pcreate = (o) => call('pay.runCreate', { cycle: '월', from: '2026-09-01', to: '2026-09-30', ...o }, admin, '', PP);
  expectErr('월 정산은 같은 달 안에서', await pcreate({ to: '2026-10-05' }), '같은 달');
  expectErr('주 정산은 7일 이내', await pcreate({ cycle: '주', from: '2026-09-01', to: '2026-09-08' }), '7일');
  expectErr('시작일이 더 늦으면 거부', await pcreate({ from: '2026-09-30', to: '2026-09-01' }), '시작일');
  expectErr('오늘 이후는 정산 불가', await pcreate({ from: '2999-01-01', to: '2999-01-31' }), '오늘 이후');
  expectErr('주기 검사', await pcreate({ cycle: '일' }), '주기');
  const prun1 = await pcreate({ title: '9월 월급여' });
  expectOk('9월 월 정산 회차 작성', prun1);
  // 수작업 계산: W1 1,950,000 (세금 58,500+5,850) / W2 552,500 (16,575+1,657) / W3 83,332 (2,499+249) / W7 150,000 (4,500+450)
  check('회차 합계: 4명, 총액 2,735,832, 공제 90,280, 실지급 2,645,552', prun1.data.people === 4 && prun1.data.gross === 2735832 && prun1.data.tax === 90280 && prun1.data.net === 2645552, JSON.stringify(prun1.data));
  const pwhy = Object.fromEntries(prun1.data.notIncluded.map((x) => [x.name, x.reason]));
  check('제외된 사람과 이유: W4(주기 다름), W5(설정 없음), W6(일급 대상 아님)', /주기/.test(pwhy[W4.name]) && /설정/.test(pwhy[W5.name]) && /대상이 아닙니다/.test(pwhy[W6.name]), JSON.stringify(pwhy));
  const pg1 = (await call('pay.runGet', { runId: prun1.data.id }, admin, '', PP)).data;
  const pit = (id) => pg1.items.find((x) => x.staffId === id);
  check('W1 명세: 19.5일, 1,950,000 / 소득세 58,500 / 지방세 5,850 / 실지급 1,885,650', pit(W1.id).days === 19.5 && pit(W1.id).gross === 1950000 && pit(W1.id).incomeTax === 58500 && pit(W1.id).localTax === 5850 && pit(W1.id).net === 1885650);
  check('W2 명세: 6.5일, 552,500 / 16,575 / 1,657(절사) / 534,268', pit(W2.id).days === 6.5 && pit(W2.id).gross === 552500 && pit(W2.id).incomeTax === 16575 && pit(W2.id).localTax === 1657 && pit(W2.id).net === 534268);
  check('W3 명세: 일당 33,333 반일 16,666(절사) → 83,332 / 2,499 / 249 / 80,584', pit(W3.id).gross === 83332 && pit(W3.id).incomeTax === 2499 && pit(W3.id).localTax === 249 && pit(W3.id).net === 80584);
  check('이동한 W7 도 이전 현장(정산현장) 정산에 3일 150,000 으로 포함', pit(W7.id).days === 3 && pit(W7.id).gross === 150000);
  check('명세에 날짜별 내역(불인정·반일·인정 표시)', pit(W1.id).detail.some((d) => d.date === '2026-09-05' && d.units === 0 && /불인정/.test(d.note)) && pit(W1.id).detail.some((d) => d.date === '2026-09-21' && d.units === 2 && /인정/.test(d.note)));
  expectErr('같은 기간 회차를 또 만들면 이미 포함된 사람은 제외되어 대상 없음', await pcreate({}), '대상이 없습니다');
  const prun2 = await pcreate({ cycle: '주', from: '2026-09-07', to: '2026-09-13', title: '9월 2주차' });
  expectOk('주 정산 회차 (W4 만 대상)', prun2);
  check('주 회차: W4 5일 × 150,000 = 750,000, 공제 없음', prun2.data.people === 1 && prun2.data.gross === 750000 && prun2.data.tax === 0 && prun2.data.net === 750000, JSON.stringify(prun2.data));
  const plist0 = (await call('pay.runList', {}, admin, '', PP)).data.runs;
  check('회차 목록', plist0.length === 2 && plist0.every((r) => r.status === '작성'));
  check('다른 현장(P01)에서는 회차 목록이 비어 있음', (await call('pay.runList', {}, admin, '', P1)).data.runs.length === 0);
  expectErr('다른 현장에서 회차 열기 → 찾을 수 없음', await call('pay.runGet', { runId: prun1.data.id }, admin, '', P1), '찾을 수 없습니다');
  expectErr('다른 현장 보조관리자가 회차 열기 → 접근 거부', await call('pay.runGet', { runId: prun1.data.id }, subA, '', PP), '접근할 수 없습니다', 'FORBIDDEN');
  for (const [label, action, data] of [['확정', 'pay.runConfirm', {}], ['삭제', 'pay.runDelete', {}], ['재계산', 'pay.runRecalc', {}], ['검토', 'pay.runReview', {}]]) {
    expectErr('다른 현장 화면에서 회차 ' + label + ' 불가', await call(action, { runId: prun1.data.id, ...data }, admin, '', P1), '찾을 수 없습니다');
  }

  // --- 조정 금액 ---
  expectErr('조정 금액은 정수', await call('pay.itemSave', { runId: prun1.data.id, staffId: W2.id, adjustAmount: 100.5, adjustMemo: 'x' }, admin, '', PP), '정수');
  expectErr('조정에는 사유 필수', await call('pay.itemSave', { runId: prun1.data.id, staffId: W2.id, adjustAmount: -2500, adjustMemo: '' }, admin, '', PP), '사유');
  expectErr('조정 후 금액이 음수가 될 수 없음', await call('pay.itemSave', { runId: prun1.data.id, staffId: W2.id, adjustAmount: -9999999, adjustMemo: '과다' }, admin, '', PP), '0원보다');
  expectOk('W2 조정 -2,500 (사유 입력)', await call('pay.itemSave', { runId: prun1.data.id, staffId: W2.id, adjustAmount: -2500, adjustMemo: '선지급 차감' }, admin, '', PP));
  const pg1b = (await call('pay.runGet', { runId: prun1.data.id }, admin, '', PP)).data;
  const pw2b = pg1b.items.find((x) => x.staffId === W2.id);
  check('조정 후 W2: 550,000 / 16,500 / 1,650 / 531,850, 회차 합계 갱신', pw2b.gross === 550000 && pw2b.incomeTax === 16500 && pw2b.localTax === 1650 && pw2b.net === 531850 && pg1b.totals.gross === 2733332 && pg1b.totals.tax === 90198 && pg1b.totals.net === 2643134, JSON.stringify(pg1b.totals));

  // --- 검토 → 확정 ---
  const subPPpw = 'Pw' + sfx + 'x1';
  expectOk('정산현장 보조관리자(확정 권한 없음)', await call('admin.saveAccount', acctBase('sppa' + sfx, '보조관리자', [PP]), admin, '', null));
  expectOk('정산현장 보조관리자(확정·급여 원문 허용)', await call('admin.saveAccount', acctBase('sppb' + sfx, '보조관리자', [PP], { allowPayConfirm: true, allowPayroll: true }), admin, '', null));
  const spA = (await loginAs('sppa' + sfx)).data.token, spB = (await loginAs('sppb' + sfx)).data.token;
  expectErr('작성 상태에서는 확정 불가', await call('pay.runConfirm', { runId: prun1.data.id }, admin, '', PP), '검토 상태');
  expectOk('보조관리자도 검토 요청 가능', await call('pay.runReview', { runId: prun1.data.id }, spA, '', PP));
  expectErr('권한 없는 보조관리자는 확정 불가', await call('pay.runConfirm', { runId: prun1.data.id }, spA, '', PP), '확정 권한', 'FORBIDDEN');
  expectOk('조정하면 검토가 풀리고 다시 작성 상태로', await call('pay.itemSave', { runId: prun1.data.id, staffId: W2.id, adjustAmount: -2500, adjustMemo: '선지급 차감' }, admin, '', PP));
  check('작성 상태로 돌아감', (await call('pay.runGet', { runId: prun1.data.id }, admin, '', PP)).data.run.status === '작성');
  expectOk('다시 검토', await call('pay.runReview', { runId: prun1.data.id }, admin, '', PP));
  expectOk('관리자 확정', await call('pay.runConfirm', { runId: prun1.data.id }, admin, '', PP));
  const pcfg = (await call('pay.runGet', { runId: prun1.data.id }, admin, '', PP)).data;
  check('확정 상태 + 확정자 기록', pcfg.run.status === '확정' && pcfg.run.confirmedBy === 'admin' && pcfg.run.confirmedAt !== '');
  expectErr('확정된 회차는 조정 불가', await call('pay.itemSave', { runId: prun1.data.id, staffId: W1.id, adjustAmount: 1000, adjustMemo: 'x' }, admin, '', PP), '확정');
  expectErr('확정된 회차는 재계산 불가', await call('pay.runRecalc', { runId: prun1.data.id }, admin, '', PP), '확정');
  expectErr('확정된 회차는 삭제 불가', await call('pay.runDelete', { runId: prun1.data.id }, admin, '', PP), '확정');
  expectErr('확정된 기간의 근태 보정은 불가 (다음 회차의 조정으로)', await padj(W1, '2026-09-06', '불인정', 'x'), '확정된 정산');
  expectErr('확정된 기간의 근태 보정 해제도 불가', await call('admin.adjustDelete', { staffId: W1.id, date: '2026-09-05' }, admin, '', PP), '확정된 정산');
  check('확정 뒤 근태 보정이 막혀도 정산 금액은 그대로', (await call('pay.runGet', { runId: prun1.data.id }, admin, '', PP)).data.totals.net === 2643134);

  // --- 주 회차: 검토 후 근태가 바뀌면 확정 거부 → 재계산 ---
  expectOk('주 회차 검토', await call('pay.runReview', { runId: prun2.data.id }, admin, '', PP));
  expectOk('검토 후 W4 9/12 인정으로 근태 보정', await padj(W4, '2026-09-12', '인정', '현장 지원'));
  expectErr('검토 이후 근태가 바뀌면 확정 거부', await call('pay.runConfirm', { runId: prun2.data.id }, admin, '', PP), '바뀌었습니다');
  const prc = await call('pay.runRecalc', { runId: prun2.data.id }, admin, '', PP);
  check('재계산: W4 6일 900,000', prc.ok && prc.data.gross === 900000 && prc.data.net === 900000, JSON.stringify(prc.data));
  expectOk('다시 검토', await call('pay.runReview', { runId: prun2.data.id }, admin, '', PP));
  expectOk('확정 권한을 받은 보조관리자가 확정', await call('pay.runConfirm', { runId: prun2.data.id }, spB, '', PP));
  expectErr('확정 전에는 지급완료 불가 / 권한 없는 보조관리자 불가', await call('pay.runPaid', { runId: prun2.data.id }, spA, '', PP), '확정 권한', 'FORBIDDEN');
  expectOk('지급완료 처리', await call('pay.runPaid', { runId: prun2.data.id }, spB, '', PP));
  check('지급완료 상태', (await call('pay.runGet', { runId: prun2.data.id }, admin, '', PP)).data.run.status === '지급완료');
  expectErr('지급완료 후에는 삭제 불가', await call('pay.runDelete', { runId: prun2.data.id }, admin, '', PP), '지급완료');

  // --- 이체 파일 ---
  const punconf = await pcreate({ cycle: '주', from: '2026-09-14', to: '2026-09-20' });
  check('대상 없는 기간은 회차를 만들지 않음', punconf.ok === false);
  expectErr('권한 없는 보조관리자는 이체 파일 불가', await call('pay.transferExport', { runId: prun1.data.id }, spA, '', PP), '이체 파일', 'FORBIDDEN');
  const ptr = await call('pay.transferExport', { runId: prun1.data.id }, admin, '', PP);
  expectOk('관리자 이체 파일 데이터', ptr);
  const trw1 = ptr.data.rows.find((x) => x.name === W1.name);
  check('이체 데이터: 은행·계좌 원문·예금주·실지급액', trw1 && trw1.bank === '국민' && trw1.accountNo === '000-000-000000' && trw1.holder === W1.name && trw1.amount === 1885650 && ptr.data.rows.length === 4, JSON.stringify(trw1));
  expectOk('급여 원문 허용 보조관리자도 가능', await call('pay.transferExport', { runId: prun1.data.id }, spB, '', PP));
  const trLogs = await query(`SELECT user FROM logs WHERE action = '이체파일' AND project_id = '${PP}'`);
  check('이체 파일 생성이 기록됨 (2건)', trLogs.length === 2, JSON.stringify(trLogs));
  const prun3 = await call('pay.runCreate', { cycle: '주', from: '2026-09-21', to: '2026-09-27' }, admin, '', PP);
  check('(참고) 근태 없는 기간은 만들어지지 않음', prun3.ok === false);

  // --- 직군별 기본 지급: 개인 설정이 없으면 직군 기본값, 개인 설정이 있으면 개인 설정이 우선 ---
  const W8 = await pmk(8, { job: '도우미' }), W9 = await pmk(9, { job: '도우미' });
  const attAug = (w, days) => days.map((d) => `INSERT INTO attendance (id, project_id, date, staff_id, time, device_key, result, distance_m) VALUES ('TA${uniq.slice(0, 3)}${++tcount}', '${PP}', '2026-08-${String(d).padStart(2, '0')}', '${w.id}', '09:00:00', '${w.dev}', '성공', 10)`).join(';\n');
  await sql([attAug(W8, [3, 4, 5, 6]), attAug(W9, [3, 4, 5])].join(';\n'));
  const jobSet = (o, tk = admin, pid = PP) => call('pay.jobSave', { job: '도우미', effectiveFrom: '2026-01-01', cycle: '월', dailyEnabled: true, feeEnabled: false, withhold: true, ...o }, tk, '', pid);
  expectErr('이 현장에 없는 직군은 설정 불가', await jobSet({ job: '없는직군', dailyWage: 1000 }), '없는 직군');
  expectErr('직군 일당 검사', await jobSet({ dailyWage: -1 }), '일당');
  expectErr('직군 일당 지급 대상이면 일당 필수', await jobSet({ dailyWage: 0 }), '일당을 입력');
  expectErr('다른 현장 보조관리자는 직군 설정 불가', await jobSet({ dailyWage: 60000 }, subA, PP), '접근할 수 없습니다', 'FORBIDDEN');
  expectOk('도우미 직군 기본 일당 60,000 월', await jobSet({ dailyWage: 60000 }));
  expectOk('W9 는 개인 일당 70,000 (직군 기본보다 우선)', await call('pay.settingSave', { staffId: W9.id, effectiveFrom: '2026-01-01', dailyWage: 70000, cycle: '월', dailyEnabled: true, withhold: true }, admin, '', PP));
  const jl = (await call('pay.jobList', {}, admin, '', PP)).data.jobs;
  const jd = jl.find((x) => x.job === '도우미');
  check('직군 목록: 도우미 기본 일당 60,000, 활동 인원 2명, 영업은 수수료 기본 대상', jd.current.dailyWage === 60000 && jd.people === 2 && jl.find((x) => x.job === '영업').defaults.feeEnabled === true && jl.find((x) => x.job === '상담사').defaults.feeEnabled === false);
  check('다른 현장 직군 목록에는 이 설정이 보이지 않음', (await call('pay.jobList', {}, admin, '', P1)).data.jobs.every((x) => x.current === null));
  const pl8 = (await call('pay.settingList', {}, admin, '', PP)).data.staff;
  check('직원 목록: W8 은 직군 기본(60,000)이 적용, W9 는 개인(70,000)이 적용', pl8.find((x) => x.id === W8.id).current.source === '직군' && pl8.find((x) => x.id === W8.id).current.dailyWage === 60000 && pl8.find((x) => x.id === W8.id).personal === false && pl8.find((x) => x.id === W9.id).current.source === '개인' && pl8.find((x) => x.id === W9.id).current.dailyWage === 70000);
  const runAug = await call('pay.runCreate', { cycle: '월', from: '2026-08-01', to: '2026-08-31', title: '8월(직군 기본)' }, admin, '', PP);
  expectOk('8월 정산 (직군 기본 + 개인 설정 혼합)', runAug);
  // 수작업: W8 4일 × 60,000 = 240,000 (7,200 + 720) / W9 3일 × 70,000 = 210,000 (6,300 + 630)
  check('8월 회차: 2명, 450,000 / 공제 14,850 / 실지급 435,150', runAug.data.people === 2 && runAug.data.gross === 450000 && runAug.data.tax === 14850 && runAug.data.net === 435150, JSON.stringify(runAug.data));
  const gAug = (await call('pay.runGet', { runId: runAug.data.id }, admin, '', PP)).data;
  check('명세: W8 240,000 (직군 일당), W9 210,000 (개인 일당)', gAug.items.find((x) => x.staffId === W8.id).gross === 240000 && gAug.items.find((x) => x.staffId === W9.id).gross === 210000);
  expectErr('다른 현장 화면에서 개인 설정 초기화 불가', await call('pay.settingClear', { staffId: W9.id }, admin, '', P1), '직원을 찾을 수 없습니다');
  expectOk('W9 개인 설정 초기화 → 직군 기본을 따름', await call('pay.settingClear', { staffId: W9.id }, admin, '', PP));
  const rcAug = await call('pay.runRecalc', { runId: runAug.data.id }, admin, '', PP);
  check('재계산: W9 3일 × 60,000 = 180,000 → 합계 420,000 / 공제 13,860 / 실지급 406,140', rcAug.ok && rcAug.data.gross === 420000 && rcAug.data.tax === 13860 && rcAug.data.net === 406140, JSON.stringify(rcAug.data));
  expectOk('시험 회차 삭제', await call('pay.runDelete', { runId: runAug.data.id }, admin, '', PP));
  expectOk('직군 기본 일당 변경은 적용 시작일 이력으로 쌓임', await jobSet({ dailyWage: 65000, effectiveFrom: '2099-01-01' }));
  check('미래 적용 직군 설정은 upcoming 으로 분리', (await call('pay.jobList', {}, admin, '', PP)).data.jobs.find((x) => x.job === '도우미').upcoming.length === 1);

  // --- 이전 현장 / 현재 현장 정산이 각각 맞게 ---
  const runP2 = await call('pay.runCreate', { cycle: '월', from: '2026-09-01', to: '2026-09-30', title: 'B현장 9월' }, admin, '', P2);
  expectOk('B현장 9월 정산 (이동 후 근무)', runP2);
  check('B현장 회차: W7 2일 × 70,000 = 140,000 / 4,200 / 420 / 135,380 (정산현장 근무분은 섞이지 않음)', runP2.data.people === 1 && runP2.data.gross === 140000 && runP2.data.tax === 4620 && runP2.data.net === 135380, JSON.stringify(runP2.data));
  expectOk('B현장 회차 검토', await call('pay.runReview', { runId: runP2.data.id }, admin, '', P2));
  expectOk('B현장 회차 확정', await call('pay.runConfirm', { runId: runP2.data.id }, admin, '', P2));

  // --- 직원앱 내 지급내역 ---
  const lw7 = await call('staff.login', { phone: W7.phone, pin: W7.pin }, '', W7.dev, null);
  expectOk('W7 로그인 (B현장 소속)', lw7);
  const pmy = await call('staff.myPay', {}, lw7.data.token, W7.dev, null);
  check('내 지급내역: 이전 현장(정산현장) 150,000 + 현재 현장(B현장) 140,000 두 건', pmy.ok && pmy.data.pays.length === 2 && pmy.data.pays.some((p) => p.project === '정산현장' && p.gross === 150000 && p.net === 145050 && p.days === 3) && pmy.data.pays.some((p) => p.project === 'B현장' && p.net === 135380 && p.days === 2), JSON.stringify(pmy.data && pmy.data.pays.map((p) => [p.project, p.gross])));
  check('내 지급내역 응답에 주민번호·계좌·다른 직원 정보 없음', !/rrn|account|주민|000101|국민/.test(JSON.stringify(pmy)) && !JSON.stringify(pmy).includes(W1.name));
  const lw1 = await call('staff.login', { phone: W1.phone, pin: W1.pin }, '', W1.dev, null);
  const pmy1 = (await call('staff.myPay', {}, lw1.data.token, W1.dev, null)).data.pays;
  check('다른 직원 W1 의 내역은 자기 것만 (1건 1,950,000 - 공제 후 1,885,650)', pmy1.length === 1 && pmy1[0].net === 1885650 && pmy1[0].detail.length === 21);
  const lw3 = await call('staff.login', { phone: W3.phone, pin: W3.pin }, '', W3.dev, null);
  check('확정되지 않은 회차는 직원에게 보이지 않음', (await call('pay.runCreate', { cycle: '월', from: '2026-07-01', to: '2026-07-31' }, admin, '', PP)).ok === false && (await call('staff.myPay', {}, lw3.data.token, W3.dev, null)).data.pays.length === 1);
  expectErr('관리자 아닌 직원은 정산 기능 불가', await call('pay.runList', {}, lw3.data.token, W3.dev, null), '권한');
  expectErr('데스크는 정산 기능 불가', await call('pay.runList', {}, deskA, '', null), '권한');
  check('정산 확정·지급완료·조정이 기록됨', (await query(`SELECT action FROM logs WHERE project_id = '${PP}' AND action IN ('정산확정', '지급완료', '정산조정', '근태보정', '지급설정')`)).length >= 8);
} catch (e) {
  failed++;
  console.log('[실패] 테스트 중 예외: ' + (e && e.stack ? e.stack : e));
} finally {
  fake.close();
  fakeMail.close();
}
console.log(failed ? `=== 실패 ${failed}건 (통과 ${pass}건) ===` : `=== 전체 통과 (${pass}건) ===`);
process.exit(failed ? 1 : 0);
