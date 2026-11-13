// 고객관리 > 부동산고객: 중개업소 조사. 현장마다 조사 링크 1개(QR), 명함 사진 AI 인식(Google Gemini), 조사 원장·중개업소 묶음.
// 개인정보 원칙: 개인정보 제공에 동의한 경우만 이름·직함·휴대폰을 저장한다(휴대폰은 암호화 + 해시).
// 상호·주소·사무실 전화는 간판·명함에 공개된 사업장 정보라 동의와 무관하게 저장한다.
import { AppError, s, all, first, run, nowStr, todayStr, newId, randomToken, encryptText, decryptText, phoneHash, writeLog } from '../core/util.js';

export const SCALE = {
  market: ['', '매우 나쁨', '나쁨', '보통', '좋음', '매우 좋음'],
  intent: ['', '매우 낮음', '낮음', '보통', '높음', '매우 높음'],
  refer: ['', '매우 낮음', '낮음', '보통', '높음', '매우 높음']
};
const PAGE = 50;
export const DEFAULT_REALTOR_CONSENT = [
  '당사는 현장 분양 업무 협력(분양 정보 안내, 고객 소개 협의)을 위해 아래와 같이 개인정보를 수집·이용합니다.',
  '',
  '1. 수집 항목: 성명, 직함, 휴대폰 번호 (명함에 적힌 정보)',
  '2. 이용 목적: 분양 정보 안내, 고객 소개 관련 연락',
  '3. 보유 기간: 현장 분양 종료 후 6개월 (이후 파기)',
  '4. 명함 사진은 글자를 읽기 위해 외부 AI 서비스(Google)로 보내지며, 당사 서버에는 사진을 저장하지 않습니다.',
  '',
  '동의를 거부할 수 있으며, 거부하시면 상호·주소·사무실 전화와 조사 응답만 기록합니다.'
].join('\n');

const maskPhone = (d) => (d && d.length >= 7 ? d.slice(0, 3) + '-****-' + d.slice(-4) : '');
const MOBILE_RE = /^01[016789]\d{7,8}$/;

// 사무실 전화: 숫자만 (02-123-4567, 031-…, 070-…, 1588-…). 엑셀처럼 앞 0 이 빠진 경우는 없으니 그대로 검사
function cleanTel(v) {
  let d = s(v).replace(/\D/g, '');
  if (d.startsWith('82') && d.length >= 10) d = '0' + d.slice(2);
  if (!d) return '';
  if (!/^(0\d{8,10}|1[5-9]\d{6})$/.test(d)) return null;
  return d;
}
function cleanMobile(v) {
  let d = s(v).replace(/\D/g, '');
  if (d.startsWith('82') && d.length >= 11) d = '0' + d.slice(2);
  if (!d) return '';
  return MOBILE_RE.test(d) ? d : null;
}
export function fmtTel(d) {
  d = s(d);
  if (!d) return '';
  if (/^02/.test(d)) return d.replace(/^(02)(\d{3,4})(\d{4})$/, '$1-$2-$3');
  if (/^1\d{7}$/.test(d)) return d.replace(/^(\d{4})(\d{4})$/, '$1-$2');
  return d.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3');
}
const score = (v, label) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new AppError(label + '을(를) 선택해 주세요.');
  return n;
};

