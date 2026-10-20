// 통합관리(hub) 뼈대: 로그인, 현장 선택, 메뉴. 메뉴별 화면은 같은 폴더의 js 가 Hub.register 로 등록한다.
// 권한 확인은 서버가 한다. 여기서 버튼을 숨기는 것은 편의일 뿐이다.
var Hub = (function () {
  Api.setScope('admin');
  var state = { staff: [], orgs: [], settings: {}, accounts: [], projects: [], me: null };
  var menus = [];
  var active = '';

  function show(name) {
    $$('main > .screen, main.screen').forEach(function (s) { s.classList.add('hidden'); });
    $('#screen-' + name).classList.remove('hidden');
    $('#top-right').classList.toggle('hidden', name !== 'app');
  }

  // ---------- 공용 도우미 ----------
  var DATE_STYLE = 'height:40px;border:1px solid var(--line);border-radius:8px;padding:0 8px;font:inherit';

  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  // 엑셀에서 수식으로 실행되지 않도록 = + - @ 로 시작하는 값 앞에 ' 를 붙인다
  function csvCell(v) {
    var t = String(v === null || v === undefined ? '' : v);
    if (/^[=+\-@]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  }

  function downloadCsv(filename, rows) {
    var text = '﻿' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n'); // BOM: 엑셀 한글 깨짐 방지
    var a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function simpleTable(headers, rows) {
    return h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, headers.map(function (t) { return h('th', null, t); }))),
      h('tbody', null, rows.length ? rows : h('tr', null, h('td', { colspan: headers.length, class: 'muted' }, '없음')))));
  }

  function nameCell(p) { return p.name + (p.nickname ? ' (' + p.nickname + ')' : ''); }
  function orgCell(p) { return p.job + (p.headName ? ' / ' + p.headName + ' ' + p.teamName : ''); }
  function statCard(label, value, sub) {
    return h('div', { class: 'card' }, h('span', { class: 'num' }, value), label, sub ? h('div', { class: 'muted' }, sub) : null);
  }

  function isAdmin() { return !!state.me && state.me.role === '관리자'; }
  function currentProject() {
    var id = Api.getProject();
    return state.projects.filter(function (p) { return p.id === id; })[0] || null;
  }
  function orgsOf(kind) { return state.orgs.filter(function (o) { return o.kind === kind; }); }

  async function loadStaff() { state.staff = (await Api.call('admin.staffList')).staff; }
  async function loadOrgs() { state.orgs = (await Api.call('admin.orgs')).orgs; }
  async function reloadProjects() {
    state.projects = (await Api.call('project.list')).projects;
    renderProjectSelect();
  }

  // ---------- 로그인 ----------
  $('#form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    runBusy($('#form-login button[type=submit]'), async function () {
      var res = await Api.call('account.login', { loginId: $('#login-id').value.trim(), password: $('#login-pw').value });
      Api.setToken(res.token);
      $('#login-pw').value = '';
      if (res.account.role !== '관리자' && res.account.role !== '보조관리자') {
        try { await Api.call('auth.logout'); } catch (err) { /* 무시 */ }
        Api.setToken('');
        throw new Error('이 계정으로 쓸 수 있는 통합관리 화면이 아직 없습니다. (데스크·방명록 계정은 각자의 화면에서 로그인해 주세요)');
      }
      if (res.account.mustChangePassword) show('changepw');
      else await enterApp();
    });
  });

  // ---------- 비밀번호 초기화 (이메일 인증 코드, 관리자 계정만) ----------
  $('#btn-forgot').addEventListener('click', function () {
    $('#rs-id').value = $('#login-id').value;
    $('#form-reset1').classList.remove('hidden');
    $('#form-reset2').classList.add('hidden');
    show('reset');
  });
  ['#btn-reset-back', '#btn-reset-back2'].forEach(function (sel) { $(sel).addEventListener('click', function () { show('login'); }); });

  async function sendResetCode() {
    await Api.call('account.resetRequest', { loginId: $('#rs-id').value.trim() });
    $('#form-reset1').classList.add('hidden');
    $('#form-reset2').classList.remove('hidden');
    $('#rs-note').textContent = '계정에 등록된 이메일이 있으면 6자리 인증 코드를 보냈습니다. 메일이 안 보이면 스팸함도 확인해 주세요. 코드는 10분 동안 유효합니다.';
    $('#rs-code').focus();
  }

  $('#form-reset1').addEventListener('submit', function (e) {
    e.preventDefault();
    runBusy($('#form-reset1 button[type=submit]'), sendResetCode);
  });

  $('#btn-reset-resend').addEventListener('click', function () {
    runBusy($('#btn-reset-resend'), async function () { await sendResetCode(); toast('코드를 다시 보냈습니다. (1분 안에 다시 요청하면 새 코드는 가지 않습니다)'); });
  });

  $('#form-reset2').addEventListener('submit', function (e) {
    e.preventDefault();
    runBusy($('#form-reset2 button[type=submit]'), async function () {
      if ($('#rs-new').value !== $('#rs-new2').value) throw new Error('새 비밀번호가 서로 다릅니다.');
      await Api.call('account.resetConfirm', { loginId: $('#rs-id').value.trim(), code: $('#rs-code').value, newPassword: $('#rs-new').value });
      $('#form-reset2').reset();
      $('#login-id').value = $('#rs-id').value.trim();
      show('login');
      toast('비밀번호를 변경했습니다. 새 비밀번호로 로그인해 주세요.');
    });
  });

  $('#form-changepw').addEventListener('submit', function (e) {
    e.preventDefault();
    runBusy($('#form-changepw button[type=submit]'), async function () {
      if ($('#cp-new').value !== $('#cp-new2').value) throw new Error('새 비밀번호가 서로 다릅니다.');
      await Api.call('account.changePassword', { oldPassword: $('#cp-old').value, newPassword: $('#cp-new').value });
      $('#form-changepw').reset();
      toast('비밀번호를 변경했습니다.');
      await enterApp();
    });
  });

  $('#btn-logout').addEventListener('click', function () {
    runBusy($('#btn-logout'), async function () {
      try { await Api.call('auth.logout'); } catch (e) { /* 이미 만료 */ }
      Api.setToken('');
      show('login');
    });
  });

  // ---------- 현장 선택 ----------
  function renderProjectSelect() {
    var sel = $('#project-select');
    sel.innerHTML = '';
    if (!state.projects.length) sel.appendChild(option('', '(현장 없음)'));
    state.projects.forEach(function (p) { sel.appendChild(option(p.id, p.name + (p.status === '종료' ? ' (종료)' : ''), p.id === Api.getProject())); });
    var cur = currentProject();
    $('#siteName').textContent = cur ? cur.name + ' · 통합관리' : '위뉴 통합관리';
  }

  $('#project-select').addEventListener('change', function () {
    Api.setProject($('#project-select').value);
    state.staff = []; state.orgs = []; state.settings = {};
    renderProjectSelect();
    runBusy(null, refresh);
  });

  // ---------- 메뉴 ----------
  function register(menu) { menus.push(menu); }

  function visibleMenus() {
    return menus.filter(function (m) { return !m.adminOnly || isAdmin(); });
  }

  function buildMenu() {
    var bar = $('#menu'), panels = $('#panels');
    bar.innerHTML = ''; panels.innerHTML = '';
    visibleMenus().forEach(function (m) {
      var tab = h('button', { type: 'button', class: 'tab', 'data-menu': m.key }, m.label);
      tab.addEventListener('click', function () { runBusy(null, function () { return open(m.key); }); });
      bar.appendChild(tab);
      panels.appendChild(h('div', { id: 'panel-' + m.key, class: 'hidden' }));
    });
  }

  async function open(key) {
    active = key;
    $$('#menu .tab').forEach(function (t) { t.classList.toggle('active', t.dataset.menu === key); });
    visibleMenus().forEach(function (m) { $('#panel-' + m.key).classList.toggle('hidden', m.key !== key); });
    await refresh();
  }

  async function refresh() {
    var m = visibleMenus().filter(function (x) { return x.key === active; })[0];
    if (!m) return;
    var root = $('#panel-' + m.key);
    if (m.needsProject !== false && !Api.getProject()) {
      root.innerHTML = '';
      root.appendChild(h('div', { class: 'card' }, h('h2', null, '현장을 먼저 선택해 주세요'),
        h('p', { class: 'muted' }, isAdmin() ? '상단에서 현장을 고르거나, [프로젝트] 메뉴에서 새 현장을 만들어 주세요.' : '담당 현장이 지정되지 않았습니다. 관리자에게 문의해 주세요.')));
      return;
    }
    await m.render(root);
  }

  // ---------- 시작 ----------
  async function enterApp() {
    var me = await Api.call('account.me');
    if (me.account.role !== '관리자' && me.account.role !== '보조관리자') throw new Error('통합관리 화면을 쓸 수 없는 계정입니다.');
    state.me = me.account;
    $('#who').textContent = me.account.name + ' (' + me.account.role + ')';
    await reloadProjects();
    // 이전에 보던 현장이 아직 접근 가능하면 그대로, 아니면 첫 현장
    var saved = Api.getProject();
    var ok = state.projects.some(function (p) { return p.id === saved; });
    Api.setProject(ok ? saved : (state.projects[0] ? state.projects[0].id : ''));
    renderProjectSelect();
    buildMenu();
    show('app');
    await open(Api.getProject() || !isAdmin() ? visibleMenus()[0].key : 'projects');
  }

  async function boot() {
    if (!Api.getToken()) { show('login'); return; }
    try {
      var me = await Api.call('account.me');
      if (me.account.mustChangePassword) { show('changepw'); return; }
      await enterApp();
    } catch (e) {
      Api.setToken('');
      show('login');
    }
  }

  return {
    state: state, show: show, register: register, open: open, refresh: refresh, boot: boot,
    DATE_STYLE: DATE_STYLE, todayLocal: todayLocal, downloadCsv: downloadCsv, simpleTable: simpleTable,
    nameCell: nameCell, orgCell: orgCell, statCard: statCard,
    isAdmin: isAdmin, currentProject: currentProject, orgsOf: orgsOf,
    loadStaff: loadStaff, loadOrgs: loadOrgs, reloadProjects: reloadProjects
  };
})();
