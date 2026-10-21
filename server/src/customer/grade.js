// 고객 등급(A~D, 4등급제). 기준은 이 파일 한 곳에서만 바꾼다.
//  - 설문: 분양 의향 5=A, 4=B, 3=C, 1~2=D. 청약통장이 있으면 한 단계 위(최대 A)
//  - 방문(방명록)한 고객은 C
//  - 설문과 방문이 모두 있으면 둘 중 높은 등급
//  - TM 등에서 직접 정한 등급(customer_grades)이 있으면 자동 분류보다 우선
export const GRADES = ['A', 'B', 'C', 'D'];

export function surveyGrade(intent, subscr) {
  const n = Number(intent);
  if (!n) return '';
  let i = n >= 5 ? 0 : n === 4 ? 1 : n === 3 ? 2 : 3;
  if (String(subscr) === '1' && i > 0) i -= 1;
  return GRADES[i];
}

export const VISIT_GRADE = 'C';

const better = (a, b) => (!a ? b : !b ? a : GRADES.indexOf(a) <= GRADES.indexOf(b) ? a : b);

// 반환: { grade, source } — source: 수동 / 설문 / 방문 / 설문+방문 / ''
export function classify(c, manual) {
  if (manual) return { grade: manual, source: '수동' };
  const sg = c.surveys ? surveyGrade(c.intent, c.subscr) : '';
  const vg = c.visits ? VISIT_GRADE : '';
  const grade = better(sg, vg);
  const source = sg && vg ? '설문+방문' : sg ? '설문' : vg ? '방문' : '';
  return { grade, source };
}
