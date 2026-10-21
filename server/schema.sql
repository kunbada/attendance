-- D1 데이터베이스 구조. 여러 번 실행해도 안전하다 (IF NOT EXISTS).
-- 이미 운영 중인 DB 는 migrations/ 폴더의 파일을 번호 순서대로 한 번씩 실행한다 (새로 만들 때는 이 파일만 실행하면 된다).
-- 날짜·시각은 Asia/Seoul 기준 문자열: 날짜 'YYYY-MM-DD', 일시 'YYYY-MM-DD HH:MM:SS'.
-- 상태·구분 값(대기/활동/예정/방문 …)은 화면과 같은 한국어 그대로 저장한다.

-- 현장(프로젝트). 모든 업무 표는 project_id 로 이 표에 속한다. code 는 가입 링크 등에 쓰는 짧은 영문·숫자(소문자)
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  client TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '준비',
  start_date TEXT NOT NULL DEFAULT '',
  end_date TEXT NOT NULL DEFAULT '',
  money_label TEXT NOT NULL DEFAULT '분양가',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_code ON projects(code);

-- 전체 공통 설정 (텔레그램 봇 이름 등). 현장별 값은 project_settings
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS project_settings (
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, key)
);

-- 본부 / 팀(parent_id = 본부) / 직군
CREATE TABLE IF NOT EXISTS orgs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  parent_id TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_orgs_project ON orgs(project_id, kind);

