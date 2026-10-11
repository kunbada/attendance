// 시트 읽기/쓰기 공통 헬퍼. 열은 항상 "헤더 이름"으로 찾는다 (열 순서가 바뀌어도 동작).

var TZ = 'Asia/Seoul';
var SHEET_B_NAMES = ['급여정보']; // 이 시트만 파일 B(관리자 전용)에 있다

// 화면에 그대로 보여줄 한국어 메시지를 담는 오류. 그 외 오류는 "서버 오류"로만 보인다.
class AppError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code || '';
  }
}

function s_(v) {
  return v === null || v === undefined ? '' : String(v);
}

function prop_(key) {
  return PropertiesService.getScriptProperties().getProperty(key);
}

function requireProp_(key) {
  var v = prop_(key);
  if (!v) throw new AppError('서버 설정이 끝나지 않았습니다. 관리자에게 문의해 주세요. (' + key + ')');
  return v;
}

var ssMemo_ = {};
function openSpreadsheet_(which) {
  if (!ssMemo_[which]) ssMemo_[which] = SpreadsheetApp.openById(requireProp_('SHEET_' + which + '_ID'));
  return ssMemo_[which];
}

function table_(name) {
  var ss = openSpreadsheet_(SHEET_B_NAMES.indexOf(name) >= 0 ? 'B' : 'A');
  var sh = ss.getSheetByName(name);
  if (!sh) throw new AppError('시트 "' + name + '" 를 찾을 수 없습니다. Setup 을 다시 실행해 주세요.');
  return sh;
}

function headersOf_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

// 모든 행을 {열이름: 값, _row: 시트행번호} 객체 배열로 돌려준다.
function readAll(name) {
  var values = table_(name).getDataRange().getValues();
  var headers = values[0].map(String);
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    var empty = true;
    for (var j = 0; j < headers.length; j++) {
      var v = values[i][j];
      if (v instanceof Date) v = Utilities.formatDate(v, TZ, 'yyyy-MM-dd HH:mm:ss');
      if (v !== '') empty = false;
      o[headers[j]] = v;
    }
    if (!empty) rows.push(o);
  }
  return rows;
}

function findOne(name, pred) {
  var rows = readAll(name);
  for (var i = 0; i < rows.length; i++) if (pred(rows[i])) return rows[i];
  return null;
}

function filterRows(name, pred) {
  return readAll(name).filter(pred);
}

// obj 에 없는 열은 빈칸. 추가된 시트 행 번호를 돌려준다.
function appendRow(name, obj) {
  var sh = table_(name);
  var row = headersOf_(sh).map(function (h) { return obj[h] === undefined ? '' : obj[h]; });
  var rowNum = sh.getLastRow() + 1;
  sh.getRange(rowNum, 1, 1, row.length).setValues([row]);
  return rowNum;
}

// obj 에 적힌 열만 바꾼다.
function updateRow(name, rowNum, obj) {
  var sh = table_(name);
  var headers = headersOf_(sh);
  var range = sh.getRange(rowNum, 1, 1, headers.length);
  var row = range.getValues()[0];
  headers.forEach(function (h, i) {
    if (obj[h] !== undefined) row[i] = obj[h];
  });
  range.setValues([row]);
}

function deleteRows(name, rowNums) {
  var sh = table_(name);
  rowNums.slice().sort(function (a, b) { return b - a; }).forEach(function (r) { sh.deleteRow(r); });
}

function newId_(prefix) {
  return prefix + Utilities.getUuid().replace(/-/g, '').slice(0, 8).toUpperCase();
}

function nowStr() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function todayStr() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
}

// 쓰기 작업은 동시에 하나만 (최대 25초 대기)
function withLock(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (e) {
    throw new AppError('요청이 많아 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function writeLog_(user, action, target, content) {
  appendRow('로그', { 일시: nowStr(), 사용자: user, 행위: action, 대상: target, 내용: content || '' });
}

function getSettings_() {
  var map = {};
  readAll('설정').forEach(function (r) { map[s_(r.항목)] = s_(r.값); });
  return map;
}
