// 다중 사용자 시나리오 + 통합관리 요약 일치 시험 (통합 서버 필요)
//   준비: server/ 에서 DB 를 새로 만들고(초기 관리자 비밀번호 출력) `npx wrangler@4 dev --local --port 8787` 을 켠다.
//   실행: ADMIN_PW=초기비밀번호 node tools/test_multi.js      (시험 중 관리자 비밀번호를 바꾸므로 다시 돌릴 때는 DB 부터 다시)
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const SRV = process.env.BASE_URL || 'http://127.0.0.1:8787';
const ADMIN_PW = process.env.ADMIN_PW;
if (!ADMIN_PW) { console.error('ADMIN_PW 환경변수에 초기 관리자 비밀번호를 넣어 주세요.'); process.exit(1); }
// 앱에 내장된 서버 주소를 시험 서버로 바꾼 사본을 만들어 연다 (파일로 열기 = 주소 "null", 서버가 허용하는 곳)
const built = fs.readFileSync(path.join(__dirname, '..', '분양계약관리.html'), 'utf8').replace(/const DEFAULT_SERVER = "[^"]*";/, 'const DEFAULT_SERVER = ' + JSON.stringify(SRV) + ';');
const COPY = path.join(__dirname, '_test_app.html'); fs.writeFileSync(COPY, built);
const URL = 'file:///' + COPY.split(path.sep).join('/');
let fails = 0;
const ok = (c, m, x) => { if (!c) { fails++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
const api = async (action, data, token = '', projectId) => (await fetch(SRV, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token, projectId, data: data || {} }) })).json();
const wait = ms => new Promise(r => setTimeout(r, ms));
const uniq = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const PW = 'Second' + uniq + 'y8';
async function mk(b) { const ctx = await b.newContext({ viewport: { width: 1300, height: 800 } }); await ctx.addInitScript(() => { try { if (!localStorage.getItem('bunyang.current')) localStorage.setItem('bunyang.current', '"P01"'); } catch (e) { } }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept()); return p; }
async function login(p, id) { await p.waitForSelector('#loginBg'); await p.fill('#aId', id); await p.fill('#aPw', PW); await p.click('#aGo'); await p.waitForSelector('#loginBg', { state: 'detached' }); }
(async () => {
  // 준비: 관리자 비밀번호 변경 → 계정 3개(보조관리자·계약담당·열람) 만들기
  const first = await api('account.login', { loginId: 'admin', password: ADMIN_PW });
  if (!first.ok) { console.log('관리자 로그인 실패', first.error); process.exit(1); }
  await api('account.changePassword', { oldPassword: ADMIN_PW, newPassword: 'AdminPw' + uniq + 'a1' }, first.data.token);
  const admin = first.data.token;
  const mk1 = async (role, tag) => {
    const loginId = tag + uniq, pw = 'First' + uniq + 'z9';
    const s = await api('admin.saveAccount', { loginId, name: tag + '계정', role, password: pw, active: true, projectIds: ['P01'] }, admin);
    if (!s.ok) throw new Error('계정 만들기 실패 ' + role + ': ' + s.error);
    const lg = await api('account.login', { loginId, password: pw });
    await api('account.changePassword', { oldPassword: pw, newPassword: PW }, lg.data.token);
    return loginId;
  };
  const boss = await mk1('보조관리자', 'boss'), kim = await mk1('계약담당', 'kim'), lee = await mk1('열람', 'lee');

  const b = await chromium.launch();
  // C: 관리자 — 견본 데이터를 서버에 올린다
  const C = await mk(b); await C.goto(URL + '#settings'); await login(C, boss); await C.waitForTimeout(800);
  ok(await C.evaluate(() => isAdmin()), 'C: 관리자 권한');
  await C.setInputFiles('#initIn', path.join(__dirname, '..', '견본_초기데이터.json')); await C.waitForTimeout(300); await C.click('#cfOk'); await C.waitForTimeout(800);
  await C.click('#sPush'); await C.waitForTimeout(300); await C.click('#cfOk'); await C.waitForTimeout(4000);
  ok(await C.evaluate(() => Object.keys(OUTBOX).length) === 0, 'C: 업로드 완료(대기 0)');
  // A: 계약담당(쓰기) / B: 열람(읽기전용) — 로그인만 해도 전체 데이터를 받는다
  const A = await mk(b); await A.goto(URL + '#dash'); await login(A, kim); await A.waitForTimeout(3500);
  ok(await A.evaluate(() => ROLE()) === 'write', 'A: 쓰기 권한');
  ok(await A.evaluate(() => live('units').length) === 40, 'A: 전체 데이터 수신');
  const B = await mk(b); await B.goto(URL + '#dash'); await login(B, lee); await B.waitForTimeout(3500);
  ok(await B.evaluate(() => ROLE()) === 'read', 'B: 읽기전용 권한');
  ok(await B.evaluate(() => live('units').length) === 40, 'B: 읽기전용도 전체 데이터 수신');
  // 담당자는 통합관리 직원 목록에서 고른다 → staffId·팀·이름이 계약에 저장된다
  const dk = 'dev-multi-' + uniq + '-xxxxxxxx', api2 = (a, d, tk, pj) => fetch(SRV, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action: a, token: tk || '', projectId: pj, deviceKey: dk, data: d }) }).then(r => r.json());
  const sg = await api2('staff.signup', { projectCode: 'site1', name: '선택직원', nickname: '', phone: '0108888' + uniq.slice(0, 4), pin: '1234', job: '상담사', rrn: '000101-3000000', bank: '국민', accountNo: '000-000-000000', holder: '선택직원', consent: true });
  const stRow = (await api('admin.staffList', {}, admin, 'P01')).data.staff.find(x => x.name === '선택직원');
  await api('admin.approve', { staffId: stRow.id }, admin, 'P01');
  await A.evaluate(() => fetchStaff()); ok(await A.evaluate(() => STAFF.some(s => s.name === '선택직원')), 'A: 통합관리 직원 목록을 받음');
  ok(await A.evaluate(() => STAFF.every(s => !('phone' in s))), 'A: 직원 목록에 연락처 없음');
  await A.evaluate(() => editContract(null, '101-105')); await A.waitForSelector('#f_staffId');
  await A.fill('#f_name', '선택테스트'); await A.fill('#f_staffId', '선택직원'); await A.click('#mSave'); await A.waitForTimeout(1500);
  const sc = await A.evaluate(() => live('contracts').find(c => c.name === '선택테스트'));
  ok(sc && sc.staffId === stRow.id && sc.staff === '선택직원', 'A: 직원 선택 → staffId·담당자 저장', sc);
  // 동시 수정(같은 세대의 다른 필드) → 서로 덮어쓰지 않고 합쳐진다
  await Promise.all([
    A.evaluate(async () => { const u = M.units['101-101']; u.skind = '특공(A수정)'; await save('units', u); }),
    C.evaluate(async () => { const u = M.units['101-101']; u.type = '99Z'; await save('units', u); })
  ]);
  await wait(9000);
  for (const [n, p] of [['A', A], ['B', B], ['C', C]]) { const u = await p.evaluate(() => { const x = M.units['101-101']; return { t: x.type, s: x.skind }; }); ok(u.t === '99Z' && u.s === '특공(A수정)', `${n}: 동시 수정 병합 반영`, u); }
  // 읽기전용 저장 시도
  await B.evaluate(async () => { const u = M.units['101-102']; u.type = 'HACK'; await save('units', u); });
  await wait(1500); ok(await B.evaluate(() => M.units['101-102'].type) !== 'HACK', 'B: 읽기전용 저장 차단(원복)');
  // 같은 동호 동시 계약 → 1건만
  const con = (id, name) => ({ id, dongho: '101-103', status: '정상', name, date: '2026-10-19' });
  await Promise.all([A.evaluate(async c => { await save('contracts', c); }, con('cA', '가나다')), C.evaluate(async c => { await save('contracts', c); }, con('cC', '라마바'))]);
  await wait(9000);
  for (const [n, p] of [['A', A], ['C', C], ['B', B]]) { const r = await p.evaluate(() => live('contracts').filter(c => c.dongho === '101-103').map(c => c.name)); ok(r.length === 1, `${n}: 동일 동호 이중계약 1건만 존속`, r); }
  const sA = await A.evaluate(() => live('contracts').filter(c => c.dongho === '101-103')[0].name), sC = await C.evaluate(() => live('contracts').filter(c => c.dongho === '101-103')[0].name); ok(sA === sC, '모든 사용자 같은 결과', [sA, sC]);
  // 입금 몇 건 (회차 입금 + 미분류) 후 통합관리 요약과 앱 대시보드 숫자 비교
  await A.evaluate(async () => {
    const dh = Object.keys(IX.active)[0]; const stg = STAGES()[0];
    await save('deposits', [{ id: 'dpA1', dongho: dh, cat: stg, inn: 1000000, out: 0, t: today().replace(/-/g, '.') + ' 10:00', desc: '시험입금' }, { id: 'dpA2', dongho: '', cat: '', inn: 500000, out: 0, t: today().replace(/-/g, '.') + ' 11:00', desc: '미분류' }]);
  });
  await wait(9000);
  const app = await C.evaluate(() => {
    const st = { 계약: 0, 가계약: 0, 동호지정: 0, 잠금: 0, 잔여: 0 }; live('units').forEach(u => st[unitStatus(u.id)]++);
    const act = Object.values(IX.active); const sg = STAGES()[0];
    return { units: live('units').length, contract: st.계약, pre: st.가계약, resv: st.동호지정, lock: st.잠금, remain: st.잔여, totalIn: live('deposits').reduce((a, d) => a + (PAY_CATS().has(d.cat) ? (d.inn || 0) - (d.out || 0) : 0), 0), unclassified: IX.unclassified, firstDone: act.filter(c => payState(c.dongho, sg).done).length };
  });
  const lg = await api('account.login', { loginId: boss, password: PW });
  const sm = (await api('contract.summary', {}, lg.data.token, 'P01')).data;
  ok(sm.units === app.units && sm.contract === app.contract && sm.pre === app.pre && sm.resv === app.resv && sm.lock === app.lock && sm.remain === app.remain, '통합관리 요약 = 앱 대시보드: 세대 상태별 수', [sm.units, sm.contract, sm.pre, sm.lock, sm.remain, app]);
  ok(sm.totalIn === app.totalIn && sm.unclassified === app.unclassified, '통합관리 요약 = 앱 대시보드: 총 수납액·미분류 입금', [sm.totalIn, app.totalIn, sm.unclassified, app.unclassified]);
  ok(sm.firstStage && sm.firstStage.done === app.firstDone, '통합관리 요약 = 앱 대시보드: 첫 회차 완납 수', [sm.firstStage, app.firstDone]);
  // 계정 사용중지 → 로그인 화면으로 (poll 이 AUTH 오류를 받는다)
  const leeId = ((await api('admin.accounts', {}, admin)).data.accounts.find(x => x.loginId === lee) || {}).id;
  const off = await api('admin.saveAccount', { id: leeId, loginId: lee, name: 'lee계정', role: '열람', active: false, projectIds: ['P01'] }, admin);
  ok(off.ok, '열람 계정 사용중지 저장', off.error);
  await wait(7000);
  ok(await B.evaluate(() => !!$('#loginBg')), 'B: 계정이 중지되면 로그인 화면으로');
  for (const p of [A, B, C]) if (p.errs.length) { fails++; console.log('pageerror', p.errs); }
  await b.close(); try { fs.unlinkSync(COPY); } catch (e) { }
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