// 조사 입력값 정리 (공개 화면 제출과 관리자 수정이 같은 규칙을 쓴다)
async function cleanInput(env, d) {
  const officeName = s(d.officeName).trim().slice(0, 60);
  if (!officeName) throw new AppError('상호(중개사무소 이름)를 입력해 주세요.');
  const officeTel = cleanTel(d.officeTel);
  if (officeTel === null) throw new AppError('사무실 전화번호 형식을 확인해 주세요.');
  const address = s(d.address).trim().slice(0, 150);
  if (d.consent !== true && d.consent !== false) throw new AppError('개인정보 제공 동의 여부를 선택해 주세요.');
  const consent = d.consent === true;
  let name = '', position = '', mobile = '';
  if (consent) {
    name = s(d.name).trim().slice(0, 30);
    position = s(d.position).trim().slice(0, 30);
    mobile = cleanMobile(d.mobile);
    if (mobile === null) throw new AppError('휴대폰 번호 형식을 확인해 주세요.');
  }
  if (!mobile && !officeTel) throw new AppError('휴대폰 또는 사무실 전화 중 하나는 입력해 주세요.');
  const market = score(d.market, '시장 동향');
  const intent = score(d.intent, '분양 의향');
  const refer = score(d.refer, '소개 의향');
  const rc = s(d.referCount).trim();
  if (!/^\d{1,4}$/.test(rc)) throw new AppError('소개 가능 고객 수를 숫자로 입력해 주세요. (없으면 0)');
  const opinion = s(d.opinion).trim().slice(0, 1000);
  if (!opinion) throw new AppError('기타 의견을 입력해 주세요. (없으면 "없음")');
  return {
    officeName, officeTel, address, consent, name, position, mobile, market, intent, refer, referCount: Number(rc), opinion,
    phoneEnc: mobile ? await encryptText(env, mobile) : '', phoneHash: mobile ? await phoneHash(env, mobile) : '', phoneTail: mobile ? mobile.slice(-4) : ''
  };
}

// ---------- 관리: 조사 링크 ----------

async function newFormCode(env) {
  for (let i = 0; i < 10; i++) {
    const code = randomToken(6);
    if (!(await first(env, 'SELECT 1 FROM realtor_forms WHERE code = ?', code))) return code;
  }
  throw new AppError('링크 코드를 만들지 못했습니다. 다시 시도해 주세요.');
}

const dailyLimit = (env) => Math.max(0, Number(env.OCR_DAILY_LIMIT) || 300);   // 현장 하나의 하루 명함 인식 수
const totalLimit = (env) => Math.max(0, Number(env.OCR_TOTAL_LIMIT) || 1000);  // 모든 현장 합계 (무료 한도 보호)

export async function realtorFormGet(env, data, ctx) {
  const pid = ctx.projectId;
  const f = await first(env, 'SELECT * FROM realtor_forms WHERE project_id = ?', pid);
  const u = await first(env, 'SELECT n FROM ocr_usage WHERE project_id = ? AND day = ?', pid, todayStr());
  return {
    form: f ? { code: f.code, active: !!f.active, consentText: f.consent_text, createdAt: f.created_at } : null,
    defaultConsentText: DEFAULT_REALTOR_CONSENT,
    ocr: { enabled: !!env.GEMINI_API_KEY, today: u ? u.n : 0, limit: dailyLimit(env) }
  };
}

// 링크가 없으면 만들고, 있으면 사용 여부·동의 문구만 바꾼다 (현장당 1개)
export async function realtorFormSave(env, data, ctx) {
  const pid = ctx.projectId;
  const now = nowStr();
  const consent = s(data.consentText).trim().slice(0, 3000);
  const cur = await first(env, 'SELECT * FROM realtor_forms WHERE project_id = ?', pid);
  if (!cur) {
    const code = await newFormCode(env);
    try {
      await run(env, 'INSERT INTO realtor_forms (project_id, code, active, consent_text, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)', pid, code, consent || DEFAULT_REALTOR_CONSENT, now, now);
    } catch (e) {
      if (!/UNIQUE|PRIMARY/i.test(String(e.message))) throw e; // 두 번 눌러도 하나만
    }
    await writeLog(env, ctx.account.login_id, '부동산조사링크생성', pid, '', pid);
    return realtorFormGet(env, data, ctx);
  }
  const active = data.active === undefined ? cur.active : (data.active ? 1 : 0);
  await run(env, 'UPDATE realtor_forms SET active = ?, consent_text = ?, updated_at = ? WHERE project_id = ?', active, consent || cur.consent_text, now, pid);
  return realtorFormGet(env, data, ctx);
}

// ---------- 공개: 조사 화면 (로그인 없음, 링크 코드) ----------

