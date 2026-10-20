// 텔레그램 봇: 연결 코드 발급, 호출 발송, 웹훅(연결·[확인] 버튼) 처리
import { AppError, s, all, first, run, nowStr, randomToken, safeEqual, getSettings, orgNameMap, writeLog } from '../core/util.js';

const CODE_LIFETIME_MS = 10 * 60 * 1000;

export async function telegramApi(env, method, payload) {
  if (!env.TELEGRAM_TOKEN) return { ok: false, description: '텔레그램 봇 토큰이 설정되지 않았습니다.' };
  // TELEGRAM_API_BASE 는 테스트에서 가짜 텔레그램 서버를 가리키는 용도 (운영에서는 비워 둔다)
  const base = env.TELEGRAM_API_BASE || 'https://api.telegram.org';
  try {
    const res = await fetch(base + '/bot' + env.TELEGRAM_TOKEN + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (e) {
    return { ok: false, description: '텔레그램 서버에 연결하지 못했습니다.' };
  }
}

export const hhmm = (dateTime) => s(dateTime).slice(11, 16);

// 고객 뒤 5자리가 있으면 " [12345]", 없으면 빈 문자열 (직원 검색으로 부를 때는 번호 없이도 호출한다)
const customerTag = (last5) => (last5 ? ' [' + last5 + ']' : '');

// 호출 메시지: "[호출] 1본부 1팀 홍길동님 [12345] 고객 도착". 본부·팀이 없는 직군은 조직을 뺀다.
async function orgLabel(env, staff) {
  const names = await orgNameMap(env, staff.project_id);
  return [names[staff.head_id], names[staff.team_id]].filter(Boolean).join(' ');
}

// 직원에게 호출 메시지 + [확인] 버튼을 보낸다. 성공 여부만 돌려준다.
// notifyLeaders: 처음 호출할 때만 담당 팀장·본부장에게도 알린다 (재호출 때는 직원에게만)
export async function sendCallMessage(env, staff, visitId, last5, notifyLeaders = false) {
  if (!staff.telegram_id) return false;
  const org = await orgLabel(env, staff);
  const who = (org ? org + ' ' : '') + staff.name + '님';
  const res = await telegramApi(env, 'sendMessage', {
    chat_id: staff.telegram_id,
    text: '[호출] ' + who + customerTag(last5) + ' 고객 도착\n안내데스크로 와주세요.',
    reply_markup: { inline_keyboard: [[{ text: '확인', callback_data: 'ack:' + visitId }]] }
  });
  if (notifyLeaders) await notifyLeadersOfCall(env, staff, who, last5);
  return !!res.ok;
}

// 담당 팀장·본부장(텔레그램 연결된 사람)에게 알림. 확인 버튼은 없다. 호출받은 본인에게는 중복으로 보내지 않는다.
async function notifyLeadersOfCall(env, staff, who, last5) {
  const leaders = await all(env,
    `SELECT id, telegram_id FROM staff WHERE project_id = ? AND status = '활동' AND telegram_id <> '' AND id <> ?
       AND ((grade = '팀장' AND team_id <> '' AND team_id = ?) OR (grade = '본부장' AND head_id <> '' AND head_id = ?))`,
    staff.project_id, staff.id, staff.team_id, staff.head_id);
  const sentTo = new Set([staff.telegram_id]);
  for (const l of leaders) {
    if (sentTo.has(l.telegram_id)) continue;
    sentTo.add(l.telegram_id);
    await telegramApi(env, 'sendMessage', { chat_id: l.telegram_id, text: '[호출 알림] ' + who + '께' + customerTag(last5) + ' 고객 도착 호출\n(안내데스크)' });
  }
}

// ---------- 직원: 연결 ----------

export async function staffTelegramLink(env, data, ctx) {
  const bot = (await getSettings(env, ctx.projectId))['텔레그램봇이름'];
  if (!bot) throw new AppError('텔레그램 봇이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.');
  const code = randomToken(8);
  await run(env, 'UPDATE staff SET telegram_link_code = ?, telegram_link_issued_at = ? WHERE id = ?', code, Date.now(), ctx.staff.id);
  return { url: 'https://t.me/' + bot + '?start=' + code, botName: bot };
}

// ---------- 웹훅 ----------

export async function handleTelegram(env, update, secret) {
  // 웹앱 주소가 알려져도 아무나 가짜 업데이트를 보낼 수 없게, 웹훅 등록 주소에 넣은 비밀값을 확인한다
  if (!env.TELEGRAM_SECRET || !safeEqual(secret, env.TELEGRAM_SECRET)) return;
  if (!Number.isInteger(update.update_id)) return;

  // 같은 업데이트가 다시 와도 한 번만 처리. 처리에 실패하면 표시를 지워서 재전송 때 다시 처리한다.
  const claim = await run(env, 'INSERT OR IGNORE INTO tg_updates (update_id, at) VALUES (?, ?)', update.update_id, nowStr());
  if (claim.meta.changes === 0) return;
  try {
    if (update.callback_query) await handleAck(env, update.callback_query);
    else if (update.message && update.message.text) await handleStart(env, update.message);
  } catch (e) {
    await run(env, 'DELETE FROM tg_updates WHERE update_id = ?', update.update_id);
    throw e;
  }
  if (Math.random() < 0.05) await run(env, `DELETE FROM tg_updates WHERE at < datetime('now', '-2 days')`);
}

async function handleStart(env, msg) {
  if (!msg.chat || msg.chat.type !== 'private') return;
  const chatId = s(msg.chat.id);
  const m = /^\/start(?:\s+(\S+))?$/.exec(s(msg.text).trim());
  if (!m) return;
  const code = m[1];
  if (!code) {
    await telegramApi(env, 'sendMessage', { chat_id: chatId, text: '근태 앱의 [텔레그램 연결] 버튼으로 들어와 연결해 주세요.' });
    return;
  }
  const staff = await first(env, `SELECT * FROM staff WHERE telegram_link_code = ? AND telegram_link_code <> '' AND status = '활동'`, code);
  if (!staff || Date.now() - staff.telegram_link_issued_at > CODE_LIFETIME_MS) {
    if (await first(env, `SELECT 1 FROM staff WHERE telegram_id = ?`, chatId)) return; // 이미 연결된 텔레그램의 재전송일 수 있다
    await telegramApi(env, 'sendMessage', { chat_id: chatId, text: '연결 코드가 만료되었거나 올바르지 않습니다. 앱에서 [텔레그램 연결]을 다시 눌러 주세요.' });
    return;
  }
  if (await first(env, 'SELECT 1 FROM staff WHERE telegram_id = ? AND id <> ?', chatId, staff.id)) {
    await telegramApi(env, 'sendMessage', { chat_id: chatId, text: '이 텔레그램은 이미 다른 직원에게 연결되어 있습니다.' });
    return;
  }
  await run(env, `UPDATE staff SET telegram_id = ?, telegram_link_code = '' WHERE id = ?`, chatId, staff.id); // 코드는 한 번만 쓸 수 있다
  await writeLog(env, staff.name, '텔레그램연결', staff.id, '', staff.project_id);
  await telegramApi(env, 'sendMessage', { chat_id: chatId, text: '연결되었습니다 (' + staff.name + ')' });
}

async function handleAck(env, cb) {
  const data = s(cb.data);
  if (!data.startsWith('ack:')) return;
  const visit = await first(env, 'SELECT * FROM visits WHERE id = ?', data.slice(4));
  const staff = visit ? await first(env, 'SELECT * FROM staff WHERE id = ?', visit.staff_id) : null;
  // 호출받은 본인의 텔레그램에서 누른 경우만 인정
  if (!visit || !staff || !staff.telegram_id || staff.telegram_id !== s(cb.from && cb.from.id)) {
    await telegramApi(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: '처리할 수 없는 요청입니다.' });
    return;
  }
  let ackedAt = visit.acked_at;
  if (!ackedAt) {
    ackedAt = nowStr();
    await run(env, `UPDATE visits SET acked_at = ? WHERE id = ? AND acked_at = ''`, ackedAt, visit.id);
  }
  await telegramApi(env, 'answerCallbackQuery', { callback_query_id: cb.id, text: '확인했습니다.' });
  if (cb.message) {
    await telegramApi(env, 'editMessageText', {
      chat_id: s(cb.message.chat.id), message_id: cb.message.message_id,
      text: s(cb.message.text).replace(/\n✅ 확인됨.*$/, '') + '\n✅ 확인됨 ' + hhmm(ackedAt)
    });
  }
}
