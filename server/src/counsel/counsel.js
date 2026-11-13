// 상담고객 앱(데스크탑, 상담사용): PIN + 텔레그램 인증번호 로그인, 상담고객 등록·상담 이력, 나의 고객·나의 부동산업소, 담당 포기·받기.
// 고객 정보는 고객 DB 와 같은 표에 쌓는다: customers(담당=owner_id, 관심평형=interest, 청약 순위·특공 종류, counsel_at),
// customer_grades(직접 정한 등급), customer_notes(상담 기록, staff_id = 상담사). 그래서 고객 DB·통계에 바로 합쳐진다.
import { AppError, s, all, first, run, nowStr, newId, encryptText, phoneHash, hashSecret, safeEqual, writeLog } from '../core/util.js';
import { createSession, projectBrief } from '../core/auth.js';
import { normalizePhone, requirePin, checkPin } from '../core/staff.js';
import { loadStaffMenu, menuFor } from '../core/staffmenu.js';
import { telegramApi } from '../telegram/telegram.js';
import { GRADES } from '../customer/grade.js';
import { loadTypes, typeGroups, cleanInterest, typeLabel } from '../core/types.js';
import { loadCustomers, resolveHash, fullPhone, customerGet, normalizePhoneLoose } from '../customer/customer.js';
import { loadOffices, officeView, responseView, SCALE, MGM, fmtTel } from '../realtor/realtor.js';

export const RANKS = ['특별공급', '1순위', '2순위', '무순위', '미정'];
export const SPECIALS = ['신혼부부', '생애최초', '다자녀', '노부모부양', '신생아', '청년', '기관추천'];
export const METHODS = ['방문상담', '전화상담', '문자·카톡', '기타'];
const OTP_MS = 5 * 60 * 1000, OTP_RESEND_MS = 60 * 1000, OTP_TRIES = 5;

const maskPhone = (d) => (d && d.length >= 7 ? d.slice(0, 3) + '-****-' + d.slice(-4) : '');
const maskTail = (t) => (t ? '***-****-' + t : '');
const fmtPhone = (d) => (d && d.length === 11 ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7) : fmtTel(d));
const nowMin = () => nowStr().slice(0, 16);

async function staffNames(env, pid) {
  const m = {};
  (await all(env, 'SELECT id, name, nickname FROM staff WHERE project_id = ?', pid)).forEach((r) => { m[r.id] = r.name + (r.nickname ? '(' + r.nickname + ')' : ''); });
  return m;
}

// ---------- 로그인: PIN 확인 → 텔레그램으로 인증번호 → 인증번호 확인 → 세션(counsel) ----------

async function staffForLogin(env, data) {
  const phone = normalizePhone(data.phone);
  const row = await first(env, 'SELECT * FROM staff WHERE phone = ?', phone);
  if (!row) throw new AppError('휴대폰 번호 또는 PIN이 올바르지 않습니다.');
  return row;
}

export async function counselLoginStart(env, data) {
  const pin = requirePin(data.pin);
  const row = await staffForLogin(env, data);
  await checkPin(env, row, pin); // PIN 을 먼저 확인해서, PIN 을 모르는 사람에게는 아무것도 알려 주지 않는다
  if (row.status !== '활동') throw new AppError('로그인할 수 없는 계정입니다. 관리자에게 문의해 주세요.');
  if (!menuFor(await loadStaffMenu(env, row.project_id), row.job).counsel) throw new AppError('이 직군은 상담고객 앱을 쓸 수 없습니다. 관리자에게 문의해 주세요.', 'FORBIDDEN');
  if (!row.telegram_id) throw new AppError('텔레그램이 연결되어 있지 않습니다. 출근 앱 홈에서 [텔레그램 연결]을 먼저 해 주세요.', 'NO_TELEGRAM');
  const now = Date.now();
  const prev = await first(env, 'SELECT sent_at FROM staff_otp WHERE staff_id = ? AND project_id = ?', row.id, row.project_id);
  if (prev && now - prev.sent_at < OTP_RESEND_MS) throw new AppError('인증번호를 방금 보냈습니다. 1분 뒤에 다시 받을 수 있습니다.');
  const code = String(100000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 900000));
  await run(env, `INSERT INTO staff_otp (staff_id, project_id, code_hash, expires_at, tries, sent_at) VALUES (?, ?, ?, ?, 0, ?)
     ON CONFLICT(staff_id) DO UPDATE SET project_id = excluded.project_id, code_hash = excluded.code_hash, expires_at = excluded.expires_at, tries = 0, sent_at = excluded.sent_at`,
    row.id, row.project_id, await hashSecret(env, 'otp:' + code), now + OTP_MS, now);
  const res = await telegramApi(env, 'sendMessage', { chat_id: row.telegram_id, text: '[상담고객 앱] 로그인 인증번호: ' + code + '\n5분 안에 입력해 주세요. 본인이 요청하지 않았다면 무시하고 관리자에게 알려 주세요.' });
  if (!res || !res.ok) throw new AppError('텔레그램으로 인증번호를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.');
  return { sent: true, name: row.name };
}

