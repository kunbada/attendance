// 근태: 관리자 QR 발급, 직원 출근 판정, 관리자 근태 현황
import { AppError, s, all, first, run, todayStr, timeStr, nowStr, newId, randomToken, getSettings, orgNameMap, staffBrief, writeLog } from '../core/util.js';

const numOrNull = (v) => {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// 두 좌표 사이 거리(m). 하버사인 공식
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function readPosition(data) {
  const lat = numOrNull(data.lat), lng = numOrNull(data.lng);
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new AppError('위치를 확인하지 못했습니다. 위치 권한을 허용하고 다시 시도해 주세요.');
  }
  return { lat, lng, accuracy: numOrNull(data.accuracy) || 0 };
}

// ---------- 관리자: QR ----------

const qrInfo = (r) => (r
  ? { issued: true, date: r.date, qr: r.qr, accuracy: r.accuracy_m, issuedAt: r.issued_at }
  : { issued: false });

export async function adminCurrentQr(env, data, ctx) {
  return qrInfo(await first(env, 'SELECT * FROM qr_issues WHERE project_id = ? AND date = ?', ctx.projectId, todayStr()));
}

// 관리자 현재 위치가 그날의 기준점. 같은 날 다시 발급하면 이전 QR 은 무효.
export async function adminIssueQr(env, data, ctx) {
  const pos = readPosition(data);
  const today = todayStr();
  const existed = await first(env, 'SELECT 1 FROM qr_issues WHERE project_id = ? AND date = ?', ctx.projectId, today);
  const qr = 'WN-ATT|' + today + '|' + randomToken(16);
  await run(env,
    `INSERT INTO qr_issues (project_id, date, qr, base_lat, base_lng, accuracy_m, issued_by, issued_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, date) DO UPDATE SET qr = excluded.qr, base_lat = excluded.base_lat, base_lng = excluded.base_lng,
       accuracy_m = excluded.accuracy_m, issued_by = excluded.issued_by, issued_at = excluded.issued_at`,
    ctx.projectId, today, qr, pos.lat, pos.lng, Math.round(pos.accuracy), ctx.account.id, nowStr());
  await writeLog(env, ctx.account.login_id, existed ? 'QR재발급' : 'QR발급', today, '정확도 ' + Math.round(pos.accuracy) + 'm', ctx.projectId);
  return qrInfo(await first(env, 'SELECT * FROM qr_issues WHERE project_id = ? AND date = ?', ctx.projectId, today));
}

// ---------- 직원: 출근 ----------

export async function attendanceCheckin(env, data, ctx) {
  const staff = ctx.staff;
  const today = todayStr();
  const pos = readPosition(data);
  const time = timeStr();
  const pid = ctx.projectId;
  const baseCols = [newId('T'), pid, today, staff.id, time, pos.lat, pos.lng, Math.round(pos.accuracy), ctx.deviceKey];

  // 실패해도 근태 기록에 '실패'로 남긴 뒤 화면에 사유를 보여준다
  const fail = async (reason, distance = null) => {
    await run(env,
      `INSERT INTO attendance (id, project_id, date, staff_id, time, lat, lng, accuracy_m, device_key, distance_m, result, fail_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '실패', ?)`, ...baseCols, distance, reason);
    throw new AppError(reason);
  };

  // 판정 2: 이미 출근 (중복 연타가 실패 기록으로 쌓이지 않도록 이 경우만 기록하지 않는다)
  const mine = await first(env, `SELECT time FROM attendance WHERE project_id = ? AND date = ? AND staff_id = ? AND result = '성공'`, pid, today, staff.id);
  if (mine) throw new AppError('이미 출근 처리되었습니다 (' + mine.time.slice(0, 5) + ')');

  // 판정 3: 한 휴대폰으로 다른 직원이 이미 출근
  if (await first(env, `SELECT 1 FROM attendance WHERE project_id = ? AND date = ? AND device_key = ? AND staff_id <> ? AND result = '성공'`, pid, today, ctx.deviceKey, staff.id)) {
    await fail('이 휴대폰으로 이미 다른 직원이 출근했습니다');
  }

  // 판정 4: 오늘 QR 인지
  const qr = await first(env, 'SELECT * FROM qr_issues WHERE project_id = ? AND date = ?', pid, today);
  if (!qr) await fail('오늘 출근 QR이 아직 발급되지 않았습니다');
  if (s(data.qr) !== qr.qr) await fail('오늘 QR이 아닙니다');

  // 판정 5: 현장 안인지
  const limit = Number((await getSettings(env, pid))['GPS허용거리m']) || 200;
  const dist = Math.round(distanceM(pos.lat, pos.lng, qr.base_lat, qr.base_lng));
  if (dist > limit) await fail('현장에서 ' + dist + 'm 떨어져 있습니다', dist);

  // 판정 6: 통과. 동시에 두 번 눌러도 DB 의 유일 색인이 하나만 통과시킨다
  try {
    await run(env,
      `INSERT INTO attendance (id, project_id, date, staff_id, time, lat, lng, accuracy_m, device_key, distance_m, result)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '성공')`, ...baseCols, dist);
  } catch (e) {
    if (/UNIQUE/i.test(String(e.message))) throw new AppError('이미 출근 처리되었습니다');
    throw e;
  }
  return { time: time.slice(0, 5), distance: dist };
}

