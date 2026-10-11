// 관리자 전용 action: 직원 관리, 급여정보, 설정(조직·계정 포함)
// 근태 현황은 Attendance.gs, 대시보드는 4단계에서 추가.

function adminName_(ctx) {
  return s_(ctx.account.아이디);
}

function findStaffOrThrow_(id) {
  var row = findOne('직원', function (r) { return s_(r.직원ID) === s_(id); });
  if (!row) throw new AppError('직원을 찾을 수 없습니다.');
  return row;
}

// ---------- 직원 ----------

function adminStaffList() {
  var orgName = {};
  readAll('조직').forEach(function (o) { orgName[s_(o.조직ID)] = s_(o.이름); });
  var list = readAll('직원').map(function (r) {
    return {
      id: s_(r.직원ID), name: s_(r.성명), nickname: s_(r.예명), phone: s_(r.휴대폰), job: s_(r.직군),
      headId: s_(r.본부ID), headName: orgName[s_(r.본부ID)] || '', teamId: s_(r.팀ID), teamName: orgName[s_(r.팀ID)] || '',
      status: s_(r.상태), rejectReason: s_(r.반려사유), joinedAt: s_(r.가입일시), approvedAt: s_(r.승인일시),
      deviceChangePending: !!s_(r.기기변경요청), telegramLinked: !!s_(r.텔레그램ID),
      locked: (Number(r.실패횟수) || 0) >= MAX_FAILS
    };
  });
  return { staff: list };
}

function adminApprove(data, ctx) {
  var row = findStaffOrThrow_(data.staffId);
  if (s_(row.상태) !== '대기') throw new AppError('승인 대기 중인 직원이 아닙니다.');
  updateRow('직원', row._row, { 상태: '활동', 반려사유: '', 승인일시: nowStr() });
  writeLog_(adminName_(ctx), '직원승인', s_(row.직원ID), s_(row.성명));
  return {};
}

function adminReject(data, ctx) {
  var row = findStaffOrThrow_(data.staffId);
  if (s_(row.상태) !== '대기') throw new AppError('승인 대기 중인 직원이 아닙니다.');
  var reason = s_(data.reason).trim();
  if (!reason) throw new AppError('반려 사유를 입력해 주세요.');
  updateRow('직원', row._row, { 상태: '반려', 반려사유: reason });
  writeLog_(adminName_(ctx), '직원반려', s_(row.직원ID), s_(row.성명) + ' / ' + reason);
  return {};
}

function adminUpdate(data, ctx) {
  var row = findStaffOrThrow_(data.staffId);
  var name = s_(data.name).trim();
  var nickname = s_(data.nickname).trim();
  if (!name || name.length > 20) throw new AppError('성명을 입력해 주세요.');
  if (nickname.length > 20) throw new AppError('예명은 20자 이내로 입력해 주세요.');
  var phone = normalizePhone_(data.phone);
  var dup = findOne('직원', function (r) { return s_(r.휴대폰) === phone && s_(r.직원ID) !== s_(row.직원ID); });
  if (dup) throw new AppError('같은 휴대폰 번호의 직원이 이미 있습니다.');
  var org = resolveOrg_(s_(data.job), s_(data.headId), s_(data.teamId));

  updateRow('직원', row._row, { 성명: name, 예명: nickname, 휴대폰: phone, 직군: org.job, 본부ID: org.headId, 팀ID: org.teamId });
  writeLog_(adminName_(ctx), '직원수정', s_(row.직원ID), name);
  return {};
}

function adminRetire(data, ctx) {
  var row = findStaffOrThrow_(data.staffId);
  if (s_(row.상태) === '퇴사') throw new AppError('이미 퇴사 처리된 직원입니다.');
  updateRow('직원', row._row, { 상태: '퇴사', 기기변경요청: '' });
  destroyUserSessions_('직원', s_(row.직원ID));
  writeLog_(adminName_(ctx), '직원퇴사', s_(row.직원ID), s_(row.성명));
  return {};
}

// 새 PIN 을 무작위로 만들어 한 번만 보여준다 (관리자가 직원에게 전달)
function adminResetPin(data, ctx) {
  var row = findStaffOrThrow_(data.staffId);
  if (s_(row.상태) === '퇴사') throw new AppError('퇴사한 직원입니다.');
  var pin = ('0000' + Math.floor(Math.random() * 10000)).slice(-4);
  updateRow('직원', row._row, { PIN해시: hashSecret_(pin), 실패횟수: 0 });
  destroyUserSessions_('직원', s_(row.직원ID));
  writeLog_(adminName_(ctx), 'PIN초기화', s_(row.직원ID), s_(row.성명));
  return { pin: pin };
}

