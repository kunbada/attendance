// 근태: 관리자 QR 발급, 직원 출근 판정, 관리자 근태 현황

function timeStr_() {
  return Utilities.formatDate(new Date(), TZ, 'HH:mm:ss');
}

function numOrNull_(v) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}

// 두 좌표 사이 거리(m). 하버사인 공식
function distanceM_(lat1, lng1, lat2, lng2) {
  var R = 6371000, rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

function todayQrRow_() {
  var today = todayStr();
  return findOne('QR발급', function (r) { return s_(r.날짜) === today; });
}

function randomToken_(n) {
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var out = '';
  for (var i = 0; i < n; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

// ---------- 관리자: QR ----------

function qrInfo_(row) {
  if (!row) return { issued: false };
  return {
    issued: true, date: s_(row.날짜), qr: s_(row.QR값), accuracy: Number(row['정확도m']) || 0, issuedAt: s_(row.발급일시)
  };
}

function adminCurrentQr() {
  return qrInfo_(todayQrRow_());
}

// 관리자 현재 위치가 그날의 기준점. 같은 날 다시 발급하면 이전 QR 은 무효.
function adminIssueQr(data, ctx) {
  var lat = numOrNull_(data.lat), lng = numOrNull_(data.lng), acc = numOrNull_(data.accuracy);
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new AppError('위치를 확인하지 못했습니다. 위치 권한을 허용하고 다시 시도해 주세요.');
  }
  var today = todayStr();
  var rec = {
    날짜: today, QR값: 'WN-ATT|' + today + '|' + randomToken_(16), 기준위도: lat, 기준경도: lng,
    '정확도m': Math.round(acc || 0), 발급계정ID: s_(ctx.account.계정ID), 발급일시: nowStr()
  };
  var existing = todayQrRow_();
  if (existing) updateRow('QR발급', existing._row, rec); else appendRow('QR발급', rec);
  writeLog_(adminName_(ctx), existing ? 'QR재발급' : 'QR발급', today, '정확도 ' + rec['정확도m'] + 'm');
  return qrInfo_(rec);
}

// ---------- 직원: 출근 ----------

function getOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

// 셀카는 관리자 드라이브 근태셀카/YYYY-MM 에 저장하고 링크만 근태 시트에 남긴다
function saveSelfie_(base64, staff, date, time) {
  base64 = s_(base64);
  if (!base64) throw new AppError('출근 셀카를 촬영해 주세요.');
  if (base64.length > 2000000 || !/^[A-Za-z0-9+\/=]+$/.test(base64)) throw new AppError('사진 형식이 올바르지 않습니다. 다시 촬영해 주세요.');
  var bytes = Utilities.base64Decode(base64);
  if (bytes[0] !== -1 || bytes[1] !== -40) throw new AppError('사진 형식이 올바르지 않습니다. 다시 촬영해 주세요.'); // JPEG 시작 바이트 FF D8
  var folder = getOrCreateFolder_(getOrCreateFolder_(DriveApp.getRootFolder(), '근태셀카'), date.slice(0, 7));
  var name = date + '_' + s_(staff.성명) + '_' + time.replace(/:/g, '') + '.jpg';
  return folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', name)).getUrl();
}

function attendanceCheckin(data, ctx) {
  var staff = ctx.staff;
  var staffId = s_(staff.직원ID);
  var today = todayStr();
  var lat = numOrNull_(data.lat), lng = numOrNull_(data.lng), acc = numOrNull_(data.accuracy);
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new AppError('위치를 확인하지 못했습니다. 위치 권한을 허용하고 다시 시도해 주세요.');
  }
  var time = timeStr_();
  var base = {
    근태ID: newId_('T'), 날짜: today, 직원ID: staffId, 시각: time, 위도: lat, 경도: lng,
    '정확도m': Math.round(acc || 0), 기기키: ctx.deviceKey
  };
  // 실패해도 근태 시트에 '실패'로 남긴 뒤 화면에 사유를 보여준다
  var fail = function (reason, distance) {
    appendRow('근태', Object.assign({}, base, { '거리m': distance === undefined ? '' : distance, 결과: '실패', 실패사유: reason }));
    throw new AppError(reason);
  };

  var okToday = filterRows('근태', function (r) { return s_(r.날짜) === today && s_(r.결과) === '성공'; });
  // 판정 2: 이미 출근 (중복 연타가 실패 기록으로 쌓이지 않도록 이 경우만 기록하지 않는다)
  var mine = okToday.filter(function (r) { return s_(r.직원ID) === staffId; })[0];
  if (mine) throw new AppError('이미 출근 처리되었습니다 (' + s_(mine.시각).slice(0, 5) + ')');

  // 판정 3: 한 휴대폰으로 다른 직원이 이미 출근
  var sameDevice = okToday.filter(function (r) { return s_(r.기기키) === ctx.deviceKey && s_(r.직원ID) !== staffId; })[0];
  if (sameDevice) fail('이 휴대폰으로 이미 다른 직원이 출근했습니다');

  // 판정 4: 오늘 QR 인지
  var qr = todayQrRow_();
  if (!qr) fail('오늘 출근 QR이 아직 발급되지 않았습니다');
  if (s_(data.qr) !== s_(qr.QR값)) fail('오늘 QR이 아닙니다');

  // 판정 5: 현장 안인지
  var limit = Number(getSettings_()['GPS허용거리m']) || 200;
  var dist = Math.round(distanceM_(lat, lng, Number(qr.기준위도), Number(qr.기준경도)));
  if (dist > limit) fail('현장에서 ' + dist + 'm 떨어져 있습니다', dist);

  // 판정 6: 통과. 셀카는 통과한 건에만 저장 (드라이브에 불필요한 사진이 쌓이지 않게)
  var selfieUrl = '';
  if (getSettings_()['출근셀카사용'] === 'Y') selfieUrl = saveSelfie_(data.selfie, staff, today, time);
  appendRow('근태', Object.assign({}, base, { '거리m': dist, 셀카링크: selfieUrl, 결과: '성공', 실패사유: '' }));
  return { time: time.slice(0, 5), distance: dist };
}

// ---------- 관리자: 근태 현황 ----------

function orgNameMap_() {
  var m = {};
  readAll('조직').forEach(function (o) { m[s_(o.조직ID)] = s_(o.이름); });
  return m;
}

function staffBrief_(s, names) {
  return {
    id: s_(s.직원ID), name: s_(s.성명), nickname: s_(s.예명), job: s_(s.직군),
    headName: names[s_(s.본부ID)] || '', teamName: names[s_(s.팀ID)] || ''
  };
}

// data.date 가 있으면 일별, data.month 가 있으면 월별
function adminAttendance(data) {
  var names = orgNameMap_();
  var staff = readAll('직원');
  var byId = {};
  staff.forEach(function (s) { byId[s_(s.직원ID)] = s; });

  if (data.month) {
    var month = s_(data.month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AppError('월 형식이 올바르지 않습니다.');
    var daysOf = {};
    filterRows('근태', function (r) { return s_(r.날짜).indexOf(month) === 0 && s_(r.결과) === '성공'; }).forEach(function (r) {
      var id = s_(r.직원ID);
      (daysOf[id] = daysOf[id] || {})[Number(s_(r.날짜).slice(8, 10))] = true;
    });
    var list = staff.filter(function (s) { return s_(s.상태) === '활동' || daysOf[s_(s.직원ID)]; }).map(function (s) {
      var d = Object.keys(daysOf[s_(s.직원ID)] || {}).map(Number).sort(function (a, b) { return a - b; });
      return Object.assign(staffBrief_(s, names), { days: d });
    });
    list.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
    var y = Number(month.slice(0, 4)), mo = Number(month.slice(5, 7));
    return { month: month, daysInMonth: new Date(y, mo, 0).getDate(), staff: list };
  }

  var date = s_(data.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('날짜 형식이 올바르지 않습니다.');
  var rows = filterRows('근태', function (r) { return s_(r.날짜) === date; });
  var seen = {};
  var present = rows.filter(function (r) { return s_(r.결과) === '성공'; })
    .sort(function (a, b) { return s_(a.시각).localeCompare(s_(b.시각)); })
    .filter(function (r) { if (seen[s_(r.직원ID)]) return false; seen[s_(r.직원ID)] = true; return true; })
    .map(function (r) {
      var s = byId[s_(r.직원ID)];
      return Object.assign(s ? staffBrief_(s, names) : { id: s_(r.직원ID), name: '(삭제된 직원)', nickname: '', job: '', headName: '', teamName: '' },
        { time: s_(r.시각).slice(0, 5), distance: Number(r['거리m']) || 0, selfieUrl: s_(r.셀카링크) });
    });
  var active = staff.filter(function (s) { return s_(s.상태) === '활동'; });
  var absent = active.filter(function (s) { return !seen[s_(s.직원ID)]; }).map(function (s) { return staffBrief_(s, names); });
  var failures = rows.filter(function (r) { return s_(r.결과) === '실패'; })
    .sort(function (a, b) { return s_(a.시각).localeCompare(s_(b.시각)); })
    .map(function (r) {
      var s = byId[s_(r.직원ID)];
      return { time: s_(r.시각).slice(0, 5), name: s ? s_(s.성명) : '(삭제된 직원)', reason: s_(r.실패사유), distance: r['거리m'] === '' ? null : Number(r['거리m']) };
    });
  return { date: date, activeCount: active.length, present: present, absent: absent, failures: failures };
}
