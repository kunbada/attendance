# 분양계약관리 앱 — Claude Code 작업 안내

> **통합 이후 위치 (2026-10-20)**: 이 앱은 `통합프로젝트관리앱/apps/contract/` 에 있다. 개인정보가 든 `초기데이터_*.json` 과 `backup/` 은 `../../private/contract/` 로 옮겼다(git 제외). 동기화 서버는 4단계에서 Apps Script → 통합 서버(`../../server`, `contract.*` action)로 교체했다(구글시트·Code.gs·clasp 는 더 이상 쓰지 않는다). 루트 `CLAUDE.md` 규칙이 우선.


위뉴(WeNew) 분양대행 현장용 **계약·가계약·동호지정·잠금동호·수금 관리** 웹앱.
기존 엑셀(`../양주역증흥S클래스_계약관리_V2_작업중.xlsx`)을 대체한다. 첫 현장: 양주역 중흥S-클래스(임대, 526세대, 금액명칭 '임대보증금').
사용자는 비개발자 실무 책임자(상무). 답변·UI 문구는 한국어.

## 폴더 구조
```
app/
  src/                 ← 앱 소스 (여기를 수정)
    index.html         템플릿 (/*CSS*/ /*XLSX*/ /*APP*/ 자리표시자)
    style.css
    core.js            유틸, IndexedDB, 데이터스토어(S/M), 인덱스(IX), 동기화(sync), 로컬폴더 백업, boot()
    ui.js              셸/라우팅(#hash), 모달·드로어, 폼 빌더, 가상스크롤 그리드 vgrid()
    v_dash.js          대시보드, 동호배치도, 세대상세 드로어 openUnit()
    v_lists.js         계약 / 가계약(pre) / 동호지정(resv) / 잠금(locks) 목록·폼, 엑셀 붙여넣기 일괄등록
    v_deposits.js      은행내역 파싱, 자동추천(suggestFor), 수금관리 화면, 업로드, 세대별 수납
    v_print.js         계약서 출력 디자이너(좌표 mm), 출력필드 정의, 영수증
    v_misc.js          세대·분양가, 레포트, 설정·백업
  vendor/xlsx.full.min.js   SheetJS 0.18.5 (오프라인 동작 위해 HTML에 인라인)
  tools/convert.py     엑셀 → 초기데이터 JSON 변환기 (python3 convert.py 원본.xlsx 출력.json)
  tools/smoke.js       Playwright 스모크 테스트
  build.js             src + vendor → 분양계약관리.html 단일 파일 생성
  분양계약관리.html     ← 빌드 결과물 (사용자가 실제로 여는 파일. 직접 수정 금지)
  초기데이터_*.json     ← 개인정보(주민번호) 포함. git/외부 업로드 금지
```

## 작업 규칙
- 수정은 `src/` 에서 하고 **반드시 `node build.js`** 로 HTML 재생성.
- 외부 CDN 금지 (현장 인터넷 끊김 대비 — 모든 라이브러리 인라인). 프레임워크 없이 순수 JS, 전역 함수 방식.
- 수정 후 `node tools/smoke.js` 로 전 화면 오류 확인 (playwright 필요: `npm i -D playwright && npx playwright install chromium`).
- 데이터 변경은 항상 `save(col, recs)` / `remove(col, id)` 사용 → IndexedDB 저장 + OUTBOX(동기화 대기) + 인덱스 재계산 + 백업 dirty 처리가 함께 된다. S/M 을 직접 고치지 말 것.
- 레코드는 `{id, updatedAt, updatedBy, deleted?...}` 공통. 삭제는 soft delete(`deleted:true`).

