-- 2단계: 근태 보정 + 용역관리(일급 정산). 새 표만 추가한다 (기존 데이터 변경 없음).

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
  detail_json TEXT NOT NULL DEFAULT '[]'
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_items_run_staff ON pay_items(run_id, staff_id);
CREATE INDEX IF NOT EXISTS ix_pay_items_staff ON pay_items(staff_id, project_id);
