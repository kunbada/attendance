// 빌드: src/* + vendor/xlsx 를 하나의 HTML(분양계약관리.html)로 합칩니다.  사용: node build.js
const fs = require('fs'), path = require('path');
const r = f => fs.readFileSync(path.join(__dirname, f), 'utf8');
const JS = ['core.js', 'v_auth.js', 'ui.js', 'v_dash.js', 'v_lists.js', 'v_deposits.js', 'v_print.js', 'v_misc.js'];
// 온라인 배포용 서버 주소: server.json {"syncUrl":"https://script.google.com/macros/s/.../exec"}  (없으면 빈 값 = 로컬 전용으로 시작)
let SERVER = ''; try { SERVER = JSON.parse(r('server.json')).syncUrl || ''; } catch (e) { }
if (process.env.NOSERVER) SERVER = ''; // 테스트용 빌드(서버 주소 미내장)
let html = r('src/index.html');
html = html.replace('/*CSS*/', () => r('src/style.css'))
  .replace('/*XLSX*/', () => r('vendor/xlsx.full.min.js').replace(/<\/script/g, '<\\/script'))
  .replace('/*APP*/', () => `const DEFAULT_SERVER = ${JSON.stringify(SERVER)};\n` + JS.map(f => r('src/' + f)).join('\n'));
fs.writeFileSync(path.join(__dirname, '분양계약관리.html'), html);
console.log('built 분양계약관리.html', (html.length / 1024).toFixed(0) + 'KB');
