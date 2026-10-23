'use strict';
/* ===================== 공통 유틸 ===================== */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n === null || n === undefined || n === '' || isNaN(n)) ? '' : Number(n).toLocaleString('ko-KR');
const fmt0 = n => (!n ? '' : fmt(n));
const pct = (a, b, d = 1) => b ? (a / b * 100).toFixed(d) + '%' : '-';
const uid = p => p + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 9);
const pad = n => String(n).padStart(2, '0');
const nowISO = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + String(d.getMilliseconds()).padStart(3, '0'); };
const today = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const toNum = v => { if (v === null || v === undefined || v === '') return 0; if (typeof v === 'number') return Math.round(v); const s = String(v).replace(/[,\s원₩]/g, ''); const n = parseFloat(s); return isNaN(n) ? 0 : Math.round(n); };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const DH_RE = /^\d{3}-\d{3,4}$/;
function toast(msg, err) { const d = document.createElement('div'); d.textContent = msg; if (err) d.className = 'err'; $('#toast').appendChild(d); setTimeout(() => d.remove(), err ? 6000 : 2800); }
function normDate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return v.getFullYear() + '-' + pad(v.getMonth() + 1) + '-' + pad(v.getDate());
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  const s = String(v).trim(); const m = s.match(/^(\d{4})[.\-\/년 ]\s*(\d{1,2})[.\-\/월 ]\s*(\d{1,2})/);
  if (m) return m[1] + '-' + pad(m[2]) + '-' + pad(m[3]);
  const m2 = s.match(/^(\d{1,2})[.\/](\d{1,2})$/); if (m2) return new Date().getFullYear() + '-' + pad(m2[1]) + '-' + pad(m2[2]);
  return s;
}
/* 숫자 → 한글 금액 (NUMBERSTRING) */
function numKor(n) {
  n = Math.round(Number(n) || 0); if (!n) return '영';
  const d = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'], u = ['', '십', '백', '천'], big = ['', '만', '억', '조', '경'];
  let s = '', i = 0;
  while (n > 0) {
    const part = n % 10000; n = Math.floor(n / 10000);
    if (part) { let ps = ''; let p = part; for (let j = 0; j < 4; j++) { const x = p % 10; p = Math.floor(p / 10); if (x) ps = d[x] + u[j] + ps; } s = ps + big[i] + s; }
    i++;
  }
  return s;
}
function dl(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
function exportXlsx(name, rows, sheet = 'Sheet1') {
  if (!window.XLSX) return toast('엑셀 라이브러리를 불러오지 못했습니다', 1);
  const ws = XLSX.utils.aoa_to_sheet(rows); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, sheet.slice(0, 30));
  XLSX.writeFile(wb, name);
}
const maskRRN = v => { v = String(v || ''); return v.length > 8 ? v.slice(0, 8) + '******' : v; };

/* ===================== 프로젝트 / 로컬 설정 ===================== */
const LS = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
};
let PROJ = LS.get('bunyang.current', 'default');
const projList = () => LS.get('bunyang.projects', [{ key: 'default', name: '기본 프로젝트' }]);

