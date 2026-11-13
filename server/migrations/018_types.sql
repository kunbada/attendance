-- 프로젝트 주택형(세부 타입)과 세대수. 계약관리(계약앱 세대표)와는 별개로, 설문·상담 앱·고객 DB 의 "관심 타입" 기준표로 쓴다.
--   code = 세부 주택형 (예: 84A, 84B) — 상담 앱에서 고른다
--   grp  = 타입군 (예: 84) — 설문(사전판촉)에서는 타입군만 묻고, 통계도 타입군으로 묶는다
CREATE TABLE IF NOT EXISTS project_types (
  project_id TEXT NOT NULL,
  code TEXT NOT NULL,
  grp TEXT NOT NULL,
  area REAL NOT NULL DEFAULT 0,               -- 전용면적(㎡), 모르면 0
  units INTEGER NOT NULL DEFAULT 0,           -- 세대수
  sort INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, code)
);
