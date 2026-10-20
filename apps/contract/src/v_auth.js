/* ===================== 로그인 / 사용자 관리 (온라인 서버 사용 시) ===================== */
let SERVER_HAS_USERS = null; // null=알 수 없음(오프라인) / true / false(최초 관리자 설정 필요)
const needLogin = () => !!META.syncUrl && SERVER_HAS_USERS === true && !(SESSION && SESSION.url === META.syncUrl && SESSION.st);

async function initAuth() {
  if (!META.syncUrl) { updateUserPill(); return; }
  try { const s = await callServer({ op: 'status' }, true); SERVER_HAS_USERS = !!s.hasUsers; } catch (e) { SERVER_HAS_USERS = null; updateUserPill(); return; }
  if (SERVER_HAS_USERS) {
    if (!(SESSION && SESSION.url === META.syncUrl && SESSION.st)) showLogin('login');
    else { try { const m = await callServer({ op: 'me' }, true); setSession(Object.assign({}, SESSION, { role: m.role, name: m.name })); } catch (e) { if (e.code === 'AUTH') { setSession(null); showLogin('login'); } } }
  } else if (!META.token) showLogin('setup');
  updateUserPill(); fetchProjects();
}
async function fetchProjects() {
  if (!META.syncUrl || needLogin()) return;
  try {
    const r = await callServer({ op: 'projects' }, true); LS.set('bunyang.srvProjects', r.projects || []);
    const pl = projList(); let ch = false;
    (r.projects || []).forEach(p => { const x = pl.find(x => x.key === p.pk); if (!x) { pl.push({ key: p.pk, name: p.name }); ch = true; } else if (x.name !== p.name) { x.name = p.name; ch = true; } });
    if (ch) { LS.set('bunyang.projects', pl); if (CUR === 'settings') render(); }
  } catch (e) { }
}

function showLogin(mode) {
  mode = mode || 'login';
  let bg = $('#loginBg'); if (!bg) { bg = document.createElement('div'); bg.id = 'loginBg'; document.body.appendChild(bg); }
  const tabs = SERVER_HAS_USERS === false ? [['setup', '최초 관리자 만들기']] : [['login', '로그인'], ['signup', '사용 신청']];
  const m = tabs.some(t => t[0] === mode) ? mode : tabs[0][0];
  const f = (id, label, type, ph) => `<div class="f full"><label>${label}</label><input class="in" id="${id}" type="${type || 'text'}" placeholder="${ph || ''}" autocomplete="${type === 'password' ? 'current-password' : 'username'}"></div>`;
  bg.innerHTML = `<div class="loginBox"><h2>${esc(CFG().project.name || '분양계약관리')}</h2><div class="sub" style="margin-bottom:12px">계약·수금관리 시스템</div>
    <div class="seg" style="margin-bottom:14px">${tabs.map(t => `<button class="${t[0] === m ? 'on' : ''}" data-m="${t[0]}">${t[1]}</button>`).join('')}</div>
    <div class="form">
      ${m === 'setup' ? `<div class="help full">서버에 아직 사용자가 없습니다. 서버 비밀키(Code.gs 의 TOKEN)와 함께 <b>관리자 계정</b>을 만드세요.</div>${f('aKey', '서버 비밀키', 'password')}` : ''}
      ${f('aId', '아이디', 'text', '영문/숫자 3자 이상')}
      ${m !== 'login' ? f('aName', '이름 (표시용)', 'text', '예: 홍길동') : ''}
      ${f('aPw', '비밀번호' + (m === 'login' ? '' : ' (6자 이상)'), 'password')}
    </div>
    <div id="aMsg" class="red" style="min-height:20px;margin:8px 0;font-size:12px"></div>
    <button class="btn pri" id="aGo" style="width:100%;padding:9px">${m === 'login' ? '로그인' : m === 'signup' ? '사용 신청 (관리자 승인 필요)' : '관리자 계정 만들기'}</button>
    ${META.syncUrl ? '' : ''}</div>`;
  $$('#loginBg .seg button').forEach(b => b.onclick = () => showLogin(b.dataset.m));
  const go = async () => {
    const id = $('#aId').value.trim(), pw = $('#aPw').value, name = $('#aName') ? $('#aName').value.trim() : '', msg = $('#aMsg'), btn = $('#aGo');
    if (!id || !pw) { msg.textContent = '아이디와 비밀번호를 입력하세요'; return; }
    btn.disabled = true; msg.textContent = ''; msg.className = 'red';
    try {
      if (m === 'signup') { await callServer({ op: 'signup', id, name, pw }, true); msg.className = 'green'; msg.textContent = '신청되었습니다. 관리자가 승인하면 로그인할 수 있습니다.'; btn.disabled = false; return; }
      const r = m === 'setup' ? await callServer({ op: 'setupAdmin', token: $('#aKey').value.trim(), id, name, pw }, true) : await callServer({ op: 'login', id, pw }, true);
      SERVER_HAS_USERS = true; setSession({ st: r.st, id: r.id, name: r.name, role: r.role });
      bg.remove(); render(); fetchProjects(); sync({ full: !META.lastRev });
    } catch (e) { msg.textContent = e.message; btn.disabled = false; }
  };
  $('#aGo').onclick = go; bg.querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter') go(); });
  setTimeout(() => { const i = $('#aId'); if (i) i.focus(); }, 30);
}

