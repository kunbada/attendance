// 고객 DB(고객관리 > 고객 DB): 같은 전화번호 해시를 가진 설문 응답·방명록(방문)·외부에서 올린 고객·계약을 한 고객으로 묶는다.
//  - 설문·방명록은 개인정보에 동의한 건만 묶는다. 외부 자료는 올릴 때 고른 출처와 동의 여부(동의/미확인)를 고객마다 기록한다.
//  - 전화번호 원문은 화면에 보내지 않는다(마스킹). 원문은 [연락처 보기]·내보내기에서만 주고 기록을 남긴다.
//  - 고객별 관리 정보(진행 상태·담당·메모·연락 거부)와 상담 기록은 customers / customer_notes 에 둔다.
import { AppError, s, all, first, run, stmt, decryptText, phoneHash, nowStr, todayStr, newId, writeLog } from '../core/util.js';
import { SCALE as RT_SCALE, backfillRealtorHash } from '../realtor/realtor.js';
import { GRADES, classify, loadGradeRules, saveGradeRules, DEFAULT_RULES } from './grade.js';
import { STD } from '../survey/std.js';
import { loadTypes, typeGroups, toGroup, typeLabel, groupLabel } from '../core/types.js';

export const STATUSES = ['신규', '연락중', '부재', '방문예정', '방문완료', '계약', '보류', '거부'];
export const NOTE_KINDS = ['TM', '상담', '메모'];
const CHANNELS = ['설문', '방문', '외부', '부동산', '상담', '계약'];
const PAGE = 50;

const maskPhone = (d) => (d && d.length >= 7 ? d.slice(0, 3) + '-****-' + d.slice(-4) : '');
const maskTail = (t) => (t ? '***-****-' + t : '');

// 전화번호 정리: 숫자만. 엑셀에서 앞의 0 이 빠진 번호(10…)와 +82 표기를 되돌린다. 올바르지 않으면 ''
export function normalizePhoneLoose(v) {
  let d = s(v).replace(/\D/g, '');
  if (d.startsWith('82') && d.length >= 11) d = '0' + d.slice(2);
  if (/^1[016789]\d{7,8}$/.test(d)) d = '0' + d;
  return /^0\d{8,10}$/.test(d) ? d : '';
}

// 방명록 옛 행(해시 도입 전)은 목록을 열 때 한 번에 채운다. 한 번에 최대 300건씩.
async function backfillGuestHash(env, pid) {
  const miss = await all(env, `SELECT id, phone FROM guestbook WHERE project_id = ? AND consent = 1 AND phone_hash = '' LIMIT 300`, pid);
  if (!miss.length) return 0;
  const list = [];
  for (const g of miss) list.push({ id: g.id, h: await phoneHash(env, g.phone) });
  const json = JSON.stringify(list);
  await env.DB.batch([stmt(env,
    `UPDATE guestbook SET phone_hash = (SELECT json_extract(value, '$.h') FROM json_each(?) WHERE json_extract(value, '$.id') = guestbook.id)
     WHERE project_id = ? AND id IN (SELECT json_extract(value, '$.id') FROM json_each(?))`, json, pid, json)]);
  return miss.length;
}

// 해약이 아닌 계약의 계약자 전화번호 → 해시. 계약 고객 표시와 "설문 → 방문 → 계약" 집계에 쓴다
async function contractIndex(env, pid) {
  const rows = await all(env,
    `SELECT dongho_g AS dongho, json_extract(json, '$.phone') AS phone, json_extract(json, '$.name') AS name, json_extract(json, '$.date') AS date
     FROM ct_records WHERE project_id = ? AND col = 'contracts' AND deleted = 0 AND COALESCE(status_g, '') <> '해약'`, pid);
  const map = new Map();
  for (const r of rows) {
    const d = normalizePhoneLoose(r.phone);
    if (!d) continue;
    map.set(await phoneHash(env, d), { dongho: s(r.dongho), name: s(r.name), date: s(r.date), phone: d });
  }
  return map;
}

