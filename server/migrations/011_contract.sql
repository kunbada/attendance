-- 4단계: 계약관리 연동. 계약앱(분양계약관리)의 컬렉션(units, contracts, pre, resv, locks, deposits, settings, templates, notes)을
-- 현장(project_id)별로 그대로 받는 표와 변경 번호(rev) 표. 새 표만 추가한다 (기존 데이터는 건드리지 않음).

-- 레코드 원본은 json 열. 자주 쓰는 항목은 생성 열(json 에서 자동 계산)로 색인한다.
CREATE TABLE IF NOT EXISTS ct_records (
  project_id TEXT NOT NULL,
  col TEXT NOT NULL,                     -- units / contracts / pre / resv / locks / deposits / settings / templates / notes
  id TEXT NOT NULL,
  rev INTEGER NOT NULL,                  -- 현장 안에서 바뀔 때마다 커지는 번호 (클라이언트가 "이 번호 이후 변경분"을 받아 간다)
  updated_at TEXT NOT NULL DEFAULT '',
  updated_by TEXT NOT NULL DEFAULT '',
  deleted INTEGER NOT NULL DEFAULT 0,    -- 삭제는 표시만 한다 (다른 PC 에도 전파되어야 하므로)
  json TEXT NOT NULL,
  dongho_g TEXT GENERATED ALWAYS AS (json_extract(json, '$.dongho')) VIRTUAL,
  status_g TEXT GENERATED ALWAYS AS (json_extract(json, '$.status')) VIRTUAL,
  dep_key_g TEXT GENERATED ALWAYS AS (json_extract(json, '$.k')) VIRTUAL,
  staff_id_g TEXT GENERATED ALWAYS AS (json_extract(json, '$.staffId')) VIRTUAL,
  PRIMARY KEY (project_id, col, id)
);
-- "이 번호 이후 바뀐 것" 조회용
CREATE INDEX IF NOT EXISTS ix_ct_rev ON ct_records(project_id, rev);
-- 같은 동호에 해약이 아닌 계약은 하나만 (동시에 두 사람이 같은 동호를 계약해도 DB 가 막는다)
CREATE UNIQUE INDEX IF NOT EXISTS ux_ct_contract_dongho ON ct_records(project_id, dongho_g)
  WHERE col = 'contracts' AND deleted = 0 AND COALESCE(status_g, '') <> '해약' AND COALESCE(dongho_g, '') <> '';
-- 같은 입금내역(중복키 k)은 한 번만
CREATE UNIQUE INDEX IF NOT EXISTS ux_ct_deposit_key ON ct_records(project_id, dep_key_g)
  WHERE col = 'deposits' AND deleted = 0 AND COALESCE(dep_key_g, '') <> '';
-- 담당 직원(staffId)별 계약 조회 (5단계 수수료 계산)
CREATE INDEX IF NOT EXISTS ix_ct_staff ON ct_records(project_id, staff_id_g) WHERE col = 'contracts' AND deleted = 0;

-- 현장별 변경 번호 카운터 (쓰기와 같은 트랜잭션에서 올린다)
CREATE TABLE IF NOT EXISTS ct_rev (
  project_id TEXT PRIMARY KEY,
  rev INTEGER NOT NULL DEFAULT 0
);
