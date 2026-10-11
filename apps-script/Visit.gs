// 방문 접수·호출·현황 (안내데스크용)

var UNCONFIRMED_MIN = 3; // 호출 후 이 시간이 지나도 확인이 없으면 화면에서 빨간색

function parseKst_(str) {
  return new Date(s_(str).replace(' ', 'T') + '+09:00');
}

function formatPhone_(d) {
  d = s_(d);
  return d.length === 11 ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7) : d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
}

// 데스크 화면에 보여줄 직원 요약. 텔레그램 미연결이면 직접 연락하도록 휴대폰 번호를 함께 준다.
function deskStaffView_(s, names) {
  var linked = !!s_(s.텔레그램ID);
  return {
    id: s_(s.직원ID), name: s_(s.성명), nickname: s_(s.예명), job: s_(s.직군),
    headName: names[s_(s.본부ID)] || '', teamName: names[s_(s.팀ID)] || '',
    telegramLinked: linked, phone: linked ? '' : formatPhone_(s.휴대폰)
  };
}

function deskLookup(data) {
  var last5 = requireLast5_(data.last5);
  var gender = normGender_(data.gender);
  var today = todayStr();
  var names = orgNameMap_();
  var staffById = {};
  readAll('직원').forEach(function (s) { staffById[s_(s.직원ID)] = s; });
  var list = filterRows('예약', function (r) {
    var st = s_(r.상태);
    return s_(r.뒤5자리) === last5 && s_(r.방문예정일) === today && (st === '예정' || st === '방문') &&
      (!gender || !s_(r.성별) || s_(r.성별) === gender);
  }).map(function (r) {
    var s = staffById[s_(r.직원ID)];
    return { id: s_(r.예약ID), last5: last5, gender: s_(r.성별), status: s_(r.상태), staff: s ? deskStaffView_(s, names) : null, staffActive: !!s && s_(s.상태) === '활동' };
  });
  return { reservations: list };
}

function deskSearchStaff(data) {
  var q = s_(data.q).trim().toLowerCase();
  if (!q) return { staff: [] };
  var names = orgNameMap_();
  var list = filterRows('직원', function (s) {
    return s_(s.상태) === '활동' && (s_(s.성명).toLowerCase().indexOf(q) >= 0 || s_(s.예명).toLowerCase().indexOf(q) >= 0);
  }).slice(0, 20).map(function (s) { return deskStaffView_(s, names); });
  return { staff: list };
}

function deskRegisterVisit(data, ctx) {
  var last5 = requireLast5_(data.last5);
  var gender = normGender_(data.gender);
  var kind = s_(data.kind);
  var staff = null;
  var reservation = null;

  if (kind === '예약') {
    reservation = findOne('예약', function (r) { return s_(r.예약ID) === s_(data.reservationId); });
    if (!reservation || s_(reservation.방문예정일) !== todayStr()) throw new AppError('오늘 예약을 찾을 수 없습니다.');
    if (s_(reservation.상태) !== '예정') throw new AppError('이미 방문 처리된 예약입니다. 다시 부르려면 아래 방문 목록의 [재호출]을 누르세요.');
    staff = findOne('직원', function (s) { return s_(s.직원ID) === s_(reservation.직원ID); });
    last5 = s_(reservation.뒤5자리);
    gender = s_(reservation.성별);
  } else if (kind === '지명') {
    staff = findOne('직원', function (s) { return s_(s.직원ID) === s_(data.staffId); });
  } else if (kind !== '담당없음') {
    throw new AppError('방문 구분이 올바르지 않습니다.');
  }
  if (kind !== '담당없음' && (!staff || s_(staff.상태) !== '활동')) {
    throw new AppError('담당 직원이 활동 중이 아닙니다. [담당 없음으로 기록]을 사용해 주세요.');
  }

  var visitId = newId_('V');
  var now = nowStr();
  var called = staff ? sendCallMessage_(staff, visitId, last5, gender) : false;
  appendRow('방문', {
    방문ID: visitId, 방문일시: now, 뒤5자리: last5, 성별: gender, 예약ID: reservation ? s_(reservation.예약ID) : '',
    담당직원ID: staff ? s_(staff.직원ID) : '', 구분: kind, 호출일시: called ? now : '', 확인일시: '', 데스크계정ID: s_(ctx.account.계정ID)
  });
  if (reservation) updateRow('예약', reservation._row, { 상태: '방문' });

  var linked = !!staff && !!s_(staff.텔레그램ID);
  return {
    visitId: visitId, kind: kind, called: called,
    staffName: staff ? s_(staff.성명) : '',
    // 연결 안 됐거나 발송 실패 → 데스크가 직접 연락할 수 있게 번호를 돌려준다
    phone: staff && !called ? formatPhone_(staff.휴대폰) : '',
    notLinked: !!staff && !linked
  };
}