-- 영업사원은 한 번에 1개 현장에만 소속 (project_id). 현장 이동은 관리자가 project_id 를 바꾸고 logs 에 남긴다
CREATE TABLE IF NOT EXISTS staff (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT '',
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
CREATE INDEX IF NOT EXISTS ix_staff_project ON staff(project_id, status);

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

-- 계정 역할: 관리자(전체 현장) / 보조관리자·계약담당·열람(지정한 현장만) / 데스크·방명록(현장 1개에 고정)
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  login_id TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  fail_count INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  email TEXT NOT NULL DEFAULT '',
  allow_payroll INTEGER NOT NULL DEFAULT 0,      -- 보조관리자에게 급여정보 원문 보기를 허용
  allow_pay_confirm INTEGER NOT NULL DEFAULT 0   -- 보조관리자에게 지급 확정을 허용 (2단계에서 사용)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_accounts_login ON accounts(login_id);

-- 계정이 접근할 수 있는 현장 (관리자는 전체라 행이 없다)
CREATE TABLE IF NOT EXISTS account_projects (
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY (account_id, project_id)
);
CREATE INDEX IF NOT EXISTS ix_account_projects_project ON account_projects(project_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions(kind, user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_expires ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS qr_issues (
  project_id TEXT NOT NULL,
  date TEXT NOT NULL,
  qr TEXT NOT NULL,
  base_lat REAL NOT NULL,
  base_lng REAL NOT NULL,
  accuracy_m INTEGER NOT NULL DEFAULT 0,
  issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  PRIMARY KEY (project_id, date)
);

CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT '',
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
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_ok_staff ON attendance(project_id, date, staff_id) WHERE result = '성공';
CREATE UNIQUE INDEX IF NOT EXISTS ux_att_ok_device ON attendance(project_id, date, device_key) WHERE result = '성공';
CREATE INDEX IF NOT EXISTS ix_att_date ON attendance(project_id, date);
CREATE INDEX IF NOT EXISTS ix_att_staff ON attendance(staff_id, date);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT '',
  last5 TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT '',
  visit_date TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_res_last5 ON reservations(project_id, last5, status);
CREATE INDEX IF NOT EXISTS ix_res_staff ON reservations(staff_id, status);
CREATE INDEX IF NOT EXISTS ix_res_date ON reservations(project_id, visit_date);

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT '',
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
CREATE INDEX IF NOT EXISTS ix_visits_at ON visits(project_id, visited_at);
CREATE INDEX IF NOT EXISTS ix_visits_staff ON visits(staff_id);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  user TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  project_id TEXT NOT NULL DEFAULT ''   -- 현장과 무관한 일(계정·프로젝트 관리)은 비어 있다
);

-- 텔레그램이 같은 업데이트를 다시 보내도 한 번만 처리하기 위한 기록
CREATE TABLE IF NOT EXISTS tg_updates (
  update_id INTEGER PRIMARY KEY,
  at TEXT NOT NULL
);

-- 방명록 (고객이 태블릿으로 입력하거나 데스크가 입력)
CREATE TABLE IF NOT EXISTS guestbook (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  visit_date TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  last5 TEXT NOT NULL,
  gender TEXT NOT NULL DEFAULT '',
  companions INTEGER NOT NULL DEFAULT 0,        -- 동반인 수 (0 = 단독). 방문객수 = 1 + companions, 방문팀수 = 1건
  head_id TEXT NOT NULL DEFAULT '',             -- 담당 본부 (비어 있고 reviewed=1 이면 '워킹')
  team_id TEXT NOT NULL DEFAULT '',
  staff_id TEXT NOT NULL DEFAULT '',
  staff_none INTEGER NOT NULL DEFAULT 0,        -- 본부/팀은 있는데 담당 직원이 없을 때 '없음'
  consent INTEGER NOT NULL DEFAULT 0,           -- 개인정보 제공 동의
  consent_at TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,                         -- 고객 / 데스크
  reviewed INTEGER NOT NULL DEFAULT 0,          -- 0 = 고객이 입력해 아직 데스크가 확인하지 않음
  visit_id TEXT NOT NULL DEFAULT '',            -- 호출했다면 방문 기록 번호
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  auto_source TEXT NOT NULL DEFAULT '',          -- 담당자를 자동으로 채운 근거: 예약 / 방문이력 (데스크가 저장하면 비움)
  reservation_id TEXT NOT NULL DEFAULT ''        -- 연결된 예약
);
CREATE INDEX IF NOT EXISTS ix_guest_date ON guestbook(project_id, visit_date);
CREATE INDEX IF NOT EXISTS ix_guest_phone ON guestbook(project_id, phone, visit_date);

-- 관리자 비밀번호 이메일 인증 초기화 (인증 코드는 해시로만 저장, 5회 틀리면 30분 잠금)
CREATE TABLE IF NOT EXISTS password_resets (
  account_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);

-- 관리자 근태 보정: 원본 출근 기록(attendance)은 고치지 않고 날짜별 덮어쓰기 값만 둔다
-- kind: 인정(출근 기록이 없어도 1일) / 불인정(출근 기록이 있어도 0일) / 반일(0.5일)
CREATE TABLE IF NOT EXISTS attendance_adjust (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  date TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_adjust_day ON attendance_adjust(project_id, staff_id, date);
CREATE INDEX IF NOT EXISTS ix_adjust_date ON attendance_adjust(project_id, date);

-- 개인별 지급 설정 (현장별, 적용 시작일별로 이력을 쌓는다)
-- daily_enabled: 일급 대상 / fee_enabled: 판매수수료 대상(영업 직군이 기본) / withhold: 3.3% 공제 여부
CREATE TABLE IF NOT EXISTS staff_pay (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  daily_wage INTEGER NOT NULL DEFAULT 0,
  cycle TEXT NOT NULL DEFAULT '월',
  daily_enabled INTEGER NOT NULL DEFAULT 1,
  fee_enabled INTEGER NOT NULL DEFAULT 0,
  withhold INTEGER NOT NULL DEFAULT 1,
  pay_mode TEXT NOT NULL DEFAULT '3.3%',      -- 3.3% / 공제없음 / 업체일괄 (withhold 는 pay_mode='3.3%' 일 때 1)
  supplier_id TEXT NOT NULL DEFAULT '',       -- pay_mode='업체일괄' 일 때 지급 대상 인력공급업체
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_staff_pay_from ON staff_pay(project_id, staff_id, effective_from);

-- 정산 회차 (현장 + 기간). 상태: 작성 → 검토 → 확정 → 지급완료. 확정된 회차는 고치지 않는다
CREATE TABLE IF NOT EXISTS pay_runs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '일급',
  title TEXT NOT NULL DEFAULT '',
  cycle TEXT NOT NULL,
  period_from TEXT NOT NULL,
  period_to TEXT NOT NULL,
  status TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT NOT NULL DEFAULT '',
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_at TEXT NOT NULL DEFAULT '',
  paid_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_pay_runs_project ON pay_runs(project_id, period_from);

-- 회차별 개인 명세. units = 반일 단위 수(2 = 1일). 금액은 모두 원 단위 정수
CREATE TABLE IF NOT EXISTS pay_items (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  name TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 0,
  base_amount INTEGER NOT NULL DEFAULT 0,
  adjust_amount INTEGER NOT NULL DEFAULT 0,
  adjust_memo TEXT NOT NULL DEFAULT '',
  gross INTEGER NOT NULL DEFAULT 0,
  income_tax INTEGER NOT NULL DEFAULT 0,
  local_tax INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL DEFAULT 0,
  withhold INTEGER NOT NULL DEFAULT 1,
  detail_json TEXT NOT NULL DEFAULT '[]',
  pay_mode TEXT NOT NULL DEFAULT '3.3%',       -- 업체일괄이면 개인 지급 없음(net 0), gross 는 업체에 청구하는 공급가
  supplier_id TEXT NOT NULL DEFAULT '',
  supplier_name TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_items_run_staff ON pay_items(run_id, staff_id);
CREATE INDEX IF NOT EXISTS ix_pay_items_staff ON pay_items(staff_id, project_id);

-- 직군별 기본 지급 설정 (개인 설정이 없는 직원에게 적용). 새 표만 추가한다.
CREATE TABLE IF NOT EXISTS job_pay (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  job TEXT NOT NULL,
  effective_from TEXT NOT NULL,
  daily_wage INTEGER NOT NULL DEFAULT 0,
  cycle TEXT NOT NULL DEFAULT '월',
  daily_enabled INTEGER NOT NULL DEFAULT 1,
  fee_enabled INTEGER NOT NULL DEFAULT 0,
  withhold INTEGER NOT NULL DEFAULT 1,
  pay_mode TEXT NOT NULL DEFAULT '3.3%',
  supplier_id TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_job_pay_from ON job_pay(project_id, job, effective_from);

-- 인력공급업체 (현장별). 용역비를 개인이 아니라 업체에 일괄 지급할 때 쓴다. 계좌번호는 암호화해 저장
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  biz_no TEXT NOT NULL DEFAULT '',
  bank TEXT NOT NULL DEFAULT '',
  account_enc TEXT NOT NULL DEFAULT '',
  holder TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_name ON suppliers(project_id, name);
