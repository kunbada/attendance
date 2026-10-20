// 공용 도구: 오류, 시간(Asia/Seoul), DB 도움 함수, 해시·암호화

// 화면에 그대로 보여줄 한국어 메시지를 담는 오류. 그 외 오류는 "서버 오류"로만 보인다.
export class AppError extends Error {
  constructor(message, code = '') {
    super(message);
    this.code = code;
  }
}

export const s = (v) => (v === null || v === undefined ? '' : String(v));

// ---------- 시간 (모두 한국 시간 기준 문자열) ----------
const kst = (ms = Date.now()) => new Date(ms + 9 * 3600 * 1000).toISOString();
export const todayStr = () => kst().slice(0, 10);
export const timeStr = () => kst().slice(11, 19);
export const nowStr = () => kst().slice(0, 10) + ' ' + kst().slice(11, 19);
export const parseKst = (str) => new Date(s(str).replace(' ', 'T') + '+09:00');

export function newId(prefix) {
  return prefix + crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
}

export function randomToken(n) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

// ---------- DB ----------
export const all = async (env, sql, ...params) => (await env.DB.prepare(sql).bind(...params).all()).results;
export const first = (env, sql, ...params) => env.DB.prepare(sql).bind(...params).first();
export const run = (env, sql, ...params) => env.DB.prepare(sql).bind(...params).run();
export const stmt = (env, sql, ...params) => env.DB.prepare(sql).bind(...params);

export async function writeLog(env, user, action, target = '', content = '') {
  await run(env, 'INSERT INTO logs (at, user, action, target, content) VALUES (?, ?, ?, ?, ?)', nowStr(), user, action, target, content);
}

export async function getSettings(env) {
  const map = {};
  (await all(env, 'SELECT key, value FROM settings')).forEach((r) => { map[r.key] = r.value; });
  return map;
}

export async function orgNameMap(env) {
  const map = {};
  (await all(env, 'SELECT id, name FROM orgs')).forEach((o) => { map[o.id] = o.name; });
  return map;
}

export function staffBrief(row, names) {
  return {
    id: row.id, name: row.name, nickname: row.nickname, job: row.job,
    headName: names[row.head_id] || '', teamName: names[row.team_id] || ''
  };
}

// ---------- 해시·암호화 ----------
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

// 비밀번호·PIN 은 SHA-256(salt + 값) 해시로만 저장한다. salt 는 서버 비밀 값(SALT)
export function hashSecret(env, value) {
  if (!env.SALT) throw new AppError('서버 설정이 끝나지 않았습니다. 관리자에게 문의해 주세요. (SALT)');
  return sha256Hex(env.SALT + value);
}

export function safeEqual(a, b) {
  a = s(a); b = s(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// 주민번호·계좌번호용 AES-GCM. 키는 서버 비밀 값(PAYROLL_KEY, base64 32바이트)
async function aesKey(env) {
  if (!env.PAYROLL_KEY) throw new AppError('서버 설정이 끝나지 않았습니다. 관리자에게 문의해 주세요. (PAYROLL_KEY)');
  const raw = Uint8Array.from(atob(env.PAYROLL_KEY), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptText(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env), new TextEncoder().encode(text)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return btoa(String.fromCharCode(...out));
}

export async function decryptText(env, b64) {
  const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: data.slice(0, 12) }, await aesKey(env), data.slice(12));
  return new TextDecoder().decode(plain);
}
