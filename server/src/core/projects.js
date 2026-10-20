// 현장(프로젝트) 관리와 현장별 설정
import { AppError, s, all, first, run, stmt, newId, randomToken, nowStr, getSettings, writeLog } from './util.js';
import { accessibleProjects } from './auth.js';
import { DEFAULT_JOBS } from './orgs.js';

const STATUSES = ['준비', '진행', '종료'];
const MONEY_LABELS = ['분양가', '임대보증금'];
export const KINDS = ['아파트', '오피스텔', '상가', '기타'];
const isDate = (v) => v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v);

// 새 현장에 넣어 주는 기본 설정
export const DEFAULT_PROJECT_SETTINGS = { 'GPS허용거리m': '200', '예약중복기준': '뒤5자리' };

const view = (p, counts) => ({
  id: p.id, code: p.code, name: p.name, kind: p.kind, address: p.address, client: p.client, status: p.status,
  startDate: p.start_date, endDate: p.end_date, moneyLabel: p.money_label, createdAt: p.created_at,
  activeStaff: (counts[p.id] || {})['활동'] || 0, pendingStaff: (counts[p.id] || {})['대기'] || 0
});

// 접근 가능한 현장 목록 (관리자는 전체, 그 외는 지정된 현장만)
export async function projectList(env, data, ctx) {
  const projects = await accessibleProjects(env, ctx.account);
  const counts = {};
  (await all(env, `SELECT project_id, status, COUNT(*) AS n FROM staff WHERE status IN ('활동', '대기') GROUP BY project_id, status`)).forEach((r) => {
    (counts[r.project_id] = counts[r.project_id] || {})[r.status] = r.n;
  });
  const allowed = new Set(projects.map((p) => p.id));
  Object.keys(counts).forEach((k) => { if (!allowed.has(k)) delete counts[k]; }); // 접근 권한 없는 현장의 인원 수는 보내지 않는다
  return { projects: projects.map((p) => view(p, counts)) };
}

// 현장 만들기·수정 (관리자 전용). 새 현장에는 기본 직군과 기본 설정을 함께 만들어 준다
export async function projectSave(env, data, ctx) {
  const name = s(data.name).trim();
  if (!name || name.length > 40) throw new AppError('현장 이름을 입력해 주세요. (40자 이내)');
  const kind = s(data.kind).trim();
  if (kind && !KINDS.includes(kind)) throw new AppError('유형은 ' + KINDS.join(' / ') + ' 중에서 선택해 주세요.');
  const address = s(data.address).trim();
  const client = s(data.client).trim();
  if (address.length > 100 || client.length > 60) throw new AppError('주소·시행사 입력이 너무 깁니다.');
  const status = s(data.status) || '준비';
  if (!STATUSES.includes(status)) throw new AppError('상태 값이 올바르지 않습니다.');
  const startDate = s(data.startDate).trim(), endDate = s(data.endDate).trim();
  if (!isDate(startDate) || !isDate(endDate)) throw new AppError('날짜 형식이 올바르지 않습니다.');
  if (startDate && endDate && startDate > endDate) throw new AppError('시작일이 종료일보다 늦습니다.');
  const moneyLabel = s(data.moneyLabel) || '분양가';
  if (!MONEY_LABELS.includes(moneyLabel)) throw new AppError('금액 명칭이 올바르지 않습니다.');

  let code = s(data.code).trim().toLowerCase();
  let id = s(data.id);
  const current = id ? await first(env, 'SELECT * FROM projects WHERE id = ?', id) : null;
  if (id && !current) throw new AppError('현장을 찾을 수 없습니다.');
  if (!code) code = current ? current.code : randomToken(6).toLowerCase();
  if (!/^[a-z0-9]{3,20}$/.test(code)) throw new AppError('현장 코드는 영문 소문자·숫자 3~20자로 입력해 주세요. (가입 링크에 쓰입니다)');
  if (await first(env, 'SELECT 1 FROM projects WHERE code = ? AND id <> ?', code, id)) throw new AppError('이미 사용 중인 현장 코드입니다.');

  if (current) {
    await run(env, 'UPDATE projects SET code = ?, name = ?, kind = ?, address = ?, client = ?, status = ?, start_date = ?, end_date = ?, money_label = ? WHERE id = ?',
      code, name, kind, address, client, status, startDate, endDate, moneyLabel, id);
    await writeLog(env, ctx.account.login_id, '현장수정', id, name + (code !== current.code ? ' / 코드 ' + current.code + ' → ' + code : ''), id);
  } else {
    id = newId('P');
    const writes = [stmt(env,
      'INSERT INTO projects (id, code, name, kind, address, client, status, start_date, end_date, money_label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, code, name, kind, address, client, status, startDate, endDate, moneyLabel, nowStr())];
    Object.keys(DEFAULT_PROJECT_SETTINGS).forEach((k) =>
      writes.push(stmt(env, 'INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?)', id, k, DEFAULT_PROJECT_SETTINGS[k])));
    DEFAULT_JOBS.forEach((j, i) =>
      writes.push(stmt(env, `INSERT INTO orgs (id, project_id, kind, name, parent_id, sort_order, active) VALUES (?, ?, '직군', ?, '', ?, 1)`, newId('O'), id, j, i + 1)));
    await env.DB.batch(writes);
    await writeLog(env, ctx.account.login_id, '현장생성', id, name + ' / 코드 ' + code, id);
  }
  return { id, code };
}

// ---------- 현장별 설정 ----------

const PROJECT_SETTING_RULES = {
  'GPS허용거리m': (v) => {
    const n = Number(v);
    if (!isFinite(n) || n < 10 || n > 5000 || Math.floor(n) !== n) throw new AppError('GPS 허용거리는 10~5000 사이 정수(m)로 입력해 주세요.');
    return String(n);
  },
  '예약중복기준': (v) => {
    if (v !== '뒤5자리' && v !== '뒤5자리+성별') throw new AppError('예약 중복 기준 값이 올바르지 않습니다.');
    return v;
  }
};

// 전체 공통 설정 (현장과 무관, 텔레그램 봇은 하나)
const GLOBAL_SETTING_RULES = {
  '텔레그램봇이름': (v) => {
    v = v.replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{0,64}$/.test(v)) throw new AppError('텔레그램 봇 이름은 영문·숫자·밑줄만 쓸 수 있습니다.');
    return v;
  }
};

export async function adminSettings(env, data, ctx) {
  return { settings: await getSettings(env, ctx.projectId) };
}

export async function adminSaveSettings(env, data, ctx) {
  const values = data.values || {};
  const projectVals = {}, globalVals = {};
  Object.keys(values).forEach((k) => {
    const v = s(values[k]).trim();
    if (PROJECT_SETTING_RULES[k]) projectVals[k] = PROJECT_SETTING_RULES[k](v);
    else if (GLOBAL_SETTING_RULES[k]) globalVals[k] = GLOBAL_SETTING_RULES[k](v);
    else throw new AppError('알 수 없는 설정 항목입니다: ' + k);
  });
  const writes = [];
  Object.keys(projectVals).forEach((k) => writes.push(stmt(env,
    'INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value', ctx.projectId, k, projectVals[k])));
  Object.keys(globalVals).forEach((k) => writes.push(stmt(env,
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, globalVals[k])));
  if (writes.length) await env.DB.batch(writes);
  await writeLog(env, ctx.account.login_id, '설정변경', '', Object.keys({ ...projectVals, ...globalVals }).join(', '), ctx.projectId);
  return {};
}