// 이 현장의 고객 전체를 묶어 만든다 (목록·집계·내보내기 공용)
export async function loadCustomers(env, pid) {
  await backfillGuestHash(env, pid);
  const map = {};
  const cust = (h) => (map[h] = map[h] || {
    hash: h, name: '', phone: '', tail: '', phoneEnc: '', surveys: 0, lastSurveyAt: '', intent: '', subscr: '', visits: 0, lastVisit: '', people: 0,
    ext: null, realtor: null, contract: null, rank: '', special: '', counselAt: '', surveyTypes: new Set(), counselors: new Set(), counselNotes: 0, lastCounsel: '', notes: 0, lastNote: '', consent: '', status: '', ownerId: '', memo: '', dnc: false, source: '', region: '', interest: '', createdAt: ''
  });

  (await all(env,
    `SELECT r.phone_hash, r.submitted_at, p.name, p.phone_enc,
            (SELECT a.value_code FROM response_answers a WHERE a.response_id = r.id AND a.q_key = 'STD_INTENT' LIMIT 1) AS intent,
            (SELECT a.value_code FROM response_answers a WHERE a.response_id = r.id AND a.q_key = 'STD_SUBSCR' LIMIT 1) AS subscr,
            (SELECT group_concat(a.value_code) FROM response_answers a WHERE a.response_id = r.id AND a.q_key = 'STD_TYPE') AS types
     FROM responses r LEFT JOIN response_pii p ON p.response_id = r.id AND p.project_id = r.project_id
     WHERE r.project_id = ? AND r.phone_hash <> '' ORDER BY r.submitted_at`, pid)).forEach((r) => {
    const c = cust(r.phone_hash);
    c.surveys++; c.lastSurveyAt = r.submitted_at; if (r.intent) { c.intent = r.intent; c.subscr = r.subscr || ''; }
    if (r.types) s(r.types).split(',').forEach((v) => c.surveyTypes.add(v));
    if (r.name && !c.name) c.name = r.name;
    if (r.phone_enc) c.phoneEnc = r.phone_enc;
    c.consent = '동의';
  });
  (await all(env, `SELECT phone_hash, phone, name, visit_date, companions FROM guestbook WHERE project_id = ? AND phone_hash <> '' ORDER BY visit_date, created_at`, pid)).forEach((g) => {
    const c = cust(g.phone_hash);
    c.visits++; c.lastVisit = g.visit_date; c.people += 1 + g.companions;
    if (g.name) c.name = g.name; // 방문 때 직접 쓴 이름이 더 정확하다
    c.phone = g.phone;
    c.consent = '동의';
  });
  // 부동산고객(중개업소 조사): 휴대폰, 없으면 사무실 전화로 묶는다
  await backfillRealtorHash(env, pid);
  (await all(env,
    `SELECT cust_hash, office_name, office_tel, name, phone_enc, phone_tail, consent, mgm, refer_count, refer, market, intent, submitted_at
     FROM realtor_responses WHERE project_id = ? AND cust_hash <> '' ORDER BY submitted_at, rowid`, pid)).forEach((r) => {
    const c = cust(r.cust_hash);
    c.realtor = { office: r.office_name, mgm: r.mgm, referCount: r.refer_count, market: r.market, intent: r.intent, refer: r.refer, count: (c.realtor ? c.realtor.count : 0) + 1, last: r.submitted_at };
    if (!c.name) c.name = r.name || r.office_name;
    if (r.phone_enc) { if (!c.phoneEnc) c.phoneEnc = r.phone_enc; if (!c.tail && !c.phone) c.tail = r.phone_tail; }
    else if (!c.phone && !c.tail && !c.phoneEnc && r.office_tel) c.phone = r.office_tel;
    if (r.consent) c.consent = '동의'; else if (!c.consent) c.consent = '미확인';
  });
  (await all(env, 'SELECT * FROM customers WHERE project_id = ?', pid)).forEach((r) => {
    // 설문·방명록에 없는 고객은 외부 자료(source_kind 있음)일 때만 고객으로 센다. 덧붙인 행만 남은 경우는 건너뛴다
    if (!map[r.phone_hash] && !r.source_kind) return;
    const c = cust(r.phone_hash);
    // 상담고객 앱에서 만든 고객(source_kind '상담')은 "외부 자료"가 아니라 "상담" 경로로 센다
    if (r.source_kind && r.source_kind !== '상담') c.ext = { source: r.source, kind: r.source_kind };
    c.rank = r.subscr_rank || ''; c.special = r.special_kind || ''; c.counselAt = r.counsel_at || '';
    if (!c.name && r.name) c.name = r.name;
    if (r.phone_enc && !c.phoneEnc) c.phoneEnc = r.phone_enc;
    c.tail = r.phone_tail;
    if (c.consent !== '동의') c.consent = r.consent || '미확인';
    c.status = r.status; c.ownerId = r.owner_id; c.memo = r.memo; c.dnc = !!r.dnc; c.source = r.source; c.region = r.region; c.interest = r.interest; c.createdAt = r.created_at;
  });
  (await all(env, 'SELECT phone_hash, staff_id, COUNT(*) AS n, MAX(at) AS last FROM customer_notes WHERE project_id = ? GROUP BY phone_hash, staff_id', pid)).forEach((n) => {
    const c = map[n.phone_hash];
    if (!c) return;
    c.notes += n.n;
    if (s(n.last) > s(c.lastNote)) c.lastNote = n.last;
    // 상담고객 앱에서 남긴 기록: 누가 상담했는지 (중복 상담사 표시용)
    if (n.staff_id) { c.counselors.add(n.staff_id); c.counselNotes += n.n; if (s(n.last) > s(c.lastCounsel)) c.lastCounsel = n.last; }
  });
  // 가장 최근 상담 기록 내용 (목록의 "상담 기록" 칸)
  (await all(env,
    `SELECT n.phone_hash, n.result, n.content FROM customer_notes n
     JOIN (SELECT phone_hash, MAX(at) AS m FROM customer_notes WHERE project_id = ? GROUP BY phone_hash) x ON x.phone_hash = n.phone_hash AND x.m = n.at
     WHERE n.project_id = ?`, pid, pid)).forEach((n) => { if (map[n.phone_hash]) map[n.phone_hash].lastNoteText = [n.result, n.content].filter(Boolean).join(' · ').slice(0, 120); });
  const contracts = await contractIndex(env, pid);
  contracts.forEach((ct, h) => { if (map[h]) map[h].contract = { dongho: ct.dongho, date: ct.date }; });

  const manual = {};
  (await all(env, 'SELECT phone_hash, grade, memo FROM customer_grades WHERE project_id = ?', pid)).forEach((g) => { manual[g.phone_hash] = g; });
  const staff = {};
  (await all(env, 'SELECT id, name FROM staff WHERE project_id = ?', pid)).forEach((r) => { staff[r.id] = r.name; });

  const rules = await loadGradeRules(env, pid);
  const types = await loadTypes(env, pid);
  const groupCodes = new Set(typeGroups(types).map((g) => g.code));
  const rows = Object.values(map);
  rows.forEach((c) => {
    const m = manual[c.hash];
    const g = classify(c, m ? m.grade : '', rules);
    c.grade = g.grade; c.gradeSource = g.source; c.gradeMemo = m ? m.memo : '';
    c.statusAuto = !c.status;
    if (!c.status) c.status = c.contract ? '계약' : c.visits ? '방문완료' : '신규';
    c.owner = staff[c.ownerId] || '';
    // 관심 타입군: 설문(타입군 코드) + 상담·외부 자료의 관심 타입(세부 주택형이면 타입군으로). 기준표에 있는 타입군만 센다
    const gs = new Set();
    c.surveyTypes.forEach((v) => { if (groupCodes.has(v) || v === '미정') gs.add(v); });
    s(c.interest).split(',').filter(Boolean).forEach((v) => { const g = v === '미정' ? v : toGroup(v, types); if (groupCodes.has(g) || g === '미정') gs.add(g); });
    // 타입이 정해진 게 하나라도 있으면 "미정"은 빼고 센다
    if (gs.size > 1) gs.delete('미정');
    c.typeGroups = [...gs];
    c.interestLabel = s(c.interest).split(',').filter(Boolean).map((v) => typeLabel(v, types)).join(', ');
    if (!c.interestLabel && c.typeGroups.length) c.interestLabel = c.typeGroups.map((g) => (g === '미정' ? g : g + '타입')).join(', ');
    // 주요 내용: 청약 순위·설문 의향·방문·계약·중개업소·메모를 한 줄로 (목록 표시·검색용)
    c.summary = [
      c.rank ? '청약 ' + c.rank + (c.special ? '(' + c.special + ')' : '') : '',
      c.intent ? '의향 ' + (INTENT_LABEL[c.intent] || c.intent) : '',
      c.visits ? '방문 ' + c.visits + '회' : '',
      c.contract ? '계약 ' + c.contract.dongho : '',
      c.realtor ? '중개업소 ' + c.realtor.office + (c.realtor.mgm ? '(MGM ' + c.realtor.mgm + ')' : '') : '',
      c.ext ? c.ext.kind + '·' + c.ext.source : '',
      c.memo ? '메모: ' + s(c.memo).split(/\r?\n/)[0].slice(0, 40) : ''
    ].filter(Boolean).join(' · ');
    // 상담 경로: 상담고객 앱에서 등록했거나, 상담사가 기록을 남긴 고객 (중개사만인 사람은 "부동산"으로 둔다)
    c.isCounsel = !!(c.counselAt || (c.counselors.size && !(c.realtor && !c.surveys && !c.visits && !c.ext && !c.contract)));
    c.channels = [c.surveys ? '설문' : '', c.visits ? '방문' : '', c.ext ? '외부' : '', c.realtor ? '부동산' : '', c.isCounsel ? '상담' : '', c.contract ? '계약' : ''].filter(Boolean);
    c.last = [c.lastSurveyAt.slice(0, 10), c.lastVisit, s(c.lastNote).slice(0, 10), c.contract ? c.contract.date : '', c.realtor ? c.realtor.last.slice(0, 10) : '', c.createdAt.slice(0, 10)].sort().pop() || '';
  });
  return { rows, staff, types };
}

