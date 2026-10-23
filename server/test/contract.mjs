// 계약관리 연동(4단계) 서버 시험. 실제 HTTP 로 로컬 서버(wrangler dev)를 호출한다.
//   0) DB 비우기 → 표 만들기 → 시드:  scripts/reset-local.sql → schema.sql → node scripts/make-seed.mjs → .seed.sql  (run.mjs 위쪽 설명과 같음)
//   1) wrangler dev --local --port 8787
//   2) ADMIN_PW=초기비밀번호 node test/contract.mjs      (시험 중 관리자 비밀번호를 바꾸므로 다시 돌릴 때는 시드부터 다시)
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8787';
const ADMIN_PW = process.env.ADMIN_PW;
if (!ADMIN_PW) { console.error('ADMIN_PW 환경변수에 초기 관리자 비밀번호를 넣어 주세요.'); process.exit(1); }

let pass = 0, failed = 0;
const call = async (action, data, token = '', projectId = 'P01', deviceKey = '') =>
  (await fetch(BASE, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ action, token, deviceKey, projectId: projectId || undefined, data: data || {} }) })).json();
const check = (label, cond, extra = '') => {
  if (cond) { pass++; console.log('[통과] ' + label + (extra ? ' → ' + extra : '')); }
  else { failed++; console.log('[실패] ' + label + (extra ? ' → ' + extra : '')); }
};
const expectErr = (label, res, part, code) => check(label, res.ok === false && (!part || res.error.includes(part)) && (!code || res.code === code), res.error || '(성공해 버림)');
const expectOk = (label, res) => check(label, res.ok === true, res.ok ? '' : res.error);

const uniq = String(Math.floor(Math.random() * 1e6)).padStart(6, '0');
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
let tick = 0;
const ts = () => '2026-10-22T09:' + String(Math.floor(tick / 60)).padStart(2, '0') + ':' + String(tick++ % 60).padStart(2, '0') + '.000'; // 계속 늘어나는 updatedAt
const rec = (c, id, extra) => ({ c, r: Object.assign({ id, updatedAt: ts() }, extra || {}) });
const patch = (c, id, p) => ({ c, id, p: Object.assign({ updatedAt: ts() }, p) });

