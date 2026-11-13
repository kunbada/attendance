-- 시험을 처음부터 다시 하려고 현장·직원·계약·정산 데이터를 모두 지운다. 되돌릴 수 없으니 먼저 D1 내보내기로 백업할 것.
-- 남기는 것: 계정(accounts: 로그인 아이디·비밀번호·역할), 공통 설정(settings), 작업 기록(logs), 비밀번호 초기화 상태(password_resets)
-- 지우는 것: 현장·현장 설정·조직·직원·급여정보·근태·예약·호출·방명록·지급 설정·정산·설문·고객 등급·계약앱 데이터·수수료 규칙·원장, 계정↔현장 연결, 직원 로그인 세션
-- 실행:  npx wrangler@4 d1 execute attendance --remote --file=scripts/wipe-data.sql --yes   (로컬 시험은 --local)
DELETE FROM fee_ledger;
DELETE FROM fee_rules;
DELETE FROM ct_records;
DELETE FROM ct_rev;
DELETE FROM customer_imports;
DELETE FROM realtor_responses;
DELETE FROM realtor_forms;
DELETE FROM ocr_usage;
DELETE FROM staff_otp;
DELETE FROM customer_notes;
DELETE FROM customers;
DELETE FROM customer_grades;
DELETE FROM response_pii;
DELETE FROM response_answers;
DELETE FROM responses;
DELETE FROM survey_links;
DELETE FROM surveys;
DELETE FROM pay_items;
DELETE FROM pay_runs;
DELETE FROM suppliers;
DELETE FROM job_pay;
DELETE FROM staff_pay;
DELETE FROM attendance_adjust;
DELETE FROM guestbook;
DELETE FROM visits;
DELETE FROM reservations;
DELETE FROM attendance;
DELETE FROM qr_issues;
DELETE FROM tg_updates;
DELETE FROM payroll;
DELETE FROM staff;
DELETE FROM orgs;
DELETE FROM account_projects;
DELETE FROM project_settings;
DELETE FROM projects;
DELETE FROM sessions WHERE kind <> 'account';