function adminApproveDevice(data, ctx) {
  var row = findStaffOrThrow_(data.staffId);
  var newKey = s_(row.기기변경요청);
  if (!newKey) throw new AppError('기기 변경 요청이 없습니다.');
  if (deviceInUse_(newKey, s_(row.직원ID))) {
    throw new AppError('새 휴대폰이 이미 다른 직원에게 등록되어 있어 승인할 수 없습니다.');
  }
  updateRow('직원', row._row, { 기기키: newKey, 기기변경요청: '' });
  destroyUserSessions_('직원', s_(row.직원ID)); // 이전 폰의 로그인 해제
  writeLog_(adminName_(ctx), '기기변경승인', s_(row.직원ID), s_(row.성명));
  return {};
}

// ---------- 급여정보 (시트 B) ----------

function findPayroll_(staffId) {
  var p = findOne('급여정보', function (r) { return s_(r.직원ID) === s_(staffId); });
  if (!p) throw new AppError('급여정보가 없습니다.');
  return p;
}

function maskRrn_(rrn) {
  return rrn.length >= 8 ? rrn.slice(0, 8) + '******' : '******';
}

function maskAccount_(no) {
  var d = no.replace(/\D/g, '');
  return '******' + d.slice(-4);
}

function adminPayrollGet(data) {
  var p = findPayroll_(data.staffId);
  return {
    name: s_(p.성명), rrn: maskRrn_(s_(p.주민번호)), bank: s_(p.은행), accountNo: maskAccount_(s_(p.계좌번호)),
    holder: s_(p.예금주), consentAt: s_(p.동의일시)
  };
}

function adminPayrollReveal(data, ctx) {
  var p = findPayroll_(data.staffId);
  writeLog_(adminName_(ctx), '급여정보열람', s_(p.직원ID), s_(p.성명));
  return { rrn: s_(p.주민번호), accountNo: s_(p.계좌번호) };
}

// ---------- 설정 ----------

var SETTING_RULES_ = {
  '현장명': function (v) {
    if (v.length > 40) throw new AppError('현장명은 40자 이내로 입력해 주세요.');
    return v;
  },
  'GPS허용거리m': function (v) {
    var n = Number(v);
    if (!isFinite(n) || n < 10 || n > 5000 || Math.floor(n) !== n) throw new AppError('GPS 허용거리는 10~5000 사이 정수(m)로 입력해 주세요.');
    return String(n);
  },
  '예약중복기준': function (v) {
    if (v !== '뒤5자리' && v !== '뒤5자리+성별') throw new AppError('예약 중복 기준 값이 올바르지 않습니다.');
    return v;
  },
  '출근셀카사용': function (v) {
    if (v !== 'Y' && v !== 'N') throw new AppError('출근 셀카 사용 값이 올바르지 않습니다.');
    return v;
  },
  '텔레그램봇이름': function (v) {
    v = v.replace(/^@/, '');
    if (!/^[A-Za-z0-9_]{0,64}$/.test(v)) throw new AppError('텔레그램 봇 이름은 영문·숫자·밑줄만 쓸 수 있습니다.');
    return v;
  }
};

function adminSettings() {
  return { settings: getSettings_() };
}

function adminSaveSettings(data, ctx) {
  var values = data.values || {};
  var clean = {};
  Object.keys(values).forEach(function (k) {
    if (!SETTING_RULES_[k]) throw new AppError('알 수 없는 설정 항목입니다: ' + k);
    clean[k] = SETTING_RULES_[k](s_(values[k]).trim());
  });
  var rows = readAll('설정');
  Object.keys(clean).forEach(function (k) {
    var row = rows.filter(function (r) { return s_(r.항목) === k; })[0];
    if (row) updateRow('설정', row._row, { 값: clean[k] });
    else appendRow('설정', { 항목: k, 값: clean[k] });
  });
  writeLog_(adminName_(ctx), '설정변경', '', Object.keys(clean).join(', '));
  return {};
}

// ---------- 조직 (본부·팀·직군) ----------

function adminOrgs() {
  return {
    orgs: readAll('조직').sort(byOrder_).map(function (o) {
      return { id: s_(o.조직ID), kind: s_(o.구분), name: s_(o.이름), parentId: s_(o.상위조직ID), order: Number(o.순서) || 0, active: s_(o.사용여부) !== 'N' };
    })
  };
}

