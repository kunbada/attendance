# 분양계약관리 앱 — Claude Code 작업 안내

> **통합 이후 위치 (2026-10-20)**: 이 앱은 `통합프로젝트관리앱/apps/contract/` 에 있다. 개인정보가 든 `초기데이터_*.json` 과 `backup/` 은 `../../private/contract/` 로 옮겼다(git 제외). 동기화 서버는 통합구성안 4단계에서 Apps Script → 통합 서버(`../../server`)로 교체한다. 루트 `CLAUDE.md` 규칙이 우선.


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
  gas/Code.gs, appsscript.json   구글시트 동기화 서버 (Apps Script 웹앱)
  tools/convert.py     엑셀 → 초기데이터 JSON 변환기 (python3 convert.py 원본.xlsx 출력.json)
  tools/mockgas.js     Code.gs를 그대로 실행하는 로컬 모의 서버 (http://localhost:8765, 토큰 test123)
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

## 데이터 모델 (컬렉션 = IndexedDB store = 구글시트 시트)
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

## 현장별 구글시트 자동 생성
- Code.gs 는 하나의 배포로 여러 현장 처리: 요청에 `pk`(현장키)가 있으면 ScriptProperties `SS_<pk>` 의 시트를 사용, `op:'newProject'` 가 새 시트를 만들어 등록. pk 없으면 기존처럼 연결된 기본 시트.
- 앱: 설정·백업 → 새 프로젝트 → 현장명 + 견본/초기데이터 JSON(`견본_초기데이터.json`, `node tools/make_sample.js`) 선택 + 구글시트 자동 생성. 권한 부여·배포는 최초 1회만 수동.
- 테스트: `node tools/mockgas.js` 실행 후 `MOCK=1 node tools/smoke.js`.

## 온라인 운영: 로그인·권한·동시편집
- 권한: admin(사용자 승인·관리+전체) / write(입력·수정) / read(조회만). 서버(Code.gs)가 강제하고, 앱은 save() 차단+배너. 사용자 정보는 ScriptProperties `USERS`(salt+SHA-256 해시), 세션 `S_<token>`(30일).
- 최초: 서버에 사용자가 없으면 앱이 "최초 관리자 만들기"(서버 비밀키=Code.gs TOKEN) 화면을 띄움. 이후 TOKEN 은 분실 복구(`recoverAdmin`)용. 사용자는 로그인 화면에서 '사용 신청' → 관리자가 설정>사용자관리에서 승인+권한 지정.
- 온라인 배포용 서버 주소: `server.json`({"syncUrl":"…/exec"}) 을 두고 `node build.js` → HTML에 기본 서버로 내장(비밀키는 내장 안 함).
- 동기화: 변경은 "바뀐 필드만(patch)" 전송(`diffRec`, `BASE`) → 서버가 필드 단위 병합. 서버가 동호 이중계약·입금내역 중복을 거절(`rejected`)하면 앱이 서버 최신으로 되돌리고 안내. 변경 감지는 5초마다 `poll`(rev만) → 바뀌었을 때만 `sync`.
- 테스트: `node tools/mockgas.js`(새로 시작) → `node tools/test_server.js`, `node tools/test_multi.js`(브라우저 3명 동시 시나리오), `MOCK=1 node tools/smoke.js`. 각 테스트마다 모의서버를 새로 시작할 것(상태 공유).

## 동기화 구조 (오프라인 우선)
- 앱은 IndexedDB(프로젝트별 DB `bunyang_<key>`)에서 즉시 동작. 변경은 OUTBOX에 쌓이고 2.5초 디바운스 + 30초 주기로 `POST {op:'sync', token, since:lastRev, changes:[{c,r}]}`.
- 서버(Code.gs)는 LockService로 직렬화, 시트별 행 = [id, rev, updatedAt, updatedBy, deleted, json, ...보기용 열]. 레코드 원본은 json 열. rev 는 ScriptProperties 'REV'(+시트별 'REV_<col>'로 변경없는 시트 읽기 생략).
- 충돌: updatedAt 이 더 최신인 쪽 우선(서버가 더 최신이면 반려하고 서버 레코드를 돌려줌).
- 요청은 `Content-Type: text/plain` (CORS preflight 회피). 시트에서 직접 수정한 값은 앱에 반영 안 됨(json 열 기준).
- 로컬 백업: File System Access API로 지정 폴더에 `<현장명>_최신백업.json`(1분 주기, 변경시) + `<현장명>_백업_YYYYMMDD_HH시.json`. 복원은 설정 화면.

## Apps Script 자동 수정/배포 (clasp)
```bash
npm i -g @google/clasp
clasp login                         # 브라우저로 구글 계정 승인 (최초 1회)
# https://script.google.com/home/usersettings 에서 "Google Apps Script API" 켜기 (최초 1회)
cd gas
# (A) 새로 만들 때: 시트까지 생성
clasp create --type sheets --title "양주역 계약관리 DB" --rootDir .
# (B) 이미 만든 스크립트가 있으면: clasp clone <스크립트ID> --rootDir .
clasp push -f
clasp deploy -d "v1"               # 최초 배포 → 출력된 배포ID 기록
clasp deploy -i <배포ID> -d "수정"  # 이후 수정: 같은 배포ID로 재배포해야 웹앱 URL이 유지됨
```
- `TOKEN` 상수는 Code.gs 맨 위. 실제 값은 사용자에게 받아서 넣되 git 에 올리지 말 것.
- 웹앱 URL: `https://script.google.com/macros/s/<배포ID>/exec` → 앱 설정·백업 화면에 입력.
- 최초 배포 후 브라우저에서 1회 권한 승인이 필요할 수 있음(사용자 안내).
- 로컬 테스트: `node tools/mockgas.js` 후 앱 설정에 `http://localhost:8765/exec`, 토큰 `test123`.

## 현재 상태 (2026-10-19)
- 구현 완료: 대시보드, 동호배치도(상태/수납 표시), 계약·가계약·동호지정·잠금 CRUD + 엑셀 붙여넣기 등록, 수금(파일/붙여넣기 업로드, 중복제거, 최근순→시간순, 누락분 끼워넣기, 잔액불연속 탐지, 자동추천·일괄적용, 인라인 분류), 세대별 수납, 세대·분양가 편집/붙여넣기, 레포트 7종, 계약서 좌표출력 디자이너 + 보정눈금, 영수증, 설정·백업·복원·멀티프로젝트, Code.gs 동기화.
- 검증: 모의 서버로 2개 PC 동기화·오프라인 복구 테스트 통과. **실제 구글 Apps Script 배포는 아직 미검증** → 첫 작업으로 clasp 배포 후 연결 테스트.
- 자동추천 정확도(기존 분류 1,772건 기준): high 1,164건 100%, mid 약 98%.
- 엑셀 데이터에서 발견: 현황판 수식 범위(533행) 때문에 계약 29건 누락 집계(실제 525/526), `104-501a` 오타, 잔액 불연속 8곳(대체지급 출금 누락 추정), 미분류 562건 중 521건 중도금 2차 high 추천.

## 다음 할 일 (사용자 요청 대기 포함)
1. clasp 로 Code.gs 배포 → 앱 연결 → 전체 업로드
2. 표준임대차계약서 실제 용지 스캔 받아 출력 좌표 맞추기 (기본 양식은 임시 배치)
3. 환불관리, 사후관리(해약·민원), 서류접수현황, 당첨자/예비당첨자 화면 (엑셀 시트 참고)
4. (선택) GitHub Pages 온라인 배포 — HTML에는 데이터가 없으므로 공개 저장소 가능, 단 초기데이터/백업 json 은 절대 커밋 금지