async function loadForm(env, code) {
  code = s(code).trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new AppError('조사 링크가 올바르지 않습니다. 링크를 다시 확인해 주세요.');
  const f = await first(env, 'SELECT f.*, p.name AS project_name, p.status AS project_status FROM realtor_forms f JOIN projects p ON p.id = f.project_id WHERE f.code = ?', code);
  if (!f) throw new AppError('존재하지 않는 조사 링크입니다. 링크를 다시 확인해 주세요.');
  return f;
}
const isOpen = (f) => f.active && f.project_status !== '종료';

export async function realtorPublicForm(env, data) {
  const f = await loadForm(env, data.code);
  if (!isOpen(f)) return { closed: true, projectName: f.project_name };
  return { projectName: f.project_name, consentText: f.consent_text, ocr: !!env.GEMINI_API_KEY };
}

const OCR_PROMPT = '이 사진은 한국 부동산 중개사무소(공인중개사)의 명함입니다. 명함에 적힌 글자만 읽어서 JSON 으로 답하세요. ' +
  '없는 항목은 빈 문자열. 추측하지 마세요. officeName=중개사무소 상호(예: ○○공인중개사사무소), name=사람 이름, position=직함(대표, 실장 등), ' +
  'mobile=휴대폰 번호(010 등으로 시작), officeTel=사무실 전화(02, 031, 070, 1588 등. 팩스는 제외), address=사무소 주소. ' +
  '명함이 아니거나 읽을 수 없으면 모두 빈 문자열.';
const OCR_SCHEMA = {
  type: 'OBJECT',
  properties: { officeName: { type: 'STRING' }, name: { type: 'STRING' }, position: { type: 'STRING' }, mobile: { type: 'STRING' }, officeTel: { type: 'STRING' }, address: { type: 'STRING' } },
  required: ['officeName', 'name', 'position', 'mobile', 'officeTel', 'address']
};
// 무료 한도는 모델마다 따로라서, 앞 모델이 한도 초과(429)·없음(404)이면 다음 모델로 넘어간다
const DEFAULT_MODELS = 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash-lite';

async function geminiRead(env, b64, mime) {
  const base = s(env.GEMINI_API_BASE) || 'https://generativelanguage.googleapis.com';
  const models = s(env.GEMINI_MODELS || DEFAULT_MODELS).split(',').map((x) => x.trim()).filter(Boolean);
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ inline_data: { mime_type: mime, data: b64 } }, { text: OCR_PROMPT }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: OCR_SCHEMA }
  });
  let limited = false, badKey = false;
  for (const m of models) {
    let res;
    try {
      // 키는 x-goog-api-key 헤더 하나로만 보낸다 (새 형식 AQ. 키와 예전 AIza 키 모두 이 방식으로 동작)
      res = await fetch(`${base}/v1beta/models/${encodeURIComponent(m)}:generateContent`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY }, body });
    } catch (e) { continue; }
    if (!res.ok) { if (res.status === 429) limited = true; if (res.status === 401 || res.status === 403) badKey = true; continue; }
    const j = await res.json().catch(() => null);
    const text = j && j.candidates && j.candidates[0] && j.candidates[0].content && (j.candidates[0].content.parts || []).map((p) => p.text || '').join('');
    if (!text) continue;
    let o;
    try { o = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { continue; }
    return { fields: o, model: m };
  }
  if (badKey && !limited) throw new AppError('명함 인식 키가 올바르지 않습니다. 관리자에게 알려 주세요. 그동안은 직접 입력해 주세요.', 'OCR_KEY');
  throw new AppError(limited ?'오늘 명함 인식 무료 한도가 찼습니다. 직접 입력해 주세요.' : '명함을 읽지 못했습니다. 다시 찍거나 직접 입력해 주세요.', limited ? 'OCR_LIMIT' : 'OCR_FAIL');
}

