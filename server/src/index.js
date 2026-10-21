// Cloudflare Worker 진입점. 모든 요청은 POST 하나로 들어와 action 이름으로 나뉜다.
// 요청·응답 형식은 Apps Script 시절과 같다:
//   요청 { action, token, deviceKey, projectId, data }  →  응답 { ok: true, data } 또는 { ok: false, error, code }
import { AppError, s } from './core/util.js';
import { authenticate, accountLogin, accountMe, accountChangePassword, authLogout, accountResetRequest, accountResetConfirm } from './core/auth.js';
import { publicOrgs, deskOrgs, staffSignup, staffLogin, staffMe, staffRequestDeviceChange } from './core/staff.js';
import {
  adminStaffList, adminApprove, adminReject, adminUpdate, adminRetire, adminResetPin, adminApproveDevice, adminMoveStaff, adminMoveInfo, adminStaffSearchAll,
  adminPayrollGet, adminPayrollReveal
} from './core/people.js';
import { adminOrgs, adminSaveOrg } from './core/orgs.js';
import { adminAccounts, adminSaveAccount } from './core/accounts.js';
import { projectList, projectSave, adminSettings, adminSaveSettings } from './core/projects.js';
import { leaderStaffList, leaderApprove, leaderReject, leaderRetire } from './core/leader.js';
import { adminCurrentQr, adminIssueQr, attendanceCheckin, adminAttendance } from './attendance/attendance.js';
import { adminAdjustSave, adminAdjustDelete } from './attendance/adjust.js';
import { paySettingList, paySettingSave } from './pay/staffpay.js';
import { payRunList, payRunCreate, payRunGet, payRunRecalc, payRunReview, payRunConfirm, payRunPaid, payRunDelete, payItemSave, payTransferExport, staffMyPay } from './pay/runs.js';
import { reservationCreate, reservationList, reservationUpdate, reservationCancel } from './visit/reservation.js';
import { deskLookup, deskSearchStaff, deskReservationList, deskRegisterVisit, deskRecall, deskTodayVisits, adminReservations, adminVisits } from './visit/visit.js';
import { staffTelegramLink, handleTelegram } from './telegram/telegram.js';
import { adminDashboard, adminGuestStats, adminGuestbook } from './report/stats.js';
import { guestSubmit, deskGuestList, deskGuestSave, deskGuestDelete, deskGuestCall, deskStaffByOrg, deskGuestSuggest } from './guestbook/guestbook.js';

