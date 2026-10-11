-- D1 데이터베이스 구조. 여러 번 실행해도 안전하다 (IF NOT EXISTS).
-- 이미 운영 중인 DB 는 migrations/ 폴더의 파일을 번호 순서대로 한 번씩 실행한다 (새로 만들 때는 이 파일만 실행하면 된다).
-- 날짜·시각은 Asia/Seoul 기준 문자열: 날짜 'YYYY-MM-DD', 일시 'YYYY-MM-DD HH:MM:SS'.
-- 상태·구분 값(대기/활동/예정/방문 …)은 화면과 같은 한국어 그대로 저장한다.

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT ''
);

-- 본부 / 팀(parent_id = 본부) / 직군
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  nickname TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  job TEXT NOT NULL,
  head_id TEXT NOT NULL DEFAULT '',
  team_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  reject_reason TEXT NOT NULL DEFAULT '',
  pin_hash TEXT NOT NULL,
  fail_count INTEGER NOT NULL DEFAULT 0,
  device_key TEXT NOT NULL DEFAULT '',
  device_change_request TEXT NOT NULL DEFAULT '',
  telegram_id TEXT NOT NULL DEFAULT '',
  telegram_link_code TEXT NOT NULL DEFAULT '',
  telegram_link_issued_at INTEGER NOT NULL DEFAULT 0,
  joined_at TEXT NOT NULL,
  approved_at TEXT NOT NULL DEFAULT '',
  grade TEXT NOT NULL DEFAULT '직원',
  can_approve INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_phone ON staff(phone);
CREATE INDEX IF NOT EXISTS ix_staff_device ON staff(device_key);
CREATE INDEX IF NOT EXISTS ix_staff_device_req ON staff(device_change_request);
CREATE INDEX IF NOT EXISTS ix_staff_telegram ON staff(telegram_id);
CREATE INDEX IF NOT EXISTS ix_staff_status ON staff(status);
CREATE INDEX IF NOT EXISTS ix_staff_org ON staff(head_id, team_id);

-- 주민번호·계좌번호는 암호화(AES-GCM)해서 저장한다. 관리자 action 에서만 읽는다.
CREATE TABLE IF NOT EXISTS payroll (
  staff_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rrn_enc TEXT NOT NULL,
  bank TEXT NOT NULL,
  account_enc TEXT NOT NULL,
  holder TEXT NOT NULL,
  consent_at TEXT NOT NULL
);

-- 관리자·데스크 계정
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  login_id TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  fail_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_login ON accounts(login_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(kind, user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS qr_issues (
  date TEXT PRIMARY KEY,
  qr TEXT NOT NULL,
  base_lat REAL NOT NULL,
  base_lng REAL NOT NULL,
  accuracy_m INTEGER NOT NULL DEFAULT 0,
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  time TEXT NOT NULL,
  lat REAL,
  lng REAL,
  accuracy_m INTEGER NOT NULL DEFAULT 0,
  distance_m INTEGER,
  device_key TEXT NOT NULL DEFAULT '',
  result TEXT NOT NULL,
  fail_reason TEXT NOT NULL DEFAULT ''
);
-- 같은 날 한 직원 / 한 휴대폰은 성공 기록이 하나만 (동시에 눌러도 DB 가 막아 준다)
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_ok_staff ON attendance(date, staff_id) WHERE result = '성공';
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_ok_device ON attendance(date, device_key) WHERE result = '성공';
CREATE INDEX IF NOT EXISTS ix_att_date ON attendance(date);
CREATE INDEX IF NOT EXISTS ix_att_staff ON attendance(staff_id, date);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  last5 TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT '',
  visit_date TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_res_last5 ON reservations(last5, status);
CREATE INDEX IF NOT EXISTS ix_res_staff ON reservations(staff_id, status);
CREATE INDEX IF NOT EXISTS ix_res_date ON reservations(visit_date);

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  visited_at TEXT NOT NULL,
  last5 TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT '',
  reservation_id TEXT NOT NULL DEFAULT '',
  staff_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  called_at TEXT NOT NULL DEFAULT '',
  acked_at TEXT NOT NULL DEFAULT '',
  desk_account_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_visits_at ON visits(visited_at);
CREATE INDEX IF NOT EXISTS ix_visits_staff ON visits(staff_id);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT ''
);

-- 텔레그램이 같은 업데이트를 다시 보내도 한 번만 처리하기 위한 기록
CREATE TABLE IF NOT EXISTS tg_updates (
  update_id INTEGER PRIMARY KEY,
  at TEXT NOT NULL
);
