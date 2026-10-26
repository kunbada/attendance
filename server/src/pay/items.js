// 정산 명세(pay_items) 공통: 일급·수수료 정산이 함께 쓴다.
import { stmt } from '../core/util.js';
import { SUPPLIER_MODE, supplyVat } from './calc.js';

// 명세 여러 줄을 한 문장(json_each)으로 넣는다 (D1 의 요청당 쿼리 수 제한을 아끼려는 것)
export function insertItems(env, runId, pid, items) {
  if (!items.length) return null;
  return stmt(env,
    `INSERT INTO pay_items (id, run_id, project_id, staff_id, name, units, base_amount, adjust_amount, adjust_memo, gross, income_tax, local_tax, net, withhold, detail_json, pay_mode, supplier_id, supplier_name)
     SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.staff_id'), json_extract(value, '$.name'), json_extract(value, '$.units'),
       json_extract(value, '$.base_amount'), json_extract(value, '$.adjust_amount'), json_extract(value, '$.adjust_memo'), json_extract(value, '$.gross'),
       json_extract(value, '$.income_tax'), json_extract(value, '$.local_tax'), json_extract(value, '$.net'), json_extract(value, '$.withhold'), json_extract(value, '$.detail_json'),
       json_extract(value, '$.pay_mode'), json_extract(value, '$.supplier_id'), json_extract(value, '$.supplier_name')
     FROM json_each(?)`, runId, pid, JSON.stringify(items));
}

// 합계: gross·tax·net 은 개인에게 지급하는 명세만. 인력공급업체 일괄지급분은 업체별 공급가·부가세(10%, 업체 합계 기준 절사)·합계로 따로 모은다
export const totals = (items) => {
  const own = items.filter((i) => i.pay_mode !== SUPPLIER_MODE), sup = items.filter((i) => i.pay_mode === SUPPLIER_MODE);
  const by = {};
  sup.forEach((i) => {
    const b = (by[i.supplier_id] = by[i.supplier_id] || { supplierId: i.supplier_id, name: i.supplier_name, people: 0, supply: 0 });
    b.people += 1; b.supply += i.gross;
  });
  const suppliers = Object.values(by).map((b) => ({ ...b, vat: supplyVat(b.supply), total: b.supply + supplyVat(b.supply) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  return {
    people: items.length, ownPeople: own.length, gross: own.reduce((n, i) => n + i.gross, 0), tax: own.reduce((n, i) => n + i.income_tax + i.local_tax, 0), net: own.reduce((n, i) => n + i.net, 0),
    suppliers, supply: suppliers.reduce((n, b) => n + b.supply, 0), vat: suppliers.reduce((n, b) => n + b.vat, 0), supplierTotal: suppliers.reduce((n, b) => n + b.total, 0)
  };
};
