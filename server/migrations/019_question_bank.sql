-- 문항 은행: 직접 만든 설문 문항을 저장해 두고 다른 설문(다른 현장 포함)에서 다시 쓴다. 회사 전체 공유.
-- key 는 설문에 들어갈 때 그대로 쓰여서, 설문이 달라도 같은 문항으로 묶어 집계할 수 있다.
CREATE TABLE IF NOT EXISTS question_bank (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,                  -- 설문 문항 키 (Q 로 시작)
  type TEXT NOT NULL,                        -- text / textarea / number / radio / checkbox / select
  title TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',   -- [{code, label}]
  required INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