// ---------- 관리자: 근태 현황 ----------

// data.date 가 있으면 일별, data.month 가 있으면 월별
export async function adminAttendance(env, data, ctx) {
  const pid = ctx.projectId;
  const names = await orgNameMap(env, pid);

  if (data.month) {
    const month = s(data.month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new AppError('월 형식이 올바르지 않습니다.');
    const rows = await all(env, `SELECT staff_id, date FROM attendance WHERE project_id = ? AND result = '성공' AND date >= ? AND date <= ?`, pid, month + '-01', month + '-31');
    const daysOf = {};
    rows.forEach((r) => { (daysOf[r.staff_id] = daysOf[r.staff_id] || new Set()).add(Number(r.date.slice(8, 10))); });
    const staff = (await all(env, 'SELECT * FROM staff WHERE project_id = ?', pid)).filter((r) => r.status === '활동' || daysOf[r.id]);
    const list = staff.map((r) => ({ ...staffBrief(r, names), days: [...(daysOf[r.id] || [])].sort((a, b) => a - b) }));
    list.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    const y = Number(month.slice(0, 4)), mo = Number(month.slice(5, 7));
    return { month, daysInMonth: new Date(y, mo, 0).getDate(), staff: list };
  }

  const date = s(data.date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError('날짜 형식이 올바르지 않습니다.');
  const rows = await all(env, 'SELECT * FROM attendance WHERE project_id = ? AND date = ? ORDER BY time', pid, date);
  const staffRows = await all(env, 'SELECT * FROM staff WHERE project_id = ?', pid);
  const byId = {};
  staffRows.forEach((r) => { byId[r.id] = r; });

  const seen = new Set();
  const present = rows.filter((r) => r.result === '성공').filter((r) => !seen.has(r.staff_id) && seen.add(r.staff_id)).map((r) => {
    const st = byId[r.staff_id];
    return {
      ...(st ? staffBrief(st, names) : { id: r.staff_id, name: '(삭제된 직원)', nickname: '', job: '', headName: '', teamName: '' }),
      time: r.time.slice(0, 5), distance: r.distance_m || 0
    };
  });
  const active = staffRows.filter((r) => r.status === '활동');
  const absent = active.filter((r) => !seen.has(r.id)).map((r) => staffBrief(r, names));
  const failures = rows.filter((r) => r.result === '실패').map((r) => ({
    time: r.time.slice(0, 5), name: byId[r.staff_id] ? byId[r.staff_id].name : '(삭제된 직원)', reason: r.fail_reason, distance: r.distance_m
  }));
  return { date, activeCount: active.length, present, absent, failures };
}
