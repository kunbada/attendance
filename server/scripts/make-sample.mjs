// 시험용 샘플 현장을 서버(API)로 만든다: 현장 1개, 직군(영업·상담사·홍보단), 직군별 직원 3명(가짜 정보, 승인 완료), 계약앱 동호 10개.
//   PowerShell:  $env:ADMIN_PW = '관리자 비밀번호'; node scripts/make-sample.mjs
//   (다른 서버에 만들려면 $env:BASE_URL = 'http://127.0.0.1:8787')
// 비밀번호는 이 컴퓨터의 환경 변수로만 쓰고 어디에도 저장하지 않는다. 직원 정보는 모두 가짜(주민번호 000101-3000000 류).
const BASE = process.env.BASE_URL || 'https://attendance-api.kunbada.workers.dev';
const PW = process.env.ADMIN_PW;
const LOGIN = process.env.ADMIN_ID || 'admin';
if (!PW) { console.error('먼저 $env:ADMIN_PW = "관리자 비밀번호" 를 입력해 주세요.'); process.exit(1); }

const call = async (action, data, token = '', projectId, deviceKey = '') => {
  const res = await (await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token, deviceKey, projectId: projectId || undefined, data: data || {} }) })).json();
  if (!res.ok) throw new Error(action + ' 실패: ' + res.error);
  return res.data;
};

const lg = await call('account.login', { loginId: LOGIN, password: PW });
if (lg.account.mustChangePassword) throw new Error('관리자 비밀번호를 먼저 바꿔야 합니다 (통합관리에 한 번 로그인해 바꿔 주세요).');
const admin = lg.token;

// 1) 현장
if ((await call('project.list', {}, admin, null)).projects.length) throw new Error('이미 현장이 있습니다. 먼저 scripts/wipe-data.sql 로 비워 주세요.');
const pr = await call('project.save', { name: '테스트현장', code: 'test1', kind: '아파트', moneyLabel: '분양가' }, admin, null);
const P = pr.id;
console.log('현장 만들기:', P, '(가입 코드 test1)');

// 2) 직군: 영업·상담사·홍보단만 사용 (기본으로 만들어지는 도우미·아르바이트는 사용 중지)
const orgs0 = (await call('admin.orgs', {}, admin, P)).orgs;
for (const o of orgs0.filter((x) => x.kind === '직군' && !['영업', '상담사', '홍보단'].includes(x.name))) {
  await call('admin.saveOrg', { id: o.id, kind: '직군', name: o.name, order: o.order, active: false }, admin, P);
  console.log('직군 사용 중지:', o.name);
}
// 영업 직원은 가입 때 본부·팀이 필요하다
await call('admin.saveOrg', { kind: '본부', name: '1본부', order: 1 }, admin, P);
const head = (await call('admin.orgs', {}, admin, P)).orgs.find((o) => o.kind === '본부' && o.name === '1본부').id;
await call('admin.saveOrg', { kind: '팀', name: '1팀', parentId: head, order: 1 }, admin, P);
const team = (await call('admin.orgs', {}, admin, P)).orgs.find((o) => o.kind === '팀' && o.name === '1팀').id;
console.log('조직 만들기: 1본부 / 1팀');

// 3) 직군별 직원 3명 (가짜 정보). 로그인 PIN 은 모두 1234
const jobs = ['영업', '상담사', '홍보단'];
let n = 0;
for (const job of jobs) {
  for (let i = 1; i <= 3; i++) {
    n += 1;
    const name = job + i;
    const phone = '0100000' + String(n).padStart(4, '0');
    const dev = 'sample-device-' + String(n).padStart(2, '0') + '-xxxxxxxxxxxxxxxx';
    await call('staff.signup', { projectCode: 'test1', name, nickname: '', phone, pin: '1234', job, headId: job === '영업' ? head : '', teamId: job === '영업' ? team : '', rrn: '000101-3000000', bank: '국민', accountNo: '000-000-000000', holder: name, consent: true }, '', null, dev);
    const row = (await call('admin.staffList', {}, admin, P)).staff.find((x) => x.phone === phone);
    await call('admin.approve', { staffId: row.id }, admin, P);
    console.log('직원 만들기·승인:', name, phone);
  }
}

// 4) 계약앱 동호 10개 (101동 5개 59A, 102동 5개 84B) + 현장 설정
const stamp = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 23);
const stageAmounts = { '계약금 1차': 10000000, '계약금 2차': 40000000, '중도금 1차': 50000000, '중도금 2차': 50000000, '중도금 3차': 50000000, '중도금 4차': 50000000, '중도금 5차': 50000000, '중도금 6차': 50000000, '잔금': 150000000 };
const changes = [{ c: 'settings', r: { id: 'main', project: { name: '테스트현장', lessor: '', bizNo: '', bank: '', account: '', moneyLabel: '분양가' }, stages: Object.keys(stageAmounts), special: {}, updatedAt: stamp() } }];
for (const dong of ['101', '102']) {
  for (let floor = 1; floor <= 5; floor++) {
    const ho = floor + '01';
    changes.push({ c: 'units', r: { id: dong + '-' + ho, dong, ho, floor, line: 1, type: dong === '101' ? '59A' : '84B', price: 500000000, amounts: stageAmounts, updatedAt: stamp() } });
  }
}
const sync = await call('contract.sync', { since: 0, changes }, admin, P);
console.log('계약앱 동호 올리기:', changes.length - 1, '개', sync.rejected && sync.rejected.length ? '(거절 ' + sync.rejected.length + '건)' : '');
console.log('\n완료. 직원 로그인: 휴대폰 01000000001 ~ 01000000009 / PIN 1234 (가짜 번호). 통합관리에서 현장 "테스트현장"을 고르세요.');
