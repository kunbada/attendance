/**
 * 위뉴 사전판촉 설문조사 앱  (Google Apps Script + Google Sheets, 무료)
 * ------------------------------------------------------------------
 *  - 관리자 화면 : 웹앱 URL 그대로 접속 → 비밀번호 로그인
 *  - 응답자 링크 : 웹앱URL?s=설문ID&t=팀조코드   (t 없으면 '미지정'으로 집계)
 *  - 데이터     : Projects / Surveys / Teams / Responses 시트 + 설문별 RAW_ 시트(실시간 로우데이터)
 *
 *  최초 1회 : setup() 실행 → 웹앱 배포(실행: 나, 액세스: 모든 사용자)
 *  비밀번호 : setAdminPassword() 안의 값을 바꾼 뒤 실행 (기본값 wenew1234)
 */

const TZ = 'Asia/Seoul';
const HEADERS = {
  Projects:  ['id', 'name', 'site', 'memo', 'status', 'createdAt'],
  Surveys:   ['id', 'projectId', 'title', 'description', 'consentText', 'questions', 'status', 'rawSheet', 'createdAt', 'updatedAt', 'theme'],
  Teams:     ['id', 'projectId', 'team', 'group', 'code', 'createdAt'],
  Responses: ['id', 'timestamp', 'projectId', 'surveyId', 'teamCode', 'team', 'group', 'answers']
};
const CHOICE_TYPES = ['radio', 'checkbox', 'select'];
const RAW_FIXED = ['응답ID', '응답일시', '프로젝트', '설문', '팀', '조', '링크코드'];

/* ================= 초기 설정 ================= */
/** 시트 타임존 맞춤 + 기존 시트에 새로 추가된 컬럼 헤더를 보강 (컬럼 추가 업데이트용) */
function ensureHeaders_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss.getSpreadsheetTimeZone() !== TZ) ss.setSpreadsheetTimeZone(TZ);   // 시트 표시 시각을 스크립트(서울)와 맞춤
  Object.keys(HEADERS).forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() === 0) return;
    const want = HEADERS[name], have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    for (let i = 0; i < want.length; i++) {
      if (have[i] === want[i]) continue;
      if (have[i] === '' || have[i] === undefined) {
        sh.getRange(1, i + 1).setValue(want[i]).setFontWeight('bold').setBackground('#eef2f7');
      }
    }
  });
}

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(HEADERS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]])
        .setFontWeight('bold').setBackground('#eef2f7');
      sh.setFrozenRows(1);
    }
  });
  ['Sheet1', '시트1'].forEach(n => {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  ensureHeaders_();
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ADMIN_PASSWORD')) props.setProperty('ADMIN_PASSWORD', 'wenew1234');
}

/** 관리자 비밀번호 변경: 아래 문자열을 바꾸고 이 함수를 실행 */
function setAdminPassword() {
  PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD', '여기에_새_비밀번호');
}

/** 응답자용 링크의 기준 주소 설정 (Apps Script 안내 배너를 가리는 래퍼 페이지 주소). 빈 문자열이면 /exec 사용 */
function setSurveyBaseUrl() {
  PropertiesService.getScriptProperties().setProperty('SURVEY_BASE_URL', 'https://kunbada.github.io/wenew-survey/');
}

/* ================= 라우팅 ================= */
function doGet(e) {
  const p = (e && e.parameter) || {};
  let out;
  if (p.s) {
    const t = HtmlService.createTemplateFromFile('Survey');
    t.surveyId = p.s;
    t.teamCode = p.t || '';
    out = t.evaluate().setTitle('설문조사');
  } else {
    out = HtmlService.createTemplateFromFile('Admin').evaluate().setTitle('사전판촉 설문 관리');
  }
  return out.addMetaTag('viewport', 'width=device-width, initial-scale=1')
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ================= 공통 유틸 ================= */
function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error(name + ' 시트가 없습니다. setup()을 먼저 실행하세요.');
  return sh;
}
function fmt_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd HH:mm:ss'); }
function uid_(prefix) {
  return prefix + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 5).toUpperCase();
}
function readTable_(name) {
  const v = sheet_(name).getDataRange().getValues();
  const h = v.shift() || [];
  const out = [];
  v.forEach((r, i) => {
    if (r[0] === '') return;
    const o = { _row: i + 2 };
    h.forEach((k, j) => {
      const x = r[j];
      o[k] = x instanceof Date ? fmt_(x) : (typeof x === 'number' ? String(x) : x);
    });
    out.push(o);
  });
  return out;
}
function upsert_(name, obj) {
  const sh = sheet_(name), h = HEADERS[name];
  const ex = readTable_(name).find(r => String(r.id) === String(obj.id));
  const row = h.map(k => obj[k] !== undefined ? obj[k] : (ex ? ex[k] : ''));
  if (ex) sh.getRange(ex._row, 1, 1, h.length).setValues([row]);
  else sh.appendRow(row);
}
function deleteRow_(name, id) {
  const ex = readTable_(name).find(r => String(r.id) === String(id));
  if (ex) sheet_(name).deleteRow(ex._row);
}
function clean_(o) { const c = Object.assign({}, o); delete c._row; return c; }
function parseJSON_(s, d) { try { return JSON.parse(s); } catch (e) { return d; } }
function auth_(pw) {
  const real = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD');
  if (!real || pw !== real) throw new Error('관리자 인증에 실패했습니다.');
}
function genCode_() {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ', C = L + '23456789';
  let s = L[Math.floor(Math.random() * L.length)];
  for (let i = 0; i < 5; i++) s += C[Math.floor(Math.random() * C.length)];
  return s;
}

