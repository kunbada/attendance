// 문항 은행: 직접 만든 문항을 저장해 두고 다른 설문에서 다시 쓴다 (회사 전체 공유, 설문 관리 권한).
// 은행 문항의 key 는 설문에 그대로 들어가므로, 설문이 달라도 같은 문항끼리 묶어 집계할 수 있다.
import { AppError, s, all, first, run, nowStr, newId, randomToken, writeLog } from '../core/util.js';
import { CUSTOM_TYPES, CHOICE_TYPES } from './std.js';
import { buildOptions } from './survey.js';

const KEY_RE = /^Q[A-Z0-9]{4,10}$/;
const view = (r) => ({ id: r.id, key: r.key, type: r.type, title: r.title, options: JSON.parse(r.options_json || '[]'), required: !!r.required, createdBy: r.created_by, updatedAt: r.updated_at });

export async function surveyQbankList(env) {
  return { questions: (await all(env, 'SELECT * FROM question_bank ORDER BY title')).map(view) };
}

// 새로 저장하거나(id 없음) 고친다. 설문에서 쓰던 문항을 저장할 때는 그 key 를 그대로 쓴다(이미 받은 응답과 이어지게)
export async function surveyQbankSave(env, data, ctx) {
  const type = s(data.type);
  if (!CUSTOM_TYPES.includes(type)) throw new AppError('문항 종류가 올바르지 않습니다.');
  const title = s(data.title).trim().slice(0, 150);
  if (!title) throw new AppError('문항 제목을 입력해 주세요.');
  const options = CHOICE_TYPES.includes(type) ? buildOptions(data.options) : [];
  if (CHOICE_TYPES.includes(type) && !options.length) throw new AppError('선택형 문항은 보기를 1개 이상 입력해 주세요.');
  const now = nowStr(), who = ctx.account.login_id;
  const id = s(data.id);
  if (id) {
    const cur = await first(env, 'SELECT * FROM question_bank WHERE id = ?', id);
    if (!cur) throw new AppError('문항 은행에서 찾을 수 없습니다.');
    await run(env, 'UPDATE question_bank SET type = ?, title = ?, options_json = ?, required = ?, updated_at = ? WHERE id = ?', type, title, JSON.stringify(options), data.required ? 1 : 0, now, id);
    await writeLog(env, who, '문항은행수정', id, title);
    return view(await first(env, 'SELECT * FROM question_bank WHERE id = ?', id));
  }
  let key = s(data.key).toUpperCase();
  if (KEY_RE.test(key)) {
    const dup = await first(env, 'SELECT id FROM question_bank WHERE key = ?', key);
    if (dup) throw new AppError('이미 문항 은행에 있는 문항입니다. 문항 은행에서 고쳐 주세요.');
  } else {
    for (let i = 0; i < 10 && (!KEY_RE.test(key) || await first(env, 'SELECT 1 FROM question_bank WHERE key = ?', key)); i++) key = 'QB' + randomToken(6);
  }
  const nid = newId('QB');
  await run(env, 'INSERT INTO question_bank (id, key, type, title, options_json, required, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    nid, key, type, title, JSON.stringify(options), data.required ? 1 : 0, who, now, now);
  await writeLog(env, who, '문항은행저장', nid, title);
  return view(await first(env, 'SELECT * FROM question_bank WHERE id = ?', nid));
}

// 은행에서만 지운다 (이미 그 문항을 넣은 설문·응답은 그대로)
export async function surveyQbankDelete(env, data, ctx) {
  const cur = await first(env, 'SELECT id, title FROM question_bank WHERE id = ?', s(data.id));
  if (!cur) throw new AppError('문항 은행에서 찾을 수 없습니다.');
  await run(env, 'DELETE FROM question_bank WHERE id = ?', cur.id);
  await writeLog(env, ctx.account.login_id, '문항은행삭제', cur.id, cur.title);
  return {};
}
