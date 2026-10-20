-- 로컬 개발 DB(--local)를 비운다. 테스트를 처음부터 다시 돌릴 때만 사용한다. 운영 DB 에는 절대 실행하지 말 것.
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS project_settings;
DROP TABLE IF EXISTS orgs;
DROP TABLE IF EXISTS staff;
DROP TABLE IF EXISTS payroll;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS account_projects;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS qr_issues;
DROP TABLE IF EXISTS attendance;
DROP TABLE IF EXISTS reservations;
DROP TABLE IF EXISTS visits;
DROP TABLE IF EXISTS logs;
DROP TABLE IF EXISTS tg_updates;
DROP TABLE IF EXISTS guestbook;
DROP TABLE IF EXISTS password_resets;