export async function counselLoginVerify(env, data) {
  const row = await staffForLogin(env, data);
  const code = s(data.code).replace(/\D/g, '');
  if (code.length !== 6) throw new AppError('텔레그램으로 받은 6자리 인증번호를 입력해 주세요.');
  const otp = await first(env, 'SELECT * FROM staff_otp WHERE staff_id = ? AND project_id = ?', row.id, row.project_id);
  if (!otp || otp.expires_at < Date.now()) throw new AppError('인증번호가 없거나 만료되었습니다. 다시 받아 주세요.');
  if (otp.tries >= OTP_TRIES) throw new AppError('인증번호를 여러 번 틀렸습니다. 다시 받아 주세요.');
  if (!safeEqual(await hashSecret(env, 'otp:' + code), otp.code_hash)) {
    await run(env, 'UPDATE staff_otp SET tries = tries + 1 WHERE staff_id = ? AND project_id = ?', row.id, row.project_id);
    throw new AppError('인증번호가 올바르지 않습니다. (' + (otp.tries + 1) + '/' + OTP_TRIES + ')');
  }
  await run(env, 'DELETE FROM staff_otp WHERE staff_id = ? AND project_id = ?', row.id, row.project_id);
  if (row.status !== '활동') throw new AppError('로그인할 수 없는 계정입니다.');
  const project = await first(env, 'SELECT * FROM projects WHERE id = ?', row.project_id);
  await writeLog(env, row.name, '상담앱로그인', row.id, '', row.project_id);
  return { token: await createSession(env, 'counsel', row.id), staff: { id: row.id, name: row.name, nickname: row.nickname, job: row.job }, project: project ? projectBrief(project) : null };
}

// ---------- 내 정보·선택지 ----------


export async function counselMe(env, data, ctx) {
  const me = ctx.staff;
  return {
    staff: { id: me.id, name: me.name, nickname: me.nickname, job: me.job }, project: projectBrief(ctx.project),
    // 관심 타입: 프로젝트 주택형 기준표(통합관리 > 프로젝트 > 주택형). 타입군(84) 또는 세부 주택형(84A)을 고른다
    options: { types: await loadTypes(env, ctx.projectId), groups: typeGroups(await loadTypes(env, ctx.projectId)), grades: GRADES, ranks: RANKS, specials: SPECIALS, methods: METHODS },
    realtorCode: ((await first(env, 'SELECT code FROM realtor_forms WHERE project_id = ? AND active = 1', ctx.projectId)) || {}).code || ''
  };
}

// ---------- 나의 고객 ----------