function deskRecall(data) {
  var visit = findOne('방문', function (r) { return s_(r.방문ID) === s_(data.visitId); });
  if (!visit) throw new AppError('방문 기록을 찾을 수 없습니다.');
  var staff = findOne('직원', function (s) { return s_(s.직원ID) === s_(visit.담당직원ID); });
  if (!staff) throw new AppError('담당 직원이 없는 방문입니다.');
  if (s_(visit.확인일시)) throw new AppError('이미 확인된 호출입니다.');
  if (!s_(staff.텔레그램ID)) throw new AppError('텔레그램이 연결되지 않은 직원입니다. 전화로 연락해 주세요: ' + formatPhone_(staff.휴대폰));
  if (!sendCallMessage_(staff, s_(visit.방문ID), s_(visit.뒤5자리), s_(visit.성별))) {
    throw new AppError('호출을 보내지 못했습니다. 전화로 연락해 주세요: ' + formatPhone_(staff.휴대폰));
  }
  updateRow('방문', visit._row, { 호출일시: nowStr() });
  return {};
}

function visitStatus_(v, staff) {
  if (!staff) return '담당없음';
  if (s_(v.확인일시)) return '확인함';
  if (!s_(v.호출일시)) return '미호출';
  return (Date.now() - parseKst_(v.호출일시).getTime()) / 60000 >= UNCONFIRMED_MIN ? '미확인' : '호출함';
}

function deskTodayVisits() {
  var today = todayStr();
  var staffById = {};
  readAll('직원').forEach(function (s) { staffById[s_(s.직원ID)] = s; });
  var list = filterRows('방문', function (v) { return s_(v.방문일시).slice(0, 10) === today; })
    .sort(function (a, b) { return s_(b.방문일시).localeCompare(s_(a.방문일시)); })
    .map(function (v) {
      var s = staffById[s_(v.담당직원ID)] || null;
      var status = visitStatus_(v, s);
      return {
        id: s_(v.방문ID), time: hhmm_(v.방문일시), last5: s_(v.뒤5자리), gender: s_(v.성별), kind: s_(v.구분),
        staffName: s ? s_(s.성명) + (s_(s.예명) ? ' (' + s_(s.예명) + ')' : '') : '',
        status: status, ackedAt: hhmm_(v.확인일시),
        phone: s && (status === '미호출') ? formatPhone_(s.휴대폰) : ''
      };
    });
  return { visits: list, now: nowStr() };
}

// ---------- 관리자: 예약·방문 현황 ----------

function inRange_(date, data) {
  var from = s_(data.from), to = s_(data.to);
  return (!from || date >= from) && (!to || date <= to);
}

function matchOrg_(staff, data) {
  if (s_(data.staffId) && s_(staff && staff.직원ID) !== s_(data.staffId)) return false;
  if (s_(data.headId) && s_(staff && staff.본부ID) !== s_(data.headId)) return false;
  if (s_(data.teamId) && s_(staff && staff.팀ID) !== s_(data.teamId)) return false;
  return true;
}

function adminReservations(data) {
  var staffById = {};
  readAll('직원').forEach(function (s) { staffById[s_(s.직원ID)] = s; });
  var names = orgNameMap_();
  var rows = filterRows('예약', function (r) {
    return inRange_(s_(r.방문예정일), data) && matchOrg_(staffById[s_(r.직원ID)], data);
  }).sort(function (a, b) { return s_(b.방문예정일).localeCompare(s_(a.방문예정일)); }).slice(0, 3000)
    .map(function (r) {
      var s = staffById[s_(r.직원ID)];
      return {
        date: s_(r.방문예정일), last5: s_(r.뒤5자리), gender: s_(r.성별), staff: s ? staffBrief_(s, names) : null,
        memo: s_(r.메모), status: effectiveStatus_(r), createdAt: s_(r.등록일시)
      };
    });
  return { reservations: rows };
}

function adminVisits(data) {
  var staffById = {};
  readAll('직원').forEach(function (s) { staffById[s_(s.직원ID)] = s; });
  var names = orgNameMap_();
  var rows = filterRows('방문', function (v) {
    var s = staffById[s_(v.담당직원ID)];
    if (!s && (s_(data.staffId) || s_(data.headId) || s_(data.teamId))) return false;
    return inRange_(s_(v.방문일시).slice(0, 10), data) && (!s || matchOrg_(s, data));
  }).sort(function (a, b) { return s_(b.방문일시).localeCompare(s_(a.방문일시)); }).slice(0, 3000)
    .map(function (v) {
      var s = staffById[s_(v.담당직원ID)];
      return {
        at: s_(v.방문일시), last5: s_(v.뒤5자리), gender: s_(v.성별), kind: s_(v.구분), staff: s ? staffBrief_(s, names) : null,
        calledAt: s_(v.호출일시), ackedAt: s_(v.확인일시)
      };
    });
  return { visits: rows };
}
