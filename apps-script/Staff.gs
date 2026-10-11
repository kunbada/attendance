// 직원 가입, 로그인, 내 정보, 기기 변경 요청

var SALES_JOB = '영업'; // 이 직군만 본부→팀을 선택한다

// ---------- 공용 검사 ----------

function normalizePhone_(v) {
  var d = s_(v).replace(/\D/g, '');
  if (!/^01[016789]\d{7,8}$/.test(d)) throw new AppError('휴대폰 번호 형식이 올바르지 않습니다.');
  return d;
}

function requireDeviceKey_(ctx) {
  if (!/^[A-Za-z0-9-]{8,64}$/.test(ctx.deviceKey)) {
    throw new AppError('기기 정보를 확인할 수 없습니다. 페이지를 새로고침해 주세요.');
  }
  return ctx.deviceKey;
}

function requirePin_(v) {
  var p = s_(v);
  if (!/^\d{4}$/.test(p)) throw new AppError('PIN은 숫자 4자리입니다.');
  return p;
}

function byOrder_(a, b) {
  return (Number(a.순서) || 0) - (Number(b.순서) || 0);
}

function activeOrgs_() {
  return filterRows('조직', function (o) { return s_(o.사용여부) !== 'N'; }).sort(byOrder_);
}

// 직군·본부·팀 선택이 유효한지 확인하고 저장할 값을 돌려준다
function resolveOrg_(job, headId, teamId) {
  var orgs = activeOrgs_();
  var hasJob = orgs.some(function (o) { return o.구분 === '직군' && s_(o.이름) === job; });
  if (!hasJob) throw new AppError('직군을 선택해 주세요.');
  if (job !== SALES_JOB) return { job: job, headId: '', teamId: '' };

  var head = orgs.some(function (o) { return o.구분 === '본부' && s_(o.조직ID) === headId; });
  if (!head) throw new AppError('본부를 선택해 주세요.');
  var team = orgs.some(function (o) {
    return o.구분 === '팀' && s_(o.조직ID) === teamId && s_(o.상위조직ID) === headId;
  });
  if (!team) throw new AppError('팀을 선택해 주세요.');
  return { job: job, headId: headId, teamId: teamId };
}

// 대기·활동 직원 중 이 기기를 이미 쓰는 사람이 있는지 (1폰 1인)
function deviceInUse_(deviceKey, exceptStaffId) {
  return !!findOne('직원', function (r) {
    var st = s_(r.상태);
    return (st === '대기' || st === '활동') && s_(r.직원ID) !== exceptStaffId &&
      (s_(r.기기키) === deviceKey || s_(r.기기변경요청) === deviceKey);
  });
}

function checkPin_(row, pin) {
  var fails = Number(row.실패횟수) || 0;
  var lockedMsg = 'PIN을 5회 잘못 입력해 잠겼습니다. 관리자에게 PIN 초기화를 요청해 주세요.';
  if (fails >= MAX_FAILS) throw new AppError(lockedMsg, 'LOCKED');
  if (hashSecret_(pin) !== s_(row.PIN해시)) {
    fails++;
    updateRow('직원', row._row, { 실패횟수: fails });
    if (fails >= MAX_FAILS) throw new AppError(lockedMsg, 'LOCKED');
    throw new AppError('PIN이 올바르지 않습니다. (' + fails + '/' + MAX_FAILS + ')');
  }
  if (fails > 0) updateRow('직원', row._row, { 실패횟수: 0 });
}

function staffSelf_(row) {
  return { id: s_(row.직원ID), name: s_(row.성명), nickname: s_(row.예명), phone: s_(row.휴대폰), job: s_(row.직군), status: s_(row.상태) };
}

// ---------- action ----------

function publicOrgs() {
  var orgs = activeOrgs_();
  var pick = function (kind) {
    return orgs.filter(function (o) { return o.구분 === kind; }).map(function (o) {
      return { id: s_(o.조직ID), name: s_(o.이름), parentId: s_(o.상위조직ID) };
    });
  };
  return { siteName: getSettings_()['현장명'] || '', jobs: pick('직군'), heads: pick('본부'), teams: pick('팀'), salesJob: SALES_JOB };
}

