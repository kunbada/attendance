// 견본 초기데이터 생성: node tools/make_sample.js  → ../견본_초기데이터.json  (새 현장 만들기에서 선택)
const fs = require('fs'), path = require('path');
// 회차: 계약금 1·2차 + 중도금 1~6차 + 잔금 (현장에서 안 쓰는 회차는 설정에서 끄면 됨)
const stages = ['계약금 1차', '계약금 2차', '중도금 1차', '중도금 2차', '중도금 3차', '중도금 4차', '중도금 5차', '중도금 6차', '잔금'];
const ratio = [0.05, 0.05, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.3];
const skinds = ['일반', '일반', '특공(신혼부부)', '특공(생애최초)'];
const now = new Date().toISOString(); const units = [];
for (const dong of ['101', '102']) for (let fl = 1; fl <= 5; fl++) for (let ln = 1; ln <= 4; ln++) {
  const ho = fl * 100 + ln, type = ln <= 2 ? '59A' : '84A', price = type === '59A' ? 250000000 : 330000000;
  const amounts = {}; stages.forEach((s, i) => amounts[s] = Math.round(price * ratio[i]));
  units.push({ id: `${dong}-${ho}`, dong, ho: String(ho), floor: fl, line: ln, type, skind: skinds[(fl + ln) % skinds.length], exArea: type === '59A' ? 59.9 : 84.9, resArea: 0, supArea: 0, etcArea: 0, conArea: 0, landArea: 0, price, amounts, updatedAt: now, updatedBy: '견본' });
}
const out = { app: 'bunyang', version: 2, exportedAt: now, units, contracts: [], pre: [], resv: [], locks: [], deposits: [], templates: [],
  settings: { id: 'main', depositCats: stages.concat(['환불', '환불지급', '대체지급', '예금결산', '입금오류', '기타']), project: { name: '견본 현장', lessor: '', bizNo: '', bank: '', account: '', moneyLabel: '분양대금' }, stages, stageDue: {}, special: {} } };
fs.writeFileSync(path.join(__dirname, '../견본_초기데이터.json'), JSON.stringify(out));
console.log('견본_초기데이터.json', units.length + '세대');
