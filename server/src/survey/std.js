// 설문 공통 문항 은행 (구성안 7장). key 와 보기 코드는 고정이라 현장이 달라도 같은 기준으로 합산·비교할 수 있다.
// 화면 문구(title)는 현장마다 다듬어도 되지만 코드는 바꾸지 않는다. 보기 목록 자체를 바꾸려면 version 을 올린다.
// editableOptions: 현장 규모에 맞게 보기 구간을 조정할 수 있는 문항 (코드는 1부터 순서대로 다시 매긴다)
// pii: 개인정보 동의한 응답에서만 받아 따로(암호화) 저장하는 문항 — 답변 표(response_answers)에는 넣지 않는다.
export const STD_VERSION = 1;

const opt = (...labels) => labels.map((label, i) => ({ code: String(i + 1), label }));
const coded = (pairs) => pairs.map(([code, label]) => ({ code, label }));
const YN = coded([['Y', '예'], ['N', '아니요']]);

export const STD = {
  STD_INTENT: { type: 'radio', title: '분양(계약) 의향', required: true, forceRequired: true, options: coded([['5', '적극 있음'], ['4', '있음'], ['3', '고민 중'], ['2', '낮음'], ['1', '없음']]) },
  STD_CONSENT_MKT: { type: 'radio', title: '분양 정보 안내(문자 등) 수신에 동의하십니까?', options: YN },
  STD_NAME: { type: 'text', title: '성함', pii: true },
  STD_PHONE: { type: 'phone', title: '연락처', pii: true },
  STD_GENDER: { type: 'radio', title: '성별', options: coded([['M', '남'], ['F', '여']]) },
  STD_AGE: { type: 'radio', title: '연령대', options: coded([['20', '20대'], ['30', '30대'], ['40', '40대'], ['50', '50대'], ['60', '60대 이상']]) },
  // 시·도 단위 코드(행정구역 코드 앞 2자리). 시·군·구 세분화는 행정구역 코드표가 필요해 후속으로 둔다
  STD_REGION: {
    type: 'select', title: '거주지(시·도)', options: coded([['11', '서울'], ['26', '부산'], ['27', '대구'], ['28', '인천'], ['29', '광주'], ['30', '대전'], ['31', '울산'], ['36', '세종'],
      ['41', '경기'], ['51', '강원'], ['43', '충북'], ['44', '충남'], ['45', '전북'], ['46', '전남'], ['47', '경북'], ['48', '경남'], ['50', '제주']])
  },
  STD_HOUSING: { type: 'radio', title: '현재 주거 형태', options: coded([['1', '자가'], ['2', '전세'], ['3', '월세'], ['4', '기타']]) },
  STD_HOUSES: { type: 'radio', title: '주택 보유', options: coded([['0', '무주택'], ['1', '1주택'], ['2', '2주택 이상']]) },
  STD_PURPOSE: { type: 'radio', title: '구입 목적', options: coded([['1', '실거주'], ['2', '투자'], ['3', '실거주+투자']]) },
  STD_TYPE: { type: 'radio', title: '관심 타입', editableOptions: true, options: opt('(현장의 타입을 입력해 주세요)') },
  STD_BUDGET: { type: 'radio', title: '예상 자금', editableOptions: true, options: opt('3억 미만', '3~5억', '5~7억', '7~10억', '10억 이상') },
  STD_TIMING: { type: 'radio', title: '구입 시기', options: coded([['1', '즉시'], ['2', '6개월 내'], ['3', '1년 내'], ['4', '미정']]) },
  STD_SOURCE: { type: 'radio', title: '분양 소식을 어떻게 알게 되셨나요?', options: coded([['1', '현수막'], ['2', '지인'], ['3', '영업사원'], ['4', '온라인'], ['5', '문자'], ['6', '기타']]) },
  STD_SUBSCR: { type: 'radio', title: '청약통장 보유', options: coded([['1', '있음'], ['2', '없음']]) }
};

export const STD_KEYS = Object.keys(STD);
export const PII_KEYS = STD_KEYS.filter((k) => STD[k].pii);
export const CHOICE_TYPES = ['radio', 'checkbox', 'select'];
// 전화번호 문항은 공통 문항 STD_PHONE 으로만 받는다 (동의한 응답만, 암호화 저장)
export const CUSTOM_TYPES = ['text', 'textarea', 'number', 'radio', 'checkbox', 'select'];

// 새 설문에 기본으로 넣어 주는 문항 (필수 + 권장 일부)
export const DEFAULT_STD = ['STD_INTENT', 'STD_NAME', 'STD_PHONE', 'STD_AGE', 'STD_SOURCE', 'STD_CONSENT_MKT'];

// 개인정보 동의 문구 초안. 운영 전에 회사(법무)에서 확정해 설문마다 고쳐 쓴다 (임시 문구)
export const DEFAULT_CONSENT_TEXT = `[임시 문구 — 운영 전 회사 확정본으로 교체]
1. 수집 항목: 성명, 연락처
2. 수집·이용 목적: 분양 상담 및 분양 정보 안내
3. 보유·이용 기간: 해당 현장 종료 후 6개월까지 (이후 지체 없이 파기)
4. 동의하지 않으셔도 설문에 참여하실 수 있으며, 이 경우 성명·연락처는 저장하지 않고 응답 내용만 익명으로 집계됩니다.`;

export const bankList = () => STD_KEYS.map((key) => ({ key, ...STD[key] }));