// 상담고객 앱에서 볼 고객 한 줄. others = 나 말고 이 고객을 담당하거나 상담한 상담사
function custView(c, me, names, types = []) {
  const others = new Set([...c.counselors].filter((x) => x !== me));
  if (c.ownerId && c.ownerId !== me) others.add(c.ownerId);
  return {
    id: c.hash.slice(0, 12), name: c.name, phone: c.phone ? maskPhone(c.phone) : maskTail(c.tail), grade: c.grade, gradeSource: c.gradeSource,
    rank: c.rank, special: c.special ? c.special.split(',') : [], interest: c.interest ? c.interest.split(',') : [], interestLabel: (c.interest ? c.interest.split(',') : []).map((v) => typeLabel(v, types)), channels: c.channels,
    owner: c.ownerId ? names[c.ownerId] || '(다른 현장 직원)' : '', ownerIsMe: c.ownerId === me, unowned: !c.ownerId,
    others: [...others].map((x) => names[x] || '(알 수 없음)'), duplicate: others.size > 0,
    notes: c.counselNotes, myNotes: c.counselors.has(me), last: c.lastCounsel || c.last, status: c.status, consent: c.consent
  };
}

const isMine = (c, me) => c.ownerId === me || c.counselors.has(me);
// 부동산 조사로만 들어온 사람(중개사)은 "나의 부동산업소"에서 다룬다
const realtorOnly = (c) => c.realtor && !c.counselAt && !c.surveys && !c.visits && !c.ext && !c.contract;

export async function counselCustomers(env, data, ctx) {
  const pid = ctx.projectId, me = ctx.staff.id;
  const [{ rows }, names, types] = await Promise.all([loadCustomers(env, pid), staffNames(env, pid), loadTypes(env, pid)]);
  let list = rows.filter((c) => isMine(c, me) && !realtorOnly(c)).map((c) => ({ c, v: custView(c, me, names, types) }));
  const counts = { all: list.length, owner: list.filter((x) => x.v.ownerIsMe).length, duplicate: list.filter((x) => x.v.duplicate).length, unowned: list.filter((x) => x.v.unowned).length };
  const f = s(data.filter);
  if (f === '담당') list = list.filter((x) => x.v.ownerIsMe);
  else if (f === '중복') list = list.filter((x) => x.v.duplicate);
  else if (f === '담당없음') list = list.filter((x) => x.v.unowned);
  if (data.grade) list = list.filter((x) => x.v.grade === s(data.grade));
  if (data.rank) list = list.filter((x) => x.v.rank === s(data.rank));
  const q = s(data.q).trim().toLowerCase(), qd = q.replace(/\D/g, '');
  if (q) list = list.filter((x) => (x.c.name || '').toLowerCase().includes(q) || (qd.length >= 4 && ((x.c.phone && x.c.phone.includes(qd)) || (x.c.tail && x.c.tail === qd.slice(-4)))));
  list.sort((a, b) => s(b.v.last).localeCompare(s(a.v.last)));
  return { counts, customers: list.slice(0, 500).map((x) => x.v) };
}

// 전화번호로 이미 있는 고객인지 (등록 전에 중복·담당 상담사 확인)
export async function counselLookup(env, data, ctx) {
  const d = normalizePhoneLoose(data.phone);
  if (!d) throw new AppError('휴대폰 번호를 확인해 주세요.');
  const hash = await phoneHash(env, d);
  const [{ rows }, names, types] = await Promise.all([loadCustomers(env, ctx.projectId), staffNames(env, ctx.projectId), loadTypes(env, ctx.projectId)]);
  const c = rows.find((x) => x.hash === hash);
  if (!c) return { exists: false };
  const v = custView(c, ctx.staff.id, names, types);
  return { exists: true, customer: { ...v, interest: v.interest, canEdit: v.ownerIsMe || v.unowned } };
}

