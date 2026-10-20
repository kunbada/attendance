// 다중 사용자 시나리오 테스트 (모의 서버 필요: node tools/mockgas.js 를 새로 시작한 뒤 실행)
const { chromium } = require('playwright'); const path = require('path');
const URL = 'file:///' + path.join(__dirname, '..', '분양계약관리.html').split(path.sep).join('/');
const SRV = 'http://localhost:8765/exec'; let fails = 0;
const ok = (c, m, x) => { if (!c) { fails++; console.log('FAIL', m, x === undefined ? '' : JSON.stringify(x)); } else console.log('ok  ', m); };
const api = async b => (await fetch(SRV, { method: 'POST', body: JSON.stringify(b) })).json();
const wait = ms => new Promise(r => setTimeout(r, ms));
async function mk(b) { const ctx = await b.newContext({ viewport: { width: 1300, height: 800 } }); const p = await ctx.newPage(); p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('dialog', d => d.accept()); return p; }
async function login(p, id, pw) { await p.waitForSelector('#loginBg'); await p.fill('#aId', id); await p.fill('#aPw', pw); await p.click('#aGo'); await p.waitForSelector('#loginBg', { state: 'detached' }); }
(async () => {
  const b = await chromium.launch();
  // A: 로컬 데이터 업로드(서버 비밀키 방식)
  const A = await mk(b); await A.goto(URL + '#settings'); await A.waitForTimeout(500);
  await A.setInputFiles('#initIn', path.join(__dirname, '..', '견본_초기데이터.json')); await A.waitForTimeout(300); await A.click('#cfOk'); await A.waitForTimeout(800);
  await A.fill('#sUrl', SRV); await A.fill('#sTok', 'test123'); await A.click('#sSave'); await A.waitForTimeout(1000);
  await A.click('#sPush'); await A.waitForTimeout(300); await A.click('#cfOk'); await A.waitForTimeout(2000);
  ok(await A.evaluate(() => Object.keys(OUTBOX).length) === 0, '업로드 완료(대기 0)');
  // 사용자 만들기
  const boss = await api({ op: 'setupAdmin', token: 'test123', id: 'boss', name: '상무', pw: '123456' });
  await api({ op: 'signup', id: 'kim', name: '김직원', pw: '123456' }); await api({ op: 'userSet', st: boss.st, uid: 'kim', role: 'write', status: 'active' });
  await api({ op: 'signup', id: 'lee', name: '이열람', pw: '123456' }); await api({ op: 'userSet', st: boss.st, uid: 'lee', role: 'read', status: 'active' });
  await api({ op: 'signup', id: 'new1', name: '신규', pw: '123456' });
  // A 재접속 → 로그인 화면
  await A.reload(); await login(A, 'kim', '123456'); await A.waitForTimeout(800);
  ok(await A.evaluate(() => ROLE()) === 'write', 'A: 쓰기 권한 로그인');
  // B: 읽기전용 — 서버 연결만 입력 → 로그인 → 전체 받기
  const B = await mk(b); await B.goto(URL + '#settings'); await B.waitForTimeout(500);
  await B.fill('#sUrl', SRV); await B.click('#sSave'); await login(B, 'lee', '123456'); await B.waitForTimeout(2500);
  ok(await B.evaluate(() => live('units').length) === 40, 'B: 읽기전용도 전체 데이터 수신');
  // C: 관리자
  const C = await mk(b); await C.goto(URL + '#settings'); await C.waitForTimeout(500);
  await C.fill('#sUrl', SRV); await C.click('#sSave'); await login(C, 'boss', '123456'); await C.waitForTimeout(2500);
  ok(await C.evaluate(() => isAdmin()), 'C: 관리자'); ok(await C.evaluate(() => PENDING_USERS) >= 0, 'C: pending 조회');
  // 동시 수정(같은 세대의 다른 필드)
  await Promise.all([
    A.evaluate(async () => { const u = M.units['101-101']; u.skind = '특공(A수정)'; await save('units', u); }),
    C.evaluate(async () => { const u = M.units['101-101']; u.type = '99Z'; await save('units', u); })
  ]);
  await wait(9000);
  for (const [n, p] of [['A', A], ['B', B], ['C', C]]) { const u = await p.evaluate(() => { const x = M.units['101-101']; return { t: x.type, s: x.skind }; }); ok(u.t === '99Z' && u.s === '특공(A수정)', `${n}: 동시 수정 병합 반영(실시간 전파)`, u); }
  // 읽기전용 저장 시도
  await B.evaluate(async () => { const u = M.units['101-102']; u.type = 'HACK'; await save('units', u); });
  await wait(1500); ok(await B.evaluate(() => M.units['101-102'].type) !== 'HACK', 'B: 읽기전용 저장 차단(원복)');
  // 같은 동호 동시 계약
  const con = (id, name) => ({ id, dongho: '101-103', status: '정상', name, date: '2026-10-19' });
  await Promise.all([A.evaluate(async c => { await save('contracts', c); }, con('cA', '가나다')), C.evaluate(async c => { await save('contracts', c); }, con('cC', '라마바'))]);
  await wait(9000);
  for (const [n, p] of [['A', A], ['C', C], ['B', B]]) { const r = await p.evaluate(() => live('contracts').filter(c => c.dongho === '101-103').map(c => c.name)); ok(r.length === 1, `${n}: 동일 동호 이중계약 1건만 존속`, r); }
  const sA = await A.evaluate(() => live('contracts').filter(c => c.dongho === '101-103')[0].name), sC = await C.evaluate(() => live('contracts').filter(c => c.dongho === '101-103')[0].name); ok(sA === sC, '모든 사용자 같은 결과', [sA, sC]);
  // 사용자관리 화면
  await C.goto(URL + '#users'); await C.waitForTimeout(1500); ok(/신규/.test(await C.innerText('#view')), '관리자: 승인대기 사용자 표시');
  // 사용중지 → 즉시 차단
  await api({ op: 'userSet', st: boss.st, uid: 'lee', status: 'disabled' }); await wait(6500);
  ok(await B.evaluate(() => !!$('#loginBg')), 'B: 사용중지되면 로그인 화면으로');
  for (const p of [A, B, C]) if (p.errs.length) { fails++; console.log('pageerror', p.errs); }
  await b.close(); console.log(fails ? 'FAILED ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
