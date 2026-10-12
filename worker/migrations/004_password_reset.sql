-- 관리자 비밀번호 이메일 인증 초기화. 이미 운영 중인 DB 에 한 번만 실행한다.
ALTER TABLE accounts ADD COLUMN email TEXT NOT NULL DEFAULT '';

-- 인증 코드는 해시로만 저장한다. 5회 틀리면 30분 잠금(locked_until).
CREATE TABLE IF NOT EXISTS password_resets (
  account_id TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  requested_at INTEGER NOT NULL,
  locked_until INTEGER NOT NULL DEFAULT 0
);
