-- 고객 DB 고도화 + 외부 데이터 업로드. 새 표 3개만 추가한다 (기존 데이터는 건드리지 않음).

-- 고객 원장: 외부에서 올린 고객(명단·관심고객)과, 설문·방명록 고객에게 덧붙이는 관리 정보(진행 상태·담당·메모·연락 거부).
-- 한 고객 = 현장 + 전화번호 해시. 전화번호 원문은 암호화(phone_enc)하고, 화면 표시·검색용으로 뒤 4자리만 따로 둔다.
CREATE TABLE IF NOT EXISTS customers (
  project_id TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  phone_enc TEXT NOT NULL DEFAULT '',
  phone_tail TEXT NOT NULL DEFAULT '',        -- 뒤 4자리
  source TEXT NOT NULL DEFAULT '',            -- 출처 이름 (예: TM업체A, 홈페이지 관심등록). 설문·방명록 고객에 덧붙인 행은 빈 값
  source_kind TEXT NOT NULL DEFAULT '',       -- 명단 / 관심고객 / 상담결과 / '' (덧붙인 행)
  consent TEXT NOT NULL DEFAULT '',           -- 동의 / 미확인 / '' (덧붙인 행: 설문·방명록의 동의를 따른다)
  status TEXT NOT NULL DEFAULT '',            -- 직접 정한 진행 상태. 비면 자동(계약 > 방문 > 신규)
  owner_id TEXT NOT NULL DEFAULT '',          -- 담당 직원
  memo TEXT NOT NULL DEFAULT '',
  dnc INTEGER NOT NULL DEFAULT 0,             -- 연락 거부
  region TEXT NOT NULL DEFAULT '',            -- 거주 지역 (올린 자료에 있으면)
  interest TEXT NOT NULL DEFAULT '',          -- 관심 타입·평형 등 (올린 자료에 있으면)
  import_id TEXT NOT NULL DEFAULT '',         -- 이 고객을 처음 만든 업로드 (업로드 취소 때 함께 지운다)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, phone_hash)
);
CREATE INDEX IF NOT EXISTS ix_customers_import ON customers(project_id, import_id);

-- 상담·TM·메모 기록 (고객별 이력)
CREATE TABLE IF NOT EXISTS customer_notes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  at TEXT NOT NULL,                           -- 상담 일시 (YYYY-MM-DD 또는 YYYY-MM-DD HH:MM)
  kind TEXT NOT NULL,                         -- TM / 상담 / 메모
  result TEXT NOT NULL DEFAULT '',            -- 결과 (예: 부재, 방문약속, 관심없음)
  content TEXT NOT NULL DEFAULT '',
  import_id TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_customer_notes_cust ON customer_notes(project_id, phone_hash, at);
CREATE INDEX IF NOT EXISTS ix_customer_notes_import ON customer_notes(project_id, import_id);

-- 외부 데이터 업로드 기록 (누가 언제 어떤 출처의 자료를 몇 건 올렸는지)
CREATE TABLE IF NOT EXISTS customer_imports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,                         -- 명단 / 관심고객 / 상담결과
  source TEXT NOT NULL,
  consent TEXT NOT NULL,                      -- 동의 / 미확인
  file_name TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,           -- 새로 생긴 고객
  updated INTEGER NOT NULL DEFAULT 0,         -- 이미 있던 고객 (빈 항목만 채움)
  notes INTEGER NOT NULL DEFAULT 0,           -- 추가된 상담 기록
  skipped INTEGER NOT NULL DEFAULT 0,         -- 전화번호 오류 등으로 건너뜀
  status TEXT NOT NULL DEFAULT '완료',         -- 완료 / 취소
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_customer_imports_project ON customer_imports(project_id, created_at);
