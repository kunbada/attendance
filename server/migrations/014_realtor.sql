-- 고객관리 > 부동산고객: 중개업소 조사(현장당 링크 1개, 명함 AI 인식). 새 표만 추가한다.

-- 현장마다 하나뿐인 조사 링크
CREATE TABLE IF NOT EXISTS realtor_forms (
  project_id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,                   -- 공개 주소 r/?c=코드
  active INTEGER NOT NULL DEFAULT 1,
  consent_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 조사 한 건 = 한 줄. 같은 중개업소는 휴대폰(해시)·사무실 전화가 같으면 화면에서 한 곳으로 묶는다
CREATE TABLE IF NOT EXISTS realtor_responses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  office_name TEXT NOT NULL DEFAULT '',        -- 상호
  office_tel TEXT NOT NULL DEFAULT '',         -- 사무실 전화 (숫자만)
  address TEXT NOT NULL DEFAULT '',
  consent INTEGER NOT NULL DEFAULT 0,          -- 개인정보 제공 동의 (0 이면 이름·직함·휴대폰은 저장하지 않는다)
  name TEXT NOT NULL DEFAULT '',
  position TEXT NOT NULL DEFAULT '',           -- 직함 (대표, 실장 등)
  phone_enc TEXT NOT NULL DEFAULT '',          -- 휴대폰 원문 (AES-GCM)
  phone_hash TEXT NOT NULL DEFAULT '',
  phone_tail TEXT NOT NULL DEFAULT '',
  market INTEGER NOT NULL,                     -- 시장 동향 5 매우 좋음 … 1 매우 나쁨
  intent INTEGER NOT NULL,                     -- 분양 의향 5 매우 높음 … 1 매우 낮음
  refer INTEGER NOT NULL,                      -- 소개 의향 5 … 1
  refer_count INTEGER NOT NULL DEFAULT 0,      -- 소개 가능 고객 수
  opinion TEXT NOT NULL DEFAULT '',
  ocr INTEGER NOT NULL DEFAULT 0,              -- 명함 인식을 써서 입력했는지
  memo TEXT NOT NULL DEFAULT '',               -- 관리자 메모
  nonce TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_realtor_resp ON realtor_responses(project_id, submitted_at);
CREATE UNIQUE INDEX IF NOT EXISTS ux_realtor_nonce ON realtor_responses(project_id, nonce) WHERE nonce <> '';

-- 명함 인식 사용량 (현장·날짜별). 무료 한도를 넘지 않게 서버가 센다
CREATE TABLE IF NOT EXISTS ocr_usage (
  project_id TEXT NOT NULL,
  day TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, day)
);