/* ================= 관리자 API ================= */
function adminLogin(pw) { auth_(pw); return true; }

function adminInit(pw) {
  auth_(pw);
  ensureHeaders_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const counts = {};
  readTable_('Responses').forEach(r => { counts[r.surveyId] = (counts[r.surveyId] || 0) + 1; });
  const surveys = readTable_('Surveys').map(s => {
    const c = clean_(s);
    c.questions = parseJSON_(s.questions, []);
    const raw = s.rawSheet ? ss.getSheetByName(s.rawSheet) : null;
    c.rawGid = raw ? raw.getSheetId() : null;
    return c;
  });
  return {
    projects: readTable_('Projects').map(clean_),
    surveys: surveys,
    teams: readTable_('Teams').map(clean_),
    counts: counts,
    baseUrl: ScriptApp.getService().getUrl(),
    surveyBaseUrl: PropertiesService.getScriptProperties().getProperty('SURVEY_BASE_URL') || ScriptApp.getService().getUrl(),
    sheetUrl: ss.getUrl()
  };
}

function saveProject(pw, p) {
  auth_(pw);
  if (!p.name || !String(p.name).trim()) throw new Error('프로젝트명을 입력하세요.');
  const o = { id: p.id || uid_('P'), name: String(p.name).trim(), site: p.site || '', memo: p.memo || '', status: p.status || '진행' };
  if (!p.id) o.createdAt = new Date();
  upsert_('Projects', o);
  return o.id;
}

function deleteProject(pw, id) {
  auth_(pw);
  if (readTable_('Surveys').some(s => s.projectId === id))
    throw new Error('설문이 있는 프로젝트는 삭제할 수 없습니다. 상태를 "종료"로 바꿔 주세요.');
  readTable_('Teams').filter(t => t.projectId === id).reverse().forEach(t => sheet_('Teams').deleteRow(t._row));
  deleteRow_('Projects', id);
}

function saveSurvey(pw, s) {
  auth_(pw);
  if (!s.projectId) throw new Error('프로젝트를 선택하세요.');
  if (!s.title || !String(s.title).trim()) throw new Error('설문 제목을 입력하세요.');
  const qs = (s.questions || []).map(q => ({
    id: q.id || uid_('Q'),
    type: q.type || 'text',
    title: String(q.title || '').trim(),
    required: !!q.required,
    options: (q.options || []).map(x => String(x).trim()).filter(Boolean)
  }));
  if (!qs.length) throw new Error('문항을 1개 이상 추가하세요.');
  qs.forEach((q, i) => {
    if (!q.title) throw new Error((i + 1) + '번 문항의 제목이 비어 있습니다.');
    if (CHOICE_TYPES.indexOf(q.type) >= 0 && !q.options.length) throw new Error((i + 1) + '번 문항의 선택지가 없습니다.');
  });
  const now = new Date();
  const o = {
    id: s.id || uid_('S'), projectId: s.projectId, title: String(s.title).trim(),
    description: s.description || '', consentText: s.consentText || '',
    questions: JSON.stringify(qs), status: s.status || '진행', updatedAt: now,
    theme: /^#[0-9a-fA-F]{6}$/.test(s.theme || '') ? s.theme : ''
  };
  if (!s.id) { o.createdAt = now; o.rawSheet = ''; }
  upsert_('Surveys', o);
  return o.id;
}