## 데이터 모델 (컬렉션 = IndexedDB store = 서버 `ct_records` 의 col)
| 컬렉션 | 주요 필드 |
|---|---|
| units (세대_분양가) | id='101-1203', dong, ho, floor, line, type, exArea, resArea, supArea, etcArea, conArea, landArea, price, amounts{회차명: 금액} |
| contracts | dongho, status(정상/해약), report(보고/미보고/해약), name, rrn, phone, email, addr, mail, date, ctype(계약유형), stype(공급유형), fee(수수료기준), team, staff, note, memo, memo2 |
| pre / resv | date, dongho, status(진행/전환/취소/환불), name, phone, plan(전환예정일), team, staff, note |
| locks | date, dongho, reason, status(잠금/해제), note |
| deposits | k(중복키 `t|입금|출금|잔액`), t('YYYY.MM.DD HH.MM.SS'), seq(같은 시각 순서), jeok(적요), desc(기재내용), out, inn, bal, branch, cat(입금구분), dongho, name, note, sug{dongho,cat,conf(high/mid/low),why}, auto(자동분류-검토필요) |
| settings | id='main', project{name,lessor,bizNo,bank,account,moneyLabel}, stages[], stageDue{}, special{타입:{유형:배정수}}, depositCats[] |
| templates | 출력양식 {name, paperW, paperH, pages, offX, offY, fields[{key,page,x,y(mm),size(pt),align,w,ls,bold,dfmt,...}]} (배경이미지는 로컬 meta에만) |

- 세대 상태 우선순위: 계약 > 가계약(진행) > 동호지정(진행) > 잠금 > 잔여 (`unitStatus`).
- 납부상태 `payState(dh, 회차)`: 회차 구분(cat)이 같은 입금 합계(입금-출금) vs units.amounts[회차]. 완납/초과/50%이상/50%미만/미납, 아직 아무도 안 낸 회차는 '예정'.
- 엑셀 관례: 동호 앞(또는 뒤) `a` = 해약/전환/해제 → 변환 시 status로 바꿈.

## 메뉴 구조 (ui.js GROUPS)
대시보드 · 동호배치도 · 수금관리(수금입력/세대별 수납/영수증 출력) · 계약관리(계약입력/잠금동호 관리/가계약 관리/계약서 출력) · 레포트 · 설정(세대관리/일반설정). 프로세스: 수납확인 → 영수증(선택) → 계약서 작성 후 계약 입력.
- 동호지정 메뉴는 폐지: 기존 resv 레코드는 부팅 시 가계약(pre, 가계약금 0원)으로 자동 이관(`migrateResv`).
- 회차 후보 `ALL_STAGES` = 계약금 1·2차, 중도금 1~6차, 잔금. 현장은 설정에서 쓰는 회차만 켠다(기존 현장의 '계약금' 단일 회차도 그대로 동작).
- units.skind = 공급구분(일반/특공 종류 등), 세대관리 화면·붙여넣기·엑셀에 포함.

## 통합 서버 연동 (4단계)
- 서버 = `../../server` 의 Worker. 계정·권한·현장은 통합관리 것을 그대로 쓴다 (아이디/비밀번호 로그인 → 토큰). 계약앱 권한 매핑: 관리자·보조관리자=admin, 계약담당=write, 열람=read(저장 차단, 서버도 거절).
- 현장 id(`P01` …) = 앱의 `PROJ` = IndexedDB 이름(`bunyang_<id>`). 현장은 통합관리 [프로젝트]에서 만들고, 앱은 로그인 때 받은 목록에서 고른다(`pickProject`). 새 현장 만들기·사용자 관리는 앱에 없다.
- `callServer` 가 예전 op 이름을 action 으로 옮긴다(`toAction`): login→account.login, poll/me/ping→contract.poll, sync→contract.sync, wipe→contract.wipe …
- 동기화 프로토콜은 그대로: 바뀐 필드만(patch, `diffRec`/`BASE`) 전송 → 서버가 필드 단위 병합, 동호 이중계약·입금 중복은 서버(DB 유일 색인)가 거절(`rejected`). 한 번에 300건씩 보내고, 서버가 `more` 를 주면 이어서 받는다. 5초마다 `poll`(rev만).
- 서버 주소는 `server.json` → `node build.js` 가 HTML 에 내장. 빌드 결과는 `분양계약관리.html`(내 PC용)과 `../../web/contract/index.html`(GitHub Pages `/contract/`) 둘 다. `NOSERVER=1` 이면 주소를 비우고 web/ 사본은 만들지 않는다.
- **담당자는 통합관리 직원 목록에서 고른다**: 계약·가계약·동호지정 입력창의 담당자 칸이 직원 선택(`staffpick`, `contract.staffList` → `STAFF`)이고, 고르면 `staffId` + 팀·담당자 글자(`team`, `staff`)를 함께 저장한다(보고서는 글자를 쓴다). 목록이 없으면(로컬 전용·아직 못 받음) 예전처럼 글자 입력. 엑셀 붙여넣기 일괄등록은 글자 열 그대로(`asText`). 통합관리 [계약관리 > 담당자 매칭]은 글자뿐인 예전 데이터·잘못된 담당자를 바로잡는 보완 용도.
- 테스트(통합 서버 필요: server/ 에서 DB 새로 만들고 `wrangler dev --local --port 8787`): `ADMIN_PW=초기비번 node tools/test_multi.js`(브라우저 3명 동시 + 통합관리 요약 일치), `node tools/smoke.js`(전 화면, 서버 불필요).