const INTENT_LABEL = Object.fromEntries(STD.STD_INTENT.options.map((o) => [o.code, o.label]));
const phoneText = (c) => (c.phone ? maskPhone(c.phone) : maskTail(c.tail));
const rowView = (c) => ({
  id: c.hash.slice(0, 12), name: c.name, phone: phoneText(c), grade: c.grade, gradeSource: c.gradeSource, gradeMemo: c.gradeMemo,
  status: c.status, statusAuto: c.statusAuto, channels: c.channels, source: c.ext ? c.ext.source : '', sourceKind: c.ext ? c.ext.kind : '',
  surveys: c.surveys, lastSurveyAt: c.lastSurveyAt, intent: c.intent, visits: c.visits, lastVisit: c.lastVisit, people: c.people,
  stage: c.surveys && c.visits ? '설문+방문' : c.surveys ? '설문만' : c.visits ? '방문만' : '외부',
  contract: c.contract, realtor: c.realtor, rank: c.rank, special: c.special, typeGroups: c.typeGroups, interestLabel: c.interestLabel, summary: c.summary, lastNoteText: c.lastNoteText || '', counselNotes: c.counselNotes, notes: c.notes, lastNote: c.lastNote, consent: c.consent, dnc: c.dnc, owner: c.owner, ownerId: c.ownerId, memo: c.memo, region: c.region, interest: c.interest, last: c.last
});