function setSurveyStatus(pw, id, status) {
  auth_(pw);
  upsert_('Surveys', { id: id, status: status, updatedAt: new Date() });
}

function deleteSurvey(pw, id) {
  auth_(pw);
  if (readTable_('Responses').some(r => r.surveyId === id))
    throw new Error('응답이 있는 설문은 삭제할 수 없습니다. "마감" 처리해 주세요.');
  deleteRow_('Surveys', id);
}

/** list: [{id?, team, group}] — id 있으면 수정, 없으면 신규(코드 자동 발급) */
function saveTeams(pw, projectId, list) {
  auth_(pw);
  const existing = readTable_('Teams');
  const codes = new Set(existing.map(t => String(t.code)));
  let added = 0;
  (list || []).forEach(t => {
    const team = String(t.team || '').trim(), group = String(t.group || '').trim();
    if (!team) return;
    if (t.id) { upsert_('Teams', { id: t.id, team: team, group: group }); return; }
    if (existing.some(e => e.projectId === projectId && String(e.team) === team && String(e.group) === group)) return;
    let code; do { code = genCode_(); } while (codes.has(code));
    codes.add(code);
    sheet_('Teams').appendRow([uid_('T'), projectId, team, group, code, new Date()]);
    added++;
  });
  return added;
}

function deleteTeam(pw, id) { auth_(pw); deleteRow_('Teams', id); }

/** f: {projectId, surveyId, from:'yyyy-MM-dd', to:'yyyy-MM-dd'} */
function getStats(pw, f) {
  auth_(pw);
  f = f || {};
  const projects = readTable_('Projects'), surveys = readTable_('Surveys'), teams = readTable_('Teams');
  const pName = id => (projects.find(p => p.id === id) || {}).name || '(삭제됨)';
  const day = r => String(r.timestamp).slice(0, 10);
  const today = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

  let rs = readTable_('Responses');
  if (f.projectId) rs = rs.filter(r => r.projectId === f.projectId);
  if (f.surveyId) rs = rs.filter(r => r.surveyId === f.surveyId);
  if (f.from) rs = rs.filter(r => day(r) >= f.from);
  if (f.to) rs = rs.filter(r => day(r) <= f.to);

  const cnt = (arr, key) => arr.reduce((m, r) => { const k = key(r); m[k] = (m[k] || 0) + 1; return m; }, {});
  const res = {
    total: rs.length,
    today: rs.filter(r => day(r) === today).length,
    byDate: cnt(rs, day),
    byProject: cnt(rs, r => pName(r.projectId)),
    bySurvey: cnt(rs, r => r.surveyId)
  };

  // 팀·조별 (응답 0건인 팀도 표시)
  const gmap = {};
  const key = (pid, team, group) => pid + '|' + team + '|' + group;
  teams.filter(t => !f.projectId || t.projectId === f.projectId).forEach(t => {
    gmap[key(t.projectId, t.team, t.group)] = { project: pName(t.projectId), team: String(t.team), group: String(t.group), code: String(t.code), count: 0, today: 0 };
  });
  rs.forEach(r => {
    const k = key(r.projectId, r.team, r.group);
    if (!gmap[k]) gmap[k] = { project: pName(r.projectId), team: String(r.team || '미지정'), group: String(r.group || ''), code: String(r.teamCode || ''), count: 0, today: 0 };
    gmap[k].count++;
    if (day(r) === today) gmap[k].today++;
  });
  res.byGroup = Object.values(gmap).sort((a, b) =>
    a.project.localeCompare(b.project) || a.team.localeCompare(b.team, 'ko', { numeric: true }) || a.group.localeCompare(b.group, 'ko', { numeric: true }));
  const tmap = {};
  res.byGroup.forEach(g => {
    const k = g.project + '|' + g.team;
    if (!tmap[k]) tmap[k] = { project: g.project, team: g.team, count: 0, today: 0 };
    tmap[k].count += g.count; tmap[k].today += g.today;
  });
  res.byTeam = Object.values(tmap);

  // 문항별 응답 분포 (선택형 문항)
  if (f.surveyId) {
    const s = surveys.find(x => x.id === f.surveyId);
    const qs = parseJSON_(s && s.questions, []);
    const parsed = rs.map(r => parseJSON_(r.answers, {}));
    res.questions = qs.filter(q => CHOICE_TYPES.indexOf(q.type) >= 0).map(q => {
      const d = {};
      q.options.forEach(o => d[o] = 0);
      let n = 0;
      parsed.forEach(a => {
        let v = a[q.id];
        v = Array.isArray(v) ? v : (v ? [v] : []);
        if (v.length) n++;
        v.forEach(x => { d[x] = (d[x] || 0) + 1; });
      });
      return { title: q.title, type: q.type, dist: d, n: n };
    });
  }
  return res;
}

