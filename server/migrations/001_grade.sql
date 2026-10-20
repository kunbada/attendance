-- 직급(직원/팀장/본부장)과 승인 권한. 이미 운영 중인 DB 에 한 번만 실행한다.
ALTER TABLE staff ADD COLUMN grade TEXT NOT NULL DEFAULT '직원';
ALTER TABLE staff ADD COLUMN can_approve INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS ix_staff_org ON staff(head_id, team_id);
