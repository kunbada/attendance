-- 3단계: 고객관리 — 설문(빌더·배포 링크·응답 원장)과 고객 통합 키(전화번호 해시). 새 표와 열만 추가한다.

CREATE TABLE IF NOT EXISTS surveys (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '작성',          -- 작성 / 진행 / 마감
  questions_json TEXT NOT NULL DEFAULT '[]',   -- [{key, std, type, title, required, options:[{code,label}]}]
  consent_text TEXT NOT NULL DEFAULT '',       -- 개인정보 수집·이용 동의 문구 (현장·설문별)
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_surveys_project ON surveys(project_id, status);

-- 배포 링크: 본부·팀·직원 개인·기타(현수막 등) 별로 코드를 발급한다. 응답은 링크 기준으로 집계된다
CREATE TABLE IF NOT EXISTS survey_links (
  code TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  survey_id TEXT NOT NULL,
  kind TEXT NOT NULL,                          -- 본부 / 팀 / 직원 / 기타
  head_id TEXT NOT NULL DEFAULT '',
  team_id TEXT NOT NULL DEFAULT '',
  person_id TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_survey_links_survey ON survey_links(project_id, survey_id);
CREATE UNIQUE INDEX IF NOT EXISTS ux_survey_links_person ON survey_links(survey_id, person_id) WHERE person_id <> '';

CREATE TABLE IF NOT EXISTS responses (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  survey_id TEXT NOT NULL,
  link_code TEXT NOT NULL DEFAULT '',
  head_id TEXT NOT NULL DEFAULT '',
  team_id TEXT NOT NULL DEFAULT '',
  person_id TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL,
  consent_pi INTEGER NOT NULL DEFAULT 0,       -- 개인정보 동의 (0 이면 이름·전화번호는 저장하지 않는다)
  consent_mkt INTEGER NOT NULL DEFAULT 0,      -- 마케팅 안내 수신 동의
  phone_hash TEXT NOT NULL DEFAULT '',         -- 동의한 응답만. 방명록 등과 같은 고객을 묶는 키
  nonce TEXT NOT NULL DEFAULT '',              -- 같은 제출이 두 번 들어오는 것을 막는 값
  answers_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS ix_responses_survey ON responses(project_id, survey_id, submitted_at);
CREATE INDEX IF NOT EXISTS ix_responses_phone ON responses(project_id, phone_hash);
CREATE UNIQUE INDEX IF NOT EXISTS ux_responses_nonce ON responses(survey_id, nonce) WHERE nonce <> '';

-- 세로형 답변: 문항 key · 보기 코드 · 표시 문구. 현장을 넘나드는 공통문항 분석에 쓴다
CREATE TABLE IF NOT EXISTS response_answers (
  response_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  survey_id TEXT NOT NULL,
  q_key TEXT NOT NULL,
  value_code TEXT NOT NULL DEFAULT '',
  value_text TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_ra_response ON response_answers(response_id);
CREATE INDEX IF NOT EXISTS ix_ra_survey ON response_answers(project_id, survey_id, q_key);
CREATE INDEX IF NOT EXISTS ix_ra_key ON response_answers(q_key, value_code);

-- 개인정보 동의한 응답만. 전화번호는 암호화(AES-GCM). 보유기간이 지나면 일괄 파기한다
CREATE TABLE IF NOT EXISTS response_pii (
  response_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  phone_enc TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_response_pii_project ON response_pii(project_id);

-- 방명록도 같은 전화번호 해시로 고객을 묶는다 (개인정보 제공에 동의한 건만). 기존 행은 고객 목록을 열 때 채워진다
ALTER TABLE guestbook ADD COLUMN phone_hash TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS ix_guest_hash ON guestbook(project_id, phone_hash);
