# CLAUDE.md — 조직분양 근태·예약 관리 앱 (간소화판)

## 프로젝트
분양현장 영업직원(최대 300명)의 가입·근태(QR+GPS)·방문예약·데스크 호출을 관리하는 회사 내부 도구.
**HTML(GitHub Pages) + Cloudflare Worker + D1 데이터베이스** 로 만든다. 상세 명세는 `spec.md`. (처음에는 Apps Script + 구글시트였으나 속도 때문에 옮겼다. 이전 코드는 git 기록에 남아 있다.)

## 사용자에 대해
- 사용자는 개발자가 아니다 (분양대행사 임원). 진행 보고와 질문은 **한국어**, 기술 용어는 짧게 풀어서.
- 사용자가 직접 해야 하는 일(Cloudflare 가입·로그인, GitHub Pages 켜기, 텔레그램 봇 만들기와 토큰 입력)은 **클릭 순서대로 번호를 매겨** 안내하고 `docs/배포가이드.md` 에도 남긴다.
- 서버(`worker/`) 코드를 바꾸면 `npx wrangler@4 deploy` 로 배포해야 반영된다. 이 명령은 Claude가 직접 실행하고, 끝나면 "서버에 반영했다"고 알려준다. 화면(`web/`)은 GitHub에 올리면 자동 반영된다.

## 절대 규칙
1. **단순하게.** 프레임워크(React/Vue 등), TypeScript, 번들러를 쓰지 않는다. 화면은 순수 HTML/CSS/JS, 서버는 순수 JavaScript(ES 모듈). npm 패키지는 쓰지 않고(`package.json` 없음), 배포·DB 관리용 `wrangler` 는 `npx wrangler@4` 로 실행만 한다.
2. 외부 라이브러리는 spec.md 6장에 적힌 것만 CDN(버전 고정)으로.
3. `spec.md` 에 없는 기능은 만들지 않는다. 필요해 보이면 먼저 제안하고 확인받는다.
4. `web/` 폴더와 저장소는 공개된다. 봇 토큰, salt, 암호화 키, 비밀번호를 절대 넣지 않는다 → 모두 Cloudflare **secret**(운영) 또는 `worker/.dev.vars`(로컬, git 제외).
5. 권한 확인은 **서버(Worker)에서**. 모든 action 시작 시 세션 → 역할 → (직원이면) deviceKey 확인.
6. 주민번호·계좌는 `payroll` 테이블에만 암호화해서 저장. 관리자 action 외의 응답에 절대 포함하지 않는다. 화면은 마스킹, 원문 보기는 로그 기록.
7. 비밀번호·PIN은 salt + SHA-256 해시로만 저장.
8. 동시 요청 충돌은 DB 가 막게 한다 (유일 색인, 조건부 INSERT/UPDATE). 여러 건이 함께 바뀌어야 하면 `DB.batch`.
9. 테스트·예시 데이터의 주민번호는 가짜 값(`000101-3000000` 류)만.

## 폴더 구조
```
web/            staff.html, desk.html, admin.html, js/, css/   ← GitHub Pages (자동 배포)
worker/         wrangler.toml, schema.sql, src/*.js, scripts/, test/   ← Cloudflare Worker + D1
docs/           배포가이드.md, 사용설명서.md
spec.md, CLAUDE.md
```

## 코드 스타일
- 한 파일이 너무 길어지지 않게 기능별로 나눈다 (`apps-script/` 는 spec.md 1장 구조).
- 함수·변수명은 영어 camelCase, DB 테이블·열 이름은 영어 snake_case, 상태·구분 값과 화면 문구는 한국어.
- DB 구조는 `worker/schema.sql` 한 곳에서 관리하고 `IF NOT EXISTS` 로 여러 번 실행해도 안전하게 쓴다. 바꿀 때는 기존 데이터를 지우지 않는 방식으로.
- 날짜는 Asia/Seoul 기준 `YYYY-MM-DD` 문자열로 저장·비교.
- 주석은 "왜 이렇게 했는지"만 짧게 한국어로.

## 작업 방식
- spec.md 7장의 단계 순서대로 진행하고, **단계가 끝날 때마다 멈추고** 사용자에게:
  1) 무엇이 되었는지, 2) 사용자가 해야 할 배포·테스트 단계, 3) 확인할 체크리스트를 알려준다.
- 로컬 확인: `web/` 는 간단한 정적 서버로 열어볼 수 있다 (예: `npx serve web` 또는 VS Code Live Server). 카메라·GPS는 HTTPS 또는 localhost에서만 동작함을 안내.
- 서버는 로컬(`wrangler dev --local`)에서 먼저 `worker/test/run.mjs` 통합 테스트로 확인한 뒤 배포한다. 새 action 을 만들면 테스트도 같이 추가한다.
- 막히거나 spec.md와 다르게 해야 할 이유가 생기면 임의로 바꾸지 말고 이유와 선택지를 제시한다.

## Git
- `.gitignore` 에 `node_modules/`, `.env*`, `*.log`, `worker/.dev.vars`, `worker/.wrangler/`, `worker/.seed.sql` 포함.
- GitHub 저장소는 **공개(Public)** 로 만들어 GitHub Pages를 켠다 (무료 계정은 공개 저장소만 Pages 가능). 그래서 비밀 정보는 커밋하지 않는다.
- 커밋 메시지는 한국어로 짧게.
