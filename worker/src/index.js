// Cloudflare Worker 진입점. 모든 요청은 POST 하나로 들어와 action 이름으로 나뉜다.
// 요청·응답 형식은 Apps Script 시절과 같다:
//   요청 { action, token, deviceKey, data }  →  응답 { ok: true, data } 또는 { ok: false, error, code }
import { AppError, s } from './util.js';
import { authenticate, accountLogin, accountChangePassword, authLogout } from './auth.js';
import { publicOrgs, staffSignup, staffLogin, staffMe, staffRequestDeviceChange } from './staff.js';
import {
  adminStaffList, adminApprove, adminReject, adminUpdate, adminRetire, adminResetPin, adminApproveDevice,
  adminPayrollGet, adminPayrollReveal, adminSettings, adminSaveSettings, adminOrgs, adminSaveOrg, adminAccounts, adminSaveAccount
} from './admin.js';
import { adminCurrentQr, adminIssueQr, attendanceCheckin, adminAttendance } from './attendance.js';
import { reservationCreate, reservationList, reservationUpdate, reservationCancel } from './reservation.js';
import { deskLookup, deskSearchStaff, deskReservationList, deskRegisterVisit, deskRecall, deskTodayVisits, adminReservations, adminVisits } from './visit.js';
import { staffTelegramLink, handleTelegram } from './telegram.js';
import { leaderStaffList, leaderApprove, leaderReject, leaderRetire } from './leader.js';

// roles: 이 action 을 부를 수 있는 역할 ('public' = 로그인 불필요, 'desk' 는 관리자도 가능)
// allowMustChange: 비밀번호 변경 전에도 부를 수 있는 action
const ACTIONS = {
  'public.orgs': { roles: ['public'], fn: publicOrgs },
  'staff.signup': { roles: ['public'], fn: staffSignup },
  'staff.login': { roles: ['public'], fn: staffLogin },
  'staff.requestDeviceChange': { roles: ['public'], fn: staffRequestDeviceChange },
  'staff.me': { roles: ['staff'], fn: staffMe },
  'staff.telegramLink': { roles: ['staff'], fn: staffTelegramLink },
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
  'account.changePassword': { roles: ['desk', 'admin'], fn: accountChangePassword, allowMustChange: true },
  'auth.logout': { roles: ['staff', 'desk', 'admin'], fn: authLogout, allowMustChange: true },

  'desk.lookup': { roles: ['desk'], fn: deskLookup },
  'desk.searchStaff': { roles: ['desk'], fn: deskSearchStaff },
  'desk.reservationList': { roles: ['desk'], fn: deskReservationList },
  'desk.registerVisit': { roles: ['desk'], fn: deskRegisterVisit },
  'desk.recall': { roles: ['desk'], fn: deskRecall },
  'desk.todayVisits': { roles: ['desk'], fn: deskTodayVisits },

  'admin.staffList': { roles: ['admin'], fn: adminStaffList },
  'admin.approve': { roles: ['admin'], fn: adminApprove },
  'admin.reject': { roles: ['admin'], fn: adminReject },
  'admin.update': { roles: ['admin'], fn: adminUpdate },
  'admin.retire': { roles: ['admin'], fn: adminRetire },
  'admin.resetPin': { roles: ['admin'], fn: adminResetPin },
  'admin.approveDevice': { roles: ['admin'], fn: adminApproveDevice },
  'admin.payrollGet': { roles: ['admin'], fn: adminPayrollGet },
  'admin.payrollReveal': { roles: ['admin'], fn: adminPayrollReveal },
  'admin.currentQr': { roles: ['admin'], fn: adminCurrentQr },
  'admin.issueQr': { roles: ['admin'], fn: adminIssueQr },
  'admin.attendance': { roles: ['admin'], fn: adminAttendance },
  'admin.reservations': { roles: ['admin'], fn: adminReservations },
  'admin.visits': { roles: ['admin'], fn: adminVisits },
  'admin.settings': { roles: ['admin'], fn: adminSettings },
  'admin.saveSettings': { roles: ['admin'], fn: adminSaveSettings },
  'admin.orgs': { roles: ['admin'], fn: adminOrgs },
  'admin.saveOrg': { roles: ['admin'], fn: adminSaveOrg },
  'admin.accounts': { roles: ['admin'], fn: adminAccounts },
  'admin.saveAccount': { roles: ['admin'], fn: adminSaveAccount }
};

async function route(env, req) {
  const def = ACTIONS[s(req && req.action)];
  if (!def) throw new AppError('알 수 없는 요청입니다.');
  const ctx = await authenticate(env, req, def.roles);
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
