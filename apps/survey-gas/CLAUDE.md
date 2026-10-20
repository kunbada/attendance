# 사전판촉 설문조사 앱 (위뉴 사내용)

> **통합 이후 위치 (2026-10-20)**: `통합프로젝트관리앱/apps/survey-gas/` (구 버전). 통합구성안 3단계에서 통합 서버(D1)로 이전한 뒤 `legacy/` 로 옮긴다. 이 폴더는 공개 저장소에 포함되므로 비밀번호·토큰을 코드에 넣지 않는다. 루트 `CLAUDE.md` 규칙이 우선.


Google Apps Script 웹앱 + Google Sheets(DB). 빌드 도구 없음. clasp로 이 폴더를 그대로 push한다 (`clasp push -f`, 설정은 `.clasp.json`/`appsscript.json`, `.md`는 `.claspignore`로 제외). 스크립트는 시트에 묶인(container-bound) 프로젝트. 계정 kunbada@gmail.com. Windows 터미널 탭에선 clasp PATH가 안 잡혀 Bash/PowerShell 도구로 실행.

## 파일
- `Code.gs` — 서버. 라우팅(doGet), 시트 CRUD, 관리자 API(비밀번호 인증), 응답 저장, 통계
- `Admin.html` — 관리자 SPA(바닐라 JS). 탭: 대시보드 / 설문(빌더) / 팀·조·배포링크(QR) / 프로젝트. Chart.js·qrcodejs CDN
- `Survey.html` — 응답자 모바일 화면. `<body data-s data-t>`로 설문ID·팀코드 전달. 시작화면 → 문항 1개씩(이전/다음) → 동의 → 제출 위저드, 설문별 컬러(`theme`)로 톤 변경
- `설치가이드.md` — 사용자용 설치·운영 가이드

## 구조
- URL: `/exec` → 관리자, `/exec?s=설문ID&t=팀조코드` → 응답 화면 (t 없거나 무효면 '미지정' 집계)
- 시트: Projects / Surveys(questions는 JSON 문자열, theme=응답화면 컬러 hex) / Teams(code=6자리, 영문자로 시작) / Responses(answers JSON, 통계 기준)
- 설문별 `RAW_<제목>_<id4>` 시트: 문항이 열로 펼쳐진 로우데이터. 헤더 셀 **메모(note)에 문항 id** 저장 → 제목 바꿔도 열 유지
- 관리자 API는 모두 첫 인자로 비밀번호(`PW`) 받음 → `auth_()` 검증. 비밀번호는 Script Properties `ADMIN_PASSWORD`
- 문항 타입: text, textarea, phone, number, radio, checkbox, select (CHOICE_TYPES = radio/checkbox/select)

## 주의 (Apps Script 제약)
- google.script.run은 Date 객체를 반환 못함 → `readTable_()`가 Date를 'yyyy-MM-dd HH:mm:ss' 문자열로, 숫자는 문자열로 변환
- 응답 저장은 `LockService` 스크립트 락 안에서 수행
- RAW 시트 기록 시 0으로 시작하는 값·수식 시작 문자는 앞에 `'` 붙임
- 코드 수정 후엔 "배포 관리 → 새 버전"으로 재배포해야 /exec 에 반영
- 아직 실제 Apps Script 환경에서 실행 테스트 전 (JS 구문 검사만 통과)

## 배포
- 웹앱 배포ID `AKfycbyQKdYmNwDGqQYyCHN1bK8rr1d7D-zyTbDAK9DtcxFyr4P5zU0yhH_2unXDHX5ot5y-Sw` — 갱신: `clasp push -f` → `clasp create-version "설명"` → `clasp deploy -i <배포ID> -V <버전>` (URL 유지)
- 컬럼을 추가하면 `HEADERS`에 추가; `ensureHeaders_()`가 기존 시트 헤더를 자동 보강(adminInit/setup)
- 관리자 화면 컬러는 브라우저 localStorage(`svtheme`)에 저장
- 응답자용 링크 기준주소: Script Property `SURVEY_BASE_URL`(`setSurveyBaseUrl()` 실행)이 있으면 배포링크·QR이 그 주소를 씀. 미설정이면 `/exec`. `site/index.html`은 Apps Script 안내 배너를 가리려고 `/exec`를 iframe으로 감싸는 정적 래퍼(외부 호스팅용, `.claspignore`로 push 제외)
- 래퍼 호스팅: GitHub Pages `https://kunbada.github.io/wenew-survey/` (저장소 github.com/kunbada/wenew-survey, main 루트의 index.html). `site/index.html`을 고치면 저장소에도 반영해야 함(`gh`/git push). `/exec` 배포ID가 바뀌면 래퍼의 EXEC 상수도 수정