export async function realtorOcr(env, data) {
  const f = await loadForm(env, data.code);
  if (!isOpen(f)) throw new AppError('사용이 중지된 조사 링크입니다.');
  if (data.consent !== true) throw new AppError('개인정보 제공에 동의한 경우에만 명함 인식을 쓸 수 있습니다. 직접 입력해 주세요.');
  if (!env.GEMINI_API_KEY) throw new AppError('명함 인식이 아직 설정되지 않았습니다. 직접 입력해 주세요.', 'OCR_OFF');
  const mime = s(data.mime) || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw new AppError('사진 형식이 올바르지 않습니다.');
  const b64 = s(data.image);
  if (!b64 || b64.length > 1500000 || !/^[A-Za-z0-9+/=]+$/.test(b64)) throw new AppError('사진이 너무 크거나 올바르지 않습니다. 다시 찍어 주세요.');
  const day = todayStr();
  const tot = await first(env, 'SELECT COALESCE(SUM(n), 0) AS n FROM ocr_usage WHERE day = ?', day);
  if (tot.n >= totalLimit(env)) throw new AppError('오늘 명함 인식 한도가 찼습니다. 직접 입력해 주세요.', 'OCR_LIMIT');
  // 쓰기 전에 먼저 센다 (동시에 여러 명이 눌러도 한도를 넘지 않게 조건부 증가)
  const got = await first(env,
    `INSERT INTO ocr_usage (project_id, day, n) VALUES (?, ?, 1) ON CONFLICT(project_id, day) DO UPDATE SET n = n + 1 WHERE ocr_usage.n < ? RETURNING n`,
    f.project_id, day, dailyLimit(env));
  if (!got || dailyLimit(env) < 1) throw new AppError('이 현장의 오늘 명함 인식 한도가 찼습니다. 직접 입력해 주세요.', 'OCR_LIMIT');
  const { fields } = await geminiRead(env, b64, mime);
  const str = (k, n) => s(fields && fields[k]).trim().slice(0, n);
  const mobile = cleanMobile(str('mobile', 30)), tel = cleanTel(str('officeTel', 30));
  return {
    officeName: str('officeName', 60), name: str('name', 30), position: str('position', 30),
    mobile: mobile ? fmtTel(mobile) : str('mobile', 30), officeTel: tel ? fmtTel(tel) : str('officeTel', 30), address: str('address', 150)
  };
}

