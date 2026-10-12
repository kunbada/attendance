// 관리자 비밀번호 초기화 이메일을 보내는 Resend API 키를 입력받아 임시 파일(.resend-key)에 둔다.
// 터미널에서 직접 실행하세요:
//   cd worker
//   node scripts/set-resend.mjs
// 키는 화면에 보이지 않게 입력받는다. 채팅·git 에는 남지 않고, 임시 파일은 Claude 가 서버에 올린 뒤 바로 삭제한다.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

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

const key = await askHidden('Resend 에서 만든 API 키(re_ 로 시작)를 붙여넣고 Enter (화면에 보이지 않습니다): ');
if (!/^re_[A-Za-z0-9_]{20,}$/.test(key)) {
  console.error('API 키 형식이 올바르지 않습니다. re_ 로 시작하는 긴 문자열이어야 합니다.');
  process.exit(1);
}
writeFileSync(join(root, '.resend-key'), key);
console.log('키를 임시 저장했습니다. Claude 에게 "Resend 키 입력했어"라고 알려 주세요. 서버에 올린 뒤 임시 파일은 삭제됩니다.');
