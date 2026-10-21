// 설문(고객관리 > 설문고객): 빌더, 배포 링크, 공개 응답, 응답 원장·통계·내보내기, 현장 간 공통문항 비교.
// 개인정보 원칙: 이름·전화번호는 개인정보 수집에 동의한 응답만, 전화번호는 암호화 + 해시(고객 연결용)로 저장한다.
import { AppError, s, all, first, run, stmt, nowStr, todayStr, newId, randomToken, encryptText, decryptText, phoneHash, orgNameMap, writeLog } from '../core/util.js';
import { STD, PII_KEYS, CHOICE_TYPES, CUSTOM_TYPES, DEFAULT_CONSENT_TEXT, DEFAULT_STD, bankList } from './std.js';

const STATUSES = ['작성', '진행', '마감'];
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

// ---------- 문항 검증 ----------

// 보기 목록 정리. 이미 코드가 있는 보기는 코드를 그대로 두고(응답 데이터와 이어져 있으므로), 새 보기만 다음 번호를 받는다
function buildOptions(raw) {
  const list = (Array.isArray(raw) ? raw : []).map((o) => (typeof o === 'string' ? { label: o } : { code: s(o.code), label: s(o.label) }))
    .map((o) => ({ code: o.code || '', label: o.label.trim().slice(0, 60) })).filter((o) => o.label);
  const used = new Set(list.map((o) => o.code).filter(Boolean));
  let n = 0;
  list.forEach((o) => {
    if (o.code) return;
    do { n++; } while (used.has(String(n)));
    o.code = String(n); used.add(o.code);
  });
  if (new Set(list.map((o) => o.code)).size !== list.length) throw new AppError('보기 코드가 중복되었습니다.');
  return list;
}

function cleanQuestions(raw) {
  if (!Array.isArray(raw) || !raw.length) throw new AppError('문항을 1개 이상 추가하세요.');
  if (raw.length > 60) throw new AppError('문항은 60개까지 만들 수 있습니다.');
  const keys = new Set();
  return raw.map((q, i) => {
    const std = STD[s(q.key)];
    const no = (i + 1) + '번 문항';
    const title = s(q.title).trim().slice(0, 150);
    let key = s(q.key);
    if (std) {
      if (keys.has(key)) throw new AppError(no + ': 같은 공통 문항을 두 번 넣을 수 없습니다.');
      keys.add(key);
      let options = std.options || [];
      if (std.editableOptions) {
        options = buildOptions(q.options);
        if (!options.length) throw new AppError(no + ': 보기를 1개 이상 입력해 주세요.');
      }
      return { key, std: true, type: std.type, title: title || std.title, required: std.forceRequired ? true : !!q.required, options };
    }
    if (!/^Q[A-Z0-9]{4,10}$/.test(key) || keys.has(key)) key = 'Q' + randomToken(6);
    keys.add(key);
    const type = s(q.type);
    if (!CUSTOM_TYPES.includes(type)) throw new AppError(no + ': 문항 종류가 올바르지 않습니다.');
    if (!title) throw new AppError(no + '의 제목이 비어 있습니다.');
    const options = CHOICE_TYPES.includes(type) ? buildOptions(q.options) : [];
    if (CHOICE_TYPES.includes(type) && !options.length) throw new AppError(no + '의 선택지가 없습니다.');
    return { key, std: false, type, title, required: !!q.required, options };
  });
}

const surveyView = (r, extra) => ({
  id: r.id, title: r.title, description: r.description, theme: r.theme, status: r.status, consentText: r.consent_text,
  version: r.version, questions: JSON.parse(r.questions_json || '[]'), createdAt: r.created_at, updatedAt: r.updated_at, ...extra
});

async function getSurvey(env, id, projectId) {
  const r = await first(env, 'SELECT * FROM surveys WHERE id = ? AND project_id = ?', s(id), projectId);
  if (!r) throw new AppError('설문을 찾을 수 없습니다.');
  return r;
}

// ---------- 관리: 설문 ----------

// 공통 문항 은행 (빌더에서 끌어다 쓴다) + 새 설문 기본값
export async function surveyBank() {
  return { bank: bankList(), defaults: DEFAULT_STD, defaultConsentText: DEFAULT_CONSENT_TEXT };
}

