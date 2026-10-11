// 텔레그램 봇: 연결 코드 발급, 호출 발송, 웹훅(연결·[확인] 버튼) 처리

var CODE_LIFETIME_MS = 10 * 60 * 1000;
// 테스트에서 실제 텔레그램에 보내지 않고 호출 내용만 가로채기 위한 자리 (운영에서는 항상 null)
var telegramStub_ = null;

function telegramApi_(method, payload) {
  if (telegramStub_) return telegramStub_(method, payload);
  var token = prop_('TELEGRAM_TOKEN');
  if (!token) return { ok: false, description: '텔레그램 봇 토큰이 설정되지 않았습니다.' };
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    return JSON.parse(res.getContentText());
  } catch (e) {
    return { ok: false, description: '텔레그램 서버에 연결하지 못했습니다.' };
  }
}

function hhmm_(dateTimeStr) {
  return s_(dateTimeStr).slice(11, 16);
}

// 직원에게 호출 메시지 + [확인] 버튼을 보낸다. 성공 여부만 돌려준다.
function sendCallMessage_(staff, visitId, last5, gender) {
  if (!s_(staff.텔레그램ID)) return false;
  var text = '[호출] ' + last5 + ' 고객' + (gender ? '(' + gender + ')' : '') + ' 도착\n안내데스크로 와주세요';
  var res = telegramApi_('sendMessage', {
    chat_id: s_(staff.텔레그램ID), text: text,
    reply_markup: { inline_keyboard: [[{ text: '확인', callback_data: 'ack:' + visitId }]] }
  });
  return !!res.ok;
}

// ---------- 직원: 연결 ----------

function staffTelegramLink(data, ctx) {
  var bot = getSettings_()['텔레그램봇이름'];
  if (!bot) throw new AppError('텔레그램 봇이 아직 설정되지 않았습니다. 관리자에게 문의해 주세요.');
  var code = randomToken_(8);
  updateRow('직원', ctx.staff._row, { 텔레그램연결코드: code + ':' + Date.now() });
  return { url: 'https://t.me/' + bot + '?start=' + code, botName: bot };
}

// ---------- 웹훅 ----------

function handleTelegram_(update, secret) {
  // 웹앱 주소가 알려져도 아무나 가짜 업데이트를 보낼 수 없게, 웹훅 등록 주소에 넣은 비밀값을 확인한다
  var expected = prop_('TELEGRAM_SECRET');
  if (!expected || secret !== expected) return;
  withLock(function () {
    if (update.callback_query) handleAck_(update.callback_query);
    else if (update.message && update.message.text) handleStart_(update.message);
  });
}

function handleStart_(msg) {
  if (!msg.chat || msg.chat.type !== 'private') return;
  var chatId = s_(msg.chat.id);
  var m = /^\/start(?:\s+(\S+))?$/.exec(s_(msg.text).trim());
  if (!m) return;
  var code = m[1];
  if (!code) {
    telegramApi_('sendMessage', { chat_id: chatId, text: '근태 앱의 [텔레그램 연결] 버튼으로 들어와 연결해 주세요.' });
    return;
  }
  var staff = findOne('직원', function (r) { return s_(r.텔레그램연결코드).split(':')[0] === code && s_(r.상태) === '활동'; });
  var issued = staff ? Number(s_(staff.텔레그램연결코드).split(':')[1]) : 0;
  if (!staff || Date.now() - issued > CODE_LIFETIME_MS) {
    telegramApi_('sendMessage', { chat_id: chatId, text: '연결 코드가 만료되었거나 올바르지 않습니다. 앱에서 [텔레그램 연결]을 다시 눌러 주세요.' });
    return;
  }
  var other = findOne('직원', function (r) { return s_(r.텔레그램ID) === chatId && s_(r.직원ID) !== s_(staff.직원ID); });
  if (other) {
    telegramApi_('sendMessage', { chat_id: chatId, text: '이 텔레그램은 이미 다른 직원에게 연결되어 있습니다.' });
    return;
  }
  updateRow('직원', staff._row, { 텔레그램ID: chatId, 텔레그램연결코드: '' }); // 코드는 한 번만 쓸 수 있다
  writeLog_(s_(staff.성명), '텔레그램연결', s_(staff.직원ID), '');
  telegramApi_('sendMessage', { chat_id: chatId, text: '연결되었습니다 (' + s_(staff.성명) + ')' });
}

function handleAck_(cb) {
  var data = s_(cb.data);
  if (data.indexOf('ack:') !== 0) return;
  var visit = findOne('방문', function (r) { return s_(r.방문ID) === data.slice(4); });
  var staff = visit ? findOne('직원', function (r) { return s_(r.직원ID) === s_(visit.담당직원ID); }) : null;
  // 호출받은 본인의 텔레그램에서 누른 경우만 인정
  if (!visit || !staff || s_(staff.텔레그램ID) !== s_(cb.from && cb.from.id)) {
    telegramApi_('answerCallbackQuery', { callback_query_id: cb.id, text: '처리할 수 없는 요청입니다.' });
    return;
  }
  var ackedAt = s_(visit.확인일시);
  if (!ackedAt) {
    ackedAt = nowStr();
    updateRow('방문', visit._row, { 확인일시: ackedAt });
  }
  telegramApi_('answerCallbackQuery', { callback_query_id: cb.id, text: '확인했습니다.' });
  if (cb.message) {
    telegramApi_('editMessageText', {
      chat_id: s_(cb.message.chat.id), message_id: cb.message.message_id,
      text: s_(cb.message.text).replace(/\n✅ 확인됨.*$/, '') + '\n✅ 확인됨 ' + hhmm_(ackedAt)
    });
  }
}
