// 시험용 봇: 가짜 직원을 여러 명 가입시키고 승인한 뒤 출근(QR+위치)까지 대신 해 준다.
// 휴대폰 한 대로는 "한 휴대폰 = 한 명" 규칙 때문에 여러 명을 시험하기 어려워서 만든 도구다.
// 운영 데이터와 섞이지 않게 항상 별도 현장 "시험현장(봇)" (코드 testbot) 안에서만 일한다.
//
//   cd server
//   node scripts/test-bot.mjs run                      가짜 직원 5명 가입·승인·오늘 출근
//   node scripts/test-bot.mjs run --staff 10 --days 20 --reserve
//   node scripts/test-bot.mjs cleanup                  시험 직원 전원 퇴사 처리
//
// 옵션: --staff N(기본 5)  --days N(지난 N일치 출근을 DB에 직접 채움, 정산 시험용)  --absent N(오늘 출근하지 않을 인원)
//       --reserve(각자 방문 예약 1건 등록)  --url 서버주소(기본: web/js/config.js 의 주소)  --local-db(내 PC 시험 DB 를 쓸 때)
// 관리자 비밀번호는 화면에 보이지 않게 입력받고 어디에도 저장하지 않는다. 가짜 값(010-0000-xxxx, 가짜 주민번호)만 쓴다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const cmd = args[0] || 'run';
const opt = (name, def) => { const i = args.indexOf('--' + name); return i < 0 ? def : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const url = opt('url', (/API_URL:\s*'([^']+)'/.exec(readFileSync(join(root, '..', 'web', 'js', 'config.js'), 'utf8')) || [])[1]);
const CODE = 'testbot';
const BASE_POS = { lat: 37.5665, lng: 126.9780 }; // 시험 현장 기준점(서울시청 부근, 가짜)
const statePath = join(root, '.test-bot.json');

function askHidden(question, envName) {
  if (envName && process.env[envName] !== undefined) return Promise.resolve(process.env[envName]); // 자동 시험용 (터미널이 아닐 때)
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let buf = '';
    stdin.on('data', function onData(ch) {
      if (ch === '\u0003') process.exit(1);
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.removeListener('data', onData); process.stdout.write('\n'); resolve(buf); }
      else if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1);
      else buf += ch;
    });
  });
}

async function call(action, data, { token = '', deviceKey = '', projectId } = {}) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token, deviceKey, projectId, data: data || {} }) });
  return res.json();
}
const must = (r, what) => { if (!r.ok) throw new Error(what + ' 실패: ' + r.error); return r.data; };

async function adminLogin() {
  const id = (await askHidden('관리자 아이디(그냥 Enter 면 admin): ', 'BOT_ADMIN_ID')).trim() || 'admin';
  const pw = await askHidden('관리자 비밀번호 (화면에 보이지 않습니다): ', 'BOT_ADMIN_PW');
  const r = await call('account.login', { loginId: id, password: pw });
  const d = must(r, '관리자 로그인');
  if (d.account.mustChangePassword) throw new Error('먼저 통합관리(hub)에서 로그인해 비밀번호를 바꿔 주세요.');
  if (d.account.role !== '관리자') throw new Error('관리자 계정으로 실행해 주세요.');
  return d.token;
}

async function ensureProject(token) {
  const list = must(await call('project.list', {}, { token }), '현장 목록').projects;
  let p = list.find((x) => x.code === CODE);
  if (!p) {
    const r = must(await call('project.save', { name: '시험현장(봇)', code: CODE, kind: '기타', status: '진행' }, { token }), '시험 현장 만들기');
    console.log('시험 현장을 만들었습니다: 시험현장(봇)');
    p = (must(await call('project.list', {}, { token }), '현장 목록').projects).find((x) => x.id === r.id);
  } else if (p.status === '종료') {
    must(await call('project.save', { id: p.id, name: p.name, code: p.code, kind: p.kind, status: '진행' }, { token }), '시험 현장 다시 열기');
  }
  return p;
}

const rnd = (n) => Math.floor(Math.random() * n);
const pad = (n, w = 2) => String(n).padStart(w, '0');
const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

