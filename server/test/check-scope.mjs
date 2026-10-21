// 현장 범위 점검: 현장(project_id)이 있는 표를 읽거나 바꾸는 SQL 에 project_id 조건이 빠졌는지 소스를 훑어 찾는다.
//   node test/check-scope.mjs      (서버를 띄우지 않아도 된다)
// 빠진 곳이 "일부러 현장과 무관하게" 다루는 것이면 아래 EXEMPT 에 이유와 함께 적는다. 이유 없는 예외는 넣지 않는다.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const SCOPED = ['staff', 'orgs', 'qr_issues', 'attendance', 'reservations', 'visits', 'guestbook', 'attendance_adjust', 'staff_pay', 'pay_runs', 'pay_items'];

// [파일 조각, SQL 조각, 이유]
const EXEMPT = [
  ['core/staff.js', "UPDATE staff SET fail_count", 'PIN 실패 횟수: 이미 찾은 본인 행(id)만 바꾼다'],
  ['core/staff.js', "FROM staff WHERE phone = ?", '휴대폰 번호는 사람 한 명당 한 행이라 현장과 무관하게 찾는다 (로그인·가입·기기변경)'],
  ['core/staff.js', "UPDATE staff SET device_change_request", '이미 로그인 확인된 본인 행(id)만 바꾼다'],
  ['core/people.js', "FROM staff WHERE phone = ? AND id <> ?", '휴대폰 번호는 전체에서 유일해야 하므로 현장과 무관하게 중복을 확인한다'],
  ['core/auth.js', "FROM staff WHERE id = ?", '세션의 직원 확인: 직원이 어느 현장 소속인지 알아내는 첫 단계'],
  ['telegram/telegram.js', "UPDATE staff SET telegram_link_code", '이미 로그인된 본인 행(id)만 바꾼다'],
  ['telegram/telegram.js', "FROM staff WHERE telegram_link_code", '텔레그램 웹훅: 일회용 연결 코드로 본인을 찾는다 (현장 미정)'],
  ['telegram/telegram.js', "FROM staff WHERE telegram_id", '텔레그램 계정 하나는 한 사람에게만 연결된다 (전체에서 유일)'],
  ['telegram/telegram.js', "UPDATE staff SET telegram_id", '찾은 본인 행(id)만 바꾼다'],
  ['telegram/telegram.js', "FROM visits WHERE id = ?", '텔레그램 [확인] 버튼: 호출받은 본인의 텔레그램인지로 확인한다 (웹훅은 현장 미정)'],
  ['telegram/telegram.js', "FROM staff WHERE id = ?", '위 방문 기록의 담당 직원 확인'],
  ['telegram/telegram.js', "UPDATE visits SET acked_at", '위에서 본인 확인이 끝난 방문 기록만 바꾼다'],
  ['visit/visit.js', "SELECT id, name FROM staff WHERE id IN", '다른 현장으로 이동한 직원의 이름만 읽는다 (지난 예약·방문 기록의 담당자 표시용, 전화번호 등은 읽지 않음)'],
  ['attendance/attendance.js', "SELECT id, name FROM staff WHERE id IN", '다른 현장으로 이동한 직원의 이름만 읽는다 (이 현장에서 일한 기록의 직원 표시용)'],
  ['pay/runs.js', "SELECT id, name FROM staff WHERE id IN", '다른 현장으로 이동한 직원도 이 현장 정산 대상이라 이름만 읽는다'],
  ['core/leader.js', "${sc.where}", '조건 문자열 scopeOf() 가 project_id 를 항상 포함해 만든다 (팀장·본부장 시험으로 확인)'],
  ['visit/visit.js', "${conds.join(' AND ')}", '조건 배열 conds 의 첫 항목이 s.project_id = ? 이다 (데스크 직원 검색 시험으로 확인)']
];
const used = new Set();

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
  });
}

// 따옴표·백틱 문자열 중 SQL 처럼 보이는 것을 뽑는다
const STRING = /`(?:[^`\\]|\\.)*`|'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g;
const TABLE_USE = new RegExp(`\\b(?:FROM|JOIN|UPDATE|INTO)\\s+(${SCOPED.join('|')})\\b`, 'gi');

let bad = 0;
for (const file of walk(src)) {
  const rel = relative(src, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(STRING)) {
    const lit = m[0];
    if (!/\b(SELECT|UPDATE|DELETE|INSERT)\b/i.test(lit)) continue;
    const tables = [...lit.matchAll(TABLE_USE)].map((x) => x[1]);
    if (!tables.length || /project_id/.test(lit)) continue;
    const hit = EXEMPT.findIndex(([f, snippet]) => rel === f && lit.includes(snippet));
    if (hit >= 0) { used.add(hit); continue; }
    bad++;
    const line = text.slice(0, m.index).split('\n').length;
    console.log(`[누락] ${rel}:${line}  표 ${[...new Set(tables)].join(', ')} → ${lit.replace(/\s+/g, ' ').slice(0, 110)}`);
  }
}
EXEMPT.forEach((e, i) => { if (!used.has(i)) console.log('[참고] 쓰이지 않는 예외(지워도 됨): ' + e[0] + ' / ' + e[1]); });
console.log(bad ? `=== project_id 조건이 없는 SQL ${bad}건 ===` : '=== 현장 범위 점검 통과 ===');
process.exit(bad ? 1 : 0);
