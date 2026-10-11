// 로그인, 세션, 해시, 기기키 확인

var MAX_FAILS = 5;
// 직원은 매일 로그인하기 번거로우니 30일, 관리자·데스크는 공용 PC 가능성 때문에 12시간
var SESSION_LIFETIME_MS = { '직원': 30 * 24 * 3600 * 1000, '계정': 12 * 3600 * 1000 };

function hashSecret_(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, requireProp_('SALT') + value, Utilities.Charset.UTF_8);
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function checkPasswordPolicy_(pw) {
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw new AppError('비밀번호는 8자 이상, 영문과 숫자를 함께 써 주세요.');
  }
}

// ---------- 세션 ----------

function formatTime_(ms) {
  return Utilities.formatDate(new Date(ms), TZ, 'yyyy-MM-dd HH:mm:ss');
}

function createSession_(kind, userId) {
  // 만료 세션 정리는 시트를 통째로 읽어서 느리다 → 로그인 10번 중 1번만
  if (Math.random() < 0.1) purgeExpiredSessions_();
  var token = Utilities.getUuid();
  var session = { kind: kind, userId: userId, expires: formatTime_(Date.now() + SESSION_LIFETIME_MS[kind]) };
  appendRow('세션', { 토큰: token, 사용자구분: kind, 사용자ID: userId, 만료일시: session.expires });
  // CacheService 는 최대 6시간까지만 보관 → 그 뒤에는 세션 시트에서 다시 읽는다
  var ttl = Math.min(21600, Math.floor(SESSION_LIFETIME_MS[kind] / 1000));
  CacheService.getScriptCache().put('S_' + token, JSON.stringify(session), ttl);
  return token;
}

function getSession_(token) {
  token = s_(token);
  if (!/^[0-9a-f-]{36}$/.test(token)) return null;
  var raw = CacheService.getScriptCache().get('S_' + token);
  var session = raw ? JSON.parse(raw) : null;
  if (!session) {
    var row = findOne('세션', function (r) { return s_(r.토큰) === token; });
    if (row) session = { kind: s_(row.사용자구분), userId: s_(row.사용자ID), expires: s_(row.만료일시) };
  }
  if (!session || session.expires <= nowStr()) return null;
  return session;
}

function destroySessionsWhere_(pred) {
  var cache = CacheService.getScriptCache();
  var rows = filterRows('세션', pred);
  rows.forEach(function (r) { cache.remove('S_' + s_(r.토큰)); });
  deleteRows('세션', rows.map(function (r) { return r._row; }));
}

function destroySession_(token) {
  destroySessionsWhere_(function (r) { return s_(r.토큰) === token; });
}

function destroyUserSessions_(kind, userId) {
  destroySessionsWhere_(function (r) { return s_(r.사용자구분) === kind && s_(r.사용자ID) === userId; });
}

function purgeExpiredSessions_() {
  var now = nowStr();
  destroySessionsWhere_(function (r) { return s_(r.만료일시) <= now; });
}

// ---------- 요청 인증: 세션 → 역할 → (직원이면) deviceKey ----------

function authenticate_(req, roles) {
  var ctx = { role: 'public', token: s_(req.token), deviceKey: s_(req.deviceKey) };
  if (roles.indexOf('public') >= 0) return ctx;

  var session = getSession_(ctx.token);
  if (!session) throw new AppError('로그인이 필요합니다. 다시 로그인해 주세요.', 'AUTH');

  if (session.kind === '직원') {
    var staff = findOne('직원', function (r) { return s_(r.직원ID) === session.userId; });
    if (!staff || s_(staff.상태) !== '활동') throw new AppError('로그인이 필요합니다. 다시 로그인해 주세요.', 'AUTH');
    if (!ctx.deviceKey || s_(staff.기기키) !== ctx.deviceKey) {
      throw new AppError('등록된 휴대폰이 아닙니다.', 'DEVICE_MISMATCH');
    }
    ctx.role = 'staff';
    ctx.staff = staff;
  } else {
    var account = findOne('계정', function (r) { return s_(r.계정ID) === session.userId; });
    if (!account || s_(account.사용여부) === 'N') throw new AppError('로그인이 필요합니다. 다시 로그인해 주세요.', 'AUTH');
    ctx.role = s_(account.역할) === '관리자' ? 'admin' : 'desk';
    ctx.account = account;
  }

  var allowed = roles.indexOf(ctx.role) >= 0 || (ctx.role === 'admin' && roles.indexOf('desk') >= 0);
  if (!allowed) throw new AppError('권한이 없습니다.', 'FORBIDDEN');
  return ctx;
}

// ---------- 관리자·데스크 로그인 ----------

function accountLogin(data) {
  var loginId = s_(data.loginId).trim();
  var password = s_(data.password);
  var acc = findOne('계정', function (r) { return s_(r.아이디) === loginId && s_(r.사용여부) !== 'N'; });
  if (!acc) throw new AppError('아이디 또는 비밀번호가 올바르지 않습니다.');

  var fails = Number(acc.실패횟수) || 0;
  var lockedMsg = '비밀번호를 5회 잘못 입력해 잠겼습니다. 관리자에게 문의해 주세요.';
  if (fails >= MAX_FAILS) throw new AppError(lockedMsg, 'LOCKED');
  if (hashSecret_(password) !== s_(acc.비밀번호해시)) {
    fails++;
    updateRow('계정', acc._row, { 실패횟수: fails });
    if (fails >= MAX_FAILS) throw new AppError(lockedMsg, 'LOCKED');
    throw new AppError('아이디 또는 비밀번호가 올바르지 않습니다. (' + fails + '/' + MAX_FAILS + ')');
  }
  if (fails > 0) updateRow('계정', acc._row, { 실패횟수: 0 });

  return {
    token: createSession_('계정', s_(acc.계정ID)),
    account: { name: s_(acc.이름), role: s_(acc.역할), mustChangePassword: s_(acc.비번변경필요) === 'Y' }
  };
}

function accountChangePassword(data, ctx) {
  var oldPw = s_(data.oldPassword);
  var newPw = s_(data.newPassword);
  if (hashSecret_(oldPw) !== s_(ctx.account.비밀번호해시)) throw new AppError('현재 비밀번호가 올바르지 않습니다.');
  checkPasswordPolicy_(newPw);
  if (newPw === oldPw) throw new AppError('새 비밀번호가 현재 비밀번호와 같습니다.');
  updateRow('계정', ctx.account._row, { 비밀번호해시: hashSecret_(newPw), 비번변경필요: 'N' });
  writeLog_(s_(ctx.account.아이디), '비밀번호변경', s_(ctx.account.계정ID), '');
  return {};
}

function authLogout(data, ctx) {
  destroySession_(ctx.token);
  return {};
}