function staffSignup(data, ctx) {
  var name = s_(data.name).trim();
  var nickname = s_(data.nickname).trim();
  if (!name || name.length > 20) throw new AppError('성명을 입력해 주세요.');
  if (nickname.length > 20) throw new AppError('예명은 20자 이내로 입력해 주세요.');
  var phone = normalizePhone_(data.phone);
  var deviceKey = requireDeviceKey_(ctx);
  var pin = requirePin_(data.pin);
  var org = resolveOrg_(s_(data.job), s_(data.headId), s_(data.teamId));

  var rrnDigits = s_(data.rrn).replace(/\D/g, '');
  if (rrnDigits.length !== 13) throw new AppError('주민등록번호 13자리를 입력해 주세요.');
  var rrn = rrnDigits.slice(0, 6) + '-' + rrnDigits.slice(6);
  var bank = s_(data.bank).trim();
  var accountNo = s_(data.accountNo).replace(/[^\d-]/g, '');
  var holder = s_(data.holder).trim();
  if (!bank) throw new AppError('은행을 선택해 주세요.');
  if (accountNo.replace(/-/g, '').length < 6 || accountNo.length > 24) throw new AppError('계좌번호를 확인해 주세요.');
  if (!holder) throw new AppError('예금주를 입력해 주세요.');
  if (data.consent !== true) throw new AppError('개인정보 수집·이용에 동의해 주세요.');

  var existing = findOne('직원', function (r) { return s_(r.휴대폰) === phone; });
  if (existing) {
    var st = s_(existing.상태);
    if (st === '대기') throw new AppError('이미 가입 신청되어 승인 대기 중인 번호입니다.');
    if (st === '활동') throw new AppError('이미 가입된 번호입니다. 로그인해 주세요.');
    if (st === '퇴사') throw new AppError('가입할 수 없는 번호입니다. 관리자에게 문의해 주세요.');
  }
  var staffId = existing ? s_(existing.직원ID) : newId_('S');
  if (deviceInUse_(deviceKey, staffId)) throw new AppError('이 휴대폰은 이미 다른 직원으로 등록되어 있습니다.');

  var now = nowStr();
  // 급여정보(시트 B)를 먼저 쓴다: 중간에 실패해도 승인 대상 직원이 생기지 않게
  var payroll = { 직원ID: staffId, 성명: name, 주민번호: rrn, 은행: bank, 계좌번호: accountNo, 예금주: holder, 동의일시: now };
  var payRow = findOne('급여정보', function (r) { return s_(r.직원ID) === staffId; });
  if (payRow) updateRow('급여정보', payRow._row, payroll); else appendRow('급여정보', payroll);

  var rec = {
    직원ID: staffId, 성명: name, 예명: nickname, 휴대폰: phone, 직군: org.job, 본부ID: org.headId, 팀ID: org.teamId,
    상태: '대기', 반려사유: '', PIN해시: hashSecret_(pin), 실패횟수: 0, 기기키: deviceKey, 기기변경요청: '',
    가입일시: now, 승인일시: ''
  };
  if (existing) updateRow('직원', existing._row, rec); else appendRow('직원', rec);
  writeLog_(name, existing ? '재가입신청' : '가입신청', staffId, '');
  return {};
}

function staffLogin(data, ctx) {
  var phone = normalizePhone_(data.phone);
  var pin = requirePin_(data.pin);
  var deviceKey = requireDeviceKey_(ctx);
  var row = findOne('직원', function (r) { return s_(r.휴대폰) === phone; });
  if (!row) throw new AppError('휴대폰 번호 또는 PIN이 올바르지 않습니다.');

  // PIN 을 먼저 확인한다: PIN 을 모르는 사람에게 상태·기기 정보를 알려주지 않기 위해
  checkPin_(row, pin);

  var status = s_(row.상태);
  if (status === '대기') throw new AppError('관리자 승인을 기다리는 중입니다. 승인 후 로그인할 수 있습니다.');
  if (status === '반려') throw new AppError('가입이 반려되었습니다. 사유: ' + s_(row.반려사유) + ' (다시 가입 신청할 수 있습니다)');
  if (status !== '활동') throw new AppError('로그인할 수 없는 계정입니다. 관리자에게 문의해 주세요.');

  if (s_(row.기기키) !== deviceKey) {
    if (s_(row.기기변경요청) === deviceKey) {
      throw new AppError('기기 변경 승인을 기다리는 중입니다. 관리자에게 승인을 요청해 주세요.', 'DEVICE_PENDING');
    }
    throw new AppError('등록된 휴대폰이 아닙니다.', 'DEVICE_MISMATCH');
  }
  return { token: createSession_('직원', s_(row.직원ID)), staff: staffSelf_(row) };
}

function staffMe(data, ctx) {
  var id = s_(ctx.staff.직원ID);
  var today = todayStr();
  var month = today.slice(0, 7);
  var mine = filterRows('근태', function (r) { return s_(r.직원ID) === id && s_(r.결과) === '성공'; });
  var todayRec = mine.filter(function (r) { return s_(r.날짜) === today; })[0];
  var days = {};
  mine.forEach(function (r) { if (s_(r.날짜).indexOf(month) === 0) days[s_(r.날짜)] = true; });
  return {
    staff: staffSelf_(ctx.staff),
    checkedInToday: !!todayRec,
    checkedInAt: todayRec ? s_(todayRec.시각) : '',
    monthDays: Object.keys(days).length,
    telegramLinked: !!s_(ctx.staff.텔레그램ID)
  };
}

function staffRequestDeviceChange(data, ctx) {
  var phone = normalizePhone_(data.phone);
  var pin = requirePin_(data.pin);
  var newKey = requireDeviceKey_(ctx);
  var row = findOne('직원', function (r) { return s_(r.휴대폰) === phone; });
  if (!row) throw new AppError('휴대폰 번호 또는 PIN이 올바르지 않습니다.');
  checkPin_(row, pin);
  if (s_(row.상태) !== '활동') throw new AppError('승인된 직원만 기기 변경을 요청할 수 있습니다.');
  if (s_(row.기기키) === newKey) throw new AppError('이미 이 휴대폰이 등록되어 있습니다. 바로 로그인해 주세요.');
  if (deviceInUse_(newKey, s_(row.직원ID))) throw new AppError('이 휴대폰은 이미 다른 직원으로 등록되어 있습니다.');

  updateRow('직원', row._row, { 기기변경요청: newKey });
  writeLog_(s_(row.성명), '기기변경요청', s_(row.직원ID), '');
  return {};
}
