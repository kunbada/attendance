// 웹앱 진입점. 모든 요청은 doPost 하나로 들어와 action 이름으로 나뉜다.

function doGet() {
  return json_({ ok: true, data: '근태관리 서버가 동작 중입니다.' });
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    out = { ok: true, data: route_(req) };
  } catch (err) {
    if (err instanceof AppError) {
      out = { ok: false, error: err.message, code: err.code };
    } else {
      // 내부 오류 내용은 화면에 내보내지 않고 로그에만 남긴다
      console.error(err && err.stack ? err.stack : String(err));
      out = { ok: false, error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' };
    }
  }
  return json_(out);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// roles: 이 action 을 부를 수 있는 역할 ('public' = 로그인 불필요, 'desk' 는 관리자도 가능)
// write: 시트를 바꾸는 작업 → LockService 로 감싼다
// 함수로 감싼 이유: 파일 로딩 순서와 상관없이 다른 .gs 의 함수를 참조하기 위해
function actions_() {
  return {
    'public.orgs': { roles: ['public'], fn: publicOrgs },
    'staff.signup': { roles: ['public'], fn: staffSignup, write: true },
    'staff.login': { roles: ['public'], fn: staffLogin, write: true },
    'staff.requestDeviceChange': { roles: ['public'], fn: staffRequestDeviceChange, write: true },
    'staff.me': { roles: ['staff'], fn: staffMe },

    'account.login': { roles: ['public'], fn: accountLogin, write: true },
    'account.changePassword': { roles: ['desk', 'admin'], fn: accountChangePassword, write: true, allowMustChange: true },
    'auth.logout': { roles: ['staff', 'desk', 'admin'], fn: authLogout, write: true, allowMustChange: true },

    'admin.staffList': { roles: ['admin'], fn: adminStaffList },
    'admin.approve': { roles: ['admin'], fn: adminApprove, write: true },
    'admin.reject': { roles: ['admin'], fn: adminReject, write: true },
    'admin.update': { roles: ['admin'], fn: adminUpdate, write: true },
    'admin.retire': { roles: ['admin'], fn: adminRetire, write: true },
    'admin.resetPin': { roles: ['admin'], fn: adminResetPin, write: true },
    'admin.approveDevice': { roles: ['admin'], fn: adminApproveDevice, write: true },
    'admin.payrollGet': { roles: ['admin'], fn: adminPayrollGet },
    'admin.payrollReveal': { roles: ['admin'], fn: adminPayrollReveal, write: true },

    'admin.settings': { roles: ['admin'], fn: adminSettings },
    'admin.saveSettings': { roles: ['admin'], fn: adminSaveSettings, write: true },
    'admin.orgs': { roles: ['admin'], fn: adminOrgs },
    'admin.saveOrg': { roles: ['admin'], fn: adminSaveOrg, write: true },
    'admin.accounts': { roles: ['admin'], fn: adminAccounts },
    'admin.saveAccount': { roles: ['admin'], fn: adminSaveAccount, write: true }
  };
}

function route_(req) {
  var def = actions_()[s_(req && req.action)];
  if (!def) throw new AppError('알 수 없는 요청입니다.');
  var run = function () {
    var ctx = authenticate_(req, def.roles);
    if (ctx.account && s_(ctx.account.비번변경필요) === 'Y' && !def.allowMustChange) {
      throw new AppError('비밀번호를 먼저 변경해 주세요.', 'MUST_CHANGE_PW');
    }
    return def.fn(req.data || {}, ctx);
  };
  var t0 = Date.now();
  var result = def.write ? withLock(run) : run();
  // 느린 요청을 [보기 → 실행 내역]에서 찾을 수 있게 소요 시간을 남긴다
  console.log(req.action + ' ' + (Date.now() - t0) + 'ms');
  return result;
}
