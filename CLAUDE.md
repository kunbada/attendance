# CLAUDE.md — 위뉴 통합 프로젝트 관리 앱

## 무엇을 만드는가
위뉴(WeNew, 분양대행사)의 현장(프로젝트)별 **인력·근태·방문·설문·계약·지급(일당·수수료)·레포트**를 하나의 서버·DB·로그인으로 관리하는 사내 도구.
기존에 따로 만든 3개 앱(근태관리, 분양계약관리, 설문관리)을 통합한다.
hub 메뉴 순서는 **홈 – 프로젝트 – 인사관리(현장인력관리(직원)·현장근태관리·조직(직군·본부·팀)관리·전체검색·가입링크) – 고객관리(설문·방문·TM·상담·데이터통합) – 계약관리 – 출납관리 – 용역관리(일급·수수료) – 결재관리 – 설정** 이다. TM고객·상담고객·출납관리·결재관리(공통 검토요청·승인)는 향후 개발.
**설계 기준은 `docs/통합구성안.md`** — 먼저 읽고, 거기 없는 기능은 만들지 않는다(필요해 보이면 제안 후 확인). 설계를 바꾸면 그 문서부터 고친다.

## 사용자에 대해
- 사용자는 개발자가 아니다 (분양대행사 상무). 보고와 질문은 **한국어**, 기술 용어는 짧게 풀어서.
- 사용자가 직접 해야 하는 일(Cloudflare·GitHub·구글 화면 조작, 비밀값 입력)은 **클릭 순서대로 번호를 매겨** 안내하고 `docs/배포가이드.md` 에도 남긴다.
- 배포 명령(`npx wrangler@4 deploy`, D1 migration, git push)은 Claude가 직접 실행하고 "반영했다"고 알려준다. 단, **운영 DB에 migration 을 적용하기 전에는 반드시 백업(`wrangler d1 export`)을 먼저** 하고 사용자에게 확인받는다.

## 폴더 (0단계 완료 구조 — 구성안 3장)
```
server/          통합 서버 = Cloudflare Worker + D1 (기존 근태 서버. 이름 attendance-api / DB attendance 유지)
                 wrangler.toml, schema.sql, migrations/, scripts/, test/run.mjs(통합 시험), test/check-scope.mjs(project_id 누락 점검)
                 src/ = index.js(ACTIONS 표) + core/(인증·프로젝트·인력·조직·계정) attendance/ visit/ guestbook/ telegram/ report/
web/             GitHub Pages 로 배포 (.github/workflows/pages.yml 이 web/ 만 올림). 공개 — 비밀 정보 금지
                 staff.html, desk.html, guest.html, admin.html(hub 로 자동 이동하는 안내만 남음, 6단계에서 삭제), js/, css/
                 hub/ (통합관리. 메뉴 구성은 hub/js/menus.js 한 곳. 현재 홈-프로젝트-인사관리-고객관리-용역관리-설정, 최종 홈-프로젝트-인사관리-고객관리-계약관리-출납관리-용역관리-설정, 구성안 6장), s/ (3단계 설문 응답), contract/ (4단계 계약앱 온라인판)
apps/contract/   분양계약관리 소스 (src/ → node build.js → 분양계약관리.html). 자체 CLAUDE.md 적용
                 gas/ 는 구 동기화 서버 — 4단계에서 통합 서버로 교체 후 legacy/ 로 이동
apps/survey-gas/ 설문관리 Apps Script (구). 3단계에서 D1 로 이전 후 legacy/ 로 이동. 자체 CLAUDE.md 적용
docs/            통합구성안.md(설계 기준), 근태_spec.md(근태·방문·방명록 기능 명세), 배포가이드.md, 사용설명서.md
                 근태_CLAUDE_원본.md(참고용 보관), 데이터사전.md·권한표.md(1단계 작성 — 표·열·권한을 바꾸면 함께 고친다)
private/         git 제외. 계약 초기데이터·백업, D1 내보내기, 0단계 이동 전 백업
```
- 근태·방문·방명록·텔레그램 기능의 세부 동작은 `docs/근태_spec.md` 가 기준이다 (프로젝트 범위 등 통합 관련 변경은 통합구성안이 우선).
- 하위 폴더 CLAUDE.md 규칙은 그 앱 코드를 만질 때 계속 적용된다. 이 파일과 충돌하면 이 파일이 우선.
- 서버 명령은 `server/` 에서 실행: `cd server && npx wrangler@4 deploy`. 로컬 테스트는 `test/run.mjs` 맨 위 주석 순서대로(DB 비우기 `scripts/reset-local.sql` → `schema.sql` → 시드 → 서버 → 시험). 코드를 고친 뒤에는 `node test/check-scope.mjs` 도 돌린다.

