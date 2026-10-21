-- 고객 등급(A~D) 수동 지정 표 + 별도 앱(설문 관리·예약/호출 조회) 사용 허용 열. 새 표와 열만 추가한다.

-- 같은 전화번호 해시의 고객에 직접 정한 등급 (TM 상담 결과 등). 있으면 자동 분류보다 우선한다
CREATE TABLE IF NOT EXISTS customer_grades (
  project_id TEXT NOT NULL,
  phone_hash TEXT NOT NULL,
  grade TEXT NOT NULL,                         -- A / B / C / D
  memo TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, phone_hash)
);

-- 보조관리자에게 별도 앱을 허용 (관리자는 항상 가능)
ALTER TABLE accounts ADD COLUMN allow_survey INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN allow_visit INTEGER NOT NULL DEFAULT 0;
