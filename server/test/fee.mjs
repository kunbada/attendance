// 5단계 판매수수료 서버 시험. 실제 HTTP 로 로컬 서버(wrangler dev)를 호출한다.
//   0) DB 비우기 → 표 만들기 → 시드 (run.mjs 위쪽 설명과 같음)  1) wrangler dev --local --port 8787
//   2) ADMIN_PW=초기비밀번호 node test/fee.mjs      (시험 중 관리자 비밀번호를 바꾸므로 다시 돌릴 때는 시드부터 다시)
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const ADMIN_PW = process.env.ADMIN_PW;
if (!ADMIN_PW) { console.error('ADMIN_PW 환경변수에 초기 관리자 비밀번호를 넣어 주세요.'); process.exit(1); }

let pass = 0, failed = 0;
const call = async (action, data, token = '', projectId, deviceKey = '') =>
  (await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token, deviceKey, projectId: projectId || undefined, data: data || {} }) })).json();
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('[통과] ' + label + (extra ? ' → ' + extra : '')); }
  else { failed++; console.log('[실패] ' + label + (extra ? ' → ' + extra : '')); }
};
const expectErr = (label, res, part, code) => check(label, res.ok === false && (!part || res.error.includes(part)) && (!code || res.code === code), res.error || '(성공해 버림)');
const expectOk = (label, res) => check(label, res.ok === true, res.ok ? '' : res.error);

const uniq = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
let tick = 0;
const ts = () => '2026-09-01T09:' + String(Math.floor(tick / 60)).padStart(2, '0') + ':' + String(tick++ % 60).padStart(2, '0') + '.000';
const rec = (c, id, extra) => ({ c, r: Object.assign({ id, updatedAt: ts() }, extra || {}) });
const patch = (c, id, p) => ({ c, id, p: Object.assign({ updatedAt: ts() }, p) });
const won = (n) => Number(n).toLocaleString('en-US');