## 절대 규칙
1. **단순하게.** 프레임워크(React/Vue 등)·TypeScript·번들러 없음. 화면은 순수 HTML/CSS/JS, 서버는 순수 JS(ES 모듈). 서버는 npm 패키지 없이 `npx wrangler@4` 로 실행만.
2. 화면 라이브러리: hub·근태 화면은 CDN 버전 고정(Chart.js, qrcode, html5-qrcode, 엑셀이 필요하면 SheetJS). **계약앱만 예외로 모든 라이브러리 인라인**(현장 인터넷 끊김 대비).
3. **프로젝트 범위**: 모든 업무 표에 `project_id`. 서버의 모든 action 은 공통 함수로 세션 → 역할 → **이 사용자가 이 프로젝트에 접근 가능한지** → (직원이면) deviceKey 순으로 확인한다. 쿼리에 `project_id` 조건이 빠지면 버그로 본다. 새 action 을 만들면 "다른 프로젝트 접근 거부" 테스트를 같이 추가한다.
4. 권한 확인은 **서버에서만**. 화면에서 버튼을 숨기는 것은 편의일 뿐.
5. **비밀 정보 금지 구역**: `web/` 과 git 저장소(공개). 토큰·salt·암호화 키·비밀번호는 Cloudflare secret(운영) 또는 `.dev.vars`(로컬, git 제외).
6. **개인정보**: 주민번호·계좌는 `payroll` 에만 암호화 저장, 관리자 action 외 응답에 포함 금지, 화면은 마스킹, 원문 보기·이체파일·개인정보 내보내기는 `logs` 기록. 설문 개인정보는 동의한 응답만, 전화번호는 암호화 + 해시(연결용). `초기데이터_*.json`·백업 json·내보낸 파일은 `private/`(git 제외)에만.
7. 비밀번호·PIN 은 salt + SHA-256 해시로만 저장.
8. 동시 요청 충돌은 DB 가 막는다 (유일 색인, 조건부 INSERT/UPDATE). 여러 건이 함께 바뀌어야 하면 `DB.batch`.
9. **DB 변경은 기존 데이터를 지우지 않는 방식**으로: `schema.sql`(새로 만들 때) + `migrations/NNN_설명.sql`(운영 중인 DB) 둘 다 갱신. 열 삭제·이름 변경 대신 새 열 추가 후 이전.
10. **지급 데이터**: 확정된 정산 회차는 수정 불가(정정은 다음 회차 조정 줄). 금액 계산은 정수(원 단위), 반올림 규칙은 한 함수에만 둔다.
11. 테스트·예시 데이터의 주민번호·전화번호는 가짜 값만(`000101-3000000`, `010-0000-0001` 류).

## 코드 스타일
- 함수·변수명 영어 camelCase, DB 표·열 영어 snake_case, 상태·구분 값과 화면 문구는 한국어.
- 날짜는 Asia/Seoul 기준 `YYYY-MM-DD`, 일시는 `YYYY-MM-DD HH:MM:SS` 문자열.
- API 형식은 근태 서버 방식 유지: `POST`, `Content-Type: text/plain;charset=utf-8`, 요청 `{action, token, deviceKey, projectId, data}`, 응답 `{ok:true,data}` / `{ok:false,error:"한국어 메시지"}`.
- 서버는 `src/<모듈>/` 로 나누고 action 이름은 `모듈.동작` (`pay.runCreate`, `survey.submit` …). 라우팅은 기존 `ACTIONS` 표 방식.
- 화면 js/css 를 고치면 해당 `*.html` 의 `?v=` 값을 올린다 (캐시 갱신).
- 주석은 "왜 이렇게 했는지"만 짧게 한국어로.

## 작업 방식
- `docs/통합구성안.md` 9장의 단계 순서대로. **단계가 끝날 때마다 멈추고** ① 된 것 ② 사용자가 할 배포·테스트 단계 ③ 확인 체크리스트를 보고한 뒤 승인받는다.
- 단계를 시작하기 전에 구성안 10장의 해당 "결정 필요 사항"을 사용자에게 확인한다. 답이 없으면 표의 기본값으로 진행하고 그 사실을 보고에 적는다.
- 서버는 로컬(`wrangler dev --local`)에서 통합 테스트(`test/run.mjs`)로 확인 후 배포. 계약앱은 `node build.js` 후 스모크·동시편집 테스트.
- 데이터 이전(근태 기존 데이터 → 첫 프로젝트, 구글시트 설문 → D1, 계약 초기데이터 → D1)은 **이전 스크립트 + 건수 대조 결과**를 함께 보고한다.
- 막히거나 구성안과 다르게 해야 할 이유가 생기면 임의로 바꾸지 말고 이유와 선택지를 제시한다.

## Git
- 루트가 저장소 (원격 kunbada/attendance, **공개**). 0단계에서 기존 근태 저장소를 루트로 올려 이력을 보존했다. GitHub Pages 주소 `kunbada.github.io/attendance/` 유지.
- `.gitignore` 에 개인정보·비밀 값 패턴이 들어 있다 (`private/`, 백업·초기데이터 json, `server/.dev.vars`, `apps/contract/gas/Code.gs`(실제 TOKEN 포함) 등). 커밋 전 `git status` 로 개인정보·비밀 파일이 없는지 확인.
- 커밋 메시지는 한국어로 짧게.