function adminSaveOrg(data, ctx) {
  var kind = s_(data.kind);
  var name = s_(data.name).trim();
  var parentId = s_(data.parentId);
  var order = Number(data.order) || 0;
  var active = data.active === false ? 'N' : 'Y';
  if (['본부', '팀', '직군'].indexOf(kind) < 0) throw new AppError('구분이 올바르지 않습니다.');
  if (!name || name.length > 30) throw new AppError('이름을 입력해 주세요. (30자 이내)');

  var all = readAll('조직');
  if (kind === '팀') {
    var parent = all.filter(function (o) { return o.구분 === '본부' && s_(o.조직ID) === parentId; })[0];
    if (!parent) throw new AppError('팀은 소속 본부를 선택해야 합니다.');
  } else {
    parentId = '';
  }
  var id = s_(data.id);
  var current = id ? all.filter(function (o) { return s_(o.조직ID) === id; })[0] : null;
  if (id && !current) throw new AppError('조직을 찾을 수 없습니다.');
  if (current && s_(current.구분) !== kind) throw new AppError('구분은 바꿀 수 없습니다.');

  var dup = all.some(function (o) {
    return o.구분 === kind && s_(o.이름) === name && s_(o.상위조직ID) === parentId && s_(o.조직ID) !== id;
  });
  if (dup) throw new AppError('같은 이름이 이미 있습니다.');

  // '영업' 직군은 가입 화면의 본부→팀 선택 규칙이 이 이름에 걸려 있다
  if (current && kind === '직군' && s_(current.이름) === SALES_JOB && (name !== SALES_JOB || active === 'N')) {
    throw new AppError('"' + SALES_JOB + '" 직군은 이름을 바꾸거나 사용 중지할 수 없습니다.');
  }

  var rec = { 구분: kind, 이름: name, 상위조직ID: parentId, 순서: order, 사용여부: active };
  if (current) {
    updateRow('조직', current._row, rec);
    if (kind === '직군' && s_(current.이름) !== name) {
      // 직원 시트에는 직군 이름이 그대로 저장되어 있으므로 함께 바꾼다
      filterRows('직원', function (r) { return s_(r.직군) === s_(current.이름); }).forEach(function (r) {
        updateRow('직원', r._row, { 직군: name });
      });
    }
    writeLog_(adminName_(ctx), '조직수정', id, kind + ' ' + name);
  } else {
    id = newId_('O');
    appendRow('조직', Object.assign({ 조직ID: id }, rec));
    writeLog_(adminName_(ctx), '조직추가', id, kind + ' ' + name);
  }
  return { id: id };
}

// ---------- 데스크·관리자 계정 ----------

function adminAccounts() {
  return {
    accounts: readAll('계정').map(function (a) {
      return {
        id: s_(a.계정ID), loginId: s_(a.아이디), name: s_(a.이름), role: s_(a.역할),
        active: s_(a.사용여부) !== 'N', locked: (Number(a.실패횟수) || 0) >= MAX_FAILS, mustChange: s_(a.비번변경필요) === 'Y'
      };
    })
  };
}

// password 를 주면 새 비밀번호로 바뀌고(첫 로그인 때 변경 강제) 잠김도 풀린다
function adminSaveAccount(data, ctx) {
  var loginId = s_(data.loginId).trim();
  var name = s_(data.name).trim();
  var role = s_(data.role);
  var password = s_(data.password);
  var active = data.active === false ? 'N' : 'Y';
  if (!/^[A-Za-z0-9_.-]{3,20}$/.test(loginId)) throw new AppError('아이디는 영문·숫자·_ . - 3~20자로 입력해 주세요.');
  if (!name) throw new AppError('이름을 입력해 주세요.');
  if (role !== '관리자' && role !== '데스크') throw new AppError('역할이 올바르지 않습니다.');

  var id = s_(data.id);
  var current = id ? findOne('계정', function (a) { return s_(a.계정ID) === id; }) : null;
  if (id && !current) throw new AppError('계정을 찾을 수 없습니다.');
  if (findOne('계정', function (a) { return s_(a.아이디) === loginId && s_(a.계정ID) !== id; })) {
    throw new AppError('이미 사용 중인 아이디입니다.');
  }
  // 자기 자신을 잠그면 아무도 관리자 화면에 못 들어간다
  if (current && s_(current.계정ID) === s_(ctx.account.계정ID) && (active === 'N' || role !== '관리자')) {
    throw new AppError('본인 계정은 사용 중지하거나 역할을 바꿀 수 없습니다.');
  }

  var rec = { 아이디: loginId, 이름: name, 역할: role, 사용여부: active };
  if (password) {
    checkPasswordPolicy_(password);
    rec.비밀번호해시 = hashSecret_(password);
    rec.비번변경필요 = 'Y';
    rec.실패횟수 = 0;
  } else if (!current) {
    throw new AppError('새 계정은 비밀번호가 필요합니다.');
  }

  if (current) {
    updateRow('계정', current._row, rec);
    if (password || active === 'N') destroyUserSessions_('계정', id);
    writeLog_(adminName_(ctx), '계정수정', id, loginId);
  } else {
    id = newId_('A');
    appendRow('계정', Object.assign({ 계정ID: id }, rec));
    writeLog_(adminName_(ctx), '계정추가', id, loginId);
  }
  return { id: id };
}