/* ===================== IndexedDB ===================== */
const COLS = ['units', 'contracts', 'pre', 'resv', 'locks', 'deposits', 'settings', 'templates', 'notes'];
const idb = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('bunyang_' + PROJ, 2);
      r.onupgradeneeded = () => { const db = r.result; COLS.forEach(c => { if (!db.objectStoreNames.contains(c)) db.createObjectStore(c, { keyPath: 'id' }); }); if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta'); };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  all(col) { return new Promise((res, rej) => { const q = this.db.transaction(col).objectStore(col).getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }); },
  putMany(col, recs) { return new Promise((res, rej) => { if (!recs.length) return res(); const tx = this.db.transaction(col, 'readwrite'); const st = tx.objectStore(col); recs.forEach(r => st.put(r)); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  del(col, id) { return new Promise((res, rej) => { const tx = this.db.transaction(col, 'readwrite'); tx.objectStore(col).delete(id); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  clear(col) { return new Promise((res, rej) => { const tx = this.db.transaction(col, 'readwrite'); tx.objectStore(col).clear(); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); },
  getMeta(k) { return new Promise((res) => { const q = this.db.transaction('meta').objectStore('meta').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); }); },
  setMeta(k, v) { return new Promise((res, rej) => { const tx = this.db.transaction('meta', 'readwrite'); tx.objectStore('meta').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
};

/* ===================== 데이터 스토어 ===================== */
const S = {}; const M = {}; COLS.forEach(c => { S[c] = []; M[c] = {}; });
let META = { pk: '', sheetUrl: '', user: '', syncUrl: '', token: '', lastRev: 0, lastSync: '', autoBackupMin: 3, lastBackup: '' };
let OUTBOX = {};
let DIRTY_BACKUP = false;
// 전체 회차 후보: 계약금 1·2차, 중도금 1~6차, 잔금 (현장에서 쓰는 회차만 설정에서 선택)
const ALL_STAGES = ['계약금 1차', '계약금 2차', '중도금 1차', '중도금 2차', '중도금 3차', '중도금 4차', '중도금 5차', '중도금 6차', '잔금'];
const DEFAULT_STAGES = ALL_STAGES.slice();
const DEFAULT_SETTINGS = () => ({ id: 'main', project: { name: '새 프로젝트', lessor: '', bizNo: '', bank: '', account: '', moneyLabel: '분양대금' }, stages: DEFAULT_STAGES.slice(), special: {}, depositCats: DEFAULT_STAGES.concat(['환불', '환불지급', '대체지급', '예금결산', '입금오류', '기타']) });
const CFG = () => M.settings.main || DEFAULT_SETTINGS();
const STAGES = () => CFG().stages || DEFAULT_STAGES;
const live = col => S[col].filter(r => !r.deleted);

function _upsert(col, rec) {
  const ex = M[col][rec.id];
  if (ex) { const i = S[col].indexOf(ex); if (i >= 0) S[col][i] = rec; else S[col].push(rec); } else S[col].push(rec);
  M[col][rec.id] = rec;
}
const persistOutbox = debounce(() => idb.setMeta('outbox', OUTBOX), 300);
const persistMeta = () => idb.setMeta('local', META);
async function save(col, recs, opt = {}) {
  if (!Array.isArray(recs)) recs = [recs];
  if (!canWrite()) { toast('읽기 전용 계정은 저장할 수 없습니다', 1); await reloadStore(); return recs; }
  const ts = nowISO();
  recs.forEach(r => { if (!r.id) r.id = uid(col[0]); r.updatedAt = ts; r.updatedBy = META.user || ''; _upsert(col, r); OUTBOX[col + '|' + r.id] = 1; });
  await idb.putMany(col, recs);
  persistOutbox(); DIRTY_BACKUP = true;
  if (!opt.noIndex) rebuild();
  scheduleSync();
  updateSyncPill();
  return recs;
}
async function remove(col, id) { const r = M[col][id]; if (!r) return; r.deleted = true; await save(col, r); }

/* ===================== 인덱스 (세대 상태, 수납 집계) ===================== */
const IX = { unit: {}, active: {}, contractsByDh: {}, pre: {}, resv: {}, lock: {}, paid: {}, depByDh: {}, unclassified: 0, types: [], dongs: [], descMap: {}, nameIdx: [] };
const PAY_CATS = () => new Set(STAGES());
function rebuild() {
  const t0 = performance.now();
  IX.unit = {}; IX.active = {}; IX.contractsByDh = {}; IX.pre = {}; IX.resv = {}; IX.lock = {}; IX.paid = {}; IX.depByDh = {}; IX.descMap = {};
  const types = new Set(), dongs = new Set();
  live('units').forEach(u => { IX.unit[u.id] = u; types.add(u.type); dongs.add(u.dong); });
  IX.types = [...types].sort(); IX.dongs = [...dongs].sort();
  live('contracts').forEach(c => { if (!c.dongho) return; (IX.contractsByDh[c.dongho] = IX.contractsByDh[c.dongho] || []).push(c); if (c.status !== '해약') IX.active[c.dongho] = IX.active[c.dongho] ? IX.active[c.dongho] : c; });
  live('pre').forEach(p => { if (p.status === '진행' && p.dongho) IX.pre[p.dongho] = p; });
  live('resv').forEach(p => { if (p.status === '진행' && p.dongho) IX.resv[p.dongho] = p; });
  live('locks').forEach(p => { if (p.status === '잠금' && p.dongho) IX.lock[p.dongho] = p; });
  const pc = PAY_CATS(); let unc = 0;
  live('deposits').forEach(d => {
    if (!d.cat) unc++;
    if (d.dongho) {
      (IX.depByDh[d.dongho] = IX.depByDh[d.dongho] || []).push(d);
      if (pc.has(d.cat)) { const p = IX.paid[d.dongho] = IX.paid[d.dongho] || {}; p[d.cat] = (p[d.cat] || 0) + (d.inn || 0) - (d.out || 0); const last = p['_last_' + d.cat]; if (!last || d.t > last) p['_last_' + d.cat] = d.t; }
      if (d.desc && d.cat) IX.descMap[d.desc.replace(/\s/g, '')] = d.dongho;
    }
  });
  IX.unclassified = unc;
  const tdy = today(), due = CFG().stageDue || {}; IX.stageActive = {};
  STAGES().forEach(sg => { IX.stageActive[sg] = (due[sg] && due[sg] <= tdy) || Object.values(IX.paid).some(p => (p[sg] || 0) > 0); });
  IX.nameIdx = [];
  Object.values(IX.active).forEach(c => IX.nameIdx.push({ name: (c.name || '').replace(/\s/g, ''), dongho: c.dongho, kind: '계약' }));
  Object.values(IX.pre).forEach(c => IX.nameIdx.push({ name: (c.name || '').replace(/\s/g, ''), dongho: c.dongho, kind: '가계약' }));
  Object.values(IX.resv).forEach(c => IX.nameIdx.push({ name: (c.name || '').replace(/\s/g, ''), dongho: c.dongho, kind: '동호지정' }));
  IX.ms = performance.now() - t0;
  updateNavBadges();
}
function unitStatus(dh) {
  if (IX.active[dh]) return '계약'; if (IX.pre[dh]) return '가계약'; if (IX.resv[dh]) return '동호지정'; if (IX.lock[dh]) return '잠금'; return '잔여';
}
function holderOf(dh) { const c = IX.active[dh] || IX.pre[dh] || IX.resv[dh]; return c ? c.name : ''; }
/* 회차 납부상태 */
function payState(dh, stage) {
  const u = IX.unit[dh]; const req = u && u.amounts ? (u.amounts[stage] || 0) : 0;
  const paid = (IX.paid[dh] && IX.paid[dh][stage]) || 0;
  let st = '미납', cls = 'bad';
  if (paid <= 0) { if (IX.stageActive && !IX.stageActive[stage]) { st = '예정'; cls = 'gray'; } else { st = '미납'; cls = 'bad'; } }
  else if (!req) { st = '입금'; cls = 'info'; }
  else if (paid > req) { st = '초과'; cls = 'warn'; }
  else if (paid === req) { st = '완납'; cls = 'ok'; }
  else if (paid >= req / 2) { st = '50%이상'; cls = 'warn'; }
  else { st = '50%미만'; cls = 'warn'; }
  return { req, paid, diff: req - paid, st, cls, done: req > 0 && paid >= req, last: IX.paid[dh] ? IX.paid[dh]['_last_' + stage] : '' };
}
function totalPaid(dh) { const p = IX.paid[dh] || {}; return STAGES().reduce((a, s) => a + (p[s] || 0), 0); }
/* 시도/시군구 */
function region(addr) {
  const a = String(addr || '').trim().split(/\s+/); let sido = a[0] || '', sgg = a[1] || '';
  const mapS = { '서울특별시': '서울시', '서울': '서울시', '경기': '경기도', '인천광역시': '인천시', '인천': '인천시', '강원특별자치도': '강원도', '강원': '강원도' };
  sido = mapS[sido] || sido;
  return { sido, sgg };
}

/* ===================== 동기화 (통합관리 서버) ===================== */
let syncing = false, syncErr = '', online = navigator.onLine;
const scheduleSync = debounce(() => sync(), 800);
window.addEventListener('online', () => { online = true; updateSyncPill(); sync(); });
window.addEventListener('offline', () => { online = false; updateSyncPill(); });
/* 로그인 세션(서버 URL 단위). 계정은 통합관리 서버의 것이고, 현장(PROJ)은 서버의 현장 id 와 같다 */
let SESSION = LS.get('bunyang.session', null);
const ROLE = () => (SESSION && SESSION.url === META.syncUrl && SESSION.role) || (META.syncUrl ? 'read' : 'admin');
const canWrite = () => !META.syncUrl || ROLE() !== 'read';
const isAdmin = () => !META.syncUrl ? false : ROLE() === 'admin';
const ROLE_L = { admin: '관리자', write: '쓰기', read: '읽기전용' };
function setSession(s) { SESSION = s ? Object.assign({ url: META.syncUrl }, s) : null; LS.set('bunyang.session', SESSION); if (s && s.name) { META.user = s.name; persistMeta(); } updateUserPill(); }
// 예전 계약앱의 op 이름을 통합 서버 action 으로 옮긴다. global=true 는 현장과 무관한 호출
function toAction(b) {
  const sess = b.op === 'login' ? null : (SESSION && SESSION.url === META.syncUrl ? SESSION.st : '');
  const m = {
    login: ['account.login', { loginId: b.id, password: b.pw }, true],
    logout: ['auth.logout', {}, true],
    changePw: ['account.changePassword', { oldPassword: b.old, newPassword: b.pw }, true],
    projects: ['project.list', {}, true],
    ping: ['contract.poll', {}],
    poll: ['contract.poll', {}],
    me: ['contract.poll', {}],
    sync: ['contract.sync', { since: b.since, changes: b.changes }],
    wipe: ['contract.wipe', {}],
    staff: ['contract.staffList', {}]
  }[b.op];
  if (!m) throw new Error('지원하지 않는 요청: ' + b.op);
  return { action: m[0], data: m[1], global: !!m[2], token: sess };
}
async function callServer(body, noAuthFail) {
  const q = toAction(body);
  const r = await fetch(META.syncUrl, { method: 'POST', body: JSON.stringify({ action: q.action, token: q.token || '', projectId: q.global ? undefined : (META.pk || undefined), data: q.data }), headers: { 'Content-Type': 'text/plain;charset=utf-8' } });
  const txt = await r.text(); let j; try { j = JSON.parse(txt); } catch (e) { throw new Error('서버 응답 오류 (서버 주소 확인): ' + txt.slice(0, 120)); }
  if (!j.ok) { const e = new Error(j.error || '서버 오류'); e.code = j.code; if (j.code === 'AUTH' && !noAuthFail) { setSession(null); showLogin(); } throw e; }
  return j.data || {};
}

/* 담당자 후보 = 통합관리의 이 현장 직원 (오프라인에서도 쓰도록 마지막 목록을 보관) */
let STAFF = LS.get('bunyang.staff.' + PROJ, []);
async function fetchStaff() {
  if (!META.syncUrl || !META.pk || needLogin()) return;
  try { const r = await callServer({ op: 'staff' }, true); STAFF = r.staff || []; LS.set('bunyang.staff.' + PROJ, STAFF); } catch (e) { }
}

/* 변경 전송은 "바뀐 필드만(patch)" 보냄 → 다른 사람이 같은 레코드의 다른 항목을 고쳐도 서로 덮어쓰지 않음 */
const BASE = {}; // col|id → 서버와 마지막으로 일치했던 레코드(JSON)
function diffRec(base, cur) {
  const p = {}; const ks = new Set(Object.keys(base).concat(Object.keys(cur))); ks.delete('_rv');
  ks.forEach(k => { if (JSON.stringify(base[k]) !== JSON.stringify(cur[k])) p[k] = cur[k] === undefined ? null : cur[k]; });
  return p;
}
function buildBase() { COLS.forEach(c => S[c].forEach(r => { const k = c + '|' + r.id; if (!OUTBOX[k]) BASE[k] = JSON.stringify(r); })); }
async function reloadStore() { for (const c of COLS) { S[c] = await idb.all(c); M[c] = {}; S[c].forEach(r => M[c][r.id] = r); } rebuild(); render(); }
async function dropLocal(c, id) { S[c] = S[c].filter(r => r.id !== id); delete M[c][id]; delete OUTBOX[c + '|' + id]; delete BASE[c + '|' + id]; await idb.del(c, id); }
function showRejected(list) {
  const g = {}; list.forEach(x => g[x.msg] = (g[x.msg] || 0) + 1);
  openModal({ title: '일부 변경이 반영되지 않았습니다', body: `<div class="help" style="margin-bottom:8px">다른 사용자가 먼저 등록/변경한 내용과 충돌하여 서버가 거절했습니다. 해당 항목은 서버의 최신 상태로 되돌렸습니다.</div><ul style="line-height:1.8">${Object.entries(g).map(([m, n]) => `<li>${esc(m)}${n > 1 ? ` <b>(${n}건)</b>` : ''}</li>`).join('')}</ul>`, foot: '<button class="btn pri" onclick="closeModal()">확인</button>' });
}
async function sync(opt = {}) {
  if (!META.syncUrl || !META.pk || syncing) return;
  if (!navigator.onLine) { online = false; updateSyncPill(); return; }
  if (needLogin()) return;
  syncing = true; updateSyncPill();
  try {
    let loops = 0, more = false;
    do {
      const keys = Object.keys(OUTBOX).slice(0, 300);
      const changes = [], sent = {};
      keys.forEach(k => {
        const i = k.indexOf('|'); const c = k.slice(0, i), id = k.slice(i + 1); const r = M[c] && M[c][id];
        if (!r) { delete OUTBOX[k]; return; }
        sent[k] = { snap: JSON.stringify(r), upd: r.updatedAt };
        if (BASE[k]) { const p = diffRec(JSON.parse(BASE[k]), r); if (!Object.keys(p).length) { delete OUTBOX[k]; return; } changes.push({ c, id, p }); } else changes.push({ c, r });
      });
      const res = await callServer({ op: 'sync', since: opt.full ? 0 : (META.lastRev || 0), changes });
      if (res.role && SESSION && res.role !== SESSION.role) setSession(Object.assign({}, SESSION, { role: res.role }));
      const rej = {}; (res.rejected || []).forEach(x => rej[x.c + '|' + x.id] = x);
      Object.keys(sent).forEach(k => { if (rej[k]) return; const i = k.indexOf('|'); const c = k.slice(0, i), id = k.slice(i + 1); const cur = M[c] && M[c][id]; if (cur && cur.updatedAt === sent[k].upd) { delete OUTBOX[k]; BASE[k] = sent[k].snap; } });
      const inc = {}; let n = 0;
      const put = (c, r) => { (inc[c] = inc[c] || []).push(r); n++; };
      for (const x of (res.rejected || [])) {
        delete OUTBOX[x.c + '|' + x.id];
        if (x.r) { _upsert(x.c, x.r); BASE[x.c + '|' + x.id] = JSON.stringify(x.r); put(x.c, x.r); } else await dropLocal(x.c, x.id);
      }
      (res.changes || []).forEach(({ c, r }) => {
        if (!M[c]) return;
        const k = c + '|' + r.id, loc = M[c][r.id], ob = BASE[k];
        if (OUTBOX[k] && loc) { // 내가 보내지 못한 변경이 있는 레코드 → 서버 최신본 위에 내 변경만 얹어 병합
          if (!ob) return;
          const merged = Object.assign({}, r, diffRec(JSON.parse(ob), loc)); BASE[k] = JSON.stringify(r); _upsert(c, merged); put(c, merged); return;
        }
        if (loc && (r._rv && loc._rv ? r._rv <= loc._rv : (r.updatedAt || '') <= (loc.updatedAt || '') && !r._rv)) { if (!BASE[k]) BASE[k] = JSON.stringify(loc); return; }
        _upsert(c, r); BASE[k] = JSON.stringify(r); put(c, r);
      });
      for (const c in inc) await idb.putMany(c, inc[c]);
      META.lastRev = res.rev; META.lastSync = nowISO(); online = true; syncErr = '';
      await persistMeta(); await idb.setMeta('outbox', OUTBOX);
      if (n) { rebuild(); DIRTY_BACKUP = true; if (!document.querySelector('.modal-bg') && !document.activeElement?.classList.contains('cell')) render(); }
      if ((res.rejected || []).length) showRejected(res.rejected);
      opt.full = false; loops++; more = !!res.more;
    } while ((Object.keys(OUTBOX).length || more) && loops < 400);
  } catch (e) {
    syncErr = e.message || String(e); if (/Failed to fetch|NetworkError/i.test(syncErr)) { online = false; syncErr = '네트워크 연결 없음'; }
    if (e.code === 'READONLY') { await reloadStore(); }
    console.warn('sync', e);
  } finally { syncing = false; updateSyncPill(); }
}
/* 실시간에 가깝게: 가벼운 poll(서버 rev만 확인)을 몇 초마다 → 바뀐 게 있을 때만 전체 동기화 */
let lastPoll = 0, polling = false;
async function poll() {
  if (!META.syncUrl || !META.pk || syncing || polling || needLogin() || !navigator.onLine) return;
  if (document.hidden && Date.now() - lastPoll < 60000) return;
  polling = true; lastPoll = Date.now();
  try {
    if (Object.keys(OUTBOX).length) { polling = false; return sync(); }
    const r = await callServer({ op: 'poll' }); online = true;
    if (r.role && SESSION && r.role !== SESSION.role) { setSession(Object.assign({}, SESSION, { role: r.role })); render(); }
    
    if (r.rev !== META.lastRev) await sync(); else { syncErr = ''; updateSyncPill(); }
  } catch (e) { if (/Failed to fetch|NetworkError/i.test(e.message)) { online = false; updateSyncPill(); } }
  finally { polling = false; }
}
setInterval(poll, 5000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });
function updateSyncPill() {
  const el = $('#syncPill'); if (!el) return;
  const n = Object.keys(OUTBOX).length;
  let cls = 'none', txt = '로컬 전용';
  if (META.syncUrl) {
    if (syncing) { cls = 'wait'; txt = '동기화 중…'; }
    else if (!online) { cls = 'off'; txt = '오프라인' + (n ? ` · 대기 ${n}` : ''); }
    else if (syncErr) { cls = 'off'; txt = '동기화 오류' + (n ? ` · 대기 ${n}` : ''); }
    else if (n) { cls = 'wait'; txt = `전송대기 ${n}`; }
    else { cls = 'ok'; txt = '동기화됨 ' + (META.lastSync ? META.lastSync.slice(11, 16) : ''); }
  } else if (n) txt = '로컬 전용 (서버 미설정)';
  el.className = 'pill ' + cls; el.innerHTML = `<i></i>${esc(txt)}`; el.title = syncErr || '클릭: 동기화 설정';
  const b = $('#backupPill'); if (b) { b.className = 'pill ' + (BK.dir ? (BK.perm ? 'ok' : 'wait') : 'none'); b.innerHTML = `<i></i>${BK.dir ? (BK.perm ? '백업 ' + (META.lastBackup ? META.lastBackup.slice(11, 16) : '대기') : '백업폴더 권한필요') : '백업폴더 미지정'}`; }
}

/* ===================== 로컬 폴더 백업 ===================== */
const BK = { dir: null, perm: false };
function exportAll() {
  const o = { app: 'bunyang', version: 2, project: PROJ, exportedAt: nowISO() };
  COLS.forEach(c => o[c] = S[c]);
  return o;
}
async function initBackup() {
  try { BK.dir = await idb.getMeta('backupDir'); if (BK.dir) BK.perm = (await BK.dir.queryPermission({ mode: 'readwrite' })) === 'granted'; } catch (e) { BK.dir = null; }
  updateSyncPill();
}
async function pickBackupDir() {
  if (!window.showDirectoryPicker) return toast('이 브라우저는 폴더 백업을 지원하지 않습니다. 크롬/엣지를 사용하세요.', 1);
  try { const h = await showDirectoryPicker({ id: 'bunyang-backup', mode: 'readwrite' }); BK.dir = h; BK.perm = true; await idb.setMeta('backupDir', h); await backupNow(true); render(); }
  catch (e) { if (e.name !== 'AbortError') toast('폴더 지정 실패: ' + e.message, 1); }
}
async function grantBackup() { if (!BK.dir) return pickBackupDir(); try { BK.perm = (await BK.dir.requestPermission({ mode: 'readwrite' })) === 'granted'; if (BK.perm) await backupNow(true); } catch (e) { toast(e.message, 1); } updateSyncPill(); render(); }
async function backupNow(force) {
  if (!BK.dir || !BK.perm) { if (force) toast('백업 폴더를 먼저 지정/허용해 주세요', 1); return false; }
  if (!force && !DIRTY_BACKUP) return false;
  try {
    const name = (CFG().project.name || PROJ).replace(/[\\/:*?"<>|\s]/g, '_');
    const txt = JSON.stringify(exportAll());
    const d = new Date(); const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours());
    for (const fn of [name + '_최신백업.json', name + '_백업_' + stamp + '시.json']) {
      const fh = await BK.dir.getFileHandle(fn, { create: true }); const w = await fh.createWritable(); await w.write(txt); await w.close();
    }
    DIRTY_BACKUP = false; META.lastBackup = nowISO(); persistMeta(); updateSyncPill();
    if (force) toast('백업 저장 완료');
    return true;
  } catch (e) { BK.perm = false; updateSyncPill(); toast('백업 실패: ' + e.message, 1); return false; }
}
setInterval(() => backupNow(false), 60000);
function downloadBackup() { dl((CFG().project.name || PROJ) + '_백업_' + today() + '.json', new Blob([JSON.stringify(exportAll())], { type: 'application/json' })); META.lastBackup = nowISO(); DIRTY_BACKUP = false; persistMeta(); updateSyncPill(); }
async function restoreFrom(obj, opt = {}) {
  if (!obj || !obj.units) throw new Error('백업 파일 형식이 아닙니다');
  const ts = nowISO();
  for (const c of COLS) {
    const arr = Array.isArray(obj[c]) ? obj[c] : [];
    if (opt.touch) arr.forEach(r => { r.updatedAt = ts; });
    await idb.clear(c); await idb.putMany(c, arr);
    S[c] = arr; M[c] = {}; arr.forEach(r => M[c][r.id] = r);
  }
  if (obj.settings && !Array.isArray(obj.settings)) { const st = Object.assign({ id: 'main', updatedAt: ts }, obj.settings); S.settings = [st]; M.settings = { main: st }; await idb.clear('settings'); await idb.putMany('settings', [st]); }
  OUTBOX = {};
  if (opt.markAll) COLS.forEach(c => S[c].forEach(r => OUTBOX[c + '|' + r.id] = 1));
  await idb.setMeta('outbox', OUTBOX);
  if (opt.resetRev) { META.lastRev = 0; await persistMeta(); }
  DIRTY_BACKUP = true; rebuild(); Object.keys(BASE).forEach(k => delete BASE[k]); buildBase();
  const pl = projList(); const me = pl.find(p => p.key === PROJ); const nm = (M.settings.main || {}).project?.name; if (nm) { if (me) me.name = nm; else pl.push({ key: PROJ, name: nm }); LS.set('bunyang.projects', pl); }
}

// 현장 목록(콤보)의 이름을 현재 프로젝트 설정의 현장명과 맞춤
function syncProjName() {
  const nm = ((M.settings.main || {}).project || {}).name; if (!nm || PROJ === 'default' && nm === '새 프로젝트') return;
  const pl = projList(); const me = pl.find(p => p.key === PROJ);
  if (me) { if (me.name !== nm) { me.name = nm; LS.set('bunyang.projects', pl); } } else { pl.push({ key: PROJ, name: nm }); LS.set('bunyang.projects', pl); }
}

/* 동호지정 메뉴 폐지 → 기존 동호지정 기록은 '가계약(가계약금 0원)'으로 이관 */
async function migrateResv() {
  const rs = live('resv'); if (!rs.length) return;
  const pre = rs.map(r => ({ date: r.date, dongho: r.dongho, status: r.status, name: r.name, phone: r.phone, plan: r.plan, team: r.team, staff: r.staff, note: ('[동호지정→가계약] ' + (r.note || '')).trim() }));
  await save('pre', pre);
  for (const r of rs) await remove('resv', r.id);
}

/* ===================== 부팅 ===================== */
async function boot() {
  await idb.open();
  for (const c of COLS) { S[c] = await idb.all(c); M[c] = {}; S[c].forEach(r => M[c][r.id] = r); }
  META = Object.assign(META, (await idb.getMeta('local')) || {});
  OUTBOX = (await idb.getMeta('outbox')) || {};
  if (!META.syncUrl && typeof DEFAULT_SERVER === 'string' && DEFAULT_SERVER) META.syncUrl = DEFAULT_SERVER;
  META.pk = PROJ !== 'default' ? PROJ : ''; // 현장 id = 서버 현장 id
  if (!M.settings.main) { const st = DEFAULT_SETTINGS(); S.settings.push(st); M.settings.main = st; }
  rebuild(); buildBase();
  syncProjName();
  await migrateResv();
  await initBackup();
  buildShell();
  route();
  await initAuth();
  sync();
}
