// 고객 등급(A~D, 4등급제) 자동 분류. 기준은 현장마다 고객관리 > 등급관리에서 정하고 project_settings('고객등급기준', JSON)에 둔다.
//  - 설문: 분양 의향(5~1)마다 등급을 정한다. 청약통장이 있으면 한 단계 위(선택)
//  - 방문(방명록): 정한 등급 하나 (없음 가능)
//  - 부동산(중개업소 조사): 점수 = 분양 의향 × 비중 + 소개 의향 × 비중 (1~5점) → A/B/C 기준 점수 이상이면 그 등급, 나머지 D.
//    MGM 참여면 한 단계 위(선택)
//  - 여러 경로가 있으면 가장 높은 등급. 직접 정한 등급(customer_grades)이 있으면 자동 분류보다 우선
import { AppError, s, first, run, writeLog } from '../core/util.js';

export const GRADES = ['A', 'B', 'C', 'D'];
export const RULES_KEY = '고객등급기준';

export const DEFAULT_RULES = {
  survey: { map: { 5: 'A', 4: 'B', 3: 'C', 2: 'D', 1: 'D' }, subscrUp: true },
  visit: { grade: 'C' },
  realtor: { wIntent: 50, cutA: 4.5, cutB: 3.5, cutC: 2.5, mgmUp: false }
};

const up = (g) => (g && GRADES.indexOf(g) > 0 ? GRADES[GRADES.indexOf(g) - 1] : g);
const better = (a, b) => (!a ? b : !b ? a : GRADES.indexOf(a) <= GRADES.indexOf(b) ? a : b);

export function surveyGrade(intent, subscr, rules = DEFAULT_RULES) {
  const n = Number(intent);
  if (!n) return '';
  const g = rules.survey.map[n] || '';
  return rules.survey.subscrUp && String(subscr) === '1' ? up(g) : g;
}

// 부동산 점수 (1~5, 소수 둘째 자리). 분양 의향 비중 wIntent%, 소개 의향 비중 (100 - wIntent)%
export function realtorScore(intent, refer, rules = DEFAULT_RULES) {
  const w = rules.realtor.wIntent / 100;
  return Math.round((Number(intent) * w + Number(refer) * (1 - w)) * 100) / 100;
}

export function realtorGrade(intent, refer, mgm, rules = DEFAULT_RULES) {
  if (!Number(intent) || !Number(refer)) return '';
  const r = rules.realtor, sc = realtorScore(intent, refer, rules);
  const g = sc >= r.cutA ? 'A' : sc >= r.cutB ? 'B' : sc >= r.cutC ? 'C' : 'D';
  return r.mgmUp && mgm === '참여' ? up(g) : g;
}

// 반환: { grade, source } — source: 수동 / 설문 / 방문 / 부동산 을 + 로 이은 것 / ''
export function classify(c, manual, rules = DEFAULT_RULES) {
  if (manual) return { grade: manual, source: '수동' };
  const parts = [
    ['설문', c.surveys ? surveyGrade(c.intent, c.subscr, rules) : ''],
    ['방문', c.visits ? rules.visit.grade : ''],
    ['부동산', c.realtor ? realtorGrade(c.realtor.intent, c.realtor.refer, c.realtor.mgm, rules) : '']
  ].filter((p) => p[1]);
  return { grade: parts.reduce((a, p) => better(a, p[1]), ''), source: parts.map((p) => p[0]).join('+') };
}

// 저장 값 검사. strict 면 잘못된 값에 오류, 아니면 기본값으로 메운다 (예전에 저장된 값 읽을 때)
export function normalizeRules(raw, strict) {
  const bad = (msg) => { if (strict) throw new AppError(msg); };
  const d = DEFAULT_RULES, o = raw && typeof raw === 'object' ? raw : {};
  const sv = o.survey || {}, vi = o.visit || {}, rt = o.realtor || {};
  const gradeOr = (v, def, label, allowEmpty) => {
    v = s(v);
    if (GRADES.includes(v) || (allowEmpty && v === '')) return v;
    bad(label + ' 등급은 A, B, C, D' + (allowEmpty ? ' 또는 "등급 없음"' : '') + ' 중에서 골라 주세요.');
    return def;
  };
  const map = {};
  [5, 4, 3, 2, 1].forEach((n) => { map[n] = gradeOr((sv.map || {})[n], d.survey.map[n], '설문 분양 의향 ' + n + '점의', true); });
  const num = (v, def, lo, hi, label) => {
    const n = Number(v);
    if (v !== '' && v !== null && v !== undefined && Number.isFinite(n) && n >= lo && n <= hi) return n;
    bad(label + '은(는) ' + lo + '~' + hi + ' 사이 숫자로 입력해 주세요.');
    return def;
  };
  const realtor = {
    wIntent: Math.round(num(rt.wIntent, d.realtor.wIntent, 0, 100, '분양 의향 비중')),
    cutA: num(rt.cutA, d.realtor.cutA, 1, 5, 'A 기준 점수'), cutB: num(rt.cutB, d.realtor.cutB, 1, 5, 'B 기준 점수'), cutC: num(rt.cutC, d.realtor.cutC, 1, 5, 'C 기준 점수'),
    mgmUp: rt.mgmUp === undefined ? d.realtor.mgmUp : rt.mgmUp === true
  };
  if (!(realtor.cutA >= realtor.cutB && realtor.cutB >= realtor.cutC)) {
    bad('기준 점수는 A ≥ B ≥ C 순서여야 합니다.');
    Object.assign(realtor, { cutA: d.realtor.cutA, cutB: d.realtor.cutB, cutC: d.realtor.cutC });
  }
  return {
    survey: { map, subscrUp: sv.subscrUp === undefined ? d.survey.subscrUp : sv.subscrUp === true },
    visit: { grade: gradeOr(vi.grade, d.visit.grade, '방문 고객', true) },
    realtor
  };
}

export async function loadGradeRules(env, pid) {
  const r = await first(env, 'SELECT value FROM project_settings WHERE project_id = ? AND key = ?', pid, RULES_KEY);
  if (!r || !r.value) return normalizeRules(DEFAULT_RULES);
  try { return normalizeRules(JSON.parse(r.value)); } catch (e) { return normalizeRules(DEFAULT_RULES); }
}

// 사람이 읽는 기준 요약 (로그용)
export function describeRules(r) {
  const sv = [5, 4, 3, 2, 1].map((n) => n + '점 ' + (r.survey.map[n] || '없음')).join(', ') + (r.survey.subscrUp ? ', 청약통장 +1' : '');
  const rt = '분양 ' + r.realtor.wIntent + '% + 소개 ' + (100 - r.realtor.wIntent) + '%, A≥' + r.realtor.cutA + ' B≥' + r.realtor.cutB + ' C≥' + r.realtor.cutC + (r.realtor.mgmUp ? ', MGM 참여 +1' : '');
  return '설문(' + sv + ') / 방문 ' + (r.visit.grade || '없음') + ' / 부동산(' + rt + ')';
}

export async function saveGradeRules(env, pid, raw, ctx) {
  const rules = normalizeRules(raw, true);
  await run(env, 'INSERT INTO project_settings (project_id, key, value) VALUES (?, ?, ?) ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value', pid, RULES_KEY, JSON.stringify(rules));
  await writeLog(env, ctx.account.login_id, '고객등급기준', pid, describeRules(rules), pid);
  return rules;
}
