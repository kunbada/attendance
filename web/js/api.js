// 서버(Apps Script) 호출 공통 함수. 토큰·기기키 보관, 오류 처리.
var Api = (function () {
  var scope = 'staff';

  function tokenKey() { return 'wn_token_' + scope; }

  function randomId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'dk-' + Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  }

  // 이 휴대폰(브라우저)을 구분하는 값. 직원 화면에서만 서버가 확인한다.
  function deviceKey() {
    var k = null;
    try { k = localStorage.getItem('wn_deviceKey'); } catch (e) { /* 저장 불가 환경 */ }
    if (!k) {
      k = randomId();
      try { localStorage.setItem('wn_deviceKey', k); } catch (e) { /* 저장 불가 환경 */ }
    }
    return k;
  }

  function getToken() { try { return localStorage.getItem(tokenKey()) || ''; } catch (e) { return ''; } }
  function setToken(t) { try { if (t) localStorage.setItem(tokenKey(), t); else localStorage.removeItem(tokenKey()); } catch (e) { /* 무시 */ } }

  // action 호출. 실패하면 error.message(한국어)와 error.code 가 있는 Error 를 던진다.
  async function call(action, data) {
    if (/여기에_웹앱_URL/.test(CONFIG.API_URL)) {
      throw new Error('서버 주소가 아직 설정되지 않았습니다. (web/js/config.js)');
    }
    var res;
    try {
      res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        // text/plain 이어야 브라우저가 사전요청(CORS preflight)을 보내지 않는다
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, token: getToken(), deviceKey: deviceKey(), data: data || {} })
      });
    } catch (e) {
      throw new Error('네트워크 연결을 확인해 주세요.');
    }
    var body;
    try { body = await res.json(); } catch (e) { throw new Error('서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요.'); }
    if (!body.ok) {
      var err = new Error(body.error || '요청을 처리하지 못했습니다.');
      err.code = body.code || '';
      if (err.code === 'AUTH') setToken('');
      throw err;
    }
    return body.data;
  }

  return {
    setScope: function (s) { scope = s; },
    deviceKey: deviceKey, getToken: getToken, setToken: setToken, call: call
  };
})();
