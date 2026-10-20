-- 1단계: 현장(프로젝트) 도입. 한 현장짜리 DB 를 "첫 현장(P01)" 하나가 있는 다현장 구조로 바꾼다.
-- 기존 데이터는 지우지 않고 전부 첫 현장 소속으로 옮긴다. 운영 DB 에 적용하기 전에 반드시 wrangler d1 export 로 백업할 것.
-- 이 파일은 한 번만 실행한다 (ALTER TABLE ADD COLUMN 은 두 번 실행하면 오류).

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

CREATE TABLE IF NOT EXISTS project_settings (
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, key)
);

CREATE TABLE IF NOT EXISTS account_projects (
  account_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  PRIMARY KEY (account_id, project_id)
);
CREATE INDEX IF NOT EXISTS ix_account_projects_project ON account_projects(project_id);

-- 첫 현장: 이름은 기존 설정의 현장명을 쓰고, 비어 있으면 '기본 현장'. 가입 링크 코드는 관리자 화면에서 바꿀 수 있다.
INSERT INTO projects (id, code, name, status, created_at)
VALUES ('P01', 'site1', COALESCE(NULLIF((SELECT value FROM settings WHERE key = '현장명'), ''), '기본 현장'), '진행', datetime('now', '+9 hours'));

-- 현장별 설정: 기존 값을 첫 현장으로 복사한다. 기존 settings 행은 "새 현장의 기본값"으로 그대로 둔다.
INSERT INTO project_settings (project_id, key, value)
SELECT 'P01', key, value FROM settings WHERE key IN ('GPS허용거리m', '예약중복기준');

-- 모든 업무 표에 project_id 추가 후 기존 행을 첫 현장으로
ALTER TABLE staff ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
UPDATE staff SET project_id = 'P01';
ALTER TABLE orgs ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
UPDATE orgs SET project_id = 'P01';
ALTER TABLE attendance ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
UPDATE attendance SET project_id = 'P01';
ALTER TABLE reservations ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
UPDATE reservations SET project_id = 'P01';
ALTER TABLE visits ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
UPDATE visits SET project_id = 'P01';
ALTER TABLE guestbook ADD COLUMN project_id TEXT NOT NULL DEFAULT '';
UPDATE guestbook SET project_id = 'P01';
ALTER TABLE logs ADD COLUMN project_id TEXT NOT NULL DEFAULT ''; -- 옛 로그는 현장 구분 없이 비워 둔다

-- 계정: 보조관리자 권한 항목 + 데스크·방명록 계정은 첫 현장에 고정
ALTER TABLE accounts ADD COLUMN allow_payroll INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN allow_pay_confirm INTEGER NOT NULL DEFAULT 0;
INSERT INTO account_projects (account_id, project_id) SELECT id, 'P01' FROM accounts WHERE role IN ('데스크', '방명록');

-- QR 은 기본키가 (현장, 날짜)로 바뀌므로 표를 새로 만들어 옮긴다
CREATE TABLE qr_issues_new (
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
INSERT INTO qr_issues_new (project_id, date, qr, base_lat, base_lng, accuracy_m, issued_by, issued_at)
SELECT 'P01', date, qr, base_lat, base_lng, accuracy_m, issued_by, issued_at FROM qr_issues;
DROP TABLE qr_issues;
ALTER TABLE qr_issues_new RENAME TO qr_issues;

-- 색인을 현장 기준으로 다시 만든다 (같은 이름으로 교체)
DROP INDEX IF EXISTS ux_att_ok_staff;
DROP INDEX IF EXISTS ux_att_ok_device;
DROP INDEX IF EXISTS ix_att_date;
CREATE UNIQUE INDEX ux_att_ok_staff ON attendance(project_id, date, staff_id) WHERE result = '성공';
CREATE UNIQUE INDEX ux_att_ok_device ON attendance(project_id, date, device_key) WHERE result = '성공';
CREATE INDEX ix_att_date ON attendance(project_id, date);

DROP INDEX IF EXISTS ix_res_last5;
DROP INDEX IF EXISTS ix_res_date;
CREATE INDEX ix_res_last5 ON reservations(project_id, last5, status);
CREATE INDEX ix_res_date ON reservations(project_id, visit_date);

DROP INDEX IF EXISTS ix_visits_at;
CREATE INDEX ix_visits_at ON visits(project_id, visited_at);

DROP INDEX IF EXISTS ix_guest_date;
DROP INDEX IF EXISTS ix_guest_phone;
CREATE INDEX ix_guest_date ON guestbook(project_id, visit_date);
CREATE INDEX ix_guest_phone ON guestbook(project_id, phone, visit_date);

CREATE INDEX IF NOT EXISTS ix_orgs_project ON orgs(project_id, kind);
CREATE INDEX IF NOT EXISTS ix_staff_project ON staff(project_id, status);