// roles: 이 action 을 부를 수 있는 역할
//   'public' = 로그인 불필요, 'staff' = 영업사원, 'admin' = 관리자(전체 현장), 'sub' = 보조관리자(지정 현장),
//   'contract' = 계약담당, 'viewer' = 열람, 'desk' = 데스크 (관리자·보조관리자도 가능), 'kiosk' = 방명록 태블릿
// scope: 'global' 이면 현장과 무관한 action. 그 외에는 인증 단계에서 ctx.projectId 가 정해지고, 접근 권한이 없는 현장은 거부된다
// allowMustChange: 비밀번호 변경 전에도 부를 수 있는 action
const MGR = ['admin', 'sub'];
const ACCOUNTS = ['admin', 'sub', 'contract', 'viewer', 'desk', 'kiosk'];
const ACTIONS = {
  'public.orgs': { roles: ['public'], fn: publicOrgs },
  'staff.signup': { roles: ['public'], fn: staffSignup },
  'staff.login': { roles: ['public'], fn: staffLogin },
  'staff.requestDeviceChange': { roles: ['public'], fn: staffRequestDeviceChange },
  'staff.me': { roles: ['staff'], fn: staffMe },
  'staff.telegramLink': { roles: ['staff'], fn: staffTelegramLink },
  'staff.myPay': { roles: ['staff'], fn: staffMyPay },
  'reservation.create': { roles: ['staff'], fn: reservationCreate },
  'reservation.list': { roles: ['staff'], fn: reservationList },
  'reservation.update': { roles: ['staff'], fn: reservationUpdate },
  'reservation.cancel': { roles: ['staff'], fn: reservationCancel },
  'attendance.checkin': { roles: ['staff'], fn: attendanceCheckin },

  'leader.staffList': { roles: ['staff'], fn: leaderStaffList },
  'leader.approve': { roles: ['staff'], fn: leaderApprove },
  'leader.reject': { roles: ['staff'], fn: leaderReject },
  'leader.retire': { roles: ['staff'], fn: leaderRetire },

  'account.login': { roles: ['public'], fn: accountLogin },
  'account.resetRequest': { roles: ['public'], fn: accountResetRequest },
  'account.resetConfirm': { roles: ['public'], fn: accountResetConfirm },
  'account.me': { roles: ACCOUNTS, scope: 'global', fn: accountMe, allowMustChange: true },
  'account.changePassword': { roles: ACCOUNTS, scope: 'global', fn: accountChangePassword, allowMustChange: true },
  'auth.logout': { roles: ['staff', ...ACCOUNTS], scope: 'global', fn: authLogout, allowMustChange: true },

  'project.list': { roles: ACCOUNTS, scope: 'global', fn: projectList },
  'project.save': { roles: ['admin'], scope: 'global', fn: projectSave },

  'desk.orgs': { roles: ['desk', 'kiosk'], fn: deskOrgs },
  'desk.lookup': { roles: ['desk'], fn: deskLookup },
  'desk.searchStaff': { roles: ['desk'], fn: deskSearchStaff },
  'desk.reservationList': { roles: ['desk'], fn: deskReservationList },
  'desk.guestList': { roles: ['desk'], fn: deskGuestList },
  'desk.guestSave': { roles: ['desk'], fn: deskGuestSave },
  'desk.guestDelete': { roles: ['desk'], fn: deskGuestDelete },
  'desk.guestCall': { roles: ['desk'], fn: deskGuestCall },
  'desk.guestSuggest': { roles: ['desk'], fn: deskGuestSuggest },
  'desk.staffByOrg': { roles: ['desk'], fn: deskStaffByOrg },
  'guest.submit': { roles: ['kiosk', 'desk'], fn: guestSubmit },
  'desk.registerVisit': { roles: ['desk'], fn: deskRegisterVisit },
  'desk.recall': { roles: ['desk'], fn: deskRecall },
  'desk.todayVisits': { roles: ['desk'], fn: deskTodayVisits },

  'admin.staffList': { roles: MGR, fn: adminStaffList },
  'admin.approve': { roles: MGR, fn: adminApprove },
  'admin.reject': { roles: MGR, fn: adminReject },
  'admin.update': { roles: MGR, fn: adminUpdate },
  'admin.retire': { roles: MGR, fn: adminRetire },
  'admin.resetPin': { roles: MGR, fn: adminResetPin },
  'admin.approveDevice': { roles: MGR, fn: adminApproveDevice },
  'admin.moveStaff': { roles: ['admin'], fn: adminMoveStaff },
  'admin.moveInfo': { roles: ['admin'], fn: adminMoveInfo },
  'admin.staffSearchAll': { roles: MGR, scope: 'global', fn: adminStaffSearchAll },
  'admin.payrollGet': { roles: MGR, fn: adminPayrollGet },
  'admin.payrollReveal': { roles: MGR, fn: adminPayrollReveal }, // 보조관리자는 계정에 허용된 경우만 (함수 안에서 확인)
  'admin.currentQr': { roles: MGR, fn: adminCurrentQr },
  'admin.issueQr': { roles: MGR, fn: adminIssueQr },
  'admin.attendance': { roles: MGR, fn: adminAttendance },
  'admin.adjustSave': { roles: MGR, fn: adminAdjustSave },
  'admin.adjustDelete': { roles: MGR, fn: adminAdjustDelete },

  // 용역관리(일급 정산). 확정·지급완료·이체 파일의 세부 권한은 함수 안에서 확인한다 (관리자 또는 계정별 허용)
  'pay.settingList': { roles: MGR, fn: paySettingList },
  'pay.settingSave': { roles: MGR, fn: paySettingSave },
  'pay.runList': { roles: MGR, fn: payRunList },
  'pay.runCreate': { roles: MGR, fn: payRunCreate },
  'pay.runGet': { roles: MGR, fn: payRunGet },
  'pay.runRecalc': { roles: MGR, fn: payRunRecalc },
  'pay.runReview': { roles: MGR, fn: payRunReview },
  'pay.runConfirm': { roles: MGR, fn: payRunConfirm },
  'pay.runPaid': { roles: MGR, fn: payRunPaid },
  'pay.runDelete': { roles: MGR, fn: payRunDelete },
  'pay.itemSave': { roles: MGR, fn: payItemSave },
  'pay.transferExport': { roles: MGR, fn: payTransferExport },

  'admin.reservations': { roles: MGR, fn: adminReservations },
  'admin.visits': { roles: MGR, fn: adminVisits },
  'admin.dashboard': { roles: MGR, fn: adminDashboard },
  'admin.guestStats': { roles: MGR, fn: adminGuestStats },
  'admin.guestbook': { roles: MGR, fn: adminGuestbook },
  'admin.settings': { roles: ['admin'], scope: 'global', fn: adminSettings },
  'admin.saveSettings': { roles: ['admin'], scope: 'global', fn: adminSaveSettings },
  'admin.orgs': { roles: MGR, fn: adminOrgs },
  'admin.saveOrg': { roles: MGR, fn: adminSaveOrg },
  'admin.accounts': { roles: ['admin'], scope: 'global', fn: adminAccounts },
  'admin.saveAccount': { roles: ['admin'], scope: 'global', fn: adminSaveAccount }
};