## 동기화 구조 (오프라인 우선)
- 앱은 IndexedDB(프로젝트별 DB `bunyang_<key>`)에서 즉시 동작. 변경은 OUTBOX에 쌓이고 2.5초 디바운스로 `contract.sync {since:lastRev, changes:[{c,r}|{c,id,p}]}` 전송.
- 서버는 레코드 원본을 `ct_records.json` 에 저장하고, 레코드마다 `rev`(변경 번호)를 단다. 같은 DB 묶음(batch)에서 현장 카운터 `ct_rev` 를 올리므로 놓치는 변경이 없다.
- 충돌: 같은 레코드의 다른 필드는 합치고, 같은 필드는 나중 요청이 이긴다.
- 요청은 `Content-Type: text/plain` (CORS preflight 회피). 파일로 열면(주소 "null") 서버가 허용 목록(`ALLOWED_ORIGINS`)에 있을 때만 접속된다.
- 로컬 백업: File System Access API로 지정 폴더에 `<현장명>_최신백업.json`(1분 주기, 변경시) + `<현장명>_백업_YYYYMMDD_HH시.json`. 복원은 설정 화면.

## 현재 상태 (2026-10-19)
- 구현 완료: 대시보드, 동호배치도(상태/수납 표시), 계약·가계약·동호지정·잠금 CRUD + 엑셀 붙여넣기 등록, 수금(파일/붙여넣기 업로드, 중복제거, 최근순→시간순, 누락분 끼워넣기, 잔액불연속 탐지, 자동추천·일괄적용, 인라인 분류), 세대별 수납, 세대·분양가 편집/붙여넣기, 레포트 7종, 계약서 좌표출력 디자이너 + 보정눈금, 영수증, 설정·백업·복원·멀티프로젝트, 통합 서버 동기화(4단계).
- 검증: 통합 서버(로컬)에서 3명 동시 편집·이중계약 차단·읽기전용 차단·계정 중지·양주역 실데이터 3,548건 업로드/내려받기·통합관리 요약 일치 시험 통과.
- 자동추천 정확도(기존 분류 1,772건 기준): high 1,164건 100%, mid 약 98%.
- 엑셀 데이터에서 발견: 현황판 수식 범위(533행) 때문에 계약 29건 누락 집계(실제 525/526), `104-501a` 오타, 잔액 불연속 8곳(대체지급 출금 누락 추정), 미분류 562건 중 521건 중도금 2차 high 추천.

## 다음 할 일 (사용자 요청 대기 포함)
1. 운영 서버 반영 후 양주역 데이터 업로드 (설정 > 백업 파일에서 복원 > 서버 덮어쓰기)
2. 표준임대차계약서 실제 용지 스캔 받아 출력 좌표 맞추기 (기본 양식은 임시 배치)
3. 환불관리, 사후관리(해약·민원), 서류접수현황, 당첨자/예비당첨자 화면 (엑셀 시트 참고)
4. (선택) GitHub Pages 온라인 배포 — HTML에는 데이터가 없으므로 공개 저장소 가능, 단 초기데이터/백업 json 은 절대 커밋 금지