export async function surveyList(env, data, ctx) {
  const pid = ctx.projectId;
  const rows = await all(env, 'SELECT * FROM surveys WHERE project_id = ? ORDER BY created_at DESC', pid);
  const counts = {}, today = {}, linkN = {};
  (await all(env, 'SELECT survey_id, COUNT(*) AS n, SUM(CASE WHEN submitted_at >= ? THEN 1 ELSE 0 END) AS t FROM responses WHERE project_id = ? GROUP BY survey_id', todayStr() + ' 00:00:00', pid))
    .forEach((r) => { counts[r.survey_id] = r.n; today[r.survey_id] = r.t || 0; });
  (await all(env, 'SELECT survey_id, COUNT(*) AS n FROM survey_links WHERE project_id = ? GROUP BY survey_id', pid)).forEach((r) => { linkN[r.survey_id] = r.n; });
  return { surveys: rows.map((r) => { const v = surveyView(r, { responses: counts[r.id] || 0, today: today[r.id] || 0, links: linkN[r.id] || 0 }); v.questionCount = v.questions.length; delete v.questions; return v; }) };
}

export async function surveyGet(env, data, ctx) {
  return { survey: surveyView(await getSurvey(env, data.surveyId, ctx.projectId)) };
}

export async function surveySave(env, data, ctx) {
  const pid = ctx.projectId;
  const title = s(data.title).trim();
  if (!title || title.length > 80) throw new AppError('설문 제목을 입력해 주세요. (80자 이내)');
  const questions = cleanQuestions(data.questions);
  const status = s(data.status) || '작성';
  if (!STATUSES.includes(status)) throw new AppError('상태 값이 올바르지 않습니다.');
  const theme = /^#[0-9a-fA-F]{6}$/.test(s(data.theme)) ? s(data.theme).toLowerCase() : '';
  const description = s(data.description).trim().slice(0, 500);
  const consent = s(data.consentText).trim().slice(0, 3000) || DEFAULT_CONSENT_TEXT;
  const qjson = JSON.stringify(questions);
  const now = nowStr();
  const id = s(data.id);
  if (id) {
    const cur = await getSurvey(env, id, pid);
    const version = cur.version + (cur.questions_json !== qjson ? 1 : 0);
    await run(env, 'UPDATE surveys SET title = ?, description = ?, theme = ?, status = ?, questions_json = ?, consent_text = ?, version = ?, updated_at = ? WHERE id = ? AND project_id = ?',
      title, description, theme, status, qjson, consent, version, now, id, pid);
    await writeLog(env, ctx.account.login_id, '설문수정', id, title, pid);
    return { id };
  }
  const nid = newId('SV');
  await run(env, 'INSERT INTO surveys (id, project_id, title, description, theme, status, questions_json, consent_text, version, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
    nid, pid, title, description, theme, status, qjson, consent, ctx.account.login_id, now, now);
  await writeLog(env, ctx.account.login_id, '설문생성', nid, title, pid);
  return { id: nid };
}

export async function surveySetStatus(env, data, ctx) {
  const sv = await getSurvey(env, data.surveyId, ctx.projectId);
  const status = s(data.status);
  if (!STATUSES.includes(status)) throw new AppError('상태 값이 올바르지 않습니다.');
  await run(env, 'UPDATE surveys SET status = ?, updated_at = ? WHERE id = ? AND project_id = ?', status, nowStr(), sv.id, ctx.projectId);
  await writeLog(env, ctx.account.login_id, '설문상태', sv.id, sv.title + ' → ' + status, ctx.projectId);
  return {};
}

export async function surveyDelete(env, data, ctx) {
  const pid = ctx.projectId;
  const sv = await getSurvey(env, data.surveyId, pid);
  const n = await first(env, 'SELECT COUNT(*) AS n FROM responses WHERE survey_id = ? AND project_id = ?', sv.id, pid);
  if (n && n.n) throw new AppError('응답이 있는 설문은 삭제할 수 없습니다. "마감" 처리해 주세요.');
  await env.DB.batch([stmt(env, 'DELETE FROM survey_links WHERE survey_id = ? AND project_id = ?', sv.id, pid), stmt(env, 'DELETE FROM surveys WHERE id = ? AND project_id = ?', sv.id, pid)]);
  await writeLog(env, ctx.account.login_id, '설문삭제', sv.id, sv.title, pid);
  return {};
}

