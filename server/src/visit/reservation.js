// 방문예약: 직원이 본인 고객을 예약·조회·수정·취소 (뒤 5자리 + 중복 차단). 예약은 직원이 소속된 현장(ctx.projectId) 안에서만 의미가 있다.
import { AppError, s, all, first, run, todayStr, nowStr, newId, getSettings } from '../core/util.js';

function isRealDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function requireLast5(v) {
  const t = s(v).trim();
  if (!/^\d{5}$/.test(t)) throw new AppError('전화번호 뒤 5자리를 숫자로 입력해 주세요.');
  return t;
}

export function normGender(v) {
  const g = s(v).trim();
  if (g !== '' && g !== '남' && g !== '여') throw new AppError('성별 값이 올바르지 않습니다.');
  return g;
}

// 방문예정일이 지났는데 아직 '예정'이면 '미방문' 으로 본다
export function effectiveStatus(r) {
  return r.status === '예정' && r.visit_date < todayStr() ? '미방문' : r.status;
}

// 지난 '예정' 건을 DB 에서도 '미방문'으로 바꾼다 (쓰기 action 마다 가볍게 실행)
async function markNoShow(env, projectId) {
  await run(env, `UPDATE reservations SET status = '미방문' WHERE project_id = ? AND status = '예정' AND visit_date < ?`, projectId, todayStr());
}

const mdLabel = (date) => Number(date.slice(5, 7)) + '/' + Number(date.slice(8, 10));

const view = (r) => ({ id: r.id, last5: r.last5, gender: r.gender, date: r.visit_date, memo: r.memo, status: effectiveStatus(r) });

async function findMyReservation(env, id, ctx) {
  const r = await first(env, 'SELECT * FROM reservations WHERE id = ? AND project_id = ?', s(id), ctx.projectId);
  if (!r || r.staff_id !== ctx.staff.id) throw new AppError('예약을 찾을 수 없습니다.'); // 남의 예약 존재 여부도 알려주지 않는다
  return r;
}

export async function reservationCreate(env, data, ctx) {
  const pid = ctx.projectId;
  await markNoShow(env, pid);
  const staffId = ctx.staff.id;
  const last5 = requireLast5(data.last5);
  const gender = normGender(data.gender);
  const date = s(data.date);
  const memo = s(data.memo).trim();
  const byGender = (await getSettings(env, pid))['예약중복기준'] === '뒤5자리+성별';
  if (!isRealDate(date)) throw new AppError('방문 예정일을 선택해 주세요.');
  if (date < todayStr()) throw new AppError('방문 예정일은 오늘 이후여야 합니다.');
  if (byGender && !gender) throw new AppError('성별을 선택해 주세요.');
  if (memo.length > 100) throw new AppError('메모는 100자 이내로 입력해 주세요.');

  // 중복 확인과 저장을 한 문장으로 처리해서, 두 직원이 동시에 등록해도 하나만 들어간다 (중복은 같은 현장 안에서만 따진다)
  const id = newId('R');
  const today = todayStr();
  const genderCond = byGender ? 'AND gender = ?' : '';
  const params = [id, pid, last5, gender, date, staffId, memo, nowStr(), pid, last5, today];
  if (byGender) params.push(gender);
  const res = await run(env,
    `INSERT INTO reservations (id, project_id, last5, gender, visit_date, staff_id, memo, status, created_at)
     SELECT ?, ?, ?, ?, ?, ?, ?, '예정', ?
     WHERE NOT EXISTS (SELECT 1 FROM reservations WHERE project_id = ? AND last5 = ? AND status = '예정' AND visit_date >= ? ${genderCond})`, ...params);
  if (res.meta.changes === 0) {
    const dup = await first(env,
      `SELECT staff_id, visit_date FROM reservations WHERE project_id = ? AND last5 = ? AND status = '예정' AND visit_date >= ? ${genderCond} LIMIT 1`,
      ...(byGender ? [pid, last5, today, gender] : [pid, last5, today]));
    if (dup && dup.staff_id === staffId) throw new AppError('이미 내 예약이 있습니다 (' + mdLabel(dup.visit_date) + ')');
    throw new AppError('이미 예약된 고객입니다.'); // 다른 직원 이름·날짜는 알려주지 않는다
  }
  return { id };
}

export async function reservationList(env, data, ctx) {
  const tab = s(data.tab) || '예정';
  const want = { '예정': ['예정'], '방문완료': ['방문'], '미방문·취소': ['미방문', '취소'] }[tab];
  if (!want) throw new AppError('구분이 올바르지 않습니다.');
  const rows = (await all(env, 'SELECT * FROM reservations WHERE project_id = ? AND staff_id = ? ORDER BY visit_date', ctx.projectId, ctx.staff.id))
    .filter((r) => want.includes(effectiveStatus(r))).map(view);
  rows.sort((a, b) => (tab === '예정' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)));
  return { reservations: rows };
}

export async function reservationUpdate(env, data, ctx) {
  await markNoShow(env, ctx.projectId);
  const r = await findMyReservation(env, data.id, ctx);
  if (effectiveStatus(r) !== '예정') throw new AppError('예정 상태의 예약만 수정할 수 있습니다.');
  const date = s(data.date);
  const memo = s(data.memo).trim();
  if (!isRealDate(date) || date < todayStr()) throw new AppError('방문 예정일은 오늘 이후로 선택해 주세요.');
  if (memo.length > 100) throw new AppError('메모는 100자 이내로 입력해 주세요.');
  await run(env, 'UPDATE reservations SET visit_date = ?, memo = ? WHERE id = ? AND project_id = ?', date, memo, r.id, ctx.projectId);
  return {};
}

export async function reservationCancel(env, data, ctx) {
  await markNoShow(env, ctx.projectId);
  const r = await findMyReservation(env, data.id, ctx);
  if (effectiveStatus(r) !== '예정') throw new AppError('예정 상태의 예약만 취소할 수 있습니다.');
  await run(env, `UPDATE reservations SET status = '취소' WHERE id = ? AND project_id = ?`, r.id, ctx.projectId);
  return {};
}
