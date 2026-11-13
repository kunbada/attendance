// 프로젝트 주택형(세부 타입)·타입군·세대수 기준표 (project_types). 계약관리와는 별개.
//  - 설문(사전판촉): 타입군만 묻는다 → 응답 값 = 타입군 코드 (예: '84')
//  - 상담 앱: 세부 주택형(예: '84A') 또는 아직 정하지 못했으면 타입군('84')을 고른다
//  - 고객 DB·통계: 세부 주택형은 타입군으로 바꿔 묶는다 (세부 값은 그대로 보존)
import { AppError, s, all, stmt, writeLog } from './util.js';

const CODE_RE = /^[0-9A-Za-z가-힣][0-9A-Za-z가-힣.\-]{0,11}$/;
// 84A → 84, 59 → 59, 101.5B → 101.5. 숫자로 시작하지 않으면 코드 그대로
export const guessGroup = (code) => { const m = s(code).match(/^\d+(\.\d+)?/); return m ? m[0] : s(code); };
// 관심 타입을 아직 정하지 못한 고객 (설문 보기·상담 앱 공통 값)
export const UNDECIDED = '미정';
export const groupLabel = (g) => (/^\d/.test(s(g)) ? g + '타입' : s(g));

export async function loadTypes(env, pid) {
  return (await all(env, 'SELECT code, grp, area, units, sort FROM project_types WHERE project_id = ? ORDER BY sort, code', pid))
    .map((r) => ({ code: r.code, grp: r.grp, area: r.area, units: r.units }));
}

// 타입군 목록 (설문 보기·통계용): 주택형 순서대로, 세대수 합계
export function typeGroups(types) {
  const out = [], by = {};
  types.forEach((t) => {
    if (!by[t.grp]) { by[t.grp] = { code: t.grp, label: groupLabel(t.grp), units: 0, types: [] }; out.push(by[t.grp]); }
    by[t.grp].units += t.units; by[t.grp].types.push(t.code);
  });
  return out;
}

// 관심 타입 값 하나 → 타입군 (세부 주택형이면 기준표로, 타입군 코드면 그대로, 모르는 값이면 숫자 앞부분)
export function toGroup(value, types) {
  const v = s(value).trim();
  const t = types.find((x) => x.code === v);
  if (t) return t.grp;
  if (types.some((x) => x.grp === v)) return v;
  return guessGroup(v.replace(/타입$|㎡$/, ''));
}
// 화면 표시: 세부 주택형은 그대로(84A), 타입군만 고른 경우는 "84타입"
export function typeLabel(value, types) {
  const v = s(value);
  const t = types.find((x) => x.code === v);
  if (t) return t.code === t.grp ? groupLabel(v) : v; // 59 처럼 세부 구분이 없는 주택형은 "59타입"
  if (types.some((x) => x.grp === v)) return groupLabel(v);
  return v;
}

// 상담 앱에서 고른 관심 타입 검사: 기준표가 있으면 세부 주택형 또는 타입군만 허용
export function cleanInterest(list, types) {
  const vals = [...new Set((Array.isArray(list) ? list : s(list).split(',')).map((x) => s(x).trim()).filter(Boolean))].slice(0, 12);
  if (!types.length) return vals.map((v) => v.slice(0, 20));
  const ok = new Set(types.map((t) => t.code).concat(types.map((t) => t.grp)).concat([UNDECIDED]));
  const bad = vals.filter((v) => !ok.has(v));
  if (bad.length) throw new AppError('프로젝트에 없는 주택형입니다: ' + bad.join(', ') + ' (통합관리 > 프로젝트 > 주택형에서 추가)');
  return vals;
}

// ---------- 관리: 프로젝트 > 주택형·세대수 ----------

export async function projectTypesGet(env, data, ctx) {
  const types = await loadTypes(env, ctx.projectId);
  const used = {};
  (await all(env, `SELECT interest FROM customers WHERE project_id = ? AND interest <> ''`, ctx.projectId))
    .forEach((r) => s(r.interest).split(',').forEach((v) => { used[v] = (used[v] || 0) + 1; }));
  return { types, groups: typeGroups(types), used, totalUnits: types.reduce((a, t) => a + t.units, 0) };
}

// 목록 전체를 바꾼다 (순서 = 화면 순서)
export async function projectTypesSave(env, data, ctx) {
  const pid = ctx.projectId;
  const raw = Array.isArray(data.types) ? data.types : [];
  if (raw.length > 60) throw new AppError('주택형은 60개까지 입력할 수 있습니다.');
  const seen = new Set();
  const rows = raw.map((t, i) => {
    const code = s(t.code).trim().toUpperCase().replace(/\s/g, '');
    const no = (i + 1) + '번째 줄';
    if (!CODE_RE.test(code)) throw new AppError(no + ': 주택형을 영문·숫자로 입력해 주세요. (예: 84A, 59)');
    if (seen.has(code)) throw new AppError(no + ': 주택형 ' + code + ' 이(가) 두 번 들어 있습니다.');
    seen.add(code);
    const grp = (s(t.grp).trim().replace(/타입$/, '') || guessGroup(code)).slice(0, 12);
    const area = Number(t.area) || 0, units = Number(t.units) || 0;
    if (area < 0 || area > 1000) throw new AppError(no + ': 전용면적을 확인해 주세요.');
    if (!Number.isInteger(units) || units < 0 || units > 100000) throw new AppError(no + ': 세대수는 0 이상 정수로 입력해 주세요.');
    return { code, grp, area: Math.round(area * 100) / 100, units, sort: i + 1 };
  });
  await env.DB.batch([stmt(env, 'DELETE FROM project_types WHERE project_id = ?', pid)].concat(rows.map((r) =>
    stmt(env, 'INSERT INTO project_types (project_id, code, grp, area, units, sort) VALUES (?, ?, ?, ?, ?, ?)', pid, r.code, r.grp, r.area, r.units, r.sort))));
  await writeLog(env, ctx.account.login_id, '주택형저장', pid, rows.map((r) => r.code + '(' + r.units + ')').join(' '), pid);
  return projectTypesGet(env, data, ctx);
}