function cleanProfile(data, types) {
  const list = (v, max) => (Array.isArray(v) ? v : s(v).split(',')).map((x) => s(x).trim().slice(0, 20)).filter(Boolean).slice(0, max);
  const interest = cleanInterest(data.interest, types);
  const rank = s(data.rank);
  if (rank && !RANKS.includes(rank)) throw new AppError('청약 순위 값이 올바르지 않습니다.');
  const special = rank === '특별공급' ? [...new Set(list(data.special, 7))] : [];
  if (special.some((x) => !SPECIALS.includes(x))) throw new AppError('특별공급 종류 값이 올바르지 않습니다.');
  const grade = data.grade === undefined ? undefined : s(data.grade);
  if (grade && !GRADES.includes(grade)) throw new AppError('등급은 A, B, C, D 중에서 골라 주세요.');
  const consent = s(data.consent);
  if (consent && !['동의', '미확인'].includes(consent)) throw new AppError('개인정보 동의 값이 올바르지 않습니다.');
  return { name: s(data.name).trim().slice(0, 30), interest: interest.join(','), rank, special: special.join(','), grade, consent: consent || '미확인' };
}

async function saveGrade(env, pid, hash, grade, me) {
  if (grade === undefined) return;
  if (!grade) { await run(env, 'DELETE FROM customer_grades WHERE project_id = ? AND phone_hash = ?', pid, hash); return; }
  await run(env, `INSERT INTO customer_grades (project_id, phone_hash, grade, memo, updated_at, updated_by) VALUES (?, ?, ?, '상담고객 앱', ?, ?)
     ON CONFLICT(project_id, phone_hash) DO UPDATE SET grade = excluded.grade, memo = excluded.memo, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
    pid, hash, grade, nowStr(), me.name);
}

async function addNote(env, pid, hash, me, data) {
  const method = s(data.method), content = s(data.content).trim().slice(0, 2000);
  if (method && !METHODS.includes(method)) throw new AppError('상담 방식 값이 올바르지 않습니다.');
  if (!content) return null;
  const at = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(s(data.at)) ? s(data.at) : nowMin();
  const id = newId('CN');
  await run(env, 'INSERT INTO customer_notes (id, project_id, phone_hash, at, kind, result, content, created_by, created_at, staff_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, pid, hash, at, '상담', method || '상담', content, me.name, nowStr(), me.id);
  return id;
}

// 상담고객 등록·저장. 다른 상담사가 담당 중이면 고객 정보는 바꾸지 않고 상담 기록만 남긴다(중복 상담으로 표시)
export async function counselSave(env, data, ctx) {
  const pid = ctx.projectId, me = ctx.staff;
  const d = normalizePhoneLoose(data.phone);
  if (!d) throw new AppError('휴대폰 번호를 확인해 주세요.');
  const p = cleanProfile(data, await loadTypes(env, pid));
  const hash = await phoneHash(env, d);
  const cur = await first(env, 'SELECT owner_id FROM customers WHERE project_id = ? AND phone_hash = ?', pid, hash);
  if (cur && cur.owner_id && cur.owner_id !== me.id) {
    const noteId = await addNote(env, pid, hash, me, data);
    const owner = await first(env, 'SELECT name FROM staff WHERE id = ? AND project_id = ?', cur.owner_id, pid);
    return { id: hash.slice(0, 12), duplicate: true, owner: owner ? owner.name : '(다른 직원)', noteAdded: !!noteId };
  }
  const now = nowStr();
  await run(env,
    `INSERT INTO customers (project_id, phone_hash, name, phone_enc, phone_tail, source, source_kind, consent, owner_id, interest, subscr_rank, special_kind, counsel_at, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, ?, ?, '상담고객', '상담', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, phone_hash) DO UPDATE SET
       name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE customers.name END,
       phone_enc = CASE WHEN customers.phone_enc = '' THEN excluded.phone_enc ELSE customers.phone_enc END,
       phone_tail = CASE WHEN customers.phone_tail = '' THEN excluded.phone_tail ELSE customers.phone_tail END,
       source = CASE WHEN customers.source = '' THEN excluded.source ELSE customers.source END,
       source_kind = CASE WHEN customers.source_kind = '' THEN excluded.source_kind ELSE customers.source_kind END,
       consent = CASE WHEN excluded.consent = '동의' THEN '동의' WHEN customers.consent = '' THEN excluded.consent ELSE customers.consent END,
       owner_id = excluded.owner_id, interest = excluded.interest, subscr_rank = excluded.subscr_rank, special_kind = excluded.special_kind,
       counsel_at = CASE WHEN customers.counsel_at = '' THEN excluded.counsel_at ELSE customers.counsel_at END,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by
     WHERE customers.owner_id = '' OR customers.owner_id = excluded.owner_id`,
    pid, hash, p.name, await encryptText(env, d), d.slice(-4), p.consent, me.id, p.interest, p.rank, p.special, now, now, now, me.name);
  await saveGrade(env, pid, hash, p.grade, me);
  const noteId = await addNote(env, pid, hash, me, data);
  await writeLog(env, me.name, '상담고객등록', hash.slice(0, 12), p.name + (noteId ? ' / 상담 기록' : ''), pid);
  return { id: hash.slice(0, 12), duplicate: false, noteAdded: !!noteId };
}

// 내 고객 정보 고치기 (담당이 나이거나 담당이 없을 때)
export async function counselUpdate(env, data, ctx) {
  const pid = ctx.projectId, me = ctx.staff;
  const hash = await resolveHash(env, pid, data.id);
  const cur = await first(env, 'SELECT owner_id FROM customers WHERE project_id = ? AND phone_hash = ?', pid, hash);
  if (cur && cur.owner_id && cur.owner_id !== me.id) throw new AppError('다른 상담사가 담당 중인 고객입니다. 담당 상담사가 포기한 뒤 [담당 받기]를 해 주세요.', 'OWNED');
  const p = cleanProfile(data, await loadTypes(env, pid));
  const now = nowStr();
  await run(env,
    `INSERT INTO customers (project_id, phone_hash, name, source, source_kind, consent, owner_id, interest, subscr_rank, special_kind, counsel_at, created_at, updated_at, updated_by)
     VALUES (?, ?, ?, '상담고객', '상담', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, phone_hash) DO UPDATE SET
       name = CASE WHEN excluded.name <> '' THEN excluded.name ELSE customers.name END,
       consent = CASE WHEN excluded.consent = '동의' THEN '동의' WHEN customers.consent = '' THEN excluded.consent ELSE customers.consent END,
       owner_id = excluded.owner_id, interest = excluded.interest, subscr_rank = excluded.subscr_rank, special_kind = excluded.special_kind,
       counsel_at = CASE WHEN customers.counsel_at = '' THEN excluded.counsel_at ELSE customers.counsel_at END,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by
     WHERE customers.owner_id = '' OR customers.owner_id = excluded.owner_id`,
    pid, hash, p.name, p.consent, me.id, p.interest, p.rank, p.special, now, now, now, me.name);
  await saveGrade(env, pid, hash, p.grade, me);
  return {};
}

// 고객 상세 + 전체 이력(설문·방문·부동산·계약·모든 상담 기록). 내 고객(담당·상담 기록)이면 전화번호 원문을 준다
export async function counselGet(env, data, ctx) {
  const pid = ctx.projectId, me = ctx.staff.id;
  const hash = await resolveHash(env, pid, data.id);
  const [{ rows }, names, types] = await Promise.all([loadCustomers(env, pid), staffNames(env, pid), loadTypes(env, pid)]);
  const c = rows.find((x) => x.hash === hash);
  if (!c) throw new AppError('이 현장에서 고객을 찾을 수 없습니다.');
  const v = custView(c, me, names, types);
  if (!isMine(c, me) && !v.unowned) {
    return { customer: { id: v.id, name: v.name, phone: v.phone, owner: v.owner, ownerIsMe: false, unowned: false, others: v.others, duplicate: true }, limited: true, timeline: [] };
  }
  const detail = await customerGet(env, { id: data.id }, ctx);
  const noteStaff = {};
  (await all(env, 'SELECT id, staff_id FROM customer_notes WHERE project_id = ? AND phone_hash = ?', pid, hash)).forEach((n) => { noteStaff[n.id] = n.staff_id; });
  const timeline = detail.timeline.map((t) => ({ ...t, mine: t.noteId ? noteStaff[t.noteId] === me : false, by: t.noteId && noteStaff[t.noteId] ? names[noteStaff[t.noteId]] || t.by : t.by }));
  return { customer: { ...v, phone: fmtPhone(await fullPhone(env, pid, hash)), canEdit: v.ownerIsMe || v.unowned }, timeline };
}

export async function counselNoteAdd(env, data, ctx) {
  const hash = await resolveHash(env, ctx.projectId, data.id);
  if (!s(data.content).trim()) throw new AppError('상담 내용을 입력해 주세요.');
  return { id: await addNote(env, ctx.projectId, hash, ctx.staff, data) };
}

// 내가 남긴 상담 기록만 지울 수 있다
export async function counselNoteDelete(env, data, ctx) {
  const res = await run(env, 'DELETE FROM customer_notes WHERE id = ? AND project_id = ? AND staff_id = ?', s(data.noteId), ctx.projectId, ctx.staff.id);
  if (!res.meta.changes) throw new AppError('내가 남긴 상담 기록만 지울 수 있습니다.');
  return {};
}

// 담당 포기 / 받기 (고객·부동산업소 공용). 포기·받기는 기록에도 남긴다
async function release(env, pid, me, hashes, label) {
  let n = 0;
  for (const h of hashes) n += (await run(env, `UPDATE customers SET owner_id = '', updated_at = ?, updated_by = ? WHERE project_id = ? AND phone_hash = ? AND owner_id = ?`, nowStr(), me.name, pid, h, me.id)).meta.changes || 0;
  if (!n) throw new AppError('내가 담당 중인 ' + label + '만 포기할 수 있습니다.');
  await run(env, 'INSERT INTO customer_notes (id, project_id, phone_hash, at, kind, result, content, created_by, created_at, staff_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId('CN'), pid, hashes[0], nowMin(), '메모', '담당 포기', me.name + ' 상담사가 담당을 포기했습니다.', me.name, nowStr(), '');
  await writeLog(env, me.name, '담당포기', hashes[0].slice(0, 12), label, pid);
}
async function take(env, pid, me, hashes, label) {
  for (const h of hashes) {
    const cur = await first(env, 'SELECT owner_id FROM customers WHERE project_id = ? AND phone_hash = ?', pid, h);
    if (cur && cur.owner_id && cur.owner_id !== me.id) {
      const o = await first(env, 'SELECT name FROM staff WHERE id = ? AND project_id = ?', cur.owner_id, pid);
      throw new AppError((o ? o.name : '다른') + ' 상담사가 담당 중입니다. 그 상담사가 [담당 포기]를 한 뒤 받을 수 있습니다.', 'OWNED');
    }
  }
  for (const h of hashes) {
    await run(env, `INSERT INTO customers (project_id, phone_hash, owner_id, created_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(project_id, phone_hash) DO UPDATE SET owner_id = excluded.owner_id, updated_at = excluded.updated_at, updated_by = excluded.updated_by WHERE customers.owner_id = ''`,
      pid, h, me.id, nowStr(), nowStr(), me.name);
  }
  await run(env, 'INSERT INTO customer_notes (id, project_id, phone_hash, at, kind, result, content, created_by, created_at, staff_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    newId('CN'), pid, hashes[0], nowMin(), '메모', '담당 받음', me.name + ' 상담사가 담당을 받았습니다.', me.name, nowStr(), '');
  await writeLog(env, me.name, '담당받기', hashes[0].slice(0, 12), label, pid);
}

export async function counselRelease(env, data, ctx) { await release(env, ctx.projectId, ctx.staff, [await resolveHash(env, ctx.projectId, data.id)], '고객'); return {}; }
export async function counselTake(env, data, ctx) { await take(env, ctx.projectId, ctx.staff, [await resolveHash(env, ctx.projectId, data.id)], '고객'); return {}; }

// ---------- 나의 부동산업소 ----------

async function realtorOwners(env, pid) {
  const m = {};
  (await all(env, `SELECT phone_hash, owner_id FROM customers WHERE project_id = ? AND owner_id <> ''`, pid)).forEach((r) => { m[r.phone_hash] = r.owner_id; });
  return m;
}
function officeInfo(g, me, owners, names) {
  const hashes = [...new Set(g.map((r) => r.cust_hash).filter(Boolean))];
  const owner = owners[g[0].cust_hash] || hashes.map((h) => owners[h]).find(Boolean) || '';
  const surveyed = new Set(g.map((r) => r.staff_id).filter(Boolean));
  const others = new Set([...surveyed].filter((x) => x !== me));
  if (owner && owner !== me) others.add(owner);
  return { hashes, owner, surveyedByMe: surveyed.has(me), myCount: g.filter((r) => r.staff_id === me).length,
    view: { ...officeView(g), owner: owner ? names[owner] || '(알 수 없음)' : '', ownerIsMe: owner === me, unowned: !owner, others: [...others].map((x) => names[x] || '(알 수 없음)'), duplicate: others.size > 0, myCount: g.filter((r) => r.staff_id === me).length } };
}

export async function counselRealtors(env, data, ctx) {
  const pid = ctx.projectId, me = ctx.staff.id;
  const [{ groups }, owners, names] = await Promise.all([loadOffices(env, pid), realtorOwners(env, pid), staffNames(env, pid)]);
  let list = groups.map((g) => officeInfo(g, me, owners, names)).filter((x) => x.surveyedByMe || x.owner === me).map((x) => x.view);
  const counts = { all: list.length, owner: list.filter((x) => x.ownerIsMe).length, duplicate: list.filter((x) => x.duplicate).length };
  const f = s(data.filter);
  if (f === '담당') list = list.filter((x) => x.ownerIsMe); else if (f === '중복') list = list.filter((x) => x.duplicate);
  const q = s(data.q).trim().toLowerCase().replace(/\s/g, '');
  if (q) list = list.filter((x) => (x.officeName + x.name + x.address).toLowerCase().replace(/\s/g, '').includes(q));
  return { counts, offices: list, scale: SCALE, mgmOptions: MGM };
}

async function myOffice(env, ctx, id) {
  const pid = ctx.projectId;
  const [{ groups }, owners, names] = await Promise.all([loadOffices(env, pid), realtorOwners(env, pid), staffNames(env, pid)]);
  const g = groups.find((list) => list.some((r) => r.id === s(id)));
  if (!g) throw new AppError('중개업소를 찾을 수 없습니다.');
  return { g, info: officeInfo(g, ctx.staff.id, owners, names), names };
}

export async function counselRealtorGet(env, data, ctx) {
  const pid = ctx.projectId, me = ctx.staff.id;
  const { g, info, names } = await myOffice(env, ctx, data.id);
  if (!info.surveyedByMe && info.owner !== me && !info.view.unowned) throw new AppError('다른 상담사가 담당하는 중개업소입니다. (' + info.view.owner + ')', 'OWNED');
  const notes = info.hashes.length ? await all(env,
    `SELECT id, at, kind, result, content, created_by, staff_id FROM customer_notes WHERE project_id = ? AND phone_hash IN (${info.hashes.map(() => '?').join(',')}) ORDER BY at DESC`, pid, ...info.hashes) : [];
  const withPhone = g.find((r) => r.phone_enc);
  return {
    office: { ...info.view, mobile: withPhone ? fmtPhone(await fullPhone(env, pid, withPhone.cust_hash)) : '' },
    responses: g.map((r) => ({ ...responseView(r), by: r.staff_id ? names[r.staff_id] || '' : '' })),
    notes: notes.map((n) => ({ id: n.id, at: n.at, kind: n.kind, result: n.result, content: n.content, by: n.staff_id ? names[n.staff_id] || n.created_by : n.created_by, mine: n.staff_id === me })),
    scale: SCALE
  };
}

export async function counselRealtorNote(env, data, ctx) {
  const { info } = await myOffice(env, ctx, data.id);
  if (!s(data.content).trim()) throw new AppError('상담 내용을 입력해 주세요.');
  if (!info.hashes.length) throw new AppError('연락처가 없는 중개업소입니다.');
  return { id: await addNote(env, ctx.projectId, info.hashes[0], ctx.staff, data) };
}
export async function counselRealtorRelease(env, data, ctx) { const { info } = await myOffice(env, ctx, data.id); await release(env, ctx.projectId, ctx.staff, info.hashes, '중개업소'); return {}; }
export async function counselRealtorTake(env, data, ctx) { const { info } = await myOffice(env, ctx, data.id); await take(env, ctx.projectId, ctx.staff, info.hashes, '중개업소'); return {}; }

// ---------- 통합관리 > 고객관리 > 상담고객 ----------

export async function counselAdminList(env, data, ctx) {
  const pid = ctx.projectId;
  const [{ rows }, names] = await Promise.all([loadCustomers(env, pid), staffNames(env, pid)]);
  const month = nowStr().slice(0, 7);
  const monthNotes = {};
  (await all(env, `SELECT staff_id, COUNT(*) AS n FROM customer_notes WHERE project_id = ? AND staff_id <> '' AND at >= ? GROUP BY staff_id`, pid, month + '-01')).forEach((r) => { monthNotes[r.staff_id] = r.n; });
  const counsel = rows.filter((c) => c.isCounsel);
  // 상담사별: 담당 고객 수, A·B 등급, 상담 기록(이번 달·전체)
  const per = {};
  const bump = (id) => (per[id] = per[id] || { id, name: names[id] || '(알 수 없음)', owned: 0, ab: 0, notes: 0, month: monthNotes[id] || 0 });
  counsel.forEach((c) => {
    if (c.ownerId) { const p = bump(c.ownerId); p.owned++; if (c.grade === 'A' || c.grade === 'B') p.ab++; }
    c.counselors.forEach((sid) => bump(sid));
  });
  (await all(env, `SELECT staff_id, COUNT(*) AS n FROM customer_notes WHERE project_id = ? AND staff_id <> '' GROUP BY staff_id`, pid)).forEach((r) => { bump(r.staff_id).notes = r.n; });
  const view = (c) => {
    const people = new Set(c.counselors); if (c.ownerId) people.add(c.ownerId);
    return {
      id: c.hash.slice(0, 12), name: c.name, phone: c.phone ? maskPhone(c.phone) : maskTail(c.tail), grade: c.grade, rank: c.rank, special: c.special, interest: c.interest,
      owner: c.ownerId ? names[c.ownerId] || '(알 수 없음)' : '', ownerId: c.ownerId, counselors: [...c.counselors].map((x) => names[x] || '(알 수 없음)'),
      duplicate: people.size > 1, notes: c.counselNotes, last: c.lastCounsel || c.last, channels: c.channels
    };
  };
  let list = counsel.map(view);
  if (data.ownerId === '-') list = list.filter((x) => !x.ownerId); else if (data.ownerId) list = list.filter((x) => x.ownerId === s(data.ownerId));
  if (data.grade) list = list.filter((x) => x.grade === s(data.grade));
  if (data.rank) list = list.filter((x) => x.rank === s(data.rank));
  if (data.duplicate === true) list = list.filter((x) => x.duplicate);
  const q = s(data.q).trim().toLowerCase();
  if (q) list = list.filter((x) => (x.name || '').toLowerCase().includes(q) || x.phone.includes(q.replace(/\D/g, '') || '@'));
  list.sort((a, b) => s(b.last).localeCompare(s(a.last)));
  return {
    total: counsel.length, matched: list.length, customers: list.slice(0, 500),
    perStaff: Object.values(per).sort((a, b) => b.owned - a.owned || a.name.localeCompare(b.name, 'ko')),
    summary: { duplicate: counsel.filter((c) => { const p = new Set(c.counselors); if (c.ownerId) p.add(c.ownerId); return p.size > 1; }).length, unowned: counsel.filter((c) => !c.ownerId).length, monthNotes: Object.values(monthNotes).reduce((a, b) => a + b, 0) },
    ranks: RANKS
  };
}
