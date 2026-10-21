-- 인력공급업체 일괄지급: 업체 표 + 지급 방식(3.3% 공제 / 공제 없음 / 업체 일괄) 열 추가. 기존 데이터는 그대로 두고 열만 더한다.

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  name TEXT NOT NULL,
  biz_no TEXT NOT NULL DEFAULT '',
  bank TEXT NOT NULL DEFAULT '',
  account_enc TEXT NOT NULL DEFAULT '',
  holder TEXT NOT NULL DEFAULT '',
  contact TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_suppliers_name ON suppliers(project_id, name);

ALTER TABLE staff_pay ADD COLUMN pay_mode TEXT NOT NULL DEFAULT '3.3%';
ALTER TABLE staff_pay ADD COLUMN supplier_id TEXT NOT NULL DEFAULT '';
UPDATE staff_pay SET pay_mode = CASE WHEN withhold = 1 THEN '3.3%' ELSE '공제없음' END;
ALTER TABLE job_pay ADD COLUMN pay_mode TEXT NOT NULL DEFAULT '3.3%';
ALTER TABLE job_pay ADD COLUMN supplier_id TEXT NOT NULL DEFAULT '';
UPDATE job_pay SET pay_mode = CASE WHEN withhold = 1 THEN '3.3%' ELSE '공제없음' END;
ALTER TABLE pay_items ADD COLUMN pay_mode TEXT NOT NULL DEFAULT '3.3%';
ALTER TABLE pay_items ADD COLUMN supplier_id TEXT NOT NULL DEFAULT '';
ALTER TABLE pay_items ADD COLUMN supplier_name TEXT NOT NULL DEFAULT '';
UPDATE pay_items SET pay_mode = CASE WHEN withhold = 1 THEN '3.3%' ELSE '공제없음' END;