function updateUserPill() {
  const el = $('#userPill'); if (!el) return;
  if (!META.syncUrl) { el.style.display = 'none'; return; }
  el.style.display = '';
  const on = SESSION && SESSION.url === META.syncUrl;
  el.className = 'pill ' + (on ? (ROLE() === 'read' ? 'wait' : 'ok') : 'none');
  el.innerHTML = on ? `<i></i>${esc(SESSION.name || SESSION.id)} · ${ROLE_L[ROLE()] || ''}` : '<i></i>로그인 필요';
  const b = $('#badge-units'); if (b) { const n = isAdmin() ? PENDING_USERS : 0; b.style.display = n ? '' : 'none'; b.textContent = n; }
}
function userMenu() {
  if (!(SESSION && SESSION.url === META.syncUrl)) return showLogin();
  openModal({
    title: '내 계정', body: `<div class="kv"><div>이름</div><div><b>${esc(SESSION.name)}</b> (${esc(SESSION.id)})</div><div>권한</div><div>${ROLE_L[ROLE()]}</div></div>
    <h4 style="margin:14px 0 6px">비밀번호 변경</h4><div class="form"><div class="f"><label>현재 비밀번호</label><input class="in" type="password" id="pwOld"></div><div class="f"><label>새 비밀번호 (6자 이상)</label><input class="in" type="password" id="pwNew"></div></div>`,
    foot: `<button class="btn dan" id="uOut" style="margin-right:auto">로그아웃</button><button class="btn" onclick="closeModal()">닫기</button><button class="btn pri" id="uPw">비밀번호 변경</button>`,
    onOpen: bg => {
      bg.querySelector('#uPw').onclick = async () => { try { await callServer({ op: 'changePw', old: $('#pwOld').value, pw: $('#pwNew').value }); toast('비밀번호를 변경했습니다'); closeModal(); } catch (e) { toast(e.message, 1); } };
      bg.querySelector('#uOut').onclick = async () => { try { await callServer({ op: 'logout' }, true); } catch (e) { } closeModal(); setSession(null); showLogin('login'); };
    }
  });
}

/* ===================== 설정 > 사용자관리 (관리자 전용) ===================== */
async function view_users(el) {
  if (!isAdmin()) { el.innerHTML = '<div class="banner">관리자만 볼 수 있습니다</div>'; return; }
  el.innerHTML = `<div class="toolbar"><h2>사용자 관리</h2><span class="sp"></span><button class="btn" onclick="render()">새로고침</button></div><div id="uList" class="empty">불러오는 중…</div>`;
  let us; try { us = (await callServer({ op: 'users' })).users; } catch (e) { $('#uList').innerHTML = `<div class="banner">${esc(e.message)}</div>`; return; }
  const st = { pending: '승인대기', active: '사용중', disabled: '사용중지' };
  us.sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || a.id.localeCompare(b.id));
  PENDING_USERS = us.filter(u => u.status === 'pending').length; updateUserPill();
  $('#uList').className = '';
  $('#uList').innerHTML = `<div class="help" style="margin-bottom:8px"><b>관리자</b>: 사용자 승인·권한 관리 + 모든 기능 / <b>쓰기</b>: 데이터 입력·수정 / <b>읽기전용</b>: 조회만 가능. 사용 신청한 사람은 <b>승인대기</b>로 보이며, 승인하면서 권한을 지정합니다.</div>
  <table class="t"><thead><tr><th>아이디</th><th>이름</th><th>상태</th><th>권한</th><th>최근 로그인</th><th>관리</th></tr></thead><tbody>${us.map(u => `<tr data-u="${esc(u.id)}" class="${u.status === 'pending' ? 'warnrow' : ''}">
    <td>${esc(u.id)}</td><td>${esc(u.name)}</td><td><span class="chip ${u.status === 'active' ? 'ok' : u.status === 'pending' ? 'warn' : 'gray'}">${st[u.status]}</span></td>
    <td><select class="in uRole">${['admin', 'write', 'read'].map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_L[r]}</option>`).join('')}</select></td>
    <td class="muted">${esc((u.last || '').replace('T', ' ').slice(0, 16))}</td>
    <td>${u.status === 'pending' ? '<button class="btn sm pri uAct" data-a="approve">승인</button> ' : u.status === 'active' ? '<button class="btn sm uAct" data-a="disable">사용중지</button> ' : '<button class="btn sm uAct" data-a="enable">다시 사용</button> '}<button class="btn sm uAct" data-a="pw">비밀번호 초기화</button> <button class="btn sm dan uAct" data-a="del">삭제</button></td></tr>`).join('')}</tbody></table>`;
  const act = async (id, body) => { try { await callServer(Object.assign({ op: 'userSet', uid: id }, body)); toast('저장했습니다'); render(); } catch (e) { toast(e.message, 1); render(); } };
  $$('#uList .uRole').forEach(s => s.onchange = () => act(s.closest('tr').dataset.u, { role: s.value }));
  $$('#uList .uAct').forEach(b => b.onclick = () => {
    const tr = b.closest('tr'), id = tr.dataset.u, role = tr.querySelector('.uRole').value, a = b.dataset.a;
    if (a === 'approve') act(id, { status: 'active', role });
    else if (a === 'enable') act(id, { status: 'active' });
    else if (a === 'disable') confirmBox(`${id} 계정을 사용중지할까요? (즉시 로그아웃됩니다)`, () => act(id, { status: 'disabled' }));
    else if (a === 'pw') { const pw = prompt(`${id} 의 새 비밀번호 (6자 이상)`); if (pw) act(id, { pw }); }
    else if (a === 'del') confirmBox(`${id} 계정을 삭제할까요?`, async () => { try { await callServer({ op: 'userDel', uid: id }); toast('삭제했습니다'); } catch (e) { toast(e.message, 1); } render(); });
  });
}
