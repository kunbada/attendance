/* ===================== 로그인 (통합관리 서버 계정) ===================== */
// 계정·권한은 통합관리에서 만든다 (관리자·보조관리자=관리자, 계약담당=쓰기, 열람=읽기전용). 이 앱은 로그인만 한다.
const needLogin = () => !!META.syncUrl && !(SESSION && SESSION.url === META.syncUrl && SESSION.st);
const srvProjects = () => LS.get('bunyang.srvProjects', []);

async function initAuth() {
  if (!META.syncUrl) { updateUserPill(); return; }
  if (!(SESSION && SESSION.url === META.syncUrl && SESSION.st)) { showLogin(); return; }
  try {
    await fetchProjects();
    if (META.pk) { const m = await callServer({ op: 'me' }, true); setSession(Object.assign({}, SESSION, { role: m.role, name: m.name })); }
  } catch (e) { if (e.code === 'AUTH') { setSession(null); showLogin(); } else if (e.code === 'FORBIDDEN' || e.code === 'NO_PROJECT') pickProject(); }
  updateUserPill();
}
// 서버의 현장 목록을 받아 둔다. 지금 현장이 목록에 없으면 고르게 한다
async function fetchProjects() {
  if (!META.syncUrl || needLogin()) return;
  const r = await callServer({ op: 'projects' }, true);
  LS.set('bunyang.srvProjects', (r.projects || []).map(p => ({ id: p.id, name: p.name })));
  if (!srvProjects().some(p => p.id === PROJ)) pickProject();
}
function switchProject(id) { LS.set('bunyang.current', id); location.reload(); }
function pickProject() {
  const list = srvProjects();
  if (list.length === 1) return switchProject(list[0].id);
  openModal({
    title: '현장 선택', body: list.length ? `<div class="help" style="margin-bottom:10px">작업할 현장을 고르세요. (현장은 통합관리에서 만듭니다)</div><div style="display:flex;flex-direction:column;gap:6px">${list.map(p => `<button class="btn pri pj" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join('')}</div>` : '<div class="banner">이 계정에 지정된 현장이 없습니다. 통합관리에서 현장 접근 권한을 확인하세요.</div>',
    foot: '<button class="btn" onclick="closeModal()">닫기</button>',
    onOpen: bg => bg.querySelectorAll('.pj').forEach(b => b.onclick = () => switchProject(b.dataset.id))
  });
}

function showLogin() {
  let bg = $('#loginBg'); if (!bg) { bg = document.createElement('div'); bg.id = 'loginBg'; document.body.appendChild(bg); }
  const f = (id, label, type) => `<div class="f full"><label>${label}</label><input class="in" id="${id}" type="${type || 'text'}" autocomplete="${type === 'password' ? 'current-password' : 'username'}"></div>`;
  bg.innerHTML = `<div class="loginBox"><h2>${esc(CFG().project.name || '분양계약관리')}</h2><div class="sub" style="margin-bottom:12px">계약·수금관리 시스템</div>
    <div class="form">${f('aId', '아이디')}${f('aPw', '비밀번호', 'password')}</div>
    <div class="help" style="margin-top:6px">통합관리에서 쓰는 계정으로 로그인합니다.</div>
    <div id="aMsg" class="red" style="min-height:20px;margin:8px 0;font-size:12px"></div>
    <button class="btn pri" id="aGo" style="width:100%;padding:9px">로그인</button></div>`;
  const go = async () => {
    const id = $('#aId').value.trim(), pw = $('#aPw').value, msg = $('#aMsg'), btn = $('#aGo');
    if (!id || !pw) { msg.textContent = '아이디와 비밀번호를 입력하세요'; return; }
    btn.disabled = true; msg.textContent = '';
    try {
      const r = await callServer({ op: 'login', id, pw }, true);
      setSession({ st: r.token, id, name: (r.account || {}).name || id, role: 'read' });
      if ((r.account || {}).mustChangePassword) {
        const np = prompt('처음 로그인입니다. 새 비밀번호를 입력하세요 (8자 이상, 영문+숫자)');
        if (!np) { setSession(null); throw new Error('비밀번호를 바꿔야 사용할 수 있습니다'); }
        await callServer({ op: 'changePw', old: pw, pw: np });
      }
      LS.set('bunyang.srvProjects', (r.projects || []).map(p => ({ id: p.id, name: p.name })));
      bg.remove();
      if (!srvProjects().some(p => p.id === PROJ)) return pickProject();
      const m = await callServer({ op: 'me' }, true); setSession(Object.assign({}, SESSION, { role: m.role, name: m.name }));
      render(); sync({ full: !META.lastRev });
    } catch (e) { if (!$('#loginBg')) showLogin(); const mm = $('#aMsg'); if (mm) mm.textContent = e.message; const b = $('#aGo'); if (b) b.disabled = false; }
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
}
function userMenu() {
  if (!(SESSION && SESSION.url === META.syncUrl)) return showLogin();
  openModal({
    title: '내 계정', body: `<div class="kv"><div>이름</div><div><b>${esc(SESSION.name)}</b> (${esc(SESSION.id)})</div><div>권한</div><div>${ROLE_L[ROLE()]}</div></div>
    <h4 style="margin:14px 0 6px">비밀번호 변경</h4><div class="form"><div class="f"><label>현재 비밀번호</label><input class="in" type="password" id="pwOld"></div><div class="f"><label>새 비밀번호 (8자 이상, 영문+숫자)</label><input class="in" type="password" id="pwNew"></div></div>`,
    foot: `<button class="btn dan" id="uOut" style="margin-right:auto">로그아웃</button><button class="btn" onclick="closeModal()">닫기</button><button class="btn pri" id="uPw">비밀번호 변경</button>`,
    onOpen: bg => {
      bg.querySelector('#uPw').onclick = async () => { try { await callServer({ op: 'changePw', old: $('#pwOld').value, pw: $('#pwNew').value }); toast('비밀번호를 변경했습니다'); closeModal(); } catch (e) { toast(e.message, 1); } };
      bg.querySelector('#uOut').onclick = async () => { try { await callServer({ op: 'logout' }, true); } catch (e) { } closeModal(); setSession(null); showLogin(); };
    }
  });
}
