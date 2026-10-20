// 초기 데이터(첫 현장·조직)와 관리자 계정을 만드는 SQL 을 .seed.sql 로 쓴다.
//   node scripts/make-seed.mjs            → 첫 현장(P01)·조직 기본값 + admin 계정(새 임시 비밀번호)
// 비밀 값(SALT, PAYROLL_KEY, TELEGRAM_SECRET)은 .dev.vars 에 한 번 만들어 두고 계속 같은 값을 쓴다.
// .dev.vars 와 .seed.sql 은 git 에 올라가지 않는다 (.gitignore).
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const varsPath = join(root, '.dev.vars');

function readVars() {
  const vars = {};
  if (existsSync(varsPath)) {
    readFileSync(varsPath, 'utf8').split(/\r?\n/).forEach((line) => {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m) vars[m[1]] = m[2];
    });
  }
  return vars;
}

const vars = readVars();
let created = false;
if (!vars.SALT) { vars.SALT = randomBytes(32).toString('hex'); created = true; }
if (!vars.PAYROLL_KEY) { vars.PAYROLL_KEY = randomBytes(32).toString('base64'); created = true; }
if (!vars.TELEGRAM_SECRET) { vars.TELEGRAM_SECRET = randomBytes(16).toString('hex'); created = true; }
if (created) {
  const keep = Object.keys(vars).map((k) => k + '=' + vars[k]).join('\n') + '\n';
  writeFileSync(varsPath, keep);
  console.log('.dev.vars 에 비밀 값을 새로 만들었습니다. 이 파일을 잃어버리면 기존 비밀번호·급여정보를 복구할 수 없으니 안전한 곳에 백업하세요.');
}

const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
const sha256 = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

// 비밀번호: 영문 8 + 숫자 2 (헷갈리는 글자 제외)
const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
const digits = '23456789';
let password = '';
for (let i = 0; i < 8; i++) password += letters[randomInt(letters.length)];
for (let i = 0; i < 2; i++) password += digits[randomInt(digits.length)];

const sql = [];
sql.push(`INSERT OR IGNORE INTO settings (key, value, description) VALUES ('텔레그램봇이름', '', '@ 없이 봇 사용자명 (예: my_site_bot). 모든 현장이 같은 봇을 쓴다');`);

// 첫 현장 하나와 예시 조직. 현장 이름·코드는 관리자 화면(통합관리 > 프로젝트)에서 고치거나 새 현장을 추가하면 된다.
// 이미 운영 중인 DB 에는 쓰지 않는다 (그쪽은 migrations/005_projects.sql 이 첫 현장 P01 을 만든다)
const PID = 'P01';
sql.push(`INSERT OR IGNORE INTO projects (id, code, name, status, created_at) VALUES ('${PID}', 'site1', '기본 현장', '진행', datetime('now', '+9 hours'));`);
[['GPS허용거리m', '200'], ['예약중복기준', '뒤5자리']].forEach(([k, v]) =>
  sql.push(`INSERT OR IGNORE INTO project_settings (project_id, key, value) VALUES ('${PID}', ${q(k)}, ${q(v)});`));
const orgSql = (id, kind, name, parent, order) =>
  `INSERT OR IGNORE INTO orgs (id, project_id, kind, name, parent_id, sort_order, active) VALUES ('${id}', '${PID}', '${kind}', ${q(name)}, '${parent}', ${order}, 1);`;
['영업', '홍보단', '상담사', '도우미', '아르바이트'].forEach((name, i) => sql.push(orgSql('OJ0' + (i + 1), '직군', name, '', i + 1)));
['1본부', '2본부'].forEach((name, i) => {
  sql.push(orgSql('OH0' + (i + 1), '본부', name, '', i + 1));
  ['1팀', '2팀'].forEach((team, j) => sql.push(orgSql('OT0' + (i + 1) + (j + 1), '팀', team, 'OH0' + (i + 1), j + 1)));
});

// 관리자 계정: 이미 있으면 비밀번호만 새로 정하고(잠김 해제) 첫 로그인 때 바꾸게 한다
sql.push(`INSERT INTO accounts (id, login_id, password_hash, role, name, fail_count, active, must_change_password)
VALUES ('A-ADMIN', 'admin', ${q(sha256(vars.SALT + password))}, '관리자', '관리자', 0, 1, 1)
ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash, fail_count = 0, active = 1, must_change_password = 1;`);
sql.push(`DELETE FROM sessions WHERE kind = 'account' AND user_id = 'A-ADMIN';`);

writeFileSync(join(root, '.seed.sql'), sql.join('\n') + '\n');
console.log('관리자 아이디: admin');
console.log('초기 비밀번호: ' + password + '   (첫 로그인 때 바꾸게 됩니다)');
