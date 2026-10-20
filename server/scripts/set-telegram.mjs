// 텔레그램 봇 토큰을 서버에 등록하고 웹훅을 연결한다. 터미널에서 직접 실행하세요:
//   cd worker
//   node scripts/set-telegram.mjs
// 토큰은 화면에 보이지 않게 입력받는다. 채팅·git 에는 남지 않고, 임시 파일(.telegram-token)은 서버에 올린 뒤 삭제한다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function readVars() {
  const vars = {};
  const p = join(root, '.dev.vars');
  if (existsSync(p)) readFileSync(p, 'utf8').split(/\r?\n/).forEach((l) => { const m = /^([A-Z_]+)=(.*)$/.exec(l.trim()); if (m) vars[m[1]] = m[2]; });
  return vars;
}

function askHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    stdin.on('data', function onData(ch) {
      if (ch === '\u0003') process.exit(1);
      if (ch === '\r' || ch === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(buf.trim());
      } else if (ch === '\u007f' || ch === '\b') {
        buf = buf.slice(0, -1);
      } else {
        buf += ch;
      }
    });
  });
}

const vars = readVars();
if (!vars.TELEGRAM_SECRET) { console.error('.dev.vars 에 TELEGRAM_SECRET 이 없습니다. 먼저 node scripts/make-seed.mjs 를 실행하세요.'); process.exit(1); }

// 서버 주소: 인자로 주거나, web/js/config.js 에서 읽는다
let workerUrl = process.argv[2];
if (!workerUrl) {
  const cfg = readFileSync(join(root, '..', 'web', 'js', 'config.js'), 'utf8');
  workerUrl = (/API_URL:\s*'([^']+)'/.exec(cfg) || [])[1];
}
if (!workerUrl || !/^https:\/\/.+\.workers\.dev\/?$/.test(workerUrl)) {
  console.error('서버 주소(https://....workers.dev)를 찾지 못했습니다. web/js/config.js 에 넣거나 인자로 주세요.');
  process.exit(1);
}
workerUrl = workerUrl.replace(/\/$/, '');

const token = await askHidden('BotFather 에서 받은 봇 토큰을 붙여넣고 Enter (화면에 보이지 않습니다): ');
if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token)) { console.error('토큰 형식이 올바르지 않습니다.'); process.exit(1); }

const tg = async (method, payload) => (await fetch(`https://api.telegram.org/bot${token}/${method}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {})
})).json();

const me = await tg('getMe');
if (!me.ok) { console.error('토큰이 올바르지 않습니다: ' + me.description); process.exit(1); }
console.log('봇 확인: @' + me.result.username);

// 서버 비밀 값 등록(wrangler)은 로그인 정보가 있는 환경에서 해야 해서, 토큰을 임시 파일에 두고 Claude가 올린 뒤 지운다
writeFileSync(join(root, '.telegram-token'), token);
console.log('토큰을 임시 저장했습니다. (서버에 올린 뒤 바로 지워집니다)');

// drop_pending_updates: 이전에 쌓인 대기 업데이트를 비운다
const hook = await tg('setWebhook', { url: workerUrl + '/?tg=' + vars.TELEGRAM_SECRET, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
console.log(hook.ok ? '웹훅 연결 완료.' : '웹훅 연결 실패: ' + hook.description);
console.log('\n관리자 화면 > 설정 > 기본 설정 > "텔레그램 봇 이름" 에 입력하세요:  ' + me.result.username);
