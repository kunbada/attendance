// 조직(직군·본부·팀) 관리. 조직은 현장마다 따로 둔다.
import { AppError, s, all, first, run, newId, writeLog } from './util.js';
import { SALES_JOB } from './staff.js';

export const DEFAULT_JOBS = ['영업', '홍보단', '상담사', '도우미', '아르바이트'];

export async function adminOrgs(env, data, ctx) {
  const rows = await all(env, 'SELECT * FROM orgs WHERE project_id = ? ORDER BY sort_order, rowid', ctx.projectId);
  return { orgs: rows.map((o) => ({ id: o.id, kind: o.kind, name: o.name, parentId: o.parent_id, order: o.sort_order, active: !!o.active })) };
}

export async function adminSaveOrg(env, data, ctx) {
  const pid = ctx.projectId;
  const kind = s(data.kind);
  const name = s(data.name).trim();
  let parentId = s(data.parentId);
  const order = Number(data.order) || 0;
  const active = data.active === false ? 0 : 1;
  if (!['본부', '팀', '직군'].includes(kind)) throw new AppError('구분이 올바르지 않습니다.');
  if (!name || name.length > 30) throw new AppError('이름을 입력해 주세요. (30자 이내)');

  if (kind === '팀') {
    if (!(await first(env, `SELECT 1 FROM orgs WHERE kind = '본부' AND id = ? AND project_id = ?`, parentId, pid))) throw new AppError('팀은 소속 본부를 선택해야 합니다.');
  } else {
    parentId = '';
  }
  let id = s(data.id);
  const current = id ? await first(env, 'SELECT * FROM orgs WHERE id = ? AND project_id = ?', id, pid) : null;
  if (id && !current) throw new AppError('조직을 찾을 수 없습니다.');
  if (current && current.kind !== kind) throw new AppError('구분은 바꿀 수 없습니다.');
  if (await first(env, 'SELECT 1 FROM orgs WHERE project_id = ? AND kind = ? AND name = ? AND parent_id = ? AND id <> ?', pid, kind, name, parentId, id)) {
    throw new AppError('같은 이름이 이미 있습니다.');
  }
  // '영업' 직군은 가입 화면의 본부→팀 선택 규칙이 이 이름에 걸려 있다
  if (current && kind === '직군' && current.name === SALES_JOB && (name !== SALES_JOB || !active)) {
    throw new AppError('"' + SALES_JOB + '" 직군은 이름을 바꾸거나 사용 중지할 수 없습니다.');
  }

  const who = ctx.account.login_id;
  if (current) {
    await run(env, 'UPDATE orgs SET name = ?, parent_id = ?, sort_order = ?, active = ? WHERE id = ? AND project_id = ?', name, parentId, order, active, id, pid);
    // 직원에는 직군 이름이 그대로 저장되어 있으므로 함께 바꾼다
    if (kind === '직군' && current.name !== name) await run(env, 'UPDATE staff SET job = ? WHERE job = ? AND project_id = ?', name, current.name, pid);
    await writeLog(env, who, '조직수정', id, kind + ' ' + name, pid);
  } else {
    id = newId('O');
    await run(env, 'INSERT INTO orgs (id, project_id, kind, name, parent_id, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?)', id, pid, kind, name, parentId, order, active);
    await writeLog(env, who, '조직추가', id, kind + ' ' + name, pid);
  }
  return { id };
}
