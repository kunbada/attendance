-- 방명록 (고객이 태블릿으로 입력하거나 데스크가 입력). 이미 운영 중인 DB 에 한 번만 실행한다.
CREATE TABLE IF NOT EXISTS guestbook (
  id TEXT PRIMARY KEY,
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
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_guest_date ON guestbook(visit_date);
CREATE INDEX IF NOT EXISTS ix_guest_phone ON guestbook(phone, visit_date);
