// 서버(Code.gs) API 테스트: 모의 서버(node tools/mockgas.js) 실행 후  node tools/test_server.js
const U = 'http://localhost:8765/exec'; let fails = 0;
const call = async b => (await fetch(U, { method: 'POST', body: JSON.stringify(b) })).json();
const ok = (c, m, x) => { if (!c) { fails++; console.log('FAIL', m, x ? JSON.stringify(x).slice(0, 200) : ''); } else console.log('ok  ', m); };
(async () => {
  const pk = 'pt' + Date.now().toString(36);
  let r = await call({ op: 'status' }); ok(r.ok && r.hasUsers === false, '초기: 사용자 없음', r);
  r = await call({ op: 'newProject', token: 'test123', pk, name: '테스트' }); ok(r.ok, '레거시 토큰으로 시트 생성', r);
  r = await call({ op: 'setupAdmin', token: 'bad', id: 'boss', pw: '123456' }); ok(!r.ok, '잘못된 서버키로 관리자 생성 거부');
  r = await call({ op: 'setupAdmin', token: 'test123', id: 'boss', name: '상무', pw: '123456' }); ok(r.ok && r.role === 'admin' && r.st, '관리자 생성', r);
  const A = r.st;
  r = await call({ op: 'sync', token: 'test123', pk, since: 0, changes: [] }); ok(!r.ok && r.code === 'AUTH', '사용자 생성 후 토큰만으로는 거부', r);
  r = await call({ op: 'setupAdmin', token: 'test123', id: 'x1234', pw: '123456' }); ok(!r.ok, '관리자 중복 생성 거부');
  r = await call({ op: 'signup', id: 'kim', name: '김직원', pw: '123456' }); ok(r.ok && r.pending, '가입 신청(승인대기)');
  r = await call({ op: 'login', id: 'kim', pw: '123456' }); ok(!r.ok && r.code === 'PENDING', '승인 전 로그인 거부', r);
  r = await call({ op: 'userSet', st: A, uid: 'kim', role: 'write', status: 'active' }); ok(r.ok, '관리자가 승인(쓰기)');
  r = await call({ op: 'signup', id: 'lee', name: '이열람', pw: '123456' }); await call({ op: 'userSet', st: A, uid: 'lee', role: 'read', status: 'active' });
  const W = (await call({ op: 'login', id: 'kim', pw: '123456' })).st, R = (await call({ op: 'login', id: 'lee', pw: '123456' })).st;
  ok(W && R, '쓰기/읽기 로그인');
  r = await call({ op: 'login', id: 'kim', pw: 'wrong1' }); ok(!r.ok, '비밀번호 오류 거부');
  r = await call({ op: 'users', st: W }); ok(!r.ok && r.code === 'FORBIDDEN', '일반 사용자는 사용자관리 불가');
  r = await call({ op: 'userSet', st: A, uid: 'boss', role: 'read' }); ok(!r.ok, '마지막 관리자 강등 불가', r);
  r = await call({ op: 'newProject', st: W, pk: 'zz', name: 'x' }); ok(!r.ok, '쓰기 사용자는 시트 생성 불가');
  const ch = (id, f) => ({ c: 'contracts', r: Object.assign({ id, dongho: '101-101', status: '정상', name: '홍길동', updatedAt: '2026-01-01T00:00:00' }, f || {}) });
  r = await call({ op: 'sync', st: R, pk, since: 0, changes: [ch('c1')] }); ok(!r.ok && r.code === 'READONLY', '읽기 전용은 저장 불가', r);
  r = await call({ op: 'sync', st: R, pk, since: 0, changes: [] }); ok(r.ok, '읽기 전용도 조회 가능');
  r = await call({ op: 'sync', st: W, pk, since: 0, changes: [ch('c1')] }); ok(r.ok && !r.rejected.length && r.changes.some(x => x.r.id === 'c1' && x.r._rv && x.r.updatedBy === '김직원'), '쓰기 사용자 저장', r);
  // 동시 계약(같은 동호) 차단
  r = await call({ op: 'sync', st: A, pk, since: 0, changes: [ch('c2', { name: '다른사람' })] }); ok(r.ok && r.rejected.length === 1 && /이미 홍길동/.test(r.rejected[0].msg), '같은 동호 이중계약 차단', r.rejected);
  // 해약 후엔 가능
  await call({ op: 'sync', st: W, pk, since: 0, changes: [{ c: 'contracts', id: 'c1', p: { status: '해약', updatedAt: '2026-01-02T00:00:00' } }] });
  r = await call({ op: 'sync', st: A, pk, since: 0, changes: [ch('c2', { name: '다른사람' })] }); ok(r.ok && !r.rejected.length, '해약 후 재계약 허용', r.rejected);
  // 필드 단위 병합: 두 사용자가 같은 레코드의 다른 필드를 동시에 수정
  await call({ op: 'sync', st: W, pk, since: 0, changes: [{ c: 'contracts', id: 'c2', p: { phone: '010-1111', updatedAt: '2026-01-03T00:00:01' } }] });
  r = await call({ op: 'sync', st: A, pk, since: 0, changes: [{ c: 'contracts', id: 'c2', p: { addr: '서울', updatedAt: '2026-01-03T00:00:00' } }] });
  const m = r.changes.find(x => x.r.id === 'c2').r; ok(m.phone === '010-1111' && m.addr === '서울' && m.name === '다른사람', '필드 병합(둘 다 반영)', m);
  // 입금내역 중복
  const dep = (id) => ({ c: 'deposits', r: { id, k: '2026.01.01 10.00.00|100|0|500', t: '2026.01.01 10.00.00', inn: 100, updatedAt: '2026-01-04' } });
  await call({ op: 'sync', st: W, pk, since: 0, changes: [dep('d1')] });
  r = await call({ op: 'sync', st: A, pk, since: 0, changes: [dep('d2')] }); ok(r.rejected.length === 1 && /중복/.test(r.rejected[0].msg), '입금내역 중복 업로드 차단', r.rejected);
  // poll
  const rev = (await call({ op: 'poll', st: R, pk })).rev; ok(rev > 0, 'poll rev', rev);
  r = await call({ op: 'poll', st: 'garbage', pk }); ok(!r.ok && r.code === 'AUTH', '잘못된 세션 poll 거부');
  // 비밀번호 변경 / 사용 중지
  r = await call({ op: 'changePw', st: W, old: '123456', pw: 'abcdef' }); ok(r.ok, '비밀번호 변경');
  r = await call({ op: 'login', id: 'kim', pw: 'abcdef' }); ok(r.ok, '새 비밀번호 로그인');
  await call({ op: 'userSet', st: A, uid: 'kim', status: 'disabled' });
  r = await call({ op: 'sync', st: W, pk, since: 0, changes: [] }); ok(!r.ok && r.code === 'AUTH', '사용중지 즉시 차단', r);
  r = await call({ op: 'recoverAdmin', token: 'test123', id: 'boss', pw: 'newpass1' }); ok(r.ok && (await call({ op: 'login', id: 'boss', pw: 'newpass1' })).ok, '서버키로 관리자 비밀번호 복구');
  console.log(fails ? 'FAILED ' + fails : 'ALL OK'); process.exit(fails ? 1 : 0);
})();