// ---------- 관리: 배포 링크 ----------

async function newLinkCode(env) {
  for (let i = 0; i < 10; i++) {
    const code = randomToken(6);
    if (!(await first(env, 'SELECT 1 FROM survey_links WHERE code = ?', code))) return code;
  }
  throw new AppError('링크 코드를 만들지 못했습니다. 다시 시도해 주세요.');
}

export async function surveyLinkList(env, data, ctx) {
  const pid = ctx.projectId;
  const sv = await getSurvey(env, data.surveyId, pid);
  const names = await orgNameMap(env, pid);
  const staff = {};
  (await all(env, 'SELECT id, name FROM staff WHERE project_id = ?', pid)).forEach((r) => { staff[r.id] = r.name; });
  const counts = {};
  (await all(env, 'SELECT link_code, COUNT(*) AS n FROM responses WHERE survey_id = ? AND project_id = ? GROUP BY link_code', sv.id, pid)).forEach((r) => { counts[r.link_code] = r.n; });
  const rows = await all(env, 'SELECT * FROM survey_links WHERE survey_id = ? AND project_id = ? ORDER BY kind, created_at', sv.id, pid);
  return {
    links: rows.map((l) => ({
      code: l.code, kind: l.kind, active: !!l.active, label: l.label, headName: names[l.head_id] || '', teamName: names[l.team_id] || '', personName: staff[l.person_id] || '',
      responses: counts[l.code] || 0
    })),
    unlinked: counts[''] || 0
  };
}

export async function surveyLinkSave(env, data, ctx) {
  const pid = ctx.projectId;
  const sv = await getSurvey(env, data.surveyId, pid);
  const kind = s(data.kind);
  const row = { head: '', team: '', person: '', label: s(data.label).trim().slice(0, 40) };
  if (kind === '본부') {
    if (!(await first(env, `SELECT 1 FROM orgs WHERE id = ? AND project_id = ? AND kind = '본부'`, s(data.headId), pid))) throw new AppError('본부를 선택해 주세요.');
    row.head = s(data.headId);
  } else if (kind === '팀') {
    const t = await first(env, `SELECT parent_id FROM orgs WHERE id = ? AND project_id = ? AND kind = '팀'`, s(data.teamId), pid);
    if (!t) throw new AppError('팀을 선택해 주세요.');
    row.team = s(data.teamId); row.head = t.parent_id;
  } else if (kind === '직원') {
    const st = await first(env, `SELECT id, name, head_id, team_id FROM staff WHERE id = ? AND project_id = ? AND status = '활동'`, s(data.staffId), pid);
    if (!st) throw new AppError('직원을 선택해 주세요.');
    row.person = st.id; row.head = st.head_id; row.team = st.team_id; row.label = st.name;
  } else if (kind === '기타') {
    if (!row.label) throw new AppError('링크 이름을 입력해 주세요. (예: 현수막, 문자)');
  } else {
    throw new AppError('링크 종류가 올바르지 않습니다.');
  }
  // 같은 대상의 링크가 이미 있으면 새로 만들지 않는다
  const dup = kind === '기타' ? await first(env, 'SELECT code FROM survey_links WHERE survey_id = ? AND project_id = ? AND kind = ? AND label = ?', sv.id, pid, kind, row.label)
    : await first(env, 'SELECT code FROM survey_links WHERE survey_id = ? AND project_id = ? AND kind = ? AND head_id = ? AND team_id = ? AND person_id = ?', sv.id, pid, kind, row.head, row.team, row.person);
  if (dup) return { code: dup.code, existed: true };
  const code = await newLinkCode(env);
  await run(env, 'INSERT INTO survey_links (code, project_id, survey_id, kind, head_id, team_id, person_id, label, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)',
    code, pid, sv.id, kind, row.head, row.team, row.person, row.label, nowStr());
  return { code, existed: false };
}

