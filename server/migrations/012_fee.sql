-- 5단계: 용역관리 2 — 판매수수료. 새 표 2개와 색인만 추가한다 (기존 데이터는 건드리지 않음).

-- 수수료 규칙(정액). 한 계약에 여러 규칙이 맞으면 동호 > 동 > 타입 > 기본 순으로 하나만 쓴다.
CREATE TABLE IF NOT EXISTS fee_rules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL,                       -- 기본 / 타입 / 동 / 동호
  scope_value TEXT NOT NULL DEFAULT '',      -- 타입 이름 / 동 번호(예 101) / 동호 목록(쉼표로 구분, 예 101-1203,101-1204)
  fee_basis TEXT NOT NULL DEFAULT '',        -- '' = 전체, 아니면 계약의 '수수료기준'(예 조직 / 일반)이 같을 때만
  staff_amount INTEGER NOT NULL DEFAULT 0,   -- 직원 몫 (원)
  leader_amount INTEGER NOT NULL DEFAULT 0,  -- 팀장 몫
  head_amount INTEGER NOT NULL DEFAULT 0,    -- 본부장 몫
  pay_mode TEXT NOT NULL DEFAULT '구분',      -- 구분(직원·팀장·본부장에게 각각) / 본부장일괄(세 몫을 합쳐 본부장에게)
  date_from TEXT NOT NULL DEFAULT '',        -- 적용 기간(계약일 기준). 비우면 제한 없음
  date_to TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  memo TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fee_rules_project ON fee_rules(project_id, active);

-- 수수료 원장: 확정된 정산에서 계약 1건마다 받는 사람별 지급 줄을 쌓고, 해약되면 환수 줄(마이너스)을 만든다.
CREATE TABLE IF NOT EXISTS fee_ledger (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  contract_id TEXT NOT NULL,                 -- 계약앱 레코드 id
  dongho TEXT NOT NULL DEFAULT '',
  contract_date TEXT NOT NULL DEFAULT '',
  staff_id TEXT NOT NULL,                    -- 받는 사람
  role TEXT NOT NULL,                        -- 직원 / 팀장 / 본부장 / 본부장일괄 / 대체
  kind TEXT NOT NULL,                        -- 지급 / 환수 / 대체(재판매로 대신 인정, 금액 0)
  amount INTEGER NOT NULL DEFAULT 0,         -- 지급은 +, 환수는 -
  state TEXT NOT NULL,                       -- 대기 / 확정 / 취소
  run_id TEXT NOT NULL DEFAULT '',           -- 이 줄이 반영된 정산 회차
  ref_id TEXT NOT NULL DEFAULT '',           -- 환수 줄이 되돌리는 지급 줄
  owner_staff_id TEXT NOT NULL DEFAULT '',   -- 지급 당시 계약 담당 직원 (재판매 대체 판단 기준)
  decision TEXT NOT NULL DEFAULT '',         -- 환수 줄의 처리: '' (미정) / 환수 / 재판매대기
  resale_until TEXT NOT NULL DEFAULT '',     -- 재판매 대기 기한 (이 날짜까지 같은 담당자가 재계약하지 않으면 환수)
  cancel_date TEXT NOT NULL DEFAULT '',      -- 환수 줄: 해약된 날 (재판매 대기 기한의 기준)
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_fee_ledger_contract ON fee_ledger(project_id, contract_id);
CREATE INDEX IF NOT EXISTS ix_fee_ledger_staff ON fee_ledger(project_id, staff_id, state);
CREATE INDEX IF NOT EXISTS ix_fee_ledger_kind ON fee_ledger(project_id, kind, state);
CREATE INDEX IF NOT EXISTS ix_fee_ledger_run ON fee_ledger(run_id);
-- 같은 계약의 같은 몫은 한 번만 지급한다 (정산 두 개가 동시에 확정돼도 DB 가 막는다)
CREATE UNIQUE INDEX IF NOT EXISTS ux_fee_ledger_pay ON fee_ledger(project_id, contract_id, role) WHERE kind IN ('지급', '대체') AND state <> '취소';
-- 지급 줄 하나에 환수 줄은 하나만
CREATE UNIQUE INDEX IF NOT EXISTS ux_fee_ledger_refund ON fee_ledger(project_id, ref_id) WHERE kind = '환수' AND state <> '취소';

-- 계약앱 입금내역을 동호로 찾기 위한 색인 (계약금 완납일 계산용)
CREATE INDEX IF NOT EXISTS ix_ct_dongho ON ct_records(project_id, col, dongho_g);
