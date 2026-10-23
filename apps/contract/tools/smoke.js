// 스모크 테스트: 초기데이터 로드 → 전 화면 렌더링 → 콘솔 오류 확인
// 준비: npm i -D playwright && npx playwright install chromium   실행: node tools/smoke.js [초기데이터.json]
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
// 서버 주소를 비운 사본으로 연다 (로컬 전용 모드 = 로그인 없이 화면만 시험)
const COPY = path.join(__dirname, '_smoke_app.html');
fs.writeFileSync(COPY, fs.readFileSync(path.join(__dirname, '..', '분양계약관리.html'), 'utf8').replace(/const DEFAULT_SERVER = "[^"]*";/, 'const DEFAULT_SERVER = "";'));
const URL = 'file:///' + COPY.replace(/\\/g, '/');
const DATA = process.argv[2] || path.join(__dirname, '..', '..', '..', 'private', 'contract', '초기데이터_양주역중흥S클래스.json');
(async () => {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text())); p.on('dialog', d => d.accept());
  await p.goto(URL + '#settings'); await p.waitForTimeout(600);
  await p.setInputFiles('#initIn', DATA); await p.waitForTimeout(400); await p.click('#cfOk'); await p.waitForTimeout(1500);
  for (const v of ['dash', 'map', 'contracts', 'pre', 'locks', 'deposits', 'payments', 'receipts', 'units', 'reports', 'print', 'settings']) { await p.goto(URL + '#' + v); await p.waitForTimeout(500); }
  // 영수증: 계약금 완납 세대 1건 렌더 확인
  await p.goto(URL + '#receipts'); await p.waitForTimeout(500);
  const rc = await p.evaluate(() => { const c = Object.values(IX.active).find(c => payState(c.dongho, STAGES()[0]).done); return c ? receiptPage(c.dongho, STAGES()[0]) : ''; });
  if (!/계약자 보관용/.test(rc) || !/회사 보관용/.test(rc)) errs.push('영수증 생성 실패');
  console.log(errs.length ? 'FAIL\n' + errs.join('\n') : 'OK — 모든 화면 오류 없음'); await b.close(); try { fs.unlinkSync(COPY); } catch (e) { } process.exit(errs.length ? 1 : 0);
})();
