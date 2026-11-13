// 상담고객 앱 (상담사, 데스크탑): 로그인(PIN + 텔레그램 인증번호), 신규 상담, 나의 고객, 나의 부동산업소
(function () {
  Api.setScope('counsel');
  var ME = null, OPT = null, REALTOR_CODE = '';
  var view = 'new';
  var SCALE = null;

  function show(id) { ['login', 'app'].forEach(function (x) { $('#screen-' + x).classList.toggle('hidden', x !== id); }); }
  function appBase() { return location.href.replace(/[?#].*$/, '').replace(/[^\/]*$/, ''); }

  // ---------- 버튼형 선택 ----------
  // multi: 여러 개 / 아니면 하나(다시 누르면 해제). onChange(값 또는 배열)
  function chips(options, value, multi, onChange, cls) {
    var sel = multi ? (value || []).slice() : value || '';
    var box = h('div', { class: 'chips ' + (cls || '') });
    options.forEach(function (o) {
      var label = typeof o === 'object' ? o.l : o;
      o = typeof o === 'object' ? o.v : o;
      var b = h('button', { type: 'button', 'data-v': o }, label);
      var on = multi ? sel.indexOf(o) >= 0 : sel === o;
      if (on) b.classList.add('on');
      b.addEventListener('click', function () {
        if (multi) {
          var i = sel.indexOf(o);
          if (i >= 0) sel.splice(i, 1); else sel.push(o);
          b.classList.toggle('on', i < 0);
        } else {
          sel = sel === o ? '' : o;
          $$('button', box).forEach(function (x) { x.classList.toggle('on', x.dataset.v === sel); });
        }
        onChange(multi ? sel.slice() : sel);
      });
      box.appendChild(b);
    });
    return box;
  }
  function sec(label, body, small) { return h('div', { class: 'cs-sec' }, h('div', { class: 'lbl' }, label, small ? h('small', null, small) : null), body); }
  function gradeTag(g) { return g ? h('span', { class: 'tag g-' + g }, g) : h('span', { class: 'sub' }, '-'); }

  // 고객 정보 입력 묶음 (신규·수정 공용). state 를 직접 고친다
  // 관심 타입: 프로젝트 주택형 기준표에서. 타입군 줄마다 "84타입(미정)" + 세부 주택형(84A·84B)
  function interestPicker(state) {
    var box = h('div');
    if (!OPT.groups.length) {
      box.appendChild(h('div', { class: 'notice warn', style: 'margin-top:0' }, '이 현장의 주택형이 아직 입력되지 않았습니다. 관리자에게 [통합관리 > 프로젝트 > 주택형·세대수] 입력을 요청해 주세요.'));
      return box;
    }
    // 맨 위: 아직 타입을 정하지 못한 고객
    box.appendChild(h('div', { style: 'display:flex;gap:10px;align-items:center;margin-bottom:6px' }, h('b', { style: 'min-width:64px;font-size:13px;color:#6b7686' }, '전체'),
      chips([{ v: '미정', l: '미정 (아직 모름)' }], state.interest.indexOf('미정') >= 0 ? ['미정'] : [], true, function (v) {
        state.interest = state.interest.filter(function (x) { return x !== '미정'; }).concat(v);
      })));
    OPT.groups.forEach(function (g) {
      var hasSub = OPT.types.some(function (t) { return t.grp === g.code && t.code !== g.code; });
      var opts = [{ v: g.code, l: g.label + (hasSub ? ' (미정)' : (g.units ? ' · ' + g.units + '세대' : '')) }].concat(OPT.types.filter(function (t) { return t.grp === g.code; })
        .filter(function (t) { return t.code !== g.code; }).map(function (t) { return { v: t.code, l: t.code + (t.units ? ' · ' + t.units + '세대' : '') }; }));
      var mine = state.interest.filter(function (v) { return opts.some(function (o) { return o.v === v; }); });
      box.appendChild(h('div', { style: 'display:flex;gap:10px;align-items:center;margin-bottom:6px' }, h('b', { style: 'min-width:64px;font-size:13px;color:#6b7686' }, g.label),
        chips(opts, mine, true, function (v) {
          state.interest = state.interest.filter(function (x) { return !opts.some(function (o) { return o.v === x; }); }).concat(v);
        })));
    });
    return box;
  }

  function profileForm(state) {
    var specialBox = h('div', { class: state.rank === '특별공급' ? '' : 'hidden', style: 'margin-top:10px' }, h('div', { class: 'sub', style: 'margin-bottom:6px' }, '특별공급 종류 (여러 개 선택 가능)'),
      chips(OPT.specials, state.special, true, function (v) { state.special = v; }, 'sub'));
    return h('div', null,
      sec('관심 타입', interestPicker(state), '여러 개 선택 · 세부 타입을 아직 모르면 "미정"'),
      sec('등급', chips(OPT.grades, state.grade, false, function (v) { state.grade = v; }, 'grade'), 'A 계약 유력 · B 관심 높음 · C 보통 · D 낮음'),
      sec('청약 순위', h('div', null, chips(OPT.ranks, state.rank, false, function (v) { state.rank = v; specialBox.classList.toggle('hidden', v !== '특별공급'); }), specialBox)),
      sec('개인정보 수집·이용 동의', chips(['동의', '미확인'], state.consent, false, function (v) { state.consent = v || '미확인'; })));
  }
  function noteForm(state) {
    var ta = h('textarea', { maxLength: 2000, placeholder: '상담 내용을 적어 주세요 (자금 계획, 관심 동·호, 다음 연락 일정 등)' }, state.content || '');
    ta.addEventListener('input', function () { state.content = ta.value; });
    return h('div', null, sec('상담 방식', chips(OPT.methods, state.method, false, function (v) { state.method = v; })), sec('상담 내용', ta));
  }

  // ---------- 로그인 ----------
  bindFormat($('#lg-phone'), formatPhone);
  bindFormat($('#lg-pin'), onlyDigits);
  bindFormat($('#lg-code'), onlyDigits);
  $('#form-login').addEventListener('submit', function (e) {
    e.preventDefault();
    runBusy($('#btn-otp'), async function () {
      var r = await Api.call('counsel.loginStart', { phone: $('#lg-phone').value, pin: $('#lg-pin').value });
      $('#otp-box').classList.remove('hidden');
      $('#lg-code').focus();
      toast(r.name + '님 텔레그램으로 인증번호를 보냈습니다. (5분 안에 입력)');
    });
  });
  $('#btn-resend').addEventListener('click', function () { $('#form-login').requestSubmit(); });
  function verify() {
    runBusy($('#btn-login'), async function () {
      var r = await Api.call('counsel.loginVerify', { phone: $('#lg-phone').value, code: $('#lg-code').value });
      Api.setToken(r.token);
      $('#lg-pin').value = ''; $('#lg-code').value = ''; $('#otp-box').classList.add('hidden');
      await enter();
    });
  }
  $('#btn-login').addEventListener('click', verify);
  $('#lg-code').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); verify(); } });
  $('#btn-logout').addEventListener('click', function () {
    runBusy($('#btn-logout'), async function () { try { await Api.call('auth.logout'); } catch (e) { /* 무시 */ } Api.setToken(''); show('login'); });
  });

  async function enter() {
    var me = await Api.call('counsel.me');
    ME = me.staff; OPT = me.options; REALTOR_CODE = me.realtorCode;
    $('#cs-site').textContent = (me.project ? me.project.name + ' · ' : '') + '상담고객';
    $('#cs-who').textContent = ME.name + (ME.nickname ? ' (' + ME.nickname + ')' : '') + ' · ' + ME.job;
    show('app');
    await go(view);
  }

  $('#cs-nav').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    runBusy(null, function () { return go(b.dataset.view); });
  });
  async function go(v) {
    view = v;
    $$('#cs-nav button').forEach(function (x) { x.classList.toggle('active', x.dataset.view === v); });
    var root = $('#cs-main');
    if (v === 'new') renderNew(root);
    else if (v === 'mine') await renderMine(root);
    else await renderRealtor(root);
    window.scrollTo(0, 0);
  }

  // ---------- 신규 상담 ----------
  function renderNew(root, preset) {
    root.innerHTML = '';
    var st = Object.assign({ phone: '', name: '', interest: [], grade: '', rank: '', special: [], consent: '미확인', method: '방문상담', content: '' }, preset || {});
    var phone = h('input', { type: 'tel', inputmode: 'numeric', placeholder: '010-0000-0000', value: st.phone });
    var name = h('input', { type: 'text', maxLength: 30, placeholder: '고객 이름', value: st.name });
    var info = h('div');
    bindFormat(phone, formatPhone);
    var timer = null, lastLooked = '';
    phone.addEventListener('input', function () {
      clearTimeout(timer);
      var d = onlyDigits(phone.value);
      if (d.length < 10) { info.innerHTML = ''; return; }
      timer = setTimeout(function () { lookup(d); }, 350);
    });
    async function lookup(d) {
      if (d === lastLooked) return; lastLooked = d;
      try {
        var r = await Api.call('counsel.lookup', { phone: d });
        info.innerHTML = '';
        if (!r.exists) { info.appendChild(h('div', { class: 'notice ok' }, '새 고객입니다.')); return; }
        var c = r.customer;
        if (c.name && !name.value) name.value = c.name;
        var line = (c.name || '(이름 없음)') + ' · 경로 ' + (c.channels.join('·') || '-') + (c.grade ? ' · ' + c.grade + '등급' : '');
        if (c.ownerIsMe) info.appendChild(h('div', { class: 'notice info' }, '내가 담당하는 고객입니다. ' + line + ' — 저장하면 정보가 바뀌고 상담 기록이 추가됩니다.'));
        else if (c.unowned) info.appendChild(h('div', { class: 'notice info' }, '이미 있는 고객입니다(담당 없음). ' + line + ' — 저장하면 내가 담당이 됩니다.'));
        else info.appendChild(h('div', { class: 'notice warn' }, '⚠ ' + c.owner + ' 상담사가 담당 중인 고객입니다. ' + line + ' — 저장하면 고객 정보는 바뀌지 않고 상담 기록만 남습니다(중복 상담으로 표시). 담당을 넘겨받으려면 그 상담사에게 [담당 포기]를 요청하세요.'));
      } catch (e) { /* 조회 실패는 저장 때 다시 확인된다 */ }
    }
    var save = h('button', { type: 'button', class: 'btn primary' }, '저장');
    var reset = h('button', { type: 'button', class: 'btn' }, '새로 쓰기');
    reset.addEventListener('click', function () { renderNew(root); });
    save.addEventListener('click', function () {
      runBusy(save, async function () {
        var r = await Api.call('counsel.save', { phone: phone.value, name: name.value, interest: st.interest, grade: st.grade, rank: st.rank, special: st.special, consent: st.consent, method: st.method, content: st.content });
        if (r.duplicate) {
          modal('중복 고객', h('div', null, h('p', null, h('b', null, r.owner + ' 상담사'), '가 담당 중인 고객입니다.'),
            h('p', { class: 'muted' }, r.noteAdded ? '고객 정보는 바꾸지 않고, 내 상담 기록만 남겼습니다. 나의 고객 목록에 "중복"으로 표시됩니다.' : '상담 내용이 없어 저장된 것이 없습니다.')), []);
        } else toast('저장했습니다.' + (r.noteAdded ? ' (상담 기록 추가)' : ''));
        renderNew(root);
      });
    });
    root.appendChild(h('h1', null, '신규 상담'));
    root.appendChild(h('div', { class: 'cs-cols' },
      h('div', { class: 'card' },
        sec('고객', h('div', null, h('div', { class: 'cs-row2' }, phone, name), info), '휴대폰 번호를 넣으면 이미 있는 고객인지 바로 알려 줍니다'),
        profileForm(st)),
      h('div', { class: 'card' }, noteForm(st), h('div', { class: 'cs-actions' }, save, reset))));
    setTimeout(function () { phone.focus(); }, 50);
  }

  // ---------- 나의 고객 ----------
  var mineF = { filter: '', q: '', grade: '', rank: '' };
  async function renderMine(root) {
    var r = await Api.call('counsel.customers', mineF);
    root.innerHTML = '';
    var again = function () { return renderMine(root); };
    var tab = function (label, key, n) {
      var b = h('button', { type: 'button', class: 'tabchip' + (mineF.filter === key ? ' on' : '') }, label, h('i', null, n));
      b.addEventListener('click', function () { mineF.filter = key; runBusy(null, again); });
      return b;
    };
    var q = h('input', { type: 'search', placeholder: '이름 또는 전화 뒤 4자리', value: mineF.q });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { mineF.q = q.value; runBusy(null, again); } });
    var g = h('select', null, option('', '등급 전체'), OPT.grades.map(function (x) { return option(x, x + '등급', mineF.grade === x); }));
    var rk = h('select', null, option('', '청약 순위 전체'), OPT.ranks.map(function (x) { return option(x, x, mineF.rank === x); }));
    [g, rk].forEach(function (el) { el.addEventListener('change', function () { mineF.grade = g.value; mineF.rank = rk.value; runBusy(null, again); }); });
    root.appendChild(h('h1', null, '나의 고객'));
    root.appendChild(h('div', { class: 'cs-bar' }, tab('전체', '', r.counts.all), tab('내 담당', '담당', r.counts.owner), tab('중복', '중복', r.counts.duplicate), tab('담당 없음', '담당없음', r.counts.unowned),
      h('span', { style: 'flex:1' }), q, g, rk));
    if (!r.customers.length) { root.appendChild(h('div', { class: 'empty' }, '고객이 없습니다. [신규 상담]에서 등록해 주세요.')); return; }
    var rows = r.customers.map(function (c) {
      var tr = h('tr', { class: 'click' },
        h('td', null, h('b', null, c.name || '(이름 없음)'), h('div', { class: 'sub' }, c.phone)),
        h('td', null, gradeTag(c.grade)),
        h('td', null, c.rank || '-', c.special.length ? h('div', { class: 'sub' }, c.special.join(', ')) : null),
        h('td', null, (c.interestLabel || c.interest).join(', ') || '-'),
        h('td', null, c.ownerIsMe ? h('span', { class: 'tag me' }, '나') : c.unowned ? h('span', { class: 'sub' }, '담당 없음') : c.owner),
        h('td', null, c.duplicate ? c.others.map(function (o) { return h('span', { class: 'tag dup' }, o); }) : h('span', { class: 'sub' }, '-')),
        h('td', null, c.notes + '회'), h('td', { class: 'sub' }, String(c.last || '').slice(0, 10)));
      tr.addEventListener('click', function () { runBusy(null, function () { return openCustomer(c.id, again); }); });
      return tr;
    });
    root.appendChild(h('table', { class: 'cs-table' }, h('thead', null, h('tr', null, ['고객', '등급', '청약 순위', '관심 타입', '담당', '다른 상담사(중복)', '상담', '최근'].map(function (x) { return h('th', null, x); }))), h('tbody', null, rows)));
  }

  function timelineBox(items, onDelete) {
    var box = h('div', { class: 'tl' });
    if (!items.length) box.appendChild(h('p', { class: 'muted' }, '이력이 없습니다.'));
    items.forEach(function (t) {
      var del = null;
      if (t.mine && t.noteId) {
        del = h('button', { type: 'button', class: 'x' }, '삭제');
        del.addEventListener('click', function () { if (confirm('이 상담 기록을 지울까요?')) runBusy(null, function () { return onDelete(t.noteId); }); });
      }
      box.appendChild(h('div', { class: 'tl-item' },
        h('div', { class: 'tl-head' }, h('span', { class: 'tag' }, t.type), h('b', null, t.title || ''), h('span', null, String(t.at || '').slice(0, 16)), t.by ? h('span', null, '· ' + t.by) : null, del),
        t.text ? h('div', { class: 'tl-text' }, t.text) : null));
    });
    return box;
  }

  async function openCustomer(id, after) {
    var d = await Api.call('counsel.get', { id: id });
    var c = d.customer, changed = false;
    var body = h('div');
    var m = modal((c.name || '(이름 없음)') + ' 고객', body, [], { wide: true });
    var overlay = document.querySelector('.modal-overlay:last-of-type');
    if (overlay) new MutationObserver(function (_, ob) { if (!document.body.contains(overlay)) { ob.disconnect(); if (changed) runBusy(null, after); } }).observe(document.body, { childList: true });
    if (d.limited) {
      var st0 = { method: '전화상담', content: '' };
      var add0 = h('button', { type: 'button', class: 'btn primary' }, '상담 기록 남기기');
      add0.addEventListener('click', function () { runBusy(add0, async function () { await Api.call('counsel.noteAdd', { id: id, method: st0.method, content: st0.content }); changed = true; toast('기록했습니다. (중복 상담으로 표시)'); m.close(); }); });
      body.appendChild(h('div', { class: 'notice warn' }, c.owner + ' 상담사가 담당 중인 고객입니다. 고객 정보와 이력은 담당 상담사만 볼 수 있습니다. 상담했다면 기록은 남길 수 있습니다(중복 표시).'));
      body.appendChild(noteForm(st0)); body.appendChild(h('div', { class: 'cs-actions' }, add0));
      return;
    }
    var st = { name: c.name, interest: c.interest.slice(), grade: c.grade && c.gradeSource === '수동' ? c.grade : c.grade, rank: c.rank, special: c.special.slice(), consent: c.consent === '동의' ? '동의' : '미확인' };
    var left = h('div');
    left.appendChild(h('div', { class: 'phone' }, c.phone));
    left.appendChild(h('div', { style: 'margin:6px 0 12px' }, c.channels.map(function (x) { return h('span', { class: 'tag' }, x); }),
      c.ownerIsMe ? h('span', { class: 'tag me' }, '내 담당') : c.unowned ? h('span', { class: 'tag' }, '담당 없음') : h('span', { class: 'tag dup' }, '담당 ' + c.owner),
      c.duplicate ? h('span', { class: 'tag dup' }, '중복: ' + c.others.join(', ')) : null));
    var own = h('div', { class: 'cs-actions', style: 'margin:0 0 14px' });
    if (c.ownerIsMe) {
      var rel = h('button', { type: 'button', class: 'btn' }, '담당 포기');
      rel.addEventListener('click', function () { if (confirm('이 고객의 담당을 포기할까요? 다른 상담사가 [담당 받기]로 이어받을 수 있습니다.')) runBusy(rel, async function () { await Api.call('counsel.release', { id: id }); changed = true; toast('담당을 포기했습니다.'); m.close(); }); });
      own.appendChild(rel);
    } else if (c.unowned) {
      var tk = h('button', { type: 'button', class: 'btn primary' }, '담당 받기');
      tk.addEventListener('click', function () { runBusy(tk, async function () { await Api.call('counsel.take', { id: id }); changed = true; toast('내 담당이 되었습니다.'); m.close(); await openCustomer(id, after); }); });
      own.appendChild(tk);
    }
    left.appendChild(own);
    if (c.canEdit) {
      var nm = h('input', { type: 'text', maxLength: 30, value: c.name || '', placeholder: '이름' });
      nm.addEventListener('input', function () { st.name = nm.value; });
      left.appendChild(sec('이름', nm));
      left.appendChild(profileForm(st));
      var sv = h('button', { type: 'button', class: 'btn primary' }, '고객 정보 저장');
      sv.addEventListener('click', function () { runBusy(sv, async function () { await Api.call('counsel.update', { id: id, name: st.name, interest: st.interest, grade: st.grade, rank: st.rank, special: st.special, consent: st.consent }); changed = true; toast('저장했습니다.'); }); });
      left.appendChild(h('div', { class: 'cs-actions' }, sv));
    } else {
      left.appendChild(h('p', { class: 'muted' }, '담당 상담사만 고객 정보를 고칠 수 있습니다. 등급 ' + (c.grade || '-') + ' · ' + (c.rank || '순위 미입력') + ' · 관심 ' + ((c.interestLabel || c.interest).join(', ') || '-')));
    }
    var right = h('div');
    var ns = { method: '전화상담', content: '' };
    var nf = h('div'); nf.appendChild(noteForm(ns));
    var addBtn = h('button', { type: 'button', class: 'btn primary' }, '상담 기록 추가');
    var tl = h('div');
    function drawTl(items) { tl.innerHTML = ''; tl.appendChild(timelineBox(items, async function (noteId) { await Api.call('counsel.noteDelete', { noteId: noteId }); changed = true; drawTl((await Api.call('counsel.get', { id: id })).timeline); })); }
    addBtn.addEventListener('click', function () {
      runBusy(addBtn, async function () {
        await Api.call('counsel.noteAdd', { id: id, method: ns.method, content: ns.content });
        changed = true; ns.content = ''; nf.innerHTML = ''; nf.appendChild(noteForm(ns));
        drawTl((await Api.call('counsel.get', { id: id })).timeline); toast('기록했습니다.');
      });
    });
    drawTl(d.timeline);
    right.appendChild(nf); right.appendChild(h('div', { class: 'cs-actions', style: 'margin-top:0' }, addBtn));
    right.appendChild(h('h3', { style: 'margin:18px 0 0' }, '전체 이력 (상담·설문·방문·부동산·계약)')); right.appendChild(tl);
    body.appendChild(h('div', { class: 'cs-detail' }, left, right));
  }

  // ---------- 나의 부동산업소 ----------
  var rtF = { filter: '', q: '' };
  var MGM_TAG = { '참여': 'g-C', '고려중': 'g-B', '불참': 'g-D' };
  async function renderRealtor(root) {
    var r = await Api.call('counsel.realtors', rtF);
    SCALE = r.scale;
    root.innerHTML = '';
    var again = function () { return renderRealtor(root); };
    var tab = function (label, key, n) {
      var b = h('button', { type: 'button', class: 'tabchip' + (rtF.filter === key ? ' on' : '') }, label, h('i', null, n));
      b.addEventListener('click', function () { rtF.filter = key; runBusy(null, again); });
      return b;
    };
    var q = h('input', { type: 'search', placeholder: '상호·이름·주소', value: rtF.q });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { rtF.q = q.value; runBusy(null, again); } });
    var openR = h('button', { type: 'button', class: 'btn primary', style: 'width:auto' }, '부동산 조사하기 ↗');
    openR.addEventListener('click', function () {
      if (!REALTOR_CODE) { toast('이 현장의 부동산 조사 링크가 없거나 중지되었습니다. 관리자에게 문의해 주세요.', true); return; }
      window.open(appBase() + 'r/?c=' + REALTOR_CODE, '_blank');
    });
    root.appendChild(h('h1', null, '나의 부동산업소', h('span', { style: 'flex:1' }), openR));
    root.appendChild(h('p', { class: 'muted', style: 'margin:-6px 0 12px' }, '이 앱에 로그인한 상태에서 [부동산 조사하기]로 조사하면 내가 조사한 업소로 기록되고, 담당이 없던 업소는 내 담당이 됩니다. 조사 후 이 화면을 새로 열어 주세요.'));
    root.appendChild(h('div', { class: 'cs-bar' }, tab('전체', '', r.counts.all), tab('내 담당', '담당', r.counts.owner), tab('중복', '중복', r.counts.duplicate), h('span', { style: 'flex:1' }), q));
    if (!r.offices.length) { root.appendChild(h('div', { class: 'empty' }, '아직 조사한 중개업소가 없습니다.')); return; }
    var rows = r.offices.map(function (o) {
      var tr = h('tr', { class: 'click' },
        h('td', null, h('b', null, o.officeName), h('div', { class: 'sub' }, o.address || '-')),
        h('td', null, o.name ? o.name + (o.position ? ' ' + o.position : '') : '-', o.phone ? h('div', { class: 'sub' }, o.phone) : null),
        h('td', null, SCALE.market[o.market] || '-'), h('td', null, SCALE.intent[o.intent] || '-'), h('td', null, SCALE.refer[o.refer] || '-'),
        h('td', null, o.referCount + '명'), h('td', null, o.mgm ? h('span', { class: 'tag ' + (MGM_TAG[o.mgm] || '') }, o.mgm) : '-'),
        h('td', null, o.ownerIsMe ? h('span', { class: 'tag me' }, '나') : o.unowned ? h('span', { class: 'sub' }, '담당 없음') : o.owner),
        h('td', null, o.duplicate ? o.others.map(function (x) { return h('span', { class: 'tag dup' }, x); }) : h('span', { class: 'sub' }, '-')),
        h('td', null, '내 ' + o.myCount + ' / ' + o.count + '회', h('div', { class: 'sub' }, String(o.last).slice(0, 10))));
      tr.addEventListener('click', function () { runBusy(null, function () { return openOffice(o.id, again); }); });
      return tr;
    });
    root.appendChild(h('table', { class: 'cs-table' }, h('thead', null, h('tr', null, ['중개업소', '대표·담당', '시장 동향', '분양 의향', '소개 의향', '소개 가능', 'MGM', '담당', '다른 상담사(중복)', '조사'].map(function (x) { return h('th', null, x); }))), h('tbody', null, rows)));
  }

  async function openOffice(id, after) {
    var d = await Api.call('counsel.realtorGet', { id: id });
    var o = d.office, sc = d.scale, changed = false;
    var body = h('div');
    var m = modal(o.officeName, body, [], { wide: true });
    var overlay = document.querySelector('.modal-overlay:last-of-type');
    if (overlay) new MutationObserver(function (_, ob) { if (!document.body.contains(overlay)) { ob.disconnect(); if (changed) runBusy(null, after); } }).observe(document.body, { childList: true });
    var own = h('div', { class: 'cs-actions', style: 'margin:8px 0 14px' });
    if (o.ownerIsMe) {
      var rel = h('button', { type: 'button', class: 'btn' }, '담당 포기');
      rel.addEventListener('click', function () { if (confirm('이 중개업소의 담당을 포기할까요?')) runBusy(rel, async function () { await Api.call('counsel.realtorRelease', { id: id }); changed = true; toast('담당을 포기했습니다.'); m.close(); }); });
      own.appendChild(rel);
    } else if (o.unowned) {
      var tk = h('button', { type: 'button', class: 'btn primary' }, '담당 받기');
      tk.addEventListener('click', function () { runBusy(tk, async function () { await Api.call('counsel.realtorTake', { id: id }); changed = true; toast('내 담당이 되었습니다.'); m.close(); }); });
      own.appendChild(tk);
    }
    var left = h('div',  null,
      h('div', { class: 'phone' }, (o.name || '') + (o.position ? ' ' + o.position : '') + (o.mobile ? ' · ' + o.mobile : '')),
      h('div', { class: 'muted' }, '사무실 ' + (o.officeTel || '-') + ' · ' + (o.address || '주소 없음')),
      h('div', { style: 'margin:6px 0' }, o.ownerIsMe ? h('span', { class: 'tag me' }, '내 담당') : o.unowned ? h('span', { class: 'tag' }, '담당 없음') : h('span', { class: 'tag dup' }, '담당 ' + o.owner),
        o.duplicate ? h('span', { class: 'tag dup' }, '중복: ' + o.others.join(', ')) : null),
      own, h('h3', { style: 'margin:6px 0' }, '조사 이력'));
    d.responses.forEach(function (r) {
      left.appendChild(h('div', { class: 'tl-item' },
        h('div', { class: 'tl-head' }, h('b', null, r.at.slice(0, 16)), r.by ? h('span', null, '· 조사 ' + r.by) : h('span', null, '· 조사자 기록 없음')),
        h('div', { class: 'tl-text' }, '시장 ' + sc.market[r.market] + ' · 분양 의향 ' + sc.intent[r.intent] + ' · 소개 의향 ' + sc.refer[r.refer] + ' · 소개 가능 ' + r.referCount + '명' + (r.mgm ? ' · MGM ' + r.mgm : '') + (r.opinion ? '\n' + r.opinion : ''))));
    });
    var ns = { method: '전화상담', content: '' };
    var nf = h('div'); nf.appendChild(noteForm(ns));
    var addBtn = h('button', { type: 'button', class: 'btn primary' }, '상담 기록 추가');
    var list = h('div', { class: 'tl' });
    function drawNotes(notes) {
      list.innerHTML = '';
      if (!notes.length) list.appendChild(h('p', { class: 'muted' }, '상담 기록이 없습니다.'));
      notes.forEach(function (n) {
        list.appendChild(h('div', { class: 'tl-item' }, h('div', { class: 'tl-head' }, h('span', { class: 'tag' }, n.result || n.kind), h('span', null, String(n.at).slice(0, 16)), h('span', null, '· ' + n.by)), n.content ? h('div', { class: 'tl-text' }, n.content) : null));
      });
    }
    drawNotes(d.notes);
    addBtn.addEventListener('click', function () {
      runBusy(addBtn, async function () {
        await Api.call('counsel.realtorNote', { id: id, method: ns.method, content: ns.content });
        changed = true; ns.content = ''; nf.innerHTML = ''; nf.appendChild(noteForm(ns));
        drawNotes((await Api.call('counsel.realtorGet', { id: id })).notes); toast('기록했습니다.');
      });
    });
    body.appendChild(h('div', { class: 'cs-detail' }, left, h('div', null, nf, h('div', { class: 'cs-actions', style: 'margin-top:0' }, addBtn), h('h3', { style: 'margin:18px 0 0' }, '상담 기록'), list)));
  }

  // ---------- 시작 ----------
  (async function () {
    if (!Api.getToken()) { show('login'); return; }
    try { await enter(); } catch (e) { Api.setToken(''); show('login'); }
  })();
})();