async function run() {
  const n = Number(opt('staff', 5)), back = Number(opt('days', 0)), absent = Number(opt('absent', 0));
  if (!Number.isInteger(n) || n < 1 || n > 50) throw new Error('--staff 는 1~50 사이 숫자입니다.');
  const token = await adminLogin();
  const proj = await ensureProject(token);
  const P = proj.id;
  const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().slice(11, 16).replace(':', '');
  const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')) : { staff: [] };
  const made = [];

  for (let i = 1; i <= n; i++) {
    const name = '봇' + stamp + '_' + pad(i);
    let phone = '';
    for (let tries = 0; tries < 20 && !phone; tries++) {
      const cand = '010-0000-' + pad(rnd(10000), 4);
      const deviceKey = 'bot-' + Date.now().toString(36) + '-' + pad(i) + '-' + pad(rnd(1e6), 6);
      const r = await call('staff.signup', {
        projectCode: CODE, name, nickname: '', phone: cand, pin: '1234', job: '상담사', rrn: '000101-3000000',
        bank: '국민', accountNo: '000-000-000000', holder: name, consent: true
      }, { deviceKey });
      if (r.ok) { phone = cand; made.push({ name, phone: cand, deviceKey, pin: '1234' }); }
      else if (!/번호|가입/.test(r.error)) throw new Error('가입 실패: ' + r.error);
    }
    if (!phone) throw new Error(name + ' 의 가짜 번호를 찾지 못했습니다. 다시 실행해 주세요.');
  }
  // 승인
  const staff = must(await call('admin.staffList', {}, { token, projectId: P }), '직원 목록').staff;
  for (const m of made) {
    const row = staff.find((s) => s.phone === m.phone.replace(/\D/g, ''));
    m.id = row.id;
    must(await call('admin.approve', { staffId: row.id }, { token, projectId: P }), '승인 ' + m.name);
  }
  console.log(`가입·승인 ${made.length}명 완료 (현장: ${proj.name})`);

  // 오늘 출근: 시험 현장의 QR 을 (가짜) 기준점에서 새로 발급하고, 기준점 근처에서 각자 출근
  const issued = must(await call('admin.issueQr', { lat: BASE_POS.lat, lng: BASE_POS.lng, accuracy: 5 }, { token, projectId: P }), 'QR 발급');
  let ok = 0, fail = 0;
  for (let i = 0; i < made.length; i++) {
    const m = made[i];
    const login = must(await call('staff.login', { phone: m.phone, pin: m.pin }, { deviceKey: m.deviceKey }), '직원 로그인');
    m.token = login.token;
    if (i >= made.length - absent) continue; // 마지막 몇 명은 일부러 출근하지 않는다
    const jitter = () => (Math.random() - 0.5) * 0.0004; // 약 ±20m
    const r = await call('attendance.checkin', { qr: issued.qr, lat: BASE_POS.lat + jitter(), lng: BASE_POS.lng + jitter(), accuracy: 8 }, { token: m.token, deviceKey: m.deviceKey });
    if (r.ok) ok++; else { fail++; console.log('  출근 실패 ' + m.name + ': ' + r.error); }
  }
  console.log(`오늘 출근: 성공 ${ok}명, 실패 ${fail}명, 미출근 ${absent}명`);

  if (opt('reserve', false)) {
    let rv = 0;
    for (const m of made) {
      const r = await call('reservation.create', { last5: pad(rnd(100000), 5), date: today(), gender: rnd(2) ? '남' : '여', memo: '시험 예약' }, { token: m.token, deviceKey: m.deviceKey });
      if (r.ok) rv++;
    }
    console.log(`방문 예약 ${rv}건 등록`);
  }

  if (back > 0) {
    // 지난 N일치 출근은 API 로 만들 수 없으므로(출근은 오늘만 가능) 시험 현장 DB 에 직접 넣는다
    const rows = [];
    let seq = 0;
    for (const m of made) {
      for (let d = 1; d <= back; d++) {
        const date = new Date(Date.now() + 9 * 3600e3 - d * 86400e3).toISOString().slice(0, 10);
        const dow = new Date(date + 'T00:00:00Z').getUTCDay();
        if (dow === 0 || Math.random() < 0.15) continue; // 일요일과 가끔 결근
        rows.push(`INSERT INTO attendance (id, project_id, date, staff_id, time, device_key, result, distance_m) VALUES ('TB${Date.now().toString(36)}${++seq}', '${P}', '${date}', '${m.id}', '09:0${rnd(10)}:00', '${m.deviceKey}', '성공', ${rnd(60)});`);
      }
    }
    writeFileSync(join(root, '.test-bot.sql'), rows.join('\n'));
    execFileSync('npx', ['--yes', 'wrangler@4', 'd1', 'execute', 'DB', opt('local-db', false) ? '--local' : '--remote', '-y', '--file=.test-bot.sql'], { cwd: root, shell: true, stdio: 'pipe', windowsHide: true });
    console.log(`지난 ${back}일치 출근 ${rows.length}건을 시험 현장에 채웠습니다. (용역관리 정산 시험용)`);
  }

  state.staff.push(...made.map((m) => ({ name: m.name, phone: m.phone, deviceKey: m.deviceKey, pin: m.pin, id: m.id })));
  writeFileSync(statePath, JSON.stringify(state, null, 1));
  console.log('\n통합관리(hub)에서 상단 현장을 "시험현장(봇)"으로 고르면 인사관리·근태·용역관리에서 확인할 수 있습니다.');
  console.log('시험이 끝나면: node scripts/test-bot.mjs cleanup');
}

async function cleanup() {
  const token = await adminLogin();
  const list = must(await call('project.list', {}, { token }), '현장 목록').projects;
  const proj = list.find((x) => x.code === CODE);
  if (!proj) { console.log('시험 현장이 없습니다.'); return; }
  const staff = must(await call('admin.staffList', {}, { token, projectId: proj.id }), '직원 목록').staff.filter((s) => s.status !== '퇴사');
  for (const s of staff) must(await call('admin.retire', { staffId: s.id }, { token, projectId: proj.id }), '퇴사 처리 ' + s.name);
  console.log(`시험 직원 ${staff.length}명을 퇴사 처리했습니다. (시험 현장의 기록은 남겨 두었고, 휴대폰은 다시 쓸 수 있습니다)`);
}

try {
  if (cmd === 'run') await run();
  else if (cmd === 'cleanup') await cleanup();
  else console.log('사용법: node scripts/test-bot.mjs run [--staff 5] [--days 20] [--absent 1] [--reserve] | cleanup');
} catch (e) {
  console.error('\n오류: ' + e.message);
  process.exit(1);
}