// 이 현장의 모든 본부·팀에 링크를 한 번에 만든다 (이미 있으면 건너뜀)
export async function surveyLinkGenerate(env, data, ctx) {
  const pid = ctx.projectId;
  const sv = await getSurvey(env, data.surveyId, pid);
  const orgs = await all(env, `SELECT id, kind, parent_id FROM orgs WHERE project_id = ? AND kind IN ('본부', '팀') AND active = 1`, pid);
  const have = new Set((await all(env, `SELECT kind, head_id, team_id FROM survey_links WHERE survey_id = ? AND project_id = ? AND kind IN ('본부', '팀')`, sv.id, pid)).map((l) => l.kind + '|' + l.head_id + '|' + l.team_id));
  let made = 0;
  for (const o of orgs) {
    const head = o.kind === '본부' ? o.id : o.parent_id, team = o.kind === '팀' ? o.id : '';
    if (have.has(o.kind + '|' + head + '|' + team)) continue;
    await run(env, 'INSERT INTO survey_links (code, project_id, survey_id, kind, head_id, team_id, person_id, label, active, created_at) VALUES (?, ?, ?, ?, ?, ?, \'\', \'\', 1, ?)',
      await newLinkCode(env), pid, sv.id, o.kind, head, team, nowStr());
    made++;
  }
  return { made };
}

export async function surveyLinkToggle(env, data, ctx) {
  const l = await first(env, 'SELECT code FROM survey_links WHERE code = ? AND project_id = ?', s(data.code), ctx.projectId);
  if (!l) throw new AppError('링크를 찾을 수 없습니다.');
  await run(env, 'UPDATE survey_links SET active = ? WHERE code = ? AND project_id = ?', data.active === false ? 0 : 1, l.code, ctx.projectId);
  return {};
}

// ---------- 공개: 응답 화면 ----------

async function loadLink(env, code) {
  code = s(code).trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) throw new AppError('설문 링크가 올바르지 않습니다. 링크를 다시 확인해 주세요.');
  const l = await first(env,
    `SELECT l.*, sv.title, sv.description, sv.theme, sv.status, sv.questions_json, sv.consent_text, sv.version, p.name AS project_name, p.status AS project_status
     FROM survey_links l JOIN surveys sv ON sv.id = l.survey_id AND sv.project_id = l.project_id JOIN projects p ON p.id = l.project_id WHERE l.code = ?`, code);
  if (!l) throw new AppError('존재하지 않는 설문 링크입니다. 링크를 다시 확인해 주세요.');
  return l;
}

const isOpen = (l) => l.active && l.status === '진행' && l.project_status !== '종료';

export async function surveyForm(env, data) {
  const l = await loadLink(env, data.code);
  if (!isOpen(l)) return { closed: true, title: l.title, projectName: l.project_name };
  return {
    title: l.title, description: l.description, theme: l.theme, projectName: l.project_name, consentText: l.consent_text, version: l.version,
    questions: JSON.parse(l.questions_json).map((q) => ({ key: q.key, type: q.type, title: q.title, required: q.required, options: q.options, pii: PII_KEYS.includes(q.key) }))
  };
}

const PHONE_RE = /^01[016789]\d{7,8}$/;