export async function realtorSubmit(env, data) {
  const f = await loadForm(env, data.code);
  if (!isOpen(f)) throw new AppError('사용이 중지된 조사 링크입니다.');
  const nonce = s(data.nonce).slice(0, 64);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(nonce)) throw new AppError('제출 정보를 확인할 수 없습니다. 페이지를 새로고침해 주세요.');
  const v = await cleanInput(env, data);
  try {
    await run(env,
      `INSERT INTO realtor_responses (id, project_id, office_name, office_tel, address, consent, name, position, phone_enc, phone_hash, phone_tail, market, intent, refer, refer_count, opinion, ocr, nonce, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      newId('RT'), f.project_id, v.officeName, v.officeTel, v.address, v.consent ? 1 : 0, v.name, v.position, v.phoneEnc, v.phoneHash, v.phoneTail,
      v.market, v.intent, v.refer, v.referCount, v.opinion, data.ocr === true ? 1 : 0, nonce, nowStr());
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) return {}; // 같은 제출이 다시 들어온 것
    throw e;
  }
  return {};
}

// ---------- 관리: 중개업소 목록·상세·수정 ----------

// 같은 중개업소 묶기: 휴대폰 해시 또는 사무실 전화가 하나라도 같으면 한 곳. 둘 다 없으면 상호+주소
function groupOffices(rows) {
  const parent = rows.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seen = {};
  rows.forEach((r, i) => {
    const keys = [];
    if (r.phone_hash) keys.push('H' + r.phone_hash);
    if (r.office_tel) keys.push('T' + r.office_tel);
    if (!keys.length) keys.push('N' + r.office_name.replace(/\s/g, '') + '|' + r.address.replace(/\s/g, ''));
    keys.forEach((k) => { if (seen[k] === undefined) seen[k] = i; else parent[find(i)] = find(seen[k]); });
  });
  const groups = {};
  rows.forEach((r, i) => { (groups[find(i)] = groups[find(i)] || []).push(r); });
  // rows 는 최근순이라 각 묶음의 첫 줄이 가장 최근 조사
  return Object.values(groups);
}

function officeView(list) {
  const r = list[0];
  const named = list.find((x) => x.name) || {};
  const withPhone = list.find((x) => x.phone_tail) || {};
  const tel = list.find((x) => x.office_tel) || {};
  return {
    id: r.id, officeName: r.office_name, address: r.address || (list.find((x) => x.address) || {}).address || '', officeTel: fmtTel(tel.office_tel || ''),
    name: named.name || '', position: named.position || '', phone: withPhone.phone_tail ? '***-****-' + withPhone.phone_tail : '',
    consent: list.some((x) => x.consent), market: r.market, intent: r.intent, refer: r.refer, referCount: r.refer_count, opinion: r.opinion,
    count: list.length, last: r.submitted_at, first: list[list.length - 1].submitted_at, memo: (list.find((x) => x.memo) || {}).memo || ''
  };
}

const responseView = (r) => ({
  id: r.id, at: r.submitted_at, officeName: r.office_name, officeTel: fmtTel(r.office_tel), address: r.address, consent: !!r.consent, name: r.name, position: r.position,
  phone: r.phone_tail ? '***-****-' + r.phone_tail : '', hasPhone: !!r.phone_enc, market: r.market, intent: r.intent, refer: r.refer, referCount: r.refer_count, opinion: r.opinion,
  ocr: !!r.ocr, memo: r.memo, updatedAt: r.updated_at, updatedBy: r.updated_by
});

async function loadOffices(env, pid) {
  const rows = await all(env, 'SELECT * FROM realtor_responses WHERE project_id = ? ORDER BY submitted_at DESC, id DESC', pid);
  return { rows, groups: groupOffices(rows) };
}

function filterOffices(groups, data) {
  const q = s(data.q).trim().toLowerCase().replace(/\s/g, '');
  const qd = q.replace(/\D/g, '');
  const market = Number(data.market) || 0;
  const consent = s(data.consent);
  if (consent && !['동의', '미동의'].includes(consent)) throw new AppError('동의 조건 값이 올바르지 않습니다.');
  return groups.filter((list) => {
    const r = list[0];
    if (market && r.market !== market) return false;
    if (consent === '동의' && !list.some((x) => x.consent)) return false;
    if (consent === '미동의' && list.some((x) => x.consent)) return false;
    if (!q) return true;
    return list.some((x) => (x.office_name + x.address + x.name).toLowerCase().replace(/\s/g, '').includes(q) ||
      (qd.length >= 4 && (x.office_tel.includes(qd) || x.phone_tail === qd.slice(-4) && qd.length === 4)));
  });
}

export async function realtorList(env, data, ctx) {
  const pid = ctx.projectId;
  const { rows, groups } = await loadOffices(env, pid);
  const latest = groups.map((g) => g[0]);
  const today = todayStr();
  const avg = (k) => (latest.length ? Math.round(latest.reduce((a, r) => a + r[k], 0) / latest.length * 10) / 10 : null);
  const dist = (k) => [5, 4, 3, 2, 1].map((n) => ({ n, label: SCALE[k][n], count: latest.filter((r) => r[k] === n).length }));
  const summary = {
    offices: groups.length, responses: rows.length, today: rows.filter((r) => r.submitted_at.startsWith(today)).length,
    consent: groups.filter((g) => g.some((x) => x.consent)).length,
    marketAvg: avg('market'), intentAvg: avg('intent'), referAvg: avg('refer'),
    referTotal: latest.reduce((a, r) => a + r.refer_count, 0),
    intentHigh: latest.filter((r) => r.intent >= 4).length, referHigh: latest.filter((r) => r.refer >= 4).length,
    market: dist('market'), intent: dist('intent'), refer: dist('refer')
  };
  let list = filterOffices(groups, data);
  const sort = s(data.sort) || '최근';
  if (sort === '소개') list.sort((a, b) => b[0].refer_count - a[0].refer_count || b[0].refer - a[0].refer);
  else if (sort === '상호') list.sort((a, b) => a[0].office_name.localeCompare(b[0].office_name, 'ko'));
  const page = Math.max(1, Number(data.page) || 1);
  return {
    summary, scale: SCALE, matched: list.length, page, pageSize: PAGE,
    offices: list.slice((page - 1) * PAGE, page * PAGE).map(officeView)
  };
}

async function officeOf(env, pid, id) {
  const { groups } = await loadOffices(env, pid);
  const g = groups.find((list) => list.some((x) => x.id === s(id)));
  if (!g) throw new AppError('조사 기록을 찾을 수 없습니다.');
  return g;
}

export async function realtorGet(env, data, ctx) {
  const g = await officeOf(env, ctx.projectId, data.id);
  return { office: officeView(g), responses: g.map(responseView), scale: SCALE };
}

// 조사 한 건 고치기 (명함 인식이 틀렸거나 잘못 입력한 경우). 휴대폰을 비워 보내면 기존 번호를 유지한다
export async function realtorSave(env, data, ctx) {
  const pid = ctx.projectId;
  const cur = await first(env, 'SELECT * FROM realtor_responses WHERE id = ? AND project_id = ?', s(data.id), pid);
  if (!cur) throw new AppError('조사 기록을 찾을 수 없습니다.');
  const keepPhone = data.consent === true && !s(data.mobile).trim() && cur.phone_enc;
  const v = await cleanInput(env, { ...data, mobile: keepPhone ? await decryptText(env, cur.phone_enc) : data.mobile });
  const memo = s(data.memo).trim().slice(0, 500);
  await run(env,
    `UPDATE realtor_responses SET office_name = ?, office_tel = ?, address = ?, consent = ?, name = ?, position = ?, phone_enc = ?, phone_hash = ?, phone_tail = ?,
       market = ?, intent = ?, refer = ?, refer_count = ?, opinion = ?, memo = ?, updated_at = ?, updated_by = ? WHERE id = ? AND project_id = ?`,
    v.officeName, v.officeTel, v.address, v.consent ? 1 : 0, v.name, v.position, v.phoneEnc, v.phoneHash, v.phoneTail,
    v.market, v.intent, v.refer, v.referCount, v.opinion, memo, nowStr(), ctx.account.login_id, cur.id, pid);
  await writeLog(env, ctx.account.login_id, '부동산조사수정', cur.id, v.officeName + (cur.consent !== (v.consent ? 1 : 0) ? ' / 동의 ' + (v.consent ? '동의' : '미동의') : ''), pid);
  return {};
}

export async function realtorDelete(env, data, ctx) {
  const pid = ctx.projectId;
  const cur = await first(env, 'SELECT id, office_name FROM realtor_responses WHERE id = ? AND project_id = ?', s(data.id), pid);
  if (!cur) throw new AppError('조사 기록을 찾을 수 없습니다.');
  await run(env, 'DELETE FROM realtor_responses WHERE id = ? AND project_id = ?', cur.id, pid);
  await writeLog(env, ctx.account.login_id, '부동산조사삭제', cur.id, cur.office_name, pid);
  return {};
}

// 휴대폰 원문 보기 (전화할 때). 볼 때마다 기록
export async function realtorReveal(env, data, ctx) {
  const pid = ctx.projectId;
  const g = await officeOf(env, pid, data.id);
  const r = g.find((x) => x.phone_enc);
  const phone = r ? fmtTel(await decryptText(env, r.phone_enc)) : '';
  await writeLog(env, ctx.account.login_id, '부동산연락처열람', g[0].id, g[0].office_name, pid);
  return { phone };
}

// 조사 원장 내보내기 (휴대폰 원문 포함). 관리자 또는 설문 관리가 허용된 계정만, 기록됨
export async function realtorExport(env, data, ctx) {
  if (ctx.role !== 'admin' && !ctx.account.allow_survey) throw new AppError('내보내기는 관리자 또는 설문 관리가 허용된 계정만 할 수 있습니다.', 'FORBIDDEN');
  const pid = ctx.projectId;
  const { groups } = await loadOffices(env, pid);
  const out = [];
  let no = 0;
  for (const g of filterOffices(groups, data)) {
    no++;
    for (const r of g) {
      out.push({ ...responseView(r), office: no, phone: r.phone_enc ? fmtTel(await decryptText(env, r.phone_enc)) : '' });
    }
  }
  await writeLog(env, ctx.account.login_id, '부동산조사내보내기', pid, out.length + '건', pid);
  return { rows: out, scale: SCALE };
}
