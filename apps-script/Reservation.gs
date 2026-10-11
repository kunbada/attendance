// 방문예약: 직원이 본인 고객을 예약·조회·수정·취소 (뒤 5자리 + 중복 차단)

function isRealDate_(s) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]);
}

function requireLast5_(v) {
  var t = s_(v).trim();
  if (!/^\d{5}$/.test(t)) throw new AppError('전화번호 뒤 5자리를 숫자로 입력해 주세요.');
  return t;
}

function normGender_(v) {
  var g = s_(v).trim();
  if (g !== '' && g !== '남' && g !== '여') throw new AppError('성별 값이 올바르지 않습니다.');
  return g;
}

// 방문예정일이 지났는데 아직 '예정'이면 화면에서는 '미방문' 으로 본다
function effectiveStatus_(r) {
  var st = s_(r.상태);
  return st === '예정' && s_(r.방문예정일) < todayStr() ? '미방문' : st;
}

// 지난 '예정' 건을 시트에서도 '미방문'으로 바꾼다. 하루 한 번만 (쓰기 action 안에서 호출)
function markNoShow_() {
  var cache = CacheService.getScriptCache();
  var key = 'NOSHOW_' + todayStr();
  if (cache.get(key)) return;
  var today = todayStr();
  filterRows('예약', function (r) { return s_(r.상태) === '예정' && s_(r.방문예정일) < today; })
    .forEach(function (r) { updateRow('예약', r._row, { 상태: '미방문' }); });
  cache.put(key, '1', 21600);
}

function mdLabel_(date) {
  return Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10));
}

function reservationView_(r) {
  return { id: s_(r.예약ID), last5: s_(r.뒤5자리), gender: s_(r.성별), date: s_(r.방문예정일), memo: s_(r.메모), status: effectiveStatus_(r) };
}

function findMyReservation_(id, staffId) {
  var r = findOne('예약', function (x) { return s_(x.예약ID) === s_(id); });
  if (!r || s_(r.직원ID) !== staffId) throw new AppError('예약을 찾을 수 없습니다.'); // 남의 예약 존재 여부도 알려주지 않는다
  return r;
}

function reservationCreate(data, ctx) {
  markNoShow_();
  var staffId = s_(ctx.staff.직원ID);
  var last5 = requireLast5_(data.last5);
  var gender = normGender_(data.gender);
  var date = s_(data.date);
  var memo = s_(data.memo).trim();
  var byGender = getSettings_()['예약중복기준'] === '뒤5자리+성별';
  if (!isRealDate_(date)) throw new AppError('방문 예정일을 선택해 주세요.');
  if (date < todayStr()) throw new AppError('방문 예정일은 오늘 이후여야 합니다.');
  if (byGender && !gender) throw new AppError('성별을 선택해 주세요.');
  if (memo.length > 100) throw new AppError('메모는 100자 이내로 입력해 주세요.');

  // 방문예정일이 오늘 이상이고 '예정'인 예약 중 같은 고객이 있으면 차단
  var today = todayStr();
  var dup = filterRows('예약', function (r) {
    return s_(r.뒤5자리) === last5 && s_(r.상태) === '예정' && s_(r.방문예정일) >= today && (!byGender || s_(r.성별) === gender);
  })[0];
  if (dup) {
    if (s_(dup.직원ID) === staffId) throw new AppError('이미 내 예약이 있습니다 (' + mdLabel_(s_(dup.방문예정일)) + ')');
    throw new AppError('이미 예약된 고객입니다.'); // 다른 직원 이름·날짜는 알려주지 않는다
  }
  var id = newId_('R');
  appendRow('예약', { 예약ID: id, 뒤5자리: last5, 성별: gender, 방문예정일: date, 직원ID: staffId, 메모: memo, 상태: '예정', 등록일시: nowStr() });
  return { id: id };
}

function reservationList(data, ctx) {
  var staffId = s_(ctx.staff.직원ID);
  var tab = s_(data.tab) || '예정';
  var want = { '예정': ['예정'], '방문완료': ['방문'], '미방문·취소': ['미방문', '취소'] }[tab];
  if (!want) throw new AppError('구분이 올바르지 않습니다.');
  var rows = filterRows('예약', function (r) { return s_(r.직원ID) === staffId && want.indexOf(effectiveStatus_(r)) >= 0; })
    .map(reservationView_);
  rows.sort(function (a, b) { return tab === '예정' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date); });
  return { reservations: rows };
}

function reservationUpdate(data, ctx) {
  markNoShow_();
  var r = findMyReservation_(data.id, s_(ctx.staff.직원ID));
  if (effectiveStatus_(r) !== '예정') throw new AppError('예정 상태의 예약만 수정할 수 있습니다.');
  var date = s_(data.date);
  var memo = s_(data.memo).trim();
  if (!isRealDate_(date) || date < todayStr()) throw new AppError('방문 예정일은 오늘 이후로 선택해 주세요.');
  if (memo.length > 100) throw new AppError('메모는 100자 이내로 입력해 주세요.');
  updateRow('예약', r._row, { 방문예정일: date, 메모: memo });
  return {};
}

function reservationCancel(data, ctx) {
  markNoShow_();
  var r = findMyReservation_(data.id, s_(ctx.staff.직원ID));
  if (effectiveStatus_(r) !== '예정') throw new AppError('예정 상태의 예약만 취소할 수 있습니다.');
  updateRow('예약', r._row, { 상태: '취소' });
  return {};
}