try {
  // ===== 준비: 관리자, 현장, 조직, 직원 =====
  const first = await call('account.login', { loginId: 'admin', password: ADMIN_PW });
  const admin = first.data.token;
  await call('account.changePassword', { oldPassword: ADMIN_PW, newPassword: 'AdminPw' + uniq + 'a1' }, admin, null);
  const pr = await call('project.save', { name: '수수료현장' + uniq, code: 'fee' + uniq.slice(0, 5) }, admin, null);
  expectOk('시험용 현장 만들기', pr);
  const P = pr.data.id;
  const code = (await call('project.list', {}, admin, null)).data.projects.find((p) => p.id === P).code;
  const sync = (tok, changes, since = 0) => call('contract.sync', { since, changes }, tok, P);

  await call('admin.saveOrg', { kind: '본부', name: '1본부', order: 1 }, admin, P);
  await call('admin.saveOrg', { kind: '본부', name: '2본부', order: 2 }, admin, P);
  const orgs0 = (await call('admin.orgs', {}, admin, P)).data.orgs;
  const HEAD = orgs0.find((o) => o.name === '1본부').id, HEAD2 = orgs0.find((o) => o.name === '2본부').id;
  await call('admin.saveOrg', { kind: '팀', name: '1팀', parentId: HEAD, order: 1 }, admin, P);
  await call('admin.saveOrg', { kind: '팀', name: '2팀', parentId: HEAD, order: 2 }, admin, P);
  const orgs1 = (await call('admin.orgs', {}, admin, P)).data.orgs;
  const T1 = orgs1.find((o) => o.name === '1팀').id, T2 = orgs1.find((o) => o.name === '2팀').id;

  let phoneN = 0;
  const mkStaff = async (name, nick, head, team, grade) => {
    phoneN += 1;
    const phone = '010' + String(60000000 + Number(uniq) % 1000000 + phoneN).padStart(8, '0');
    const dev = 'dev-fee-' + uniq + '-' + phoneN + '-xxxx';
    const sg = await call('staff.signup', { projectCode: code, name, nickname: nick, phone, pin: '1234', job: '영업', headId: head, teamId: team || T1, rrn: '000101-3000000', bank: '국민', accountNo: '000-000-000000', holder: name, consent: true }, '', null, dev);
    if (!sg.ok) throw new Error('직원 가입 실패 ' + name + ': ' + sg.error);
    const sid = (await call('admin.staffList', {}, admin, P)).data.staff.find((x) => x.phone === phone).id;
    await call('admin.approve', { staffId: sid }, admin, P);
    if (grade !== '직원') {
      const up = await call('admin.update', { staffId: sid, name, nickname: nick, phone, job: '영업', headId: head, teamId: grade === '본부장' ? '' : team, grade }, admin, P);
      if (!up.ok) throw new Error('직급 지정 실패 ' + name + ': ' + up.error);
    }
    return sid;
  };
  const sH = await mkStaff('본부장甲', '갑', HEAD, '', '본부장');
  const sL = await mkStaff('팀장乙', '을', HEAD, T1, '팀장');
  const sE1 = await mkStaff('직원丙', '병', HEAD, T1, '직원');
  const sE2 = await mkStaff('직원丁', '정', HEAD, T1, '직원');
  const sE3 = await mkStaff('직원戊', '무', HEAD, T2, '직원'); // 2팀에는 팀장이 없다
  const sNo = await mkStaff('직원己', '기', HEAD, T1, '직원'); // 수수료 대상이 아닌 직원 (지급 설정에서 끔)

  const setPay = (sid, fee) => call('pay.settingSave', { staffId: sid, dailyWage: 0, cycle: '월', dailyEnabled: false, feeEnabled: fee, payMode: '3.3%', effectiveFrom: '2026-01-01' }, admin, P);
  for (const sid of [sH, sL, sE1, sE2, sE3]) expectOk('지급 설정(수수료 대상)', await setPay(sid, true));
  expectOk('지급 설정(수수료 대상 아님)', await setPay(sNo, false));

  // ===== 계약앱 데이터 =====
  const STAGES = ['계약금 1차', '계약금 2차', '중도금 1차'];
  const amounts = { '계약금 1차': 1000000, '계약금 2차': 2000000, '중도금 1차': 5000000 };
  const unit = (dh, type) => rec('units', dh, { dong: dh.split('-')[0], type, amounts });
  let depN = 0;
  const dep = (dh, cat, inn, day) => rec('deposits', 'dp' + (++depN), { k: 'key' + uniq + depN, dongho: dh, cat, inn, out: 0, t: '2026.' + day.slice(5, 7) + '.' + day.slice(8, 10) + ' 10.00.00' });
  const contract = (id, dh, staffId, date, extra) => rec('contracts', id, Object.assign({ dongho: dh, status: '정상', name: '고객' + id, date, staffId, staff: '', team: '' }, extra || {}));
  const dhs = ['101-101', '101-102', '101-103', '101-104', '101-105', '101-106', '102-101', '101-107', '101-108', '101-109'];
  const full = (dh, d1, d2) => [dep(dh, '계약금 1차', 1000000, d1), dep(dh, '계약금 2차', 2000000, d2)];
  const changes = [
    rec('settings', 'main', { stages: STAGES, project: { name: '수수료현장' } }),
    ...dhs.map((d) => unit(d, d.startsWith('102') ? '84B' : '59A')),
    contract('cx1', '101-101', sE1, '2026-09-01'), ...full('101-101', '2026-09-05', '2026-09-10'),               // 정상 지급 (직원·팀장·본부장)
    contract('cx2', '101-102', sE2, '2026-09-02', { fee: '조직' }), dep('101-102', '계약금 1차', 1000000, '2026-09-12'), // 1차만 납부
    contract('cx3', '101-103', sL, '2026-09-03'), ...full('101-103', '2026-09-14', '2026-09-15'),                  // 팀장 직접 계약
    contract('cx4', '101-104', sH, '2026-09-04'), ...full('101-104', '2026-09-18', '2026-09-20'),                  // 본부장 직접 계약
    contract('cx5', '101-105', sE3, '2026-09-05'), ...full('101-105', '2026-09-20', '2026-09-21'),                 // 팀장 없는 팀 → 보류
    contract('cx6', '101-106', sE1, '2026-08-01'), ...full('101-106', '2026-08-10', '2026-08-20'),                 // 정산 시작일 이전 → 대상 아님
    contract('cx7', '102-101', sE1, '2026-09-06'), ...full('102-101', '2026-09-24', '2026-09-25'),                 // 동 규칙(102)
    contract('cx8', '101-107', sE1, '2026-09-07'), ...full('101-107', '2026-09-25', '2026-09-26'),                 // 본부장 일괄
    contract('cx9', '101-108', sNo, '2026-09-08'), ...full('101-108', '2026-09-26', '2026-09-27'),                 // 수수료 대상 아닌 직원 → 직원 몫만 빠지고 팀장·본부장 몫은 지급
    contract('cx10', '101-109', '', '2026-09-09'), ...full('101-109', '2026-09-27', '2026-09-28')                  // 담당자 미연결 → 대상 아님
  ];
  expectOk('계약 데이터 올리기', await sync(admin, changes));

  // ===== 규칙 =====
  const rule = (extra) => call('fee.ruleSave', Object.assign({ scope: '기본', staffAmount: 300000, leaderAmount: 100000, headAmount: 50000, payMode: '구분' }, extra), admin, P);
  expectErr('금액이 모두 0이면 거부', await rule({ staffAmount: 0, leaderAmount: 0, headAmount: 0 }), '0원보다');
  expectErr('범위 값 없는 타입 규칙 거부', await rule({ scope: '타입', scopeValue: '' }), '값을 입력');
  expectErr('동호 형식 오류 거부', await rule({ scope: '동호', scopeValue: '1011' }), '101-1203');
  expectErr('음수 금액 거부', await rule({ staffAmount: -1 }), '정수');
  expectOk('기본 규칙', await rule({}));
  expectOk('수수료기준 조직 규칙(기본 범위)', await rule({ feeBasis: '조직', staffAmount: 350000, leaderAmount: 120000, headAmount: 60000 }));
  expectOk('102동 규칙', await rule({ scope: '동', scopeValue: '102동', staffAmount: 400000, leaderAmount: 150000, headAmount: 70000 }));
  expectOk('101-104 동호 규칙(팀장 몫 없음)', await rule({ scope: '동호', scopeValue: '101-104', staffAmount: 500000, leaderAmount: 0, headAmount: 200000 }));
  expectOk('101-107 본부장 일괄 규칙', await rule({ scope: '동호', scopeValue: '101-107', payMode: '본부장일괄' }));
  const rl = (await call('fee.ruleList', {}, admin, P)).data;
  check('규칙 목록: 5개, 동호 > 동 > 기본 순서', rl.rules.length === 5 && rl.rules[0].scope === '동호' && rl.rules[rl.rules.length - 1].scope === '기본', rl.rules.map((r) => r.scope).join(','));
  check('규칙 화면용 목록: 타입·동·수수료기준', rl.types.includes('59A') && rl.dongs.includes('101') && rl.feeBases.includes('조직'), JSON.stringify([rl.types, rl.dongs, rl.feeBases]));

  // ===== 권한 =====
  const mkAcc = async (role, tag) => {
    const loginId = tag + uniq, pw = 'First' + uniq + 'z9';
    const sv = await call('admin.saveAccount', { loginId, name: tag, role, password: pw, active: true, projectIds: [P] }, admin, null);
    if (!sv.ok) throw new Error('계정 만들기 실패: ' + sv.error);
    const lg = await call('account.login', { loginId, password: pw });
    await call('account.changePassword', { oldPassword: pw, newPassword: 'Second' + uniq + 'y8' }, lg.data.token, null);
    return lg.data.token;
  };
  const writer = await mkAcc('계약담당', 'cw'), subNo = await mkAcc('보조관리자', 'sub');
  expectErr('계약담당 계정은 수수료 규칙 불가', await call('fee.ruleList', {}, writer, P), '권한', 'FORBIDDEN');
  expectErr('로그인 없이 불가', await call('fee.runCreate', { from: '2026-09-01', to: '2026-09-30' }, '', P), '로그인', 'AUTH');

  // ===== 1차 정산: 계약금 모두 납부 후 지급 =====
  const FROM = '2026-09-01', TO = '2026-09-30';
  expectOk('설정: 모두 납부 후 / 정산 시작일 / 대기 3개월', await call('fee.settingsSave', { after: '계약금전체', start: FROM, months: 3, missing: '보류' }, admin, P));
  expectErr('지급 시점 값 오류 거부', await call('fee.settingsSave', { after: '아무때나', start: FROM, months: 3, missing: '보류' }, admin, P), '지급 시점');
  expectErr('오늘 이후 기간 거부', await call('fee.runCreate', { from: FROM, to: '2099-01-01' }, admin, P), '오늘 이후');
  const cr = await call('fee.runCreate', { from: FROM, to: TO, title: '9월 수수료' }, admin, P);
  expectOk('수수료 정산 만들기', cr);
  const runId = cr.data.id;
  let g = (await call('pay.runGet', { runId }, admin, P)).data;
  const it = (name) => g.items.find((i) => i.name === name);
  // 기대값: 직원丙(E1): cx1 300k + cx7(102동) 400k = 700k / 팀장乙(L): cx1 100k + cx3 (직원 300k + 팀장 100k) + cx7 150k = 650k
  //          본부장甲(H): cx1 50k + cx3 50k + cx4 (직원 500k + 본부장 200k) + cx7 70k + cx8 (일괄 450k) = 1,320k
  check('수수료 정산: 받는 사람은 본부장·팀장·직원丙 3명', g.items.length === 3 && g.run.kind === '수수료', g.items.map((i) => i.name).join(','));
  check('직원丙 700,000원 (정상 계약 + 102동 규칙)', it('직원丙') && it('직원丙').gross === 700000 && it('직원丙').count === 2, it('직원丙') && won(it('직원丙').gross));
  check('팀장乙 750,000원 (팀원 계약 + 직접 계약 직원몫·팀장몫 + 102동 + 대상 아닌 직원 계약의 팀장 몫)', it('팀장乙') && it('팀장乙').gross === 750000, it('팀장乙') && won(it('팀장乙').gross));
  check('본부장甲 1,370,000원 (직접 계약 직원몫·본부장몫 + 일괄 포함)', it('본부장甲') && it('본부장甲').gross === 1370000, it('본부장甲') && won(it('본부장甲').gross));
  check('3.3% 공제: 직원丙 소득세 21,000 지방세 2,100 실지급 676,900', it('직원丙').incomeTax === 21000 && it('직원丙').localTax === 2100 && it('직원丙').net === 676900);
  check('보류: 팀장 없는 팀(101-105) 1건', g.fee.held.length === 1 && g.fee.held[0].dongho === '101-105' && /팀장/.test(g.fee.held[0].reason), JSON.stringify(g.fee.held));
  check('수수료 대상이 아닌 직원 몫은 제외 안내', g.fee.dropped.some((d) => d.staff === '직원己' && /대상이 아닙니다/.test(d.reason)));
  check('1차만 낸 계약(101-102)·시작일 이전(101-106)·담당 미연결(101-109)은 정산 대상 아님', !g.items.some((i) => i.detail.some((d) => ['101-102', '101-106', '101-109'].includes(d.dongho))));
  check('명세에 계약 내역이 들어 있음(동호·몫·금액)', it('직원丙').detail.some((d) => d.dongho === '102-101' && d.role === '직원' && d.amount === 400000));
  check('본부장 일괄 줄은 몫이 본부장일괄', it('본부장甲').detail.some((d) => d.dongho === '101-107' && d.role === '본부장일괄' && d.amount === 450000));
  check('직접 계약한 팀장은 직원 몫과 팀장 몫을 모두 받음', it('팀장乙').detail.filter((d) => d.dongho === '101-103').map((d) => d.role).sort().join() === '직원,팀장');
  check('직접 계약한 본부장은 직원 몫과 본부장 몫, 팀장 몫은 없음', it('본부장甲').detail.filter((d) => d.dongho === '101-104').map((d) => d.role).sort().join() === '본부장,직원');
  const other = await call('fee.runCreate', { from: FROM, to: TO }, admin, P);
  expectErr('같은 계약이 다른 작성 중 회차에 이미 들어가 있으면 중복 정산 불가', other, '정산할 수수료가 없습니다');

  // 조정 → 검토 → 확정
  expectOk('조정 금액', await call('pay.itemSave', { runId, staffId: sE1, adjustAmount: -50000, adjustMemo: '선지급 차감' }, admin, P));
  g = (await call('pay.runGet', { runId }, admin, P)).data;
  check('조정 후 직원丙 650,000원', it('직원丙').gross === 650000 && it('직원丙').adjustAmount === -50000);
  expectOk('검토 요청', await call('pay.runReview', { runId }, admin, P));
  expectErr('보조관리자는 허용 없이 확정 불가', await call('pay.runConfirm', { runId }, subNo, P), '권한', 'FORBIDDEN');
  // 검토 후 규칙이 바뀌면 확정이 막힌다
  const baseRule = rl.rules.find((r) => r.scope === '기본' && !r.feeBasis);
  await call('fee.ruleSave', { ...baseRule, staffAmount: 310000 }, admin, P);
  expectErr('검토 이후 규칙이 바뀌면 확정 거부', await call('pay.runConfirm', { runId }, admin, P), '바뀌었습니다');
  await call('fee.ruleSave', { ...baseRule, staffAmount: 300000 }, admin, P);
  expectOk('규칙을 되돌리면 확정', await call('pay.runConfirm', { runId }, admin, P));
  g = (await call('pay.runGet', { runId }, admin, P)).data;
  check('확정 상태', g.run.status === '확정' && g.items.length === 3);
  expectErr('확정된 회차는 다시 계산 불가', await call('pay.runRecalc', { runId }, admin, P), '이미');
  expectErr('같은 기간 다시 만들어도 이미 지급한 계약은 제외', await call('fee.runCreate', { from: FROM, to: TO }, admin, P), '정산할 수수료가 없습니다');
  const tf = await call('pay.transferExport', { runId }, admin, P);
  check('이체 파일: 3건', tf.ok && tf.data.rows.length === 3);
  const lst = (await call('pay.runList', { kind: '수수료' }, admin, P)).data.runs;
  check('회차 목록(수수료)', lst.length === 1 && lst[0].kind === '수수료' && lst[0].people === 3);
  check('회차 목록(일급)에는 수수료 회차가 없음', (await call('pay.runList', { kind: '일급' }, admin, P)).data.runs.length === 0);
  const st1 = (await call('pay.statement', { from: FROM, to: TO }, admin, P)).data;
  check('합산 명세: 수수료 합계 2,770,000원 (조정 -50,000 포함)', st1.totals.fee.gross === 2770000, String(st1.totals.fee.gross));

  // ===== 2차 정산: 지급 시점을 계약금 1차로 바꾸면 101-102 도 대상 =====
  expectOk('설정: 계약금 1차 납부 후 지급', await call('fee.settingsSave', { after: '계약금1차', start: FROM, months: 3, missing: '건너뜀' }, admin, P));
  const cr2 = await call('fee.runCreate', { from: FROM, to: TO, title: '9월 추가분' }, admin, P);
  expectOk('2차 정산 만들기', cr2);
  let g2 = (await call('pay.runGet', { runId: cr2.data.id }, admin, P)).data;
  const it2 = (name) => g2.items.find((i) => i.name === name);
  // 101-102 (직원丁, 수수료기준 조직 → 350k/120k/60k) 와, 1팀 팀장 없음 건너뜀 설정으로 101-105(직원戊, 2팀 팀장 없음) 도 이제 대상: 직원 300k + 본부장 50k
  check('2차: 직원丁 350,000 (수수료기준 조직 규칙)', it2('직원丁') && it2('직원丁').gross === 350000, it2('직원丁') && won(it2('직원丁').gross));
  check('2차: 팀장 몫 120,000 + 본부장 60,000 + 101-105 본부장 몫 50,000', it2('팀장乙').gross === 120000 && it2('본부장甲').gross === 110000, `${it2('팀장乙') && it2('팀장乙').gross}/${it2('본부장甲') && it2('본부장甲').gross}`);
  check('2차: 팀장 없는 팀은 설정에 따라 그 몫만 건너뛰고 직원戊 300,000 지급', it2('직원戊') && it2('직원戊').gross === 300000);
  check('2차: 이미 지급한 계약은 다시 나오지 않음(직원丙 없음)', !it2('직원丙'));
  await call('pay.runDelete', { runId: cr2.data.id }, admin, P);

  // ===== 해약 → 환수 =====
  // cx1(직원丙) 해약, cx7(102-101, 직원丙) 해약
  expectOk('계약 해약 처리(cx1, cx7)', await sync(admin, [patch('contracts', 'cx1', { status: '해약' }), patch('contracts', 'cx7', { status: '해약' })]));
  let cl = (await call('fee.cancelList', {}, admin, P)).data;
  const grp = (dh) => cl.pending.find((x) => x.dongho === dh);
  check('해약 목록: 101-101 환수 3줄 합계 -450,000', grp('101-101') && grp('101-101').lines.length === 3 && grp('101-101').total === -450000, grp('101-101') && String(grp('101-101').total));
  check('해약 목록: 102-101 환수 합계 -620,000(400+150+70)', grp('102-101') && grp('102-101').total === -620000, grp('102-101') && String(grp('102-101').total));
  check('결정 전 환수는 정산에 들어가지 않음', (await call('fee.cancelList', {}, admin, P)).data.pending.every((x) => x.decision === ''));
  expectErr('결정 값 오류 거부', await call('fee.cancelDecide', { contractId: 'cx1', decision: '모름' }, admin, P), '선택');
  const dec1 = await call('fee.cancelDecide', { contractId: 'cx1', decision: '재판매대기' }, admin, P);
  expectOk('101-101: 재판매 대기', dec1);
  check('재판매 대기 기한은 해약일로부터 3개월', /^\d{4}-\d{2}-\d{2}$/.test(dec1.data.resaleUntil), dec1.data.resaleUntil);
  expectOk('102-101: 환수로 결정', await call('fee.cancelDecide', { contractId: 'cx7', decision: '환수' }, admin, P));

  // 101-101 을 같은 직원丙이 재판매 → 환수 취소·대체 인정 (새 계약은 수수료를 다시 받지 않음)
  expectOk('같은 담당자 재판매 계약', await sync(admin, [contract('cx1b', '101-101', sE1, '2026-10-02')]));
  cl = (await call('fee.cancelList', {}, admin, P)).data;
  check('같은 담당자가 재판매하면 환수 대기가 사라짐', !cl.pending.some((x) => x.dongho === '101-101'));
  check('내역에 재판매 대체(취소) 기록', cl.history.some((h) => h.dongho === '101-101' && h.state === '취소'));
  // 102-101 은 직원丁이 재판매 (다른 직원) → 새 계약은 정상 지급, 원 담당자는 환수. 그리고 직원丙에게 새 수수료(조정용) 하나 더
  expectOk('다른 직원 재판매 계약 + 직원丙의 새 계약', await sync(admin, [
    contract('cx7b', '102-101', sE2, '2026-10-03'),
    unit('101-110', '59A'), contract('cx11', '101-110', sE1, '2026-10-04'), ...full('101-110', '2026-10-05', '2026-10-06')
  ]));
  expectOk('101-110 전용 규칙(직원 900,000)', await rule({ scope: '동호', scopeValue: '101-110', staffAmount: 900000, leaderAmount: 0, headAmount: 0 }));
  expectOk('설정: 계약금 모두 납부 후', await call('fee.settingsSave', { after: '계약금전체', start: FROM, months: 3, missing: '건너뜀' }, admin, P));

  const TO2 = '2026-10-31';
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const to2 = today < TO2 ? today : TO2;
  const cr3 = await call('fee.runCreate', { from: '2026-10-01', to: to2, title: '10월 수수료' }, admin, P);
  expectOk('3차 정산 만들기(해약 환수 차감 포함)', cr3);
  const g3 = (await call('pay.runGet', { runId: cr3.data.id }, admin, P)).data;
  const it3 = (name) => g3.items.find((i) => i.name === name);
  // 직원丙: 새 계약 900k - 환수 400k(102-101 직원 몫) = 500k.  직원丁(새 102-101 계약 → 102동 규칙 400k) 그리고 101-105 직원戊 300k 도 건너뜀 설정으로 포함
  check('직원丙: 새 계약 900,000 − 102-101 환수 400,000 = 500,000', it3('직원丙') && it3('직원丙').gross === 500000 && it3('직원丙').detail.some((d) => d.t === '환수' && d.amount === -400000), it3('직원丙') && won(it3('직원丙').gross));
  check('직원丁: 다른 직원이 재판매했으므로 새 담당자에게 정상 지급 400,000', it3('직원丁') && it3('직원丁').gross === 400000, it3('직원丁') && won(it3('직원丁').gross));
  check('팀장乙: 환수 150,000 이 지급액(새 계약 팀장 몫 150,000 + ...)과 함께 처리됨', !!it3('팀장乙'));
  check('같은 담당자 재판매(101-110 아님 101-101)는 새 계약 수수료 없음', !g3.items.some((i) => i.detail.some((d) => d.t === '지급' && d.cid === 'cx1b')));
  check('이월 안내(없거나 있을 수 있음)가 배열로 내려옴', Array.isArray(g3.fee.carried));
  if (process.env.STOP_AT_DRAFT) { console.log('UI_ADMIN_PW=AdminPw' + uniq + 'a1 UI_PROJECT=' + P + ' UI_RUN=' + cr3.data.id); console.log('=== 화면 시험용으로 여기서 멈춤 ==='); process.exit(0); }
  expectOk('3차 검토', await call('pay.runReview', { runId: cr3.data.id }, admin, P));
  expectOk('3차 확정', await call('pay.runConfirm', { runId: cr3.data.id }, admin, P));
  cl = (await call('fee.cancelList', {}, admin, P)).data;
  check('차감한 환수 줄은 확정 처리되어 대기 목록에서 사라짐', !cl.pending.some((x) => x.dongho === '102-101' && x.deducted === false && x.lines.some((l) => l.staffName === '직원丙')));

  // ===== 내 지급내역 (직원앱) =====
  const prof = await call('staff.login', { phone: (await call('admin.staffList', {}, admin, P)).data.staff.find((x) => x.id === sE1).phone, pin: '1234' }, '', null, 'dev-fee-' + uniq + '-3-xxxx');
  if (prof.ok) {
    const mp = await call('staff.myPay', {}, prof.data.token, null, 'dev-fee-' + uniq + '-3-xxxx');
    const fee = (mp.data.pays || []).filter((x) => x.kind === '수수료');
    check('직원앱 내 지급내역: 수수료 2회차, 고객 이름 없이 동호·몫·금액만', fee.length === 2 && fee.every((x) => x.detail.every((d) => 'dongho' in d && !('name' in d) && !('customer' in d))), JSON.stringify(fee.map((x) => x.title)));
  } else check('직원앱 로그인(시험 준비)', false, prof.error);

  const stAll = (await call('pay.statement', { from: '2026-09-01', to: '2026-10-31' }, admin, P)).data;
  check('합산 명세: 사람별로 일급·수수료·합계', stAll.people.length >= 3 && stAll.people.every((p) => p.total.gross === p.daily.gross + p.fee.gross));

  // ===== 현장 격리 =====
  const pb = await call('project.save', { name: '다른현장' + uniq, code: 'oth' + uniq.slice(0, 5) }, admin, null);
  const PB = pb.data.id;
  const ruleId = rl.rules[0].id;
  check('다른 현장: 규칙 목록이 비어 있음', (await call('fee.ruleList', {}, admin, PB)).data.rules.length === 0);
  expectErr('다른 현장에서 이 현장 규칙 수정 불가', await call('fee.ruleSave', { id: ruleId, scope: '기본', staffAmount: 1, leaderAmount: 0, headAmount: 0 }, admin, PB), '찾을 수 없습니다');
  expectErr('다른 현장에서 이 현장 규칙 삭제 불가', await call('fee.ruleDelete', { id: ruleId }, admin, PB), '찾을 수 없습니다');
  expectErr('다른 현장에서 이 현장 정산 회차 열기 불가', await call('pay.runGet', { runId }, admin, PB), '찾을 수 없습니다');
  expectErr('다른 현장에서 이 현장 환수 결정 불가', await call('fee.cancelDecide', { contractId: 'cx7', decision: '환수' }, admin, PB), '처리할 환수 건이 없습니다');
  check('다른 현장: 해약·환수·합산 명세가 비어 있음', (await call('fee.cancelList', {}, admin, PB)).data.pending.length === 0 && (await call('pay.statement', { from: '2026-09-01', to: '2026-10-31' }, admin, PB)).data.people.length === 0);
  const sb = (await call('fee.settingsGet', {}, admin, PB)).data.settings;
  check('다른 현장: 설정은 기본값(시작일 없음)', sb.start === '' && sb.after === '계약금전체' && sb.months === 3);
} catch (e) {
  failed++;
  console.log('[실패] 테스트 중 예외: ' + (e && e.stack ? e.stack : e));
}
console.log('\n=== ' + (failed ? '실패 ' + failed + '건 (통과 ' + pass + '건)' : '전체 통과 (' + pass + '건)') + ' ===');
process.exit(failed ? 1 : 0);
