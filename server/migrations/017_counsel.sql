-- 상담고객: 상담사용 앱(데스크탑, PIN + 텔레그램 인증). 고객 정보는 고객 DB(customers·customer_grades·customer_notes)에 그대로 쌓는다.
-- 부동산 조사에는 조사한 직원을 기록한다. 기존 데이터는 바꾸지 않고 열·표만 추가한다.
ALTER TABLE realtor_responses ADD COLUMN staff_id TEXT NOT NULL DEFAULT '';     -- 조사한 직원 (직원 앱·상담 앱에 로그인한 상태로 제출한 경우)
ALTER TABLE customers ADD COLUMN subscr_rank TEXT NOT NULL DEFAULT '';          -- 청약 순위: 특별공급 / 1순위 / 2순위 / 무순위 / 미정
ALTER TABLE customers ADD COLUMN special_kind TEXT NOT NULL DEFAULT '';         -- 특별공급 종류 (쉼표로 여러 개)
ALTER TABLE customers ADD COLUMN counsel_at TEXT NOT NULL DEFAULT '';           -- 상담고객 앱에서 처음 등록한 때 (상담고객 표시)
ALTER TABLE customer_notes ADD COLUMN staff_id TEXT NOT NULL DEFAULT '';        -- 상담고객 앱에서 기록한 상담사
CREATE INDEX IF NOT EXISTS ix_customers_owner ON customers(project_id, owner_id);
CREATE INDEX IF NOT EXISTS ix_customer_notes_staff ON customer_notes(project_id, staff_id);
CREATE INDEX IF NOT EXISTS ix_realtor_staff ON realtor_responses(project_id, staff_id);

-- 상담고객 앱 로그인 2단계 인증번호 (텔레그램으로 보냄). 직원 1명당 1줄, 5분 유효, 5회 틀리면 무효
CREATE TABLE IF NOT EXISTS staff_otp (
  staff_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  tries INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER NOT NULL
);