// 조건에 맞는 고객만 남긴다 (목록·내보내기 공용)
async function applyFilter(env, rows, data) {
  const q = s(data.q).trim().toLowerCase();
  const qd = q.replace(/\D/g, '');
  if (q) {
    const fullHash = qd.length >= 9 && normalizePhoneLoose(qd) ? await phoneHash(env, normalizePhoneLoose(qd)) : '';
    if (qd.length >= 3 && !fullHash) {
      // 설문만 있는 고객은 번호가 암호화되어 있어, 번호로 찾을 때만 풀어 본다
      for (const c of rows) if (!c.phone && !c.tail && c.phoneEnc) { try { c.phone = await decryptText(env, c.phoneEnc); } catch (e) { /* 풀 수 없는 값은 건너뜀 */ } }
    }
    // 이름·중개업소·주요 내용(청약·메모 등)·최근 상담 기록 내용으로도 찾는다
    rows = rows.filter((c) => ((c.name || '') + ' ' + (c.realtor ? c.realtor.office : '') + ' ' + (c.summary || '') + ' ' + (c.lastNoteText || '')).toLowerCase().includes(q) || (fullHash && c.hash === fullHash)
      || (!fullHash && qd.length >= 3 && ((c.phone && c.phone.includes(qd)) || (c.tail && qd.length <= 4 && c.tail.endsWith(qd)))));
  }
  const channel = s(data.channel);
  if (channel && channel !== '전체') { if (!CHANNELS.includes(channel)) throw new AppError('구분 값이 올바르지 않습니다.'); rows = rows.filter((c) => c.channels.includes(channel)); }
  const stage = s(data.stage);
  if (stage && stage !== '전체') {
    if (!['설문+방문', '설문만', '방문만', '외부'].includes(stage)) throw new AppError('구분 값이 올바르지 않습니다.');
    rows = rows.filter((c) => (c.surveys && c.visits ? '설문+방문' : c.surveys ? '설문만' : c.visits ? '방문만' : '외부') === stage);
  }
  const grade = s(data.grade);
  if (grade === '없음') rows = rows.filter((c) => !c.grade);
  else if (grade) { if (!GRADES.includes(grade)) throw new AppError('등급 값이 올바르지 않습니다.'); rows = rows.filter((c) => c.grade === grade); }
  const status = s(data.status);
  if (status) { if (!STATUSES.includes(status)) throw new AppError('진행 상태 값이 올바르지 않습니다.'); rows = rows.filter((c) => c.status === status); }
  const owner = s(data.ownerId);
  if (owner === '-') rows = rows.filter((c) => !c.ownerId); else if (owner) rows = rows.filter((c) => c.ownerId === owner);
  const consent = s(data.consent);
  if (consent) rows = rows.filter((c) => c.consent === consent);
  const source = s(data.source);
  if (source) rows = rows.filter((c) => c.ext && c.ext.source === source);
  if (data.callable === true) rows = rows.filter((c) => !c.dnc && c.status !== '거부' && c.status !== '계약');
  if (data.noNote === true) rows = rows.filter((c) => !c.notes);
  const note = s(data.note);
  if (note === '있음') rows = rows.filter((c) => c.notes); else if (note === '없음') rows = rows.filter((c) => !c.notes);
  // 최근 활동: 7일·30일 이내, 또는 30일 넘게 활동 없음
  const recent = s(data.recent);
  if (recent) {
    const ago = (n) => new Date(Date.now() + 9 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
    if (recent === '7') rows = rows.filter((c) => c.last >= ago(7));
    else if (recent === '30') rows = rows.filter((c) => c.last >= ago(30));
    else if (recent === 'old') rows = rows.filter((c) => !c.last || c.last < ago(30));
    else throw new AppError('최근 활동 조건 값이 올바르지 않습니다.');
  }
  const type = s(data.type);
  if (type) rows = rows.filter((c) => c.typeGroups.includes(type));
  const sort = s(data.sort) || '최근';
  const gi = (g) => (g ? GRADES.indexOf(g) : 9);
  if (sort === '이름') rows.sort((a, b) => (a.name || '힣').localeCompare(b.name || '힣', 'ko'));
  else if (sort === '등급') rows.sort((a, b) => gi(a.grade) - gi(b.grade) || b.last.localeCompare(a.last));
  else rows.sort((a, b) => b.last.localeCompare(a.last));
  return rows;
}

export async function customerList(env, data, ctx) {
  const pid = ctx.projectId;
  const { rows: allRows, staff, types } = await loadCustomers(env, pid);
  const count = (fn) => allRows.filter(fn).length;
  const high = allRows.filter((c) => Number(c.intent) >= 4);
  const summary = {
    total: allRows.length,
    channels: { 설문: count((c) => c.surveys), 방문: count((c) => c.visits), 외부: count((c) => c.ext), 부동산: count((c) => c.realtor), 상담: count((c) => c.isCounsel), 계약: count((c) => c.contract) },
    grades: Object.fromEntries(GRADES.map((g) => [g, count((c) => c.grade === g)])), noGrade: count((c) => !c.grade),
    statuses: Object.fromEntries(STATUSES.map((x) => [x, count((c) => c.status === x)])),
    // 퍼널: 설문 → 방문 → 계약
    surveyToVisit: count((c) => c.surveys && c.visits), visitToContract: count((c) => c.visits && c.contract),
    highIntent: high.length, highIntentVisited: high.filter((c) => c.visits).length,
    realtorMgm: count((c) => c.realtor && c.realtor.mgm === '참여'), realtorRefer: allRows.reduce((a, c) => a + (c.realtor ? c.realtor.referCount : 0), 0),
    // 관심 타입군별 고객 수 (프로젝트 주택형 기준표의 타입군 순서)
    types: typeGroups(types).map((g) => ({ code: g.code, label: g.label, units: g.units, n: count((c) => c.typeGroups.includes(g.code)) }))
      .concat(types.length ? [{ code: '미정', label: '미정', units: 0, n: count((c) => c.typeGroups.includes('미정')) }] : []),
    unconfirmed: count((c) => c.consent === '미확인'), dnc: count((c) => c.dnc), noNote: count((c) => !c.notes), noOwner: count((c) => !c.ownerId)
  };
  // 예전 화면·시험이 쓰던 이름도 함께 준다
  const funnel = { surveyCustomers: summary.channels.설문, visitCustomers: summary.channels.방문, both: summary.surveyToVisit, highIntent: summary.highIntent, highIntentVisited: summary.highIntentVisited, grades: summary.grades };
  const sources = [...new Set(allRows.filter((c) => c.ext).map((c) => c.ext.source))].sort((a, b) => a.localeCompare(b, 'ko'));
  const rows = await applyFilter(env, allRows.slice(), data);
  const page = Math.max(1, Number(data.page) || 1);
  const slice = rows.slice((page - 1) * PAGE, page * PAGE);
  // 화면에 나가는 줄 가운데 번호가 암호화만 되어 있는 것(설문만 있는 고객)은 이때 풀어 마스킹한다
  for (const c of slice) if (!c.phone && !c.tail && c.phoneEnc) { try { c.phone = await decryptText(env, c.phoneEnc); } catch (e) { /* 건너뜀 */ } }
  return {
    summary, funnel, sources, statuses: STATUSES, shown: slice.length, total: allRows.length, matched: rows.length, page, pageSize: PAGE,
    staff: Object.keys(staff).map((id) => ({ id, name: staff[id] })).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    customers: slice.map(rowView)
  };
}

// 목록의 id(해시 앞 12자) → 전체 해시. 이 현장의 고객(설문·방명록·외부 자료)일 때만 찾는다
export async function resolveHash(env, pid, id) {
  id = s(id).trim();
  if (!/^[0-9a-f]{12}$/.test(id)) throw new AppError('고객 정보가 올바르지 않습니다.');
  const hi = id + 'g'; // 16진수 문자보다 큰 글자 → 앞 12자가 같은 범위
  const hit = await first(env,
    `SELECT phone_hash FROM customers WHERE project_id = ? AND phone_hash >= ? AND phone_hash < ? AND source_kind <> ''
     UNION SELECT phone_hash FROM responses WHERE project_id = ? AND phone_hash >= ? AND phone_hash < ?
     UNION SELECT phone_hash FROM guestbook WHERE project_id = ? AND phone_hash >= ? AND phone_hash < ?
     UNION SELECT cust_hash FROM realtor_responses WHERE project_id = ? AND cust_hash >= ? AND cust_hash < ?
     UNION SELECT phone_hash FROM customers WHERE project_id = ? AND phone_hash >= ? AND phone_hash < ? AND counsel_at <> '' LIMIT 1`, pid, id, hi, pid, id, hi, pid, id, hi, pid, id, hi, pid, id, hi);
  if (!hit) throw new AppError('이 현장에서 고객을 찾을 수 없습니다.');
  return hit.phone_hash;
}

// 고객 한 명의 전체 이력 (설문·방문·상담 기록·계약·업로드)
export async function customerGet(env, data, ctx) {
  const pid = ctx.projectId;
  const hash = await resolveHash(env, pid, data.id);
  const { rows } = await loadCustomers(env, pid);
  const c = rows.find((x) => x.hash === hash);
  if (!c) throw new AppError('이 현장에서 고객을 찾을 수 없습니다.');
  if (!c.phone && !c.tail && c.phoneEnc) { try { c.phone = await decryptText(env, c.phoneEnc); } catch (e) { /* 건너뜀 */ } }
  const staff = {};
  (await all(env, 'SELECT id, name FROM staff WHERE project_id = ?', pid)).forEach((r) => { staff[r.id] = r.name; });
  const timeline = [];
  (await all(env,
    `SELECT r.submitted_at, r.person_id, r.consent_mkt, sv.title,
            (SELECT a.value_text FROM response_answers a WHERE a.response_id = r.id AND a.q_key = 'STD_INTENT' LIMIT 1) AS intent
     FROM responses r LEFT JOIN surveys sv ON sv.id = r.survey_id AND sv.project_id = r.project_id
     WHERE r.project_id = ? AND r.phone_hash = ?`, pid, hash)).forEach((r) => timeline.push({
    at: r.submitted_at, type: '설문', title: s(r.title) || '설문 응답',
    text: [r.intent ? '분양 의향: ' + r.intent : '', r.person_id && staff[r.person_id] ? '담당 ' + staff[r.person_id] : '', r.consent_mkt ? '마케팅 수신 동의' : ''].filter(Boolean).join(' · ')
  }));
  (await all(env, 'SELECT visit_date, created_at, companions, staff_id, staff_none FROM guestbook WHERE project_id = ? AND phone_hash = ?', pid, hash)).forEach((g) => timeline.push({
    at: g.created_at || g.visit_date, type: '방문', title: '모델하우스 방문',
    text: [g.companions ? '동반 ' + g.companions + '명' : '', staff[g.staff_id] ? '담당 ' + staff[g.staff_id] : ''].filter(Boolean).join(' · ')
  }));
  (await all(env, 'SELECT id, at, kind, result, content, import_id, created_by FROM customer_notes WHERE project_id = ? AND phone_hash = ?', pid, hash)).forEach((n) => timeline.push({
    at: n.at, type: n.kind, title: n.result || n.kind, text: n.content, noteId: n.id, by: n.created_by, imported: !!n.import_id
  }));
  (await all(env, 'SELECT submitted_at, office_name, market, intent, refer, refer_count, mgm, opinion FROM realtor_responses WHERE project_id = ? AND cust_hash = ?', pid, hash)).forEach((r) => timeline.push({
    at: r.submitted_at, type: '부동산', title: '중개업소 조사 · ' + r.office_name,
    text: ['시장 동향 ' + RT_SCALE.market[r.market], '분양 의향 ' + RT_SCALE.intent[r.intent], '소개 의향 ' + RT_SCALE.refer[r.refer], '소개 가능 ' + r.refer_count + '명', r.mgm ? 'MGM ' + r.mgm : '', r.opinion].filter(Boolean).join(' · ')
  }));
  if (c.contract) timeline.push({ at: c.contract.date, type: '계약', title: '계약 ' + c.contract.dongho, text: '' });
  if (c.ext && c.createdAt) timeline.push({ at: c.createdAt, type: '등록', title: '외부 자료 등록', text: c.ext.kind + ' · 출처 ' + c.ext.source });
  timeline.sort((a, b) => s(b.at).localeCompare(s(a.at)));
  const staffList = Object.keys(staff).map((id) => ({ id, name: staff[id] })).sort((x, y) => x.name.localeCompare(y.name, 'ko'));
  return { customer: rowView(c), timeline, statuses: STATUSES, noteKinds: NOTE_KINDS, staff: staffList };
}

// 고객 관리 정보 저장: 진행 상태·담당 직원·메모·연락 거부·이름. 설문·방명록 고객이면 덧붙이는 행이 만들어진다
export async function customerSave(env, data, ctx) {
  const pid = ctx.projectId;
  const hash = await resolveHash(env, pid, data.id);
  const status = s(data.status);
  if (status && !STATUSES.includes(status)) throw new AppError('진행 상태 값이 올바르지 않습니다.');
  const ownerId = s(data.ownerId);
  if (ownerId && !(await first(env, 'SELECT 1 FROM staff WHERE id = ? AND project_id = ?', ownerId, pid))) throw new AppError('이 현장의 직원이 아닙니다.');
  const memo = s(data.memo).trim().slice(0, 500);
  const name = s(data.name).trim().slice(0, 30);
  const dnc = data.dnc === true ? 1 : 0;
  await run(env,
    `INSERT INTO customers (project_id, phone_hash, name, status, owner_id, memo, dnc, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, phone_hash) DO UPDATE SET name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE customers.name END,
       status = excluded.status, owner_id = excluded.owner_id, memo = excluded.memo, dnc = excluded.dnc, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    pid, hash, name, status, ownerId, memo, dnc, nowStr(), nowStr(), ctx.account.login_id);
  await writeLog(env, ctx.account.login_id, '고객수정', hash.slice(0, 12), (status || '자동') + (dnc ? ' / 연락 거부' : ''), pid);
  return {};
}

const isAt = (v) => /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(v);

export async function customerNoteAdd(env, data, ctx) {
  const pid = ctx.projectId;
  const hash = await resolveHash(env, pid, data.id);
  const kind = s(data.kind) || '메모';
  if (!NOTE_KINDS.includes(kind)) throw new AppError('기록 구분은 TM / 상담 / 메모 중에서 선택해 주세요.');
  const at = s(data.at).trim() || nowStr().slice(0, 16);
  if (!isAt(at)) throw new AppError('일시 형식이 올바르지 않습니다.');
  const result = s(data.result).trim().slice(0, 30), content = s(data.content).trim().slice(0, 1000);
  if (!result && !content) throw new AppError('결과 또는 내용을 입력해 주세요.');
  const id = newId('CN');
  await run(env, 'INSERT INTO customer_notes (id, project_id, phone_hash, at, kind, result, content, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, pid, hash, at, kind, result, content, ctx.account.login_id, nowStr());
  return { id };
}

export async function customerNoteDelete(env, data, ctx) {
  const res = await run(env, 'DELETE FROM customer_notes WHERE id = ? AND project_id = ?', s(data.noteId), ctx.projectId);
  if (!res.meta.changes) throw new AppError('기록을 찾을 수 없습니다.');
  await writeLog(env, ctx.account.login_id, '고객기록삭제', s(data.noteId), '', ctx.projectId);
  return {};
}

export async function fullPhone(env, pid, hash) {
  const g = await first(env, `SELECT phone FROM guestbook WHERE project_id = ? AND phone_hash = ? AND phone <> '' LIMIT 1`, pid, hash);
  if (g) return g.phone;
  const c = await first(env, `SELECT phone_enc FROM customers WHERE project_id = ? AND phone_hash = ? AND phone_enc <> ''`, pid, hash);
  if (c) return decryptText(env, c.phone_enc);
  const p = await first(env,
    `SELECT p.phone_enc FROM responses r JOIN response_pii p ON p.response_id = r.id AND p.project_id = r.project_id WHERE r.project_id = ? AND r.phone_hash = ? AND p.phone_enc <> '' LIMIT 1`, pid, hash);
  if (p) return decryptText(env, p.phone_enc);
  const rt = await first(env, `SELECT phone_enc, office_tel FROM realtor_responses WHERE project_id = ? AND cust_hash = ? ORDER BY phone_enc = '' LIMIT 1`, pid, hash);
  return rt ? (rt.phone_enc ? decryptText(env, rt.phone_enc) : rt.office_tel) : '';
}

// 전화번호 원문 보기 (전화를 걸 때). 볼 때마다 기록한다
export async function customerReveal(env, data, ctx) {
  const pid = ctx.projectId;
  const hash = await resolveHash(env, pid, data.id);
  const phone = await fullPhone(env, pid, hash);
  await writeLog(env, ctx.account.login_id, '고객연락처열람', hash.slice(0, 12), '', pid);
  return { phone };
}

// 조건에 맞는 고객을 전화번호 원문과 함께 내보낸다. 관리자 또는 설문 관리가 허용된 계정만, 기록을 남긴다
const EXPORT_MAX = 2000;
export async function customerExport(env, data, ctx) {
  if (ctx.role !== 'admin' && !ctx.account.allow_survey) throw new AppError('고객 내보내기는 관리자 또는 설문 관리가 허용된 계정만 할 수 있습니다.', 'FORBIDDEN');
  const pid = ctx.projectId;
  const { rows: allRows } = await loadCustomers(env, pid);
  const rows = (await applyFilter(env, allRows, data)).slice(0, EXPORT_MAX);
  const out = [];
  for (const c of rows) {
    let phone = c.phone;
    if (!phone && c.phoneEnc) { try { phone = await decryptText(env, c.phoneEnc); } catch (e) { phone = ''; } }
    out.push({ ...rowView(c), phone });
  }
  await writeLog(env, ctx.account.login_id, '고객내보내기', pid, out.length + '명', pid);
  return { rows: out, max: EXPORT_MAX };
}

// 등급 직접 입력(TM 상담 결과 등). grade 가 비어 있으면 수동 지정을 지우고 자동 분류로 돌아간다.
export async function customerGradeSave(env, data, ctx) {
  const pid = ctx.projectId;
  const hash = await resolveHash(env, pid, data.id);
  const grade = s(data.grade).trim().toUpperCase();
  if (grade && !GRADES.includes(grade)) throw new AppError('등급은 A, B, C, D 중에서 골라 주세요.');
  const memo = s(data.memo).trim().slice(0, 200);
  if (!grade) await run(env, 'DELETE FROM customer_grades WHERE project_id = ? AND phone_hash = ?', pid, hash);
  else {
    await run(env,
      `INSERT INTO customer_grades (project_id, phone_hash, grade, memo, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, phone_hash) DO UPDATE SET grade = excluded.grade, memo = excluded.memo, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      pid, hash, grade, memo, nowStr(), ctx.account.login_id);
  }
  await writeLog(env, ctx.account.login_id, '고객등급', hash.slice(0, 12), grade || '수동 해제', pid);
  return { ok: true };
}

// ---------- 등급관리: 자동 등급 기준 (현장별) ----------

function gradeStats(rows) {
  const by = (fn) => Object.fromEntries(GRADES.map((g) => [g, rows.filter((c) => fn(c) && c.grade === g).length]).concat([['없음', rows.filter((c) => fn(c) && !c.grade).length]]));
  return {
    total: by(() => true), manual: rows.filter((c) => c.gradeSource === '수동').length,
    channels: { 설문: by((c) => c.surveys), 방문: by((c) => c.visits), 부동산: by((c) => c.realtor) }
  };
}

const INTENT_LABELS = Object.fromEntries(STD.STD_INTENT.options.map((o) => [o.code, o.label]));

export async function customerGradeRules(env, data, ctx) {
  const { rows } = await loadCustomers(env, ctx.projectId);
  return { rules: await loadGradeRules(env, ctx.projectId), defaults: DEFAULT_RULES, surveyLabels: INTENT_LABELS, stats: gradeStats(rows) };
}

export async function customerGradeRulesSave(env, data, ctx) {
  const rules = await saveGradeRules(env, ctx.projectId, data.rules, ctx);
  const { rows } = await loadCustomers(env, ctx.projectId);
  return { rules, stats: gradeStats(rows) };
}
