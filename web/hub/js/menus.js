// 메뉴 구성 (구성안 6장). 순서 = 홈 – 프로젝트 – 인사관리 – 고객관리 – 용역관리 – 설정
// 계약관리·출납관리는 해당 단계에서 만들 때 여기에 추가한다. 아직 없는 메뉴는 화면에 보이지 않는다.
// 별도 앱(?app=survey / ?app=visit)은 통합관리 메뉴 대신 해당 화면 하나만 보여 준다 (권한은 계정별 허용, 서버가 확인).
if (Hub.app === 'survey') {
  Hub.group({ key: 'surveyapp', label: '설문 관리', items: [{ label: '설문 관리', section: 'surveyapp' }] });
} else if (Hub.app === 'visit') {
  Hub.group({ key: 'visitlog', label: '예약·호출 조회', items: [{ label: '예약·호출 조회', section: 'visitlog' }] });
} else {
  Hub.group({ key: 'home', label: '홈', items: [{ label: '홈', section: 'home' }] });
  Hub.group({ key: 'projects', label: '프로젝트', needsProject: false, items: [{ label: '프로젝트', section: 'projects' }] });
  Hub.group({ key: 'hr', label: '인사관리', items: [{ label: '현장인력관리', section: 'people' }, { label: '현장근태관리', section: 'attendance' }] });
  Hub.group({ key: 'customers', label: '고객관리', items: [{ label: '설문고객', section: 'surveys' }, { label: '방문고객', section: 'visits' }, { label: '데이터통합관리', section: 'customers' }] });
  Hub.group({ key: 'service', label: '용역관리', items: [{ label: '일급 정산', section: 'payruns' }, { label: '지급 설정', section: 'paysettings' }] });
  Hub.group({ key: 'settings', label: '설정', adminOnly: true, needsProject: false, items: [{ label: '설정', section: 'settings' }] });
}