export async function surveySubmit(env, data) {
  const l = await loadLink(env, data.code);
  if (!isOpen(l)) throw new AppError('마감된 설문입니다.');
  const nonce = s(data.nonce).slice(0, 64);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(nonce)) throw new AppError('제출 정보를 확인할 수 없습니다. 페이지를 새로고침해 주세요.');
  const consentPi = data.consentPi === true;
  const input = data.answers && typeof data.answers === 'object' ? data.answers : {};
  const qs = JSON.parse(l.questions_json);

  let name = '', phone = '', consentMkt = 0;
  const rows = [], answers = {};
  for (const q of qs) {
    const pii = PII_KEYS.includes(q.key);
    let v = input[q.key];
    if (pii && !consentPi) continue; // 동의하지 않았으면 이름·전화번호는 받지도 저장하지도 않는다
    const multi = Array.isArray(v);
    const list = (multi ? v : (v === undefined || v === null || v === '' ? [] : [v])).map((x) => s(x).trim().slice(0, 1000)).filter((x) => x !== '');
    if (q.required && !list.length) throw new AppError('필수 문항에 응답해 주세요: ' + q.title);
    if (!list.length) continue;
    if (CHOICE_TYPES.includes(q.type)) {
      if (q.type !== 'checkbox' && list.length > 1) throw new AppError('한 개만 선택할 수 있습니다: ' + q.title);
      const picked = list.map((code) => {
        const o = q.options.find((x) => x.code === code);
        if (!o) throw new AppError('올바르지 않은 선택입니다: ' + q.title);
        return o;
      });
      answers[q.key] = q.type === 'checkbox' ? picked.map((o) => o.code) : picked[0].code;
      picked.forEach((o) => rows.push({ q_key: q.key, value_code: o.code, value_text: o.label }));
      if (q.key === 'STD_CONSENT_MKT') consentMkt = picked[0].code === 'Y' ? 1 : 0;
    } else if (q.type === 'phone') {
      const d = list[0].replace(/\D/g, '');
      if (!PHONE_RE.test(d)) throw new AppError('휴대폰 번호 형식을 확인해 주세요.');
      if (q.key === 'STD_PHONE') phone = d;
      else { answers[q.key] = d; rows.push({ q_key: q.key, value_code: '', value_text: d }); }
    } else if (q.type === 'number') {
      if (!/^-?\d{1,12}(\.\d+)?$/.test(list[0])) throw new AppError('숫자로 입력해 주세요: ' + q.title);
      answers[q.key] = list[0]; rows.push({ q_key: q.key, value_code: '', value_text: list[0] });
    } else {
      if (q.key === 'STD_NAME') name = list[0].slice(0, 20);
      else { answers[q.key] = list[0]; rows.push({ q_key: q.key, value_code: '', value_text: list[0] }); }
    }
  }
  if (!consentPi) consentMkt = 0; // 연락처가 없으면 수신 동의도 의미가 없다

  const id = newId('RS');
  const hash = consentPi && phone ? await phoneHash(env, phone) : '';
  const writes = [stmt(env,
    `INSERT INTO responses (id, project_id, survey_id, link_code, head_id, team_id, person_id, submitted_at, consent_pi, consent_mkt, phone_hash, nonce, answers_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, l.project_id, l.survey_id, l.code, l.head_id, l.team_id, l.person_id, nowStr(), consentPi ? 1 : 0, consentMkt, hash, nonce, JSON.stringify(answers))];
  if (rows.length) {
    writes.push(stmt(env,
      `INSERT INTO response_answers (response_id, project_id, survey_id, q_key, value_code, value_text)
       SELECT ?, ?, ?, json_extract(value, '$.q_key'), json_extract(value, '$.value_code'), json_extract(value, '$.value_text') FROM json_each(?)`,
      id, l.project_id, l.survey_id, JSON.stringify(rows)));
  }
  if (consentPi && (name || phone)) {
    writes.push(stmt(env, 'INSERT INTO response_pii (response_id, project_id, name, phone_enc) VALUES (?, ?, ?, ?)', id, l.project_id, name, phone ? await encryptText(env, phone) : ''));
  }
  try {
    await env.DB.batch(writes);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) return {}; // 같은 제출이 다시 들어온 것: 이미 저장되었으니 성공으로 본다
    throw e;
  }
  return {};
}

// ---------- 관리: 응답 원장·통계·내보내기 ----------

const maskPhone = (d) => (d && d.length >= 7 ? d.slice(0, 3) + '-****-' + d.slice(-4) : '');

function dateRange(data) {
  const from = s(data.from), to = s(data.to);
  if ((from && !isDate(from)) || (to && !isDate(to))) throw new AppError('날짜 형식이 올바르지 않습니다.');
  return { from: from ? from + ' 00:00:00' : '0000-00-00', to: to ? to + ' 23:59:59' : '9999-12-31 23:59:59' };
}

// 응답 한 줄을 사람이 읽는 형태로 (보기 코드 → 표시 문구)
function display(q, v) {
  if (v === undefined) return '';
  if (CHOICE_TYPES.includes(q.type)) {
    const one = (c) => { const o = q.options.find((x) => x.code === c); return o ? o.label : c; };
    return Array.isArray(v) ? v.map(one).join(', ') : one(v);
  }
  return v;
}

async function ledger(env, pid, sv, data, withPhone) {
  const { from, to } = dateRange(data);
  const limit = Math.min(Number(data.limit) || 200, 5000), offset = Math.max(Number(data.offset) || 0, 0);
  const qs = JSON.parse(sv.questions_json);
  const names = await orgNameMap(env, pid);
  const staff = {};
  (await all(env, 'SELECT id, name FROM staff WHERE project_id = ?', pid)).forEach((r) => { staff[r.id] = r.name; });
  const links = {};
  (await all(env, 'SELECT code, kind, label FROM survey_links WHERE survey_id = ? AND project_id = ?', sv.id, pid)).forEach((r) => { links[r.code] = r; });
  const rows = await all(env,
    `SELECT r.*, p.name AS pii_name, p.phone_enc FROM responses r LEFT JOIN response_pii p ON p.response_id = r.id AND p.project_id = r.project_id
     WHERE r.project_id = ? AND r.survey_id = ? AND r.submitted_at >= ? AND r.submitted_at <= ? ORDER BY r.submitted_at DESC LIMIT ? OFFSET ?`, pid, sv.id, from, to, limit, offset);
  const out = [];
  for (const r of rows) {
    const ans = JSON.parse(r.answers_json || '{}');
    let phone = '';
    if (r.phone_enc) { phone = await decryptText(env, r.phone_enc); }
    const lk = links[r.link_code];
    out.push({
      id: r.id, at: r.submitted_at, linkLabel: lk ? (lk.label || lk.kind) : '(링크 없음)', head: names[r.head_id] || '', team: names[r.team_id] || '', person: staff[r.person_id] || '',
      consentPi: !!r.consent_pi, consentMkt: !!r.consent_mkt, name: r.pii_name || '', phone: withPhone ? phone : maskPhone(phone),
      answers: Object.fromEntries(qs.filter((q) => ans[q.key] !== undefined).map((q) => [q.key, display(q, ans[q.key])]))
    });
  }
  return { questions: qs.map((q) => ({ key: q.key, title: q.title, type: q.type, pii: PII_KEYS.includes(q.key) })), rows: out };
}

export async function surveyResponses(env, data, ctx) {
  const sv = await getSurvey(env, data.surveyId, ctx.projectId);
  const total = await first(env, 'SELECT COUNT(*) AS n FROM responses WHERE project_id = ? AND survey_id = ?', ctx.projectId, sv.id);
  return { total: total.n, ...(await ledger(env, ctx.projectId, sv, data, false)) };
}

// 내보내기: 동의한 응답의 이름·전화번호 원문이 들어가므로 기록을 남긴다
export async function surveyExport(env, data, ctx) {
  const sv = await getSurvey(env, data.surveyId, ctx.projectId);
  const res = await ledger(env, ctx.projectId, sv, { ...data, limit: 5000, offset: 0 }, true);
  await writeLog(env, ctx.account.login_id, '설문내보내기', sv.id, sv.title + ' / ' + res.rows.length + '건', ctx.projectId);
  return { title: sv.title, ...res };
}

export async function surveyStats(env, data, ctx) {
  const pid = ctx.projectId;
  const sv = await getSurvey(env, data.surveyId, pid);
  const { from, to } = dateRange(data);
  const qs = JSON.parse(sv.questions_json);
  const base = 'project_id = ? AND survey_id = ? AND submitted_at >= ? AND submitted_at <= ?';
  const total = await first(env, `SELECT COUNT(*) AS n, COALESCE(SUM(consent_pi), 0) AS pi, COALESCE(SUM(consent_mkt), 0) AS mkt FROM responses WHERE ${base}`, pid, sv.id, from, to);
  const byDate = await all(env, `SELECT substr(submitted_at, 1, 10) AS d, COUNT(*) AS n FROM responses WHERE ${base} GROUP BY d ORDER BY d`, pid, sv.id, from, to);
  const names = await orgNameMap(env, pid);
  const staff = {};
  (await all(env, 'SELECT id, name FROM staff WHERE project_id = ?', pid)).forEach((r) => { staff[r.id] = r.name; });
  const byTeam = await all(env, `SELECT head_id, team_id, COUNT(*) AS n FROM responses WHERE ${base} GROUP BY head_id, team_id`, pid, sv.id, from, to);
  const byPerson = await all(env, `SELECT person_id, COUNT(*) AS n FROM responses WHERE ${base} AND person_id <> '' GROUP BY person_id ORDER BY n DESC LIMIT 50`, pid, sv.id, from, to);
  const dist = await all(env,
    `SELECT a.q_key, a.value_code, COUNT(*) AS n FROM response_answers a JOIN responses r ON r.id = a.response_id
     WHERE r.project_id = ? AND r.survey_id = ? AND r.submitted_at >= ? AND r.submitted_at <= ? GROUP BY a.q_key, a.value_code`, pid, sv.id, from, to);
  const by = {};
  dist.forEach((d) => { (by[d.q_key] = by[d.q_key] || {})[d.value_code] = d.n; });
  const questions = qs.filter((q) => CHOICE_TYPES.includes(q.type)).map((q) => {
    const counts = by[q.key] || {};
    return { key: q.key, title: q.title, std: q.std, options: q.options.map((o) => ({ code: o.code, label: o.label, n: counts[o.code] || 0 })), answered: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
  const intent = questions.find((q) => q.key === 'STD_INTENT');
  const intentN = intent ? intent.options.reduce((a, o) => a + o.n, 0) : 0;
  return {
    total: total.n, consentPi: total.pi, consentMkt: total.mkt, byDate,
    byTeam: byTeam.map((t) => ({ head: names[t.head_id] || '(미지정)', team: names[t.team_id] || '', n: t.n })).sort((a, b) => (a.head + a.team).localeCompare(b.head + b.team, 'ko')),
    byPerson: byPerson.map((p) => ({ name: staff[p.person_id] || '(알 수 없음)', n: p.n })),
    questions,
    intentAvg: intentN ? Math.round(intent.options.reduce((a, o) => a + Number(o.code) * o.n, 0) / intentN * 100) / 100 : null
  };
}

// 현장을 넘나드는 공통문항 비교: 같은 key·코드끼리 현장별 분포를 합산한다 (관리자: 전체 현장, 보조관리자: 담당 현장만)
export async function surveyCompare(env, data, ctx) {
  const keys = (Array.isArray(data.keys) && data.keys.length ? data.keys : ['STD_INTENT']).filter((k) => STD[k] && STD[k].options);
  if (!keys.length) throw new AppError('비교할 공통 문항을 선택해 주세요.');
  const scope = ctx.role === 'admin' ? '' : ' AND a.project_id IN (SELECT project_id FROM account_projects WHERE account_id = ?)';
  const out = [];
  for (const key of keys) {
    const rows = await all(env,
      `SELECT a.project_id, a.value_code, COUNT(*) AS n FROM response_answers a WHERE a.q_key = ?${scope} GROUP BY a.project_id, a.value_code`, key, ...(scope ? [ctx.account.id] : []));
    const projects = {};
    (await all(env, 'SELECT id, name FROM projects')).forEach((p) => { projects[p.id] = p.name; });
    const per = {};
    rows.forEach((r) => { (per[r.project_id] = per[r.project_id] || {})[r.value_code] = r.n; });
    const std = STD[key];
    out.push({
      key, title: std.title, options: std.options,
      projects: Object.keys(per).map((pid) => ({ projectId: pid, name: projects[pid] || pid, counts: per[pid], total: Object.values(per[pid]).reduce((a, b) => a + b, 0) })).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
    });
  }
  return { compare: out };
}

// 개인정보 보유기간이 지난 응답의 이름·전화번호를 파기한다 (종료된 현장 중 종료일이 N개월 지난 것). 관리자 전용, 기록됨.
export async function surveyPurgePii(env, data, ctx) {
  const months = Math.max(1, Math.min(Number(data.months) || 6, 60));
  const cutoff = new Date(Date.now() + 9 * 3600e3);
  cutoff.setMonth(cutoff.getMonth() - months);
  const day = cutoff.toISOString().slice(0, 10);
  const projects = await all(env, `SELECT id, name FROM projects WHERE status = '종료' AND end_date <> '' AND end_date <= ?`, day);
  let removed = 0;
  for (const p of projects) {
    const res = await run(env, 'DELETE FROM response_pii WHERE project_id = ?', p.id);
    await run(env, `UPDATE responses SET phone_hash = '' WHERE project_id = ? AND phone_hash <> ''`, p.id);
    removed += res.meta.changes || 0;
  }
  await writeLog(env, ctx.account.login_id, '설문개인정보파기', '', months + '개월 경과 현장 ' + projects.length + '곳 / 이름·전화번호 ' + removed + '건');
  return { projects: projects.length, removed };
}

// ---------- 직원앱: 내 설문 링크 ----------

// 진행 중인 설문마다 내 개인 링크를 (없으면 만들어) 돌려준다. 이 링크로 들어온 응답은 내 실적으로 집계된다
export async function surveyMyLinks(env, data, ctx) {
  const pid = ctx.projectId, me = ctx.staff;
  const surveys = await all(env, `SELECT id, title FROM surveys WHERE project_id = ? AND status = '진행' ORDER BY created_at DESC`, pid);
  const out = [];
  for (const sv of surveys) {
    let l = await first(env, 'SELECT code FROM survey_links WHERE survey_id = ? AND project_id = ? AND person_id = ?', sv.id, pid, me.id);
    if (!l) {
      const code = await newLinkCode(env);
      try {
        await run(env, 'INSERT INTO survey_links (code, project_id, survey_id, kind, head_id, team_id, person_id, label, active, created_at) VALUES (?, ?, ?, \'직원\', ?, ?, ?, ?, 1, ?)',
          code, pid, sv.id, me.head_id, me.team_id, me.id, me.name, nowStr());
        l = { code };
      } catch (e) {
        l = await first(env, 'SELECT code FROM survey_links WHERE survey_id = ? AND project_id = ? AND person_id = ?', sv.id, pid, me.id); // 동시에 눌러도 하나만
        if (!l) throw e;
      }
    }
    const n = await first(env, 'SELECT COUNT(*) AS n FROM responses WHERE project_id = ? AND survey_id = ? AND person_id = ?', pid, sv.id, me.id);
    out.push({ surveyId: sv.id, title: sv.title, code: l.code, responses: n ? n.n : 0 });
  }
  return { links: out };
}

// 설문 응답 고객 목록(고객관리 > 설문고객): 필수 항목만. 세부 문항은 설문 앱의 내보내기나 데이터통합관리에서 본다.
// 개인정보에 동의한 응답만 이름·전화번호(마스킹)가 나온다.
export async function surveyRespondents(env, data, ctx) {
  const pid = ctx.projectId;
  const q = s(data.q).trim().toLowerCase();
  const surveyId = s(data.surveyId);
  const rows = await all(env,
    `SELECT r.id, r.submitted_at, r.survey_id, r.consent_pi, r.consent_mkt, r.person_id, r.team_id, r.head_id, r.link_code, sv.title,
            p.name, p.phone_enc,
            (SELECT a.value_text FROM response_answers a WHERE a.response_id = r.id AND a.q_key = 'STD_INTENT' LIMIT 1) AS intent,
            (SELECT a.value_text FROM response_answers a WHERE a.response_id = r.id AND a.q_key = 'STD_AGE' LIMIT 1) AS age
     FROM responses r JOIN surveys sv ON sv.id = r.survey_id AND sv.project_id = r.project_id
     LEFT JOIN response_pii p ON p.response_id = r.id AND p.project_id = r.project_id
     WHERE r.project_id = ?${surveyId ? ' AND r.survey_id = ?' : ''} ORDER BY r.submitted_at DESC LIMIT 1000`,
    ...(surveyId ? [pid, surveyId] : [pid]));
  const names = await orgNameMap(env, pid);
  const staff = {};
  (await all(env, 'SELECT id, name FROM staff WHERE project_id = ?', pid)).forEach((r) => { staff[r.id] = r.name; });
  const mask = (d) => (d && d.length >= 7 ? d.slice(0, 3) + '-****-' + d.slice(-4) : '');
  const out = [];
  for (const r of rows) {
    const phone = r.phone_enc ? mask(await decryptText(env, r.phone_enc)) : '';
    const row = {
      at: r.submitted_at, survey: r.title, name: r.name || '', phone, intent: r.intent || '', age: r.age || '',
      consentPi: !!r.consent_pi, consentMkt: !!r.consent_mkt, person: staff[r.person_id] || '', team: [names[r.head_id], names[r.team_id]].filter(Boolean).join(' ')
    };
    if (q && !(row.name.toLowerCase().includes(q) || row.person.toLowerCase().includes(q))) continue;
    out.push(row);
  }
  const total = await first(env, `SELECT COUNT(*) AS n FROM responses WHERE project_id = ?${surveyId ? ' AND survey_id = ?' : ''}`, ...(surveyId ? [pid, surveyId] : [pid]));
  return { total: total.n, shown: out.length, rows: out };
}
