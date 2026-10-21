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
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_job_pay_from ON job_pay(project_id, job, effective_from);