async function route(env, req) {
  const def = ACTIONS[s(req && req.action)];
  if (!def) throw new AppError('알 수 없는 요청입니다.');
  const ctx = await authenticate(env, req, def);
  if (ctx.account && ctx.account.must_change_password && !def.allowMustChange) {
    throw new AppError('비밀번호를 먼저 변경해 주세요.', 'MUST_CHANGE_PW');
  }
  return def.fn(env, req.data || {}, ctx);
}

// 허용된 화면 주소(ALLOWED_ORIGINS)에서 온 브라우저만 응답을 읽을 수 있다
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = s(env.ALLOWED_ORIGINS).split(',').map((x) => x.trim()).filter(Boolean);
  const h = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, GET, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

const json = (obj, headers, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method === 'GET') return json({ ok: true, data: '근태관리 서버가 동작 중입니다.' }, cors);
    if (request.method !== 'POST') return json({ ok: false, error: '허용되지 않는 요청입니다.' }, cors, 405);

    let req;
    try {
      const text = await request.text();
      if (text.length > 200000) throw new AppError('요청이 너무 큽니다.');
      req = JSON.parse(text);
    } catch (e) {
      return json({ ok: false, error: e instanceof AppError ? e.message : '요청 형식이 올바르지 않습니다.' }, cors);
    }

    // 텔레그램 웹훅 (주소 끝의 ?tg= 비밀값으로 확인). 실패하면 500 을 돌려 텔레그램이 다시 보내게 한다.
    if (req && req.update_id !== undefined) {
      try {
        await handleTelegram(env, req, s(new URL(request.url).searchParams.get('tg')));
        return json({ ok: true }, {});
      } catch (e) {
        console.error('telegram', e && e.stack ? e.stack : String(e));
        return json({ ok: false }, {}, 500);
      }
    }

    const t0 = Date.now();
    try {
      const data = await route(env, req);
      console.log(req.action + ' ' + (Date.now() - t0) + 'ms');
      return json({ ok: true, data }, cors);
    } catch (e) {
      if (e instanceof AppError) return json({ ok: false, error: e.message, code: e.code }, cors);
      // 내부 오류 내용은 화면에 내보내지 않고 로그에만 남긴다
      console.error(req && req.action, e && e.stack ? e.stack : String(e));
      return json({ ok: false, error: '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, cors);
    }
  }
};
