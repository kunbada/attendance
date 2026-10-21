// 고객관리 > 설문고객: 설문 목록·빌더(공통 문항 은행 + 현장 고유 문항), 배포 링크·QR, 응답 원장, 통계
(function () {
  var simpleTable = Hub.simpleTable, downloadCsv = Hub.downloadCsv, DATE_STYLE = Hub.DATE_STYLE, statCard = Hub.statCard;
  var STATUS_BADGE = { '작성': '', '진행': 'ok', '마감': 'warn' };
  var TYPE_LABEL = { text: '짧은 글', textarea: '긴 글', number: '숫자', radio: '한 가지 선택', checkbox: '여러 개 선택', select: '목록에서 선택' };
  var CHOICE = ['radio', 'checkbox', 'select'];
  var root = null;
  var view = { mode: 'list', surveyId: '', tab: 'links' };
  var editing = null, bank = null;

  function baseUrl() { return location.href.replace(/hub\/.*$/, ''); }
  function linkUrl(code) { return baseUrl() + 's/?c=' + code; }

  async function render(r) {
    root = r;
    if (view.mode === 'edit') return renderEditor();
    if (view.mode === 'detail') { try { return await renderDetail(); } catch (e) { view.mode = 'list'; } }
    return renderList();
  }

  // ====================================================================
  // 설문 목록
  // ====================================================================
  async function renderList() {
    var res = await Api.call('survey.list');
    root.innerHTML = '';
    var add = h('button', { type: 'button', class: 'btn small primary' }, '+ 새 설문');
    add.addEventListener('click', function () { runBusy(add, newSurvey); });
    root.appendChild(h('div', { class: 'toolbar' }, h('strong', null, '설문 (' + res.surveys.length + ')'), add,
      h('span', { class: 'muted' }, '고객이 휴대폰으로 응답하는 설문입니다. 설문마다 팀·직원별 배포 링크(QR)를 만들어 응답을 집계합니다.')));
    var rows = res.surveys.map(function (s) {
      var b = function (label, fn, cls) { var x = h('button', { type: 'button', class: 'btn small ' + (cls || '') }, label); x.addEventListener('click', function () { runBusy(x, fn); }); return [x, ' ']; };
      return h('tr', null, h('td', null, h('strong', null, s.title)), h('td', null, h('span', { class: 'badge ' + STATUS_BADGE[s.status] }, s.status)),
        h('td', null, s.questionCount + '문항'), h('td', null, s.responses + '건' + (s.today ? ' (오늘 ' + s.today + ')' : '')), h('td', null, s.links + '개'),
        h('td', { class: 'muted' }, s.updatedAt.slice(0, 10)),
        h('td', null, [
          b('링크·QR', function () { return openDetail(s.id, 'links'); }, 'primary'), b('결과', function () { return openDetail(s.id, 'stats'); }),
          b('편집', function () { return editSurvey(s.id); }),
          b(s.status === '진행' ? '마감' : '진행', async function () { await Api.call('survey.setStatus', { surveyId: s.id, status: s.status === '진행' ? '마감' : '진행' }); await renderList(); }),
          b('삭제', async function () {
            if (!confirm('"' + s.title + '" 설문을 삭제할까요? (응답이 있으면 삭제되지 않습니다)')) return;
            await Api.call('survey.delete', { surveyId: s.id }); await renderList(); toast('삭제했습니다.');
          }, 'danger')]));
    });
    root.appendChild(simpleTable(['설문', '상태', '문항', '응답', '링크', '수정일', ''], rows));
  }

  async function loadBank() { if (!bank) bank = await Api.call('survey.bank'); return bank; }

  async function newSurvey() {
    var b = await loadBank();
    editing = {
      id: '', title: '', description: '', theme: '#2f6fb3', status: '진행', consentText: b.defaultConsentText,
      questions: b.defaults.map(function (k) { return stdQuestion(b, k); })
    };
    view.mode = 'edit'; renderEditor();
  }

  async function editSurvey(id) {
    await loadBank();
    editing = (await Api.call('survey.get', { surveyId: id })).survey;
    view.mode = 'edit'; renderEditor();
  }

  function stdQuestion(b, key) {
    var s = b.bank.filter(function (x) { return x.key === key; })[0];
    return { key: s.key, std: true, type: s.type, title: s.title, required: !!s.required, options: JSON.parse(JSON.stringify(s.options || [])), editableOptions: !!s.editableOptions, forceRequired: !!s.forceRequired, pii: !!s.pii };
  }

  // ====================================================================
  // 설문 빌더
  // ====================================================================
  function renderEditor() {
    root.innerHTML = '';
    var title = h('input', { type: 'text', value: editing.title, maxLength: 80, placeholder: '예: 양주역 사전판촉 설문' });
    var desc = h('textarea', { rows: 2, maxLength: 500, placeholder: '응답자에게 처음 보이는 안내 문구' }, editing.description);
    var theme = h('input', { type: 'color', value: editing.theme || '#2f6fb3', style: 'width:60px;height:40px;padding:0;border:0' });
    var status = h('select', null, ['작성', '진행', '마감'].map(function (s) { return option(s, s, editing.status === s); }));
    var consent = h('textarea', { rows: 6, maxLength: 3000 }, editing.consentText);
    var qbox = h('div');

    function drawQuestions() {
      qbox.innerHTML = '';
      editing.questions.forEach(function (q, i) { qbox.appendChild(questionCard(q, i, drawQuestions)); });
    }
    drawQuestions();

    // 공통 문항 은행에서 추가
    var used = function () { return editing.questions.map(function (q) { return q.key; }); };
    var pick = h('select');
    function fillPick() {
      pick.innerHTML = '';
      pick.appendChild(option('', '공통 문항 은행에서 추가…'));
      bank.bank.filter(function (b) { return used().indexOf(b.key) < 0; }).forEach(function (b) { pick.appendChild(option(b.key, b.title + (b.required ? ' (필수 권장)' : '') + (b.pii ? ' · 개인정보' : ''))); });
    }
    fillPick();
    pick.addEventListener('change', function () {
      if (!pick.value) return;
      editing.questions.push(stdQuestion(bank, pick.value));
      drawQuestions(); fillPick();
    });
    var customType = h('select', null, Object.keys(TYPE_LABEL).map(function (t) { return option(t, TYPE_LABEL[t]); }));
    var addCustom = h('button', { type: 'button', class: 'btn small' }, '+ 직접 만든 문항');
    addCustom.addEventListener('click', function () {
      editing.questions.push({ key: '', std: false, type: customType.value, title: '', required: false, options: CHOICE.indexOf(customType.value) >= 0 ? [{ code: '', label: '' }, { code: '', label: '' }] : [] });
      drawQuestions(); fillPick();
    });

    var save = h('button', { type: 'button', class: 'btn primary', style: 'max-width:200px' }, '저장');
    save.addEventListener('click', function () {
      runBusy(save, async function () {
        editing.title = title.value; editing.description = desc.value; editing.theme = theme.value; editing.status = status.value; editing.consentText = consent.value;
        var res = await Api.call('survey.save', {
          id: editing.id, title: editing.title, description: editing.description, theme: editing.theme, status: editing.status, consentText: editing.consentText,
          questions: editing.questions.map(function (q) { return { key: q.key, type: q.type, title: q.title, required: q.required, options: q.options }; })
        });
        toast('저장했습니다.');
        view.mode = 'detail'; view.surveyId = res.id; view.tab = 'links';
        await render(root);
      });
    });
    var cancel = h('button', { type: 'button', class: 'btn', style: 'max-width:120px' }, '취소');
    cancel.addEventListener('click', function () { view.mode = 'list'; runBusy(cancel, function () { return render(root); }); });

    root.appendChild(h('div', { class: 'card' }, h('h2', null, editing.id ? '설문 편집' : '새 설문'),
      field('설문 제목', title), field('안내 문구', desc), h('div', { class: 'toolbar' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, '응답 화면 색'), theme), field('상태', status))));
    root.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '개인정보 수집·이용 동의 문구'),
      h('p', { class: 'muted' }, '응답 화면 맨 앞에 나옵니다. 고객이 동의하지 않아도 참여할 수 있고, 이 경우 이름·연락처는 저장하지 않고 응답 내용만 익명으로 집계됩니다. 기본 문구는 임시 문구이므로 운영 전에 회사에서 확정한 문구로 바꿔 주세요.'), consent));
    root.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '문항'),
      h('p', { class: 'muted' }, '공통 문항은 현장이 달라도 같은 기준으로 합산·비교됩니다 (보기 코드가 고정). 문구는 다듬어도 됩니다. "분양 의향"은 필수 문항입니다.'), qbox,
      h('div', { class: 'toolbar' }, pick, customType, addCustom)));
    root.appendChild(h('div', { class: 'toolbar' }, save, cancel));
  }

  function questionCard(q, i, redraw) {
    var title = h('input', { type: 'text', value: q.title, maxLength: 150, placeholder: '문항 제목' });
    title.addEventListener('input', function () { q.title = title.value; });
    var req = h('input', { type: 'checkbox', checked: q.required || q.forceRequired, disabled: !!q.forceRequired });
    req.addEventListener('change', function () { q.required = req.checked; });
    var mv = function (label, d) {
      var b = h('button', { type: 'button', class: 'btn small' }, label);
      b.addEventListener('click', function () { var j = i + d; if (j < 0 || j >= editing.questions.length) return; var a = editing.questions; var t = a[i]; a[i] = a[j]; a[j] = t; redraw(); });
      return b;
    };
    var del = h('button', { type: 'button', class: 'btn small danger' }, '삭제');
    del.addEventListener('click', function () { editing.questions.splice(i, 1); redraw(); renderEditorPick(); });
    var head = h('div', { class: 'toolbar' }, h('strong', null, (i + 1) + '.'),
      q.std ? h('span', { class: 'badge ok' }, '공통 ' + q.key) : h('span', { class: 'badge' }, TYPE_LABEL[q.type]),
      q.pii ? h('span', { class: 'badge warn' }, '개인정보 동의 시에만') : null, mv('↑', -1), mv('↓', 1), del);
    var body = [head, field('제목', title), h('label', { class: 'check' }, req, ' 필수 응답')];
    // 보기: 직접 만든 선택형 문항, 그리고 구간을 조정할 수 있는 공통 문항(관심 타입·예상 자금)
    if ((!q.std && CHOICE.indexOf(q.type) >= 0) || q.editableOptions) {
      var obox = h('div');
      var drawOpts = function () {
        obox.innerHTML = '';
        q.options.forEach(function (o, k) {
          var inp = h('input', { type: 'text', value: o.label, maxLength: 60, placeholder: '보기 ' + (k + 1) });
          inp.addEventListener('input', function () { o.label = inp.value; });
          var x = h('button', { type: 'button', class: 'btn small' }, '✕');
          x.addEventListener('click', function () { q.options.splice(k, 1); drawOpts(); });
          obox.appendChild(h('div', { class: 'toolbar' }, inp, x));
        });
        var add = h('button', { type: 'button', class: 'btn small' }, '+ 보기 추가');
        add.addEventListener('click', function () { q.options.push({ code: '', label: '' }); drawOpts(); });
        obox.appendChild(add);
      };
      drawOpts();
      body.push(h('div', { class: 'field' }, h('span', { class: 'field-label' }, '보기 (이미 응답이 있는 보기는 삭제보다 이름 수정을 권장합니다)'), obox));
    } else if (q.std && q.options && q.options.length) {
      body.push(h('p', { class: 'muted' }, '보기(고정): ' + q.options.map(function (o) { return o.label; }).join(' / ')));
    }
    return h('div', { class: 'card', style: 'background:#fafbfd' }, body);
  }
  function renderEditorPick() { /* 공통 문항 목록은 다음 그리기 때 다시 채워진다 */ }

  // ====================================================================
  // 설문 상세: 링크·QR / 응답 원장 / 통계
  // ====================================================================
  async function openDetail(id, tab) { view.mode = 'detail'; view.surveyId = id; view.tab = tab || 'links'; await render(root); }

  async function renderDetail() {
    var sv = (await Api.call('survey.get', { surveyId: view.surveyId })).survey;
    root.innerHTML = '';
    var back = h('button', { type: 'button', class: 'btn small' }, '← 설문 목록');
    back.addEventListener('click', function () { view.mode = 'list'; runBusy(back, function () { return render(root); }); });
    var tabs = h('div', { class: 'tabs no-print' });
    [['links', '배포 링크·QR'], ['responses', '응답 원장'], ['stats', '통계']].forEach(function (t) {
      var b = h('button', { type: 'button', class: 'tab' + (view.tab === t[0] ? ' active' : '') }, t[1]);
      b.addEventListener('click', function () { view.tab = t[0]; runBusy(b, function () { return render(root); }); });
      tabs.appendChild(b);
    });
    root.appendChild(h('div', { class: 'toolbar no-print' }, back, h('strong', null, sv.title), h('span', { class: 'badge ' + STATUS_BADGE[sv.status] }, sv.status)));
    root.appendChild(tabs);
    var box = h('div');
    root.appendChild(box);
    if (view.tab === 'links') await renderLinks(box, sv);
    else if (view.tab === 'responses') await renderResponses(box, sv);
    else await renderStats(box, sv);
  }

  // ----- 링크 -----
  async function renderLinks(box, sv) {
    var res = await Api.call('survey.linkList', { surveyId: sv.id });
    await Hub.loadOrgs(); await Hub.loadStaff();
    var state = Hub.state;
    box.innerHTML = '';
    var again = function () { return renderLinks(box, sv); };
    var gen = h('button', { type: 'button', class: 'btn small primary' }, '본부·팀 링크 일괄 만들기');
    gen.addEventListener('click', function () { runBusy(gen, async function () { var r = await Api.call('survey.linkGenerate', { surveyId: sv.id }); await again(); toast(r.made ? r.made + '개 만들었습니다.' : '새로 만들 링크가 없습니다.'); }); });
    var addStaff = h('button', { type: 'button', class: 'btn small' }, '+ 직원 개인 링크');
    addStaff.addEventListener('click', function () {
      var sel = h('select', null, option('', '직원을 선택해 주세요'), state.staff.filter(function (s) { return s.status === '활동'; }).map(function (s) { return option(s.id, s.name + (s.nickname ? ' (' + s.nickname + ')' : '') + ' · ' + s.job); }));
      modal('직원 개인 링크', h('div', null, h('p', { class: 'muted' }, '직원이 직원 앱의 [내 설문 QR]에서도 자기 링크를 받을 수 있습니다. 이 링크로 들어온 응답은 그 직원의 실적으로 집계됩니다.'), field('직원', sel)), [{
        label: '만들기', primary: true, onClick: async function (close) { await Api.call('survey.linkSave', { surveyId: sv.id, kind: '직원', staffId: sel.value }); close(); await again(); toast('만들었습니다.'); }
      }]);
    });
    var addEtc = h('button', { type: 'button', class: 'btn small' }, '+ 기타 링크 (현수막·문자 등)');
    addEtc.addEventListener('click', function () {
      var label = h('input', { type: 'text', maxLength: 40, placeholder: '예: 현수막, 문자 발송' });
      modal('기타 링크', h('div', null, field('링크 이름', label)), [{
        label: '만들기', primary: true, onClick: async function (close) { await Api.call('survey.linkSave', { surveyId: sv.id, kind: '기타', label: label.value }); close(); await again(); toast('만들었습니다.'); }
      }]);
    });
    box.appendChild(h('div', { class: 'toolbar' }, gen, addStaff, addEtc,
      h('span', { class: 'muted' }, '응답은 링크로 집계됩니다. QR 을 인쇄하거나 링크를 문자·카톡으로 보내세요.' + (res.unlinked ? ' (링크 없는 응답 ' + res.unlinked + '건)' : ''))));
    var rows = res.links.map(function (l) {
      var who = l.kind === '본부' ? l.headName : l.kind === '팀' ? l.headName + ' ' + l.teamName : l.kind === '직원' ? l.personName + (l.teamName ? ' (' + l.headName + ' ' + l.teamName + ')' : '') : l.label;
      var qr = h('button', { type: 'button', class: 'btn small' }, 'QR·복사');
      qr.addEventListener('click', function () { showQr(sv, l, who); });
      var tg = h('button', { type: 'button', class: 'btn small' }, l.active ? '중지' : '사용');
      tg.addEventListener('click', function () { runBusy(tg, async function () { await Api.call('survey.linkToggle', { code: l.code, active: !l.active }); await again(); }); });
      return h('tr', null, h('td', null, l.kind), h('td', null, h('strong', null, who)), h('td', null, h('code', null, l.code)), h('td', null, l.responses + '건'),
        h('td', null, h('span', { class: 'badge ' + (l.active ? 'ok' : '') }, l.active ? '사용' : '중지')), h('td', null, [qr, ' ', tg]));
    });
    box.appendChild(simpleTable(['종류', '대상', '코드', '응답', '상태', ''], rows));
  }

  function showQr(sv, l, who) {
    var url = linkUrl(l.code);
    var qrBox = h('div', { class: 'qr-box' });
    var copy = h('button', { type: 'button', class: 'btn small' }, '링크 복사');
    copy.addEventListener('click', function () {
      if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('복사했습니다.'); }); else prompt('링크를 복사하세요', url);
    });
    var print = h('button', { type: 'button', class: 'btn small' }, '인쇄');
    print.addEventListener('click', function () { window.print(); });
    modal('설문 QR — ' + who, h('div', { class: 'qr-big' }, qrBox, h('p', { class: 'qr-title' }, sv.title), h('p', null, h('code', { style: 'word-break:break-all' }, url)), h('div', null, copy, ' ', print)), []);
    if (window.QRCode) new QRCode(qrBox, { text: url, width: 220, height: 220 });
    else qrBox.textContent = 'QR 라이브러리를 불러오지 못했습니다. 링크를 직접 전달해 주세요.';
  }

  // ----- 응답 원장 -----
  var ledgerRange = { from: '', to: '' };
  async function renderResponses(box, sv) {
    var res = await Api.call('survey.responses', { surveyId: sv.id, from: ledgerRange.from, to: ledgerRange.to, limit: 500 });
    box.innerHTML = '';
    var from = h('input', { type: 'date', value: ledgerRange.from, style: DATE_STYLE }), to = h('input', { type: 'date', value: ledgerRange.to, style: DATE_STYLE });
    var go = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    go.addEventListener('click', function () { ledgerRange = { from: from.value, to: to.value }; runBusy(go, function () { return renderResponses(box, sv); }); });
    var csv = h('button', { type: 'button', class: 'btn small' }, 'CSV 내보내기 (연락처 포함, 기록됨)');
    csv.addEventListener('click', function () {
      if (!confirm('동의한 응답의 이름·전화번호 원문이 들어간 파일을 만듭니다. 만든 기록이 남습니다. 계속할까요?')) return;
      runBusy(csv, async function () {
        var ex = await Api.call('survey.export', { surveyId: sv.id, from: ledgerRange.from, to: ledgerRange.to });
        var head = ['일시', '링크', '본부', '팀', '직원', '개인정보동의', '마케팅동의', '이름', '전화번호'].concat(ex.questions.filter(function (q) { return !q.pii; }).map(function (q) { return q.title; }));
        var rows = ex.rows.map(function (r) {
          return [r.at, r.linkLabel, r.head, r.team, r.person, r.consentPi ? '동의' : '미동의', r.consentMkt ? '동의' : '미동의', r.name, r.phone].concat(ex.questions.filter(function (q) { return !q.pii; }).map(function (q) {
            var v = r.answers[q.key]; return v === undefined ? '' : v;
          }));
        });
        downloadCsv('설문응답_' + sv.title + '.csv', [head].concat(rows));
        toast('내려받았습니다. 개인정보가 들어 있으니 안전하게 보관해 주세요.');
      });
    });
    box.appendChild(h('div', { class: 'toolbar' }, from, '~', to, go, csv, h('span', { class: 'muted' }, '총 ' + res.total + '건 (최근 ' + res.rows.length + '건 표시)')));
    var qs = res.questions.filter(function (q) { return !q.pii; });
    var rows = res.rows.map(function (r) {
      return h('tr', null, h('td', null, r.at.slice(5, 16)), h('td', null, r.linkLabel + (r.team ? ' · ' + r.head + ' ' + r.team : '')), h('td', null, r.person),
        h('td', null, r.consentPi ? h('span', { class: 'badge ok' }, '동의') : h('span', { class: 'badge' }, '미동의')),
        h('td', null, r.name), h('td', null, r.phone),
        qs.map(function (q) { var v = r.answers[q.key]; return h('td', null, v === undefined ? '' : String(v)); }));
    });
    box.appendChild(simpleTable(['일시', '링크', '직원', '개인정보', '이름', '연락처'].concat(qs.map(function (q) { return q.title; })), rows));
  }

  // ----- 통계 -----
  var statRange = { from: '', to: '' };
  async function renderStats(box, sv) {
    var st = await Api.call('survey.stats', { surveyId: sv.id, from: statRange.from, to: statRange.to });
    box.innerHTML = '';
    var from = h('input', { type: 'date', value: statRange.from, style: DATE_STYLE }), to = h('input', { type: 'date', value: statRange.to, style: DATE_STYLE });
    var go = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    go.addEventListener('click', function () { statRange = { from: from.value, to: to.value }; runBusy(go, function () { return renderStats(box, sv); }); });
    box.appendChild(h('div', { class: 'toolbar' }, from, '~', to, go));
    box.appendChild(h('div', { class: 'summary' }, statCard('총 응답', st.total + '건'), statCard('개인정보 동의', st.consentPi + '건', st.total ? Math.round(st.consentPi / st.total * 100) + '%' : ''),
      statCard('마케팅 수신 동의', st.consentMkt + '건'), st.intentAvg !== null ? statCard('분양 의향 평균', st.intentAvg + '점', '5점 만점') : null));
    st.questions.forEach(function (q) {
      var max = Math.max.apply(null, q.options.map(function (o) { return o.n; }).concat([1]));
      var rows = q.options.map(function (o) {
        return h('tr', null, h('td', null, o.label), h('td', null, o.n + '건'),
          h('td', { style: 'min-width:160px' }, h('div', { class: 'bar' }, h('span', { style: 'width:' + Math.round(o.n / max * 100) + '%' })), q.answered ? Math.round(o.n / q.answered * 100) + '%' : ''));
      });
      box.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, q.title + ' ', q.std ? h('span', { class: 'badge ok' }, '공통') : null), simpleTable(['보기', '응답', '비율'], rows)));
    });
    box.appendChild(h('div', { class: 'grid3' },
      h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '본부·팀별 응답'), simpleTable(['본부', '팀', '응답'], st.byTeam.map(function (t) { return h('tr', null, h('td', null, t.head), h('td', null, t.team), h('td', null, t.n)); }))),
      h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '직원별 응답 (상위 50)'), simpleTable(['직원', '응답'], st.byPerson.map(function (p) { return h('tr', null, h('td', null, p.name), h('td', null, p.n)); }))),
      h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '날짜별 응답'), simpleTable(['날짜', '응답'], st.byDate.map(function (d) { return h('tr', null, h('td', null, d.d), h('td', null, d.n)); })))));
  }

  Hub.section('surveyapp', { render: render });
})();
