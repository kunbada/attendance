// 공용 함수: DOM 만들기, 토스트, 로딩, 입력 서식, 모달
// 직원이 입력한 이름 등이 관리자 화면에 그대로 나오므로, 화면은 innerHTML 대신 h() 로 만든다 (스크립트 삽입 방지).

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

function appendChildren_(el, child) {
  if (child === null || child === undefined || child === false) return;
  if (Array.isArray(child)) { child.forEach(function (c) { appendChildren_(el, c); }); return; }
  el.appendChild(child.nodeType ? child : document.createTextNode(String(child)));
}

function h(tag, attrs) {
  var el = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'style' || k === 'colspan' || k === 'for' || k.indexOf('data-') === 0) el.setAttribute(k, v);
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v);
    });
  }
  for (var i = 2; i < arguments.length; i++) appendChildren_(el, arguments[i]);
  return el;
}

// ---------- 토스트·로딩 ----------

var toastTimer_;
function toast(msg, isError) {
  var t = $('#toast');
  if (!t) { t = h('div', { id: 'toast' }); document.body.appendChild(t); }
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(toastTimer_);
  toastTimer_ = setTimeout(function () { t.className = ''; }, isError ? 5000 : 2500);
}

var loadingCount_ = 0;
function showLoading(on) {
  loadingCount_ += on ? 1 : -1;
  var l = $('#loading');
  if (!l) { l = h('div', { id: 'loading' }, h('div', { class: 'spinner' })); document.body.appendChild(l); }
  l.className = loadingCount_ > 0 ? 'show' : '';
}

// 버튼을 잠그고(중복 제출 방지) 로딩을 보여준 뒤 fn 실행. 오류는 토스트로.
async function runBusy(btn, fn) {
  if (btn && btn.disabled) return;
  if (btn) btn.disabled = true;
  showLoading(true);
  try {
    await fn();
  } catch (e) {
    toast(e.message || '오류가 발생했습니다.', true);
  } finally {
    showLoading(false);
    if (btn) btn.disabled = false;
  }
}

// ---------- 입력 서식 ----------

function onlyDigits(s) { return String(s || '').replace(/\D/g, ''); }

function formatPhone(s) {
  var d = onlyDigits(s).slice(0, 11);
  if (d.length < 4) return d;
  if (d.length < 8) return d.slice(0, 3) + '-' + d.slice(3);
  if (d.length < 11) return d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
  return d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7);
}

function formatRrn(s) {
  var d = onlyDigits(s).slice(0, 13);
  return d.length > 6 ? d.slice(0, 6) + '-' + d.slice(6) : d;
}

function bindFormat(input, fn) {
  input.addEventListener('input', function () { input.value = fn(input.value); });
}

// ---------- 모달 ----------
// buttons: [{ label, primary, onClick(close) }]. onClick 이 Promise 를 돌려주면 끝날 때까지 버튼 잠금.
function modal(title, body, buttons) {
  var overlay = h('div', { class: 'modal-overlay' });
  function close() { overlay.remove(); }
  var actions = h('div', { class: 'modal-actions' });
  (buttons || []).concat([{ label: '닫기', onClick: function (c) { c(); } }]).forEach(function (b) {
    var btn = h('button', { type: 'button', class: 'btn ' + (b.primary ? 'primary' : 'ghost') }, b.label);
    btn.addEventListener('click', function () {
      runBusy(btn, function () { return Promise.resolve(b.onClick(close)); });
    });
    actions.appendChild(btn);
  });
  overlay.appendChild(h('div', { class: 'modal' }, h('h3', null, title), body, actions));
  document.body.appendChild(overlay);
  return { close: close };
}

function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), input, hint ? h('span', { class: 'hint' }, hint) : null);
}

function option(value, text, selected) {
  return h('option', { value: value, selected: !!selected }, text);
}