/* ================= 응답자(공개) API ================= */
function getSurveyForm(surveyId) {
  const s = readTable_('Surveys').find(r => String(r.id) === String(surveyId));
  if (!s) return { error: '존재하지 않는 설문입니다. 링크를 다시 확인해 주세요.' };
  const p = readTable_('Projects').find(r => r.id === s.projectId) || {};
  if (s.status !== '진행' || p.status === '종료') return { closed: true, title: s.title, projectName: p.name || '' };
  return {
    title: s.title, description: s.description, consentText: s.consentText,
    questions: parseJSON_(s.questions, []), projectName: p.name || '',
    theme: s.theme || ''
  };
}

function submitResponse(surveyId, teamCode, answers) {
  answers = answers || {};
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const s = readTable_('Surveys').find(r => String(r.id) === String(surveyId));
    if (!s) throw new Error('존재하지 않는 설문입니다.');
    const p = readTable_('Projects').find(r => r.id === s.projectId) || {};
    if (s.status !== '진행' || p.status === '종료') throw new Error('마감된 설문입니다.');

    const qs = parseJSON_(s.questions, []);
    const ans = {};
    qs.forEach(q => {
      let a = answers[q.id];
      if (Array.isArray(a)) a = a.map(x => String(x).slice(0, 200));
      else a = a == null ? '' : String(a).trim().slice(0, 2000);
      const empty = Array.isArray(a) ? !a.length : a === '';
      if (q.required && empty) throw new Error('필수 문항에 응답해 주세요: ' + q.title);
      ans[q.id] = a;
    });
    if (s.consentText && !answers.__consent) throw new Error('개인정보 수집·이용에 동의해 주세요.');

    const team = readTable_('Teams').find(t => String(t.code) === String(teamCode) && t.projectId === s.projectId);
    const now = new Date(), id = uid_('R');
    const teamName = team ? team.team : '미지정', groupName = team ? team.group : '';
    sheet_('Responses').appendRow([id, now, s.projectId, s.id, teamCode || '', teamName, groupName, JSON.stringify(ans)]);
    writeRaw_(s, p, teamName, groupName, teamCode, qs, ans, id, now);
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

/** 설문별 RAW 시트에 한 행씩 기록 (문항ID는 헤더 셀 메모로 관리 → 문항 제목을 바꿔도 열이 유지됨) */
function writeRaw_(s, p, teamName, groupName, teamCode, qs, ans, id, now) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = s.rawSheet ? ss.getSheetByName(s.rawSheet) : null;
  if (!sh) {
    const name = 'RAW_' + String(s.title).replace(/[\[\]\*\?\/\\:']/g, '').slice(0, 25) + '_' + String(s.id).slice(-4);
    sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, RAW_FIXED.length).setValues([RAW_FIXED]).setFontWeight('bold').setBackground('#eef2f7');
      sh.setFrozenRows(1);
    }
    upsert_('Surveys', { id: s.id, rawSheet: name });
  }
  const lastCol = Math.max(sh.getLastColumn(), RAW_FIXED.length);
  const notes = sh.getRange(1, 1, 1, lastCol).getNotes()[0];
  const colOf = {};
  notes.forEach((n, i) => { if (n) colOf[n] = i + 1; });
  let next = lastCol + 1;
  qs.forEach(q => {
    if (colOf[q.id]) return;
    if (next > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 5);
    sh.getRange(1, next).setValue(q.title).setNote(q.id).setFontWeight('bold').setBackground('#eef2f7');
    colOf[q.id] = next++;
  });
  const row = new Array(next - 1).fill('');
  [id, now, p.name || '', s.title, teamName, groupName, teamCode || ''].forEach((v, i) => row[i] = v);
  qs.forEach(q => {
    let a = ans[q.id];
    if (Array.isArray(a)) a = a.join(', ');
    // 0으로 시작하는 번호(전화번호 등) 보존 + 수식 주입 방지
    if (typeof a === 'string' && (/^[=+\-@]/.test(a) || /^0\d/.test(a))) a = "'" + a;
    row[colOf[q.id] - 1] = a;
  });
  sh.appendRow(row);
}