try {
  // ===== 준비: 관리자, 현장 2개, 계정 4종 =====
  const first = await call('account.login', { loginId: 'admin', password: ADMIN_PW });
  expectOk('관리자 로그인', first);
  const newPw = 'AdminPw' + uniq + 'a1';
  await call('account.changePassword', { oldPassword: ADMIN_PW, newPassword: newPw }, first.data.token, null);
  const admin = first.data.token;
  const p2 = await call('project.save', { name: 'B현장' + uniq, code: 'bsite' + uniq.slice(0, 4) }, admin, null);
  expectOk('두 번째 현장 만들기', p2);
  const P1 = 'P01', P2 = p2.data.id;

  const mkAccount = async (role, projectIds, tag) => {
    const loginId = tag + uniq, pw = 'First' + uniq + 'z9';
    const saved = await call('admin.saveAccount', { loginId, name: tag + '계정', role, password: pw, active: true, projectIds }, admin, null);
    if (!saved.ok) throw new Error('계정 만들기 실패 ' + role + ': ' + saved.error);
    const lg = await call('account.login', { loginId, password: pw });
    await call('account.changePassword', { oldPassword: pw, newPassword: 'Second' + uniq + 'y8' }, lg.data.token, null);
    return lg.data.token;
  };
  const sub = await mkAccount('보조관리자', [P1], 'sub');
  const writer = await mkAccount('계약담당', [P1], 'writer');
  const viewer = await mkAccount('열람', [P1], 'viewer');
  const subB = await mkAccount('보조관리자', [P2], 'subb');
  const desk = await mkAccount('데스크', [P1], 'desk');

  const sync = (tok, changes, since = 0, pid = P1) => call('contract.sync', { since, changes }, tok, pid);

  // ===== 권한·현장 범위 =====
  expectErr('로그인 없이 동기화 거부', await sync('', []), '로그인', 'AUTH');
  expectErr('데스크 계정은 계약 동기화 불가', await sync(desk, []), '권한', 'FORBIDDEN');
  expectOk('읽기 전용(열람)도 조회 가능', await sync(viewer, []));
  expectErr('읽기 전용은 저장 불가', await sync(viewer, [rec('contracts', 'c-v1', { dongho: '101-101', status: '정상' })]), '읽기 전용', 'READONLY');
  const pollV = await call('contract.poll', {}, viewer);
  check('poll: 열람 계정의 권한은 read', pollV.ok && pollV.data.role === 'read' && typeof pollV.data.rev === 'number');
  check('poll: 계약담당은 write, 보조관리자는 admin', (await call('contract.poll', {}, writer)).data.role === 'write' && (await call('contract.poll', {}, sub)).data.role === 'admin');
  expectErr('보조관리자는 지정되지 않은 현장 접근 불가', await sync(sub, [], 0, P2), '접근할 수 없습니다', 'FORBIDDEN');
  expectErr('B현장 보조관리자는 A현장 접근 불가', await sync(subB, [], 0, P1), '접근할 수 없습니다', 'FORBIDDEN');
  expectErr('현장을 안 주면 거부', await call('contract.poll', {}, sub, null), '현장', 'NO_PROJECT');
  expectErr('열람 계정은 요약만 볼 수 있고 매칭은 불가', await call('contract.matchList', {}, viewer), '권한', 'FORBIDDEN');

  // ===== 기본 동기화 =====
  let r = await sync(writer, [rec('contracts', 'c1', { dongho: '101-101', status: '정상', name: '홍길동', team: '1팀', staff: '김영업', date: today })]);
  expectOk('계약담당 저장', r);
  const c1 = r.data.changes.find((x) => x.c === 'contracts' && x.r.id === 'c1');
  check('저장한 레코드가 응답에 돌아오고 _rv·updatedBy 가 붙음', c1 && c1.r._rv >= 1 && c1.r.updatedBy === 'writer계정', JSON.stringify(c1 && c1.r).slice(0, 120));
  check('서버 rev 가 레코드 rev 이상', r.data.rev >= c1.r._rv);
  const rev1 = r.data.rev;
  check('poll 의 rev 와 sync 의 rev 가 같음', (await call('contract.poll', {}, sub)).data.rev === rev1);
  r = await sync(sub, [], rev1);
  check('이미 아는 rev 이후에는 새 변경 없음', r.ok && r.data.changes.length === 0 && r.data.rev === rev1);

  // ===== 이중계약 / 해약 후 재계약 =====
  r = await sync(sub, [rec('contracts', 'c2', { dongho: '101-101', status: '정상', name: '다른사람' })], rev1);
  check('같은 동호 이중계약 차단 (이미 홍길동)', r.ok && r.data.rejected.length === 1 && /이미 홍길동/.test(r.data.rejected[0].msg) && r.data.rejected[0].r === null, JSON.stringify(r.data.rejected[0]).slice(0, 140));
  r = await sync(writer, [patch('contracts', 'c1', { status: '해약' })]);
  expectOk('해약 처리', r);
  r = await sync(sub, [rec('contracts', 'c2', { dongho: '101-101', status: '정상', name: '다른사람' })]);
  check('해약 후 같은 동호 재계약 허용', r.ok && !r.data.rejected.length, JSON.stringify(r.data.rejected));
  r = await sync(writer, [patch('contracts', 'c1', { status: '정상' })]);
  check('해약 건을 다시 정상으로 되돌릴 때도 이중계약 차단', r.ok && r.data.rejected.length === 1 && /이미 다른사람/.test(r.data.rejected[0].msg), JSON.stringify(r.data.rejected));
  check('거절된 건은 서버의 최신 상태(해약)가 함께 돌아옴', r.data.rejected[0].r && r.data.rejected[0].r.status === '해약');
  r = await sync(writer, [rec('contracts', 'c3', { dongho: '101-102', status: '정상', name: '가' }), rec('contracts', 'c4', { dongho: '101-102', status: '정상', name: '나' })]);
  check('한 번의 요청 안에서도 같은 동호는 하나만', r.ok && r.data.rejected.length === 1 && r.data.rejected[0].id === 'c4', JSON.stringify(r.data.rejected.map((x) => x.id)));

  // ===== 필드 단위 병합, 서버가 더 최신인 경우 =====
  await sync(writer, [rec('contracts', 'c-m', { dongho: '201-101', status: '정상', name: '병합' })]);
  const merged = await Promise.all([
    sync(writer, [patch('contracts', 'c-m', { phone: '010-1111-0000' })]),
    sync(sub, [patch('contracts', 'c-m', { addr: '서울' })])
  ]);
  check('같은 레코드의 다른 필드를 동시에 고쳐도 둘 다 반영', merged.every((x) => x.ok && !x.data.rejected.length));
  const pull = async (tok, since = 0, pid = P1) => {
    const out = new Map(); let rv = since, more = true, pages = 0;
    while (more) { const x = await sync(tok, [], rv, pid); x.data.changes.forEach((ch) => out.set(ch.c + '|' + ch.r.id, ch.r)); rv = x.data.rev; more = x.data.more; pages++; }
    return { map: out, rev: rv, pages };
  };
  const all1 = await pull(viewer);
  const cm = all1.map.get('contracts|c-m');
  check('병합 결과에 두 필드가 모두 있음', cm && cm.phone === '010-1111-0000' && cm.addr === '서울' && cm.name === '병합', JSON.stringify(cm));
  r = await sync(writer, [{ c: 'contracts', r: { id: 'c-m', dongho: '201-101', status: '정상', name: '옛날값', updatedAt: '2000-01-01T00:00:00.000' } }]);
  check('서버에 더 최신 값이 있으면 오래된 전체 레코드는 덮어쓰지 않고 서버 값을 돌려줌', r.ok && r.data.changes.some((x) => x.r.id === 'c-m' && x.r.name === '병합'), JSON.stringify(r.data.rejected));
  check('(그리고 서버의 이름은 그대로)', (await pull(viewer)).map.get('contracts|c-m').name === '병합');

  // ===== 입금내역 중복 =====
  const dep = (id, k, extra) => rec('deposits', id, Object.assign({ k, t: '2026.01.01 10.00.00', inn: 100, bal: 500 }, extra));
  r = await sync(writer, [dep('d1', '2026.01.01 10.00.00|100|0|500')]);
  expectOk('입금내역 저장', r);
  r = await sync(sub, [dep('d2', '2026.01.01 10.00.00|100|0|500')]);
  check('같은 입금내역 중복 업로드 차단', r.ok && r.data.rejected.length === 1 && /중복/.test(r.data.rejected[0].msg), JSON.stringify(r.data.rejected));
  r = await sync(sub, [dep('d3', 'kk-same'), dep('d4', 'kk-same')]);
  check('한 요청 안에서 같은 키가 두 번 와도 하나만', r.ok && r.data.rejected.length === 1 && r.data.rejected[0].id === 'd4', JSON.stringify(r.data.rejected.map((x) => x.id)));
  r = await sync(sub, [patch('deposits', 'd1', { cat: '계약금 1차', dongho: '101-101' })]);
  check('이미 있는 입금내역을 분류(수정)하는 것은 허용', r.ok && !r.data.rejected.length);
  const racedDeps = await Promise.all([sync(writer, [dep('d5', 'race-key')]), sync(sub, [dep('d6', 'race-key')])]);
  check('동시에 같은 입금내역을 올려도 하나만 저장', racedDeps.reduce((n, x) => n + x.data.rejected.length, 0) === 1, JSON.stringify(racedDeps.map((x) => x.data.rejected.length)));
  const racedCon = await Promise.all([
    sync(writer, [rec('contracts', 'rc1', { dongho: '305-101', status: '정상', name: '동시1' })]),
    sync(sub, [rec('contracts', 'rc2', { dongho: '305-101', status: '정상', name: '동시2' })])
  ]);
  check('두 사람이 동시에 같은 동호를 계약해도 하나만 성공', racedCon.reduce((n, x) => n + x.data.rejected.length, 0) === 1, JSON.stringify(racedCon.map((x) => x.data.rejected.length)));
  const racedPatches = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((f, i) => sync(i % 2 ? writer : sub, [patch('contracts', 'c-m', { ['f_' + f]: f })])));
  check('같은 레코드를 다섯 명이 동시에 고쳐도 모두 반영', racedPatches.every((x) => x.ok && !x.data.rejected.length) && (() => { return true; })());
  const cm2 = (await pull(viewer)).map.get('contracts|c-m');
  check('다섯 필드가 모두 남아 있음', ['a', 'b', 'c', 'd', 'e'].every((f) => cm2['f_' + f] === f), JSON.stringify(cm2).slice(0, 160));

  // ===== 입력 검사·크기 =====
  const tooMany = []; for (let i = 0; i < 1001; i++) tooMany.push(rec('notes', 'n' + i, {}));
  expectErr('한 번에 1000건을 넘기면 거부', await sync(writer, tooMany), '너무 많습니다');
  r = await sync(writer, [rec('bogus', 'x1', {}), { c: 'notes', id: '' }, rec('notes', 'n-ok', { text: '정상' }), { c: 'notes', r: 'string' }]);
  check('모르는 컬렉션·빈 id·형식 오류는 조용히 무시, 정상 건은 저장', r.ok && r.data.changes.some((x) => x.r.id === 'n-ok') && !r.data.changes.some((x) => x.r.id === 'x1'));
  r = await sync(writer, [rec('notes', 'big1', { text: 'x'.repeat(310000) })]);
  check('레코드 하나가 너무 크면 그 건만 거절', r.ok && r.data.rejected.length === 1 && /너무 큽니다/.test(r.data.rejected[0].msg));
  const huge = await call('contract.sync', { since: 0, changes: [rec('notes', 'huge', { text: 'y'.repeat(3100000) })] }, writer);
  expectErr('요청 전체가 3MB 를 넘으면 거부', huge, '너무 큽니다');
  expectErr('계약 외 action 은 200KB 넘으면 거부', await call('project.list', { pad: 'z'.repeat(250000) }, admin, null), '너무 큽니다');

  // ===== 대량 업로드와 분할 수신 (양주역 첫 업로드 규모) =====
  const t0 = Date.now();
  const bulk = []; for (let i = 0; i < 2300; i++) bulk.push(rec('units', 'U' + String(i).padStart(4, '0'), { dong: '1' + (i % 9), ho: i, type: 'A', price: 1000 * i, amounts: { '계약금 1차': 100 } }));
  let bulkRejected = 0, bulkRev = 0;
  for (let i = 0; i < bulk.length; i += 300) {
    const x = await sync(writer, bulk.slice(i, i + 300), bulkRev);
    if (!x.ok) throw new Error('대량 업로드 실패: ' + x.error);
    bulkRejected += x.data.rejected.length;
  }
  const upMs = Date.now() - t0;
  check('2300건을 300건씩 올려도 모두 반영 (' + upMs + 'ms)', bulkRejected === 0);
  const t1 = Date.now();
  const full = await pull(viewer);
  const units = [...full.map.keys()].filter((k) => k.startsWith('units|')).length;
  check('처음부터 받으면 여러 번에 나눠서 전부 받음 (' + (Date.now() - t1) + 'ms)', units === 2300 && full.pages >= 2, '레코드 ' + full.map.size + '건, ' + full.pages + '번');
  const revs = [...full.map.values()].map((x) => x._rv);
  check('모든 레코드에 서로 다른 _rv 가 있음', new Set(revs).size === revs.length && revs.every((v) => v > 0));
  check('받은 최종 rev 가 서버 rev 와 같음', full.rev === (await call('contract.poll', {}, viewer)).data.rev);

  // ===== 현장 격리 =====
  await sync(subB, [rec('contracts', 'c1', { dongho: '101-101', status: '정상', name: 'B현장고객' })], 0, P2);
  const pB = await pull(subB, 0, P2);
  check('B현장에서는 A현장 레코드가 보이지 않음', pB.map.size === 1 && pB.map.get('contracts|c1').name === 'B현장고객', String(pB.map.size));
  check('같은 id(c1)와 같은 동호(101-101)도 현장마다 따로', (await pull(viewer)).map.get('contracts|c1').name === '홍길동');
  check('B현장 rev 는 A현장과 따로 올라감', (await call('contract.poll', {}, subB, P2)).data.rev === 1);

  // ===== 담당자 매칭 =====
  const mkStaff = async (name, nick, i) => {
    const phone = '010' + String(70000000 + Number(uniq) % 1000000 + i).padStart(8, '0');
    const dev = 'dev-match-' + uniq + '-' + i + '-xxxx';
    const sg = await call('staff.signup', { projectCode: 'site1', name, nickname: nick, phone, pin: '1234', job: '상담사', rrn: '000101-3000000', bank: '국민', accountNo: '000-000-000000', holder: name, consent: true }, '', P1, dev);
    if (!sg.ok) throw new Error('직원 가입 실패: ' + sg.error);
    const sid = (await call('admin.staffList', {}, admin, P1)).data.staff.find((x) => x.phone === phone).id;
    await call('admin.approve', { staffId: sid }, admin, P1);
    return sid;
  };
  const sKim = await mkStaff('김영업', '영업이', 1);
  const sLee = await mkStaff('이영업', '', 2);
  const sl = await call('contract.staffList', {}, viewer);
  check('담당자 후보 목록: 열람 계정도 조회, 연락처는 없음', sl.ok && sl.data.staff.some((x) => x.id === sKim) && sl.data.staff.every((x) => !('phone' in x)));
  expectErr('담당자 후보 목록: 데스크 계정은 불가', await call('contract.staffList', {}, desk), '권한', 'FORBIDDEN');
  check('담당자 후보 목록: 다른 현장 직원은 없음', (await call('contract.staffList', {}, subB, P2)).data.staff.length === 0);
  await sync(writer, [
    rec('contracts', 'm1', { dongho: '401-101', status: '정상', name: 'a', team: '9팀', staff: '김영업' }),
    rec('contracts', 'm2', { dongho: '401-102', status: '정상', name: 'b', team: '9팀', staff: '김영업' }),
    rec('contracts', 'm3', { dongho: '401-103', status: '정상', name: 'c', team: '8팀', staff: '영업이' }),
    rec('contracts', 'm4', { dongho: '401-104', status: '정상', name: 'd', team: '', staff: '박모름' })
  ]);
  const ml = await call('contract.matchList', {}, sub);
  expectOk('담당자 매칭 목록', ml);
  const grp = (team, staff) => ml.data.groups.find((g) => g.team === team && g.staff === staff);
  check('(팀, 담당자) 글자별로 묶임', grp('9팀', '김영업') && grp('9팀', '김영업').total === 2 && grp('8팀', '영업이').total === 1);
  check('이름이 같은 직원을 추천', grp('9팀', '김영업').suggestions.some((x) => x.id === sKim));
  check('예명이 같은 직원도 추천', grp('8팀', '영업이').suggestions.some((x) => x.id === sKim));
  check('이름이 없거나 모르는 담당자는 추천 없음', grp('', '박모름').suggestions.length === 0);
  expectErr('다른 현장 직원으로는 연결 불가', await call('contract.matchSave', { team: '9팀', staff: '김영업', staffId: 'S-NOPE' }, sub), '직원이 아닙니다');
  expectErr('계약담당은 매칭 불가', await call('contract.matchSave', { team: '9팀', staff: '김영업', staffId: sKim }, writer), '권한', 'FORBIDDEN');
  const before = (await pull(writer)).rev;
  const ms = await call('contract.matchSave', { team: '9팀', staff: '김영업', staffId: sKim }, sub);
  check('같은 글자의 계약 2건에 한꺼번에 연결', ms.ok && ms.data.updated === 2, JSON.stringify(ms.data));
  const afterMap = (await pull(writer, before)).map;
  check('연결된 계약이 다른 PC(계약담당)에게 변경분으로 전달됨', afterMap.get('contracts|m1').staffId === sKim && afterMap.get('contracts|m2').staffId === sKim && /통합관리/.test(afterMap.get('contracts|m1').updatedBy));
  check('다른 글자의 계약은 그대로', !(await pull(writer)).map.get('contracts|m3').staffId);
  const ms2 = await call('contract.matchSave', { team: '9팀', staff: '김영업', staffId: sKim }, sub);
  check('같은 값으로 다시 저장하면 바뀐 건 없음', ms2.ok && ms2.data.updated === 0 && ms2.data.skipped === 2);
  const ml2 = await call('contract.matchList', {}, sub);
  check('목록에 연결 건수 표시', ml2.data.groups.find((g) => g.team === '9팀' && g.staff === '김영업').linked === 2 && ml2.data.linked === 2);
  const ms3 = await call('contract.matchSave', { team: '9팀', staff: '김영업', staffId: sLee }, sub);
  check('다른 직원으로 바꿔 연결할 수 있음 (담당자는 한 명)', ms3.ok && ms3.data.updated === 2 && (await pull(writer)).map.get('contracts|m1').staffId === sLee);
  const ms4 = await call('contract.matchSave', { team: '9팀', staff: '김영업', staffId: '' }, sub);
  check('연결 해제', ms4.ok && ms4.data.updated === 2 && !(await pull(writer)).map.get('contracts|m1').staffId);
  expectErr('B현장 보조관리자는 A현장 매칭 불가', await call('contract.matchList', {}, subB, P1), '접근할 수 없습니다', 'FORBIDDEN');

  // ===== 현황 요약 (계약앱 대시보드와 같은 계산) =====
  const S = (tok, changes) => sync(tok, changes, 0, P2);
  await call('contract.wipe', {}, subB, P2); // 앞의 현장 격리 시험 데이터(B현장 계약 1건)를 비우고 시작
  const stampOld = '2026.01.01 10.00.00', stampToday = today.replace(/-/g, '.') + ' 09.00.00';
  r = await S(subB, [
    rec('units', '101-101', { type: 'A', amounts: { '계약금 1차': 1000, '중도금 1차': 2000 } }),
    rec('units', '101-102', { type: 'A', amounts: { '계약금 1차': 1000, '중도금 1차': 2000 } }),
    rec('units', '102-101', { type: 'B', amounts: { '계약금 1차': 1000, '중도금 1차': 2000 } }),
    rec('units', '102-102', { type: 'B', amounts: { '계약금 1차': 1000, '중도금 1차': 2000 } }),
    rec('contracts', 'sc1', { dongho: '101-101', status: '정상', name: '가', date: today }),
    rec('contracts', 'sc2', { dongho: '101-102', status: '정상', name: '나', date: '2026-01-01' }),
    rec('contracts', 'sc3', { dongho: '102-101', status: '해약', name: '다' }),
    rec('pre', 'sp1', { dongho: '102-101', status: '진행', name: '라' }),
    rec('locks', 'sl1', { dongho: '102-102', status: '잠금' }),
    rec('settings', 'main', { project: { name: 'B현장', moneyLabel: '분양대금' }, stages: ['계약금 1차', '중도금 1차'], stageDue: { '중도금 1차': '2000-01-01' } }),
    rec('deposits', 'sd1', { k: 'k1', t: stampOld, dongho: '101-101', cat: '계약금 1차', inn: 1000, out: 0 }),
    rec('deposits', 'sd2', { k: 'k2', t: stampOld, dongho: '101-102', cat: '계약금 1차', inn: 400, out: 0 }),
    rec('deposits', 'sd3', { k: 'k3', t: stampToday, inn: 50, out: 0 }),
    rec('deposits', 'sd4', { k: 'k4', t: stampOld, dongho: '101-101', cat: '환불', inn: 0, out: 100 })
  ]);
  check('요약용 시험 데이터 저장 (거절 없음)', r.ok && r.data.rejected.length === 0, JSON.stringify(r.data && r.data.rejected));
  const sm = await call('contract.summary', {}, viewer.replace(/^/, ''), P2);
  expectErr('열람 계정(A현장만 허용)은 B현장 요약 불가', sm, '접근할 수 없습니다', 'FORBIDDEN');
  const sum = await call('contract.summary', {}, subB, P2);
  expectOk('요약 조회', sum);
  const d = sum.data;
  check('세대 4, 계약 2, 가계약 1, 잠금 1, 잔여 0', d.units === 4 && d.contract === 2 && d.pre === 1 && d.lock === 1 && d.remain === 0 && d.resv === 0, JSON.stringify([d.units, d.contract, d.pre, d.lock, d.remain]));
  check('분양률 50%, 가계약 포함 75%, 오늘 계약 1건', d.contractRate === 50 && d.withPreRate === 75 && d.todayContracts === 1, JSON.stringify([d.contractRate, d.withPreRate, d.todayContracts, today]));
  check('총 수납액 1400 (회차에 없는 환불 구분은 제외), 미분류 1건, 오늘 입금 1건 50원', d.totalIn === 1400 && d.unclassified === 1 && d.todayDeposits === 1 && d.todayDepositAmount === 50, JSON.stringify([d.totalIn, d.unclassified, d.todayDeposits, d.todayDepositAmount]));
  check('첫 회차(계약금 1차): 완납 1, 미완납 1', d.firstStage && d.firstStage.stage === '계약금 1차' && d.firstStage.done === 1 && d.firstStage.notDone === 1);
  const st1 = d.stages[0], st2 = d.stages[1];
  check('계약금 1차: 대상 2, 완납 1, 일부납 1, 약정 2000, 수납 1400', st1.targets === 2 && st1.done === 1 && st1.part === 1 && st1.none === 0 && st1.req === 2000 && st1.paid === 1400 && st1.active, JSON.stringify(st1));
  check('중도금 1차: 기한이 지나 활성, 미납 2, 약정 4000, 수납 0', st2.active && st2.none === 2 && st2.req === 4000 && st2.paid === 0 && st2.due === '2000-01-01', JSON.stringify(st2));
  const tA = d.types.find((x) => x.type === 'A'), tB = d.types.find((x) => x.type === 'B');
  check('타입별: A 공급 2 계약 2 / B 공급 2 가계약 1 잠금 1', tA.supply === 2 && tA.contract === 2 && tB.supply === 2 && tB.pre === 1 && tB.lock === 1 && tB.contract === 0);
  check('금액 명칭은 현장 설정을 따름', d.moneyLabel === '분양대금');
  const wB = await call('contract.wipe', {}, writer);
  expectErr('계약담당은 서버 데이터 초기화 불가', wB, '권한', 'FORBIDDEN');

  // ===== 초기화(wipe) =====
  const beforeWipe = await pull(subB, 0, P2);
  const wp = await call('contract.wipe', {}, subB, P2);
  const liveBefore = [...beforeWipe.map.values()].filter((x) => !x.deleted).length;
  check('초기화: 살아 있는 레코드를 모두 삭제 표시', wp.ok && wp.data.wiped === liveBefore && liveBefore > 10, JSON.stringify(wp.data) + ' / 살아있던 ' + liveBefore);
  const afterWipe = await pull(subB, beforeWipe.rev, P2);
  check('삭제 사실이 변경분으로 전파됨 (deleted=true, 새 _rv)', afterWipe.map.size === liveBefore && [...afterWipe.map.values()].every((x) => x.deleted === true && x._rv > beforeWipe.rev));
  r = await S(subB, [rec('contracts', 'sc9', { dongho: '101-101', status: '정상', name: '새고객' })]);
  check('초기화 뒤에는 같은 동호·입금키를 다시 쓸 수 있음', r.ok && !r.data.rejected.length);
  r = await S(subB, [rec('deposits', 'sd9', { k: 'k1', t: stampOld, inn: 1 })]);
  check('(입금내역 키도 다시 사용 가능)', r.ok && !r.data.rejected.length);
  check('초기화 후 요약은 새 데이터만 집계', (await call('contract.summary', {}, subB, P2)).data.contract === 0 && (await call('contract.summary', {}, subB, P2)).data.units === 0);
  check('다른 현장(A)의 데이터는 그대로', (await pull(viewer)).map.get('contracts|c-m').name === '병합');
  const logs = await call('admin.accounts', {}, admin, null);
  check('(참고) 계정 목록 조회 정상', logs.ok);
} catch (e) {
  failed++;
  console.log('[실패] 시험 중 예외: ' + (e && e.stack ? e.stack : e));
}
console.log(failed ? '=== 실패 ' + failed + '건 (통과 ' + pass + '건) ===' : '=== 전체 통과 (' + pass + '건) ===');
process.exit(failed ? 1 : 0);
