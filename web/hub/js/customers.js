// 고객관리: 설문고객(응답 고객 리스트), 고객 DB(설문·방문·외부 자료·계약을 한 고객으로, 등급·상태·담당·상담 기록)
(function () {
  var simpleTable = Hub.simpleTable, statCard = Hub.statCard, downloadCsv = Hub.downloadCsv, DATE_STYLE = Hub.DATE_STYLE;
  var GRADE_BADGE = { A: 'danger', B: 'warn', C: 'ok', D: '' };

  // ====================================================================
  // 설문고객: 설문에 응답한 고객 리스트 (필수 항목만)
  // ====================================================================
  var sq = '';
  async function renderRespondents(root) {
    var res = await Api.call('survey.respondents', { q: sq });
    var me = Hub.state.me || {};
    root.innerHTML = '';
    var openApp = h('button', { type: 'button', class: 'btn small primary' }, '설문관리(새창)');
    openApp.addEventListener('click', function () {
      if (!me.allowSurvey) { toast('이 계정에는 설문 관리 권한이 없습니다. 관리자에게 허용을 요청해 주세요.', true); return; }
      window.open('?app=survey', '_blank');
    });
    var dl = h('button', { type: 'button', class: 'btn small' }, '설문 결과 다운로드');
    dl.addEventListener('click', function () {
      if (!me.allowSurvey) { toast('이 계정에는 설문 결과 다운로드 권한이 없습니다. 관리자에게 허용을 요청해 주세요.', true); return; }
      runBusy(dl, openDownload);
    });
    root.appendChild(h('div', { class: 'toolbar' }, h('strong', null, '설문 응답 고객 (' + res.total + '건)'), openApp, dl,
      h('span', { class: 'muted' }, '설문을 만들고 링크·QR 을 배포하는 일은 별도 설문 관리 앱(새 창)에서 합니다. 세부 응답은 다운로드하거나 고객 DB 에서 확인하세요.')));

    var q = h('input', { type: 'search', value: sq, placeholder: '이름 또는 담당 직원', style: 'max-width:220px' });
    var go = h('button', { type: 'button', class: 'btn small primary' }, '검색');
    function run() { sq = q.value; return runBusy(go, function () { return renderRespondents(root); }); }
    go.addEventListener('click', run);
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    root.appendChild(h('div', { class: 'toolbar' }, q, go, h('span', { class: 'muted' }, '최근 ' + res.shown + '건 표시. 개인정보에 동의하지 않은 응답은 이름·연락처가 없습니다.')));

    var rows = res.rows.map(function (r) {
      return h('tr', null, h('td', null, r.at.slice(5, 16)), h('td', null, r.survey), h('td', null, r.name || '(비공개)'), h('td', null, r.phone),
        h('td', null, r.intent), h('td', null, r.age), h('td', null, r.person ? r.person + (r.team ? ' (' + r.team + ')' : '') : r.team),
        h('td', null, r.consentPi ? h('span', { class: 'badge ok' }, '동의') : h('span', { class: 'badge' }, '미동의')));
    });
    root.appendChild(simpleTable(['응답일시', '설문', '이름', '전화번호', '분양 의향', '연령대', '담당', '개인정보'], rows));
  }

  // 설문별 상세 결과 내려받기: 연락처 원문이 들어가므로 서버가 기록을 남긴다
  async function openDownload() {
    var list = (await Api.call('survey.list')).surveys;
    var body = h('div', null, h('p', { class: 'muted' }, '동의한 응답의 이름·전화번호 원문이 들어간 파일이 만들어지고, 내려받은 기록이 남습니다.'),
      list.length ? list.map(function (s) {
        var b = h('button', { type: 'button', class: 'btn small' }, '다운로드');
        b.addEventListener('click', function () { runBusy(b, function () { return exportSurvey(s); }); });
        return h('div', { class: 'toolbar' }, h('strong', null, s.title), h('span', { class: 'muted' }, s.responses + '건'), b);
      }) : h('p', { class: 'muted' }, '만들어진 설문이 없습니다.'));
    modal('설문 결과 다운로드', body, []);
  }

  async function exportSurvey(sv) {
    var ex = await Api.call('survey.export', { surveyId: sv.id });
    var qs = ex.questions.filter(function (q) { return !q.pii; });
    var head = ['일시', '링크', '본부', '팀', '직원', '개인정보동의', '마케팅동의', '이름', '전화번호'].concat(qs.map(function (q) { return q.title; }));
    var rows = ex.rows.map(function (r) {
      return [r.at, r.linkLabel, r.head, r.team, r.person, r.consentPi ? '동의' : '미동의', r.consentMkt ? '동의' : '미동의', r.name, r.phone].concat(qs.map(function (q) {
        var v = r.answers[q.key]; return v === undefined ? '' : v;
      }));
    });
    downloadCsv('설문응답_' + sv.title + '.csv', [head].concat(rows));
    toast('내려받았습니다. 개인정보가 들어 있으니 안전하게 보관해 주세요.');
  }

  Hub.section('surveys', { render: renderRespondents });

  // ====================================================================
  // 고객 DB: 같은 전화번호의 설문·방문·외부 자료·계약을 한 고객으로. 등급·진행 상태·담당·상담 기록
  // ====================================================================
  var EMPTY = { q: '', channel: '', grade: '', status: '', ownerId: '', source: '', consent: '', sort: '최근', callable: false, noNote: false, page: 1 };
  var filter = Object.assign({}, EMPTY);
  var INTENT = { '1': '1점', '2': '2점', '3': '3점', '4': '4점', '5': '5점' };
  var STATUS_BADGE = { '신규': 'info', '연락중': 'warn', '부재': '', '방문예정': 'warn', '방문완료': 'ok', '계약': 'ok', '보류': '', '거부': 'danger' };
  var CHANNEL_BADGE = { '설문': 'info', '방문': 'ok', '외부': 'warn', '부동산': 'line', '계약': 'danger' };
  var TYPE_BADGE = { '설문': 'info', '방문': 'ok', 'TM': 'warn', '상담': 'warn', '메모': '', '계약': 'danger', '등록': 'line', '부동산': 'line' };
  var QUICK = ['통화', '부재', '재통화', '방문약속', '관심없음', '결번'];

  function gradeBadge(g) { return g ? h('span', { class: 'badge ' + GRADE_BADGE[g] }, g) : h('span', { class: 'muted' }, '-'); }
  function set(patch) { filter = Object.assign({}, filter, { page: 1 }, patch); }

  async function render(root) {
    var res = await Api.call('customer.list', filter);
    var sm = res.summary;
    root.innerHTML = '';
    var again = function () { return render(root); };
    var go = function (patch) { set(patch); return runBusy(null, again); };

    // 1) 채널별 고객 수 (누르면 그 채널만)
    var kpi = function (label, value, sub, channel) {
      var b = h('button', { type: 'button', class: 'kpi' + (filter.channel === channel ? ' active' : '') }, label, h('b', null, value.toLocaleString('ko-KR')), sub ? h('small', null, sub) : null);
      b.addEventListener('click', function () { go({ channel: filter.channel === channel ? '' : channel }); });
      return b;
    };
    var rate = function (a, b) { return b ? Math.round(a / b * 100) + '%' : '-'; };
    root.appendChild(h('div', { class: 'kpis' },
      kpi('전체 고객', sm.total, '전화번호 기준으로 묶음', ''),
      kpi('설문 고객', sm.channels.설문, '의향 높음 ' + sm.highIntent + '명', '설문'),
      kpi('방문 고객', sm.channels.방문, '설문 → 방문 ' + sm.surveyToVisit + '명 (' + rate(sm.surveyToVisit, sm.channels.설문) + ')', '방문'),
      kpi('외부 자료 고객', sm.channels.외부, '동의 미확인 ' + sm.unconfirmed + '명', '외부'),
      kpi('부동산 고객', sm.channels.부동산 || 0, 'MGM 참여 ' + (sm.realtorMgm || 0) + '곳 · 소개 가능 ' + (sm.realtorRefer || 0) + '명', '부동산'),
      kpi('계약 고객', sm.channels.계약, '방문 → 계약 ' + sm.visitToContract + '명 (' + rate(sm.visitToContract, sm.channels.방문) + ')', '계약')));

    // 2) 등급·관리 필요 바로가기
    var chip = function (label, n, active, patch) {
      var b = h('button', { type: 'button', class: 'chip' + (active ? ' active' : '') }, label, h('i', null, String(n)));
      b.addEventListener('click', function () { go(patch); });
      return b;
    };
    root.appendChild(h('div', { class: 'chips' },
      ['A', 'B', 'C', 'D'].map(function (g) { return chip(g + ' 등급', sm.grades[g], filter.grade === g, { grade: filter.grade === g ? '' : g }); }),
      chip('등급 없음', sm.noGrade, filter.grade === '없음', { grade: filter.grade === '없음' ? '' : '없음' }),
      h('span', { class: 'sep' }),
      chip('상담 기록 없음', sm.noNote, filter.noNote, { noNote: !filter.noNote }),
      chip('담당 없음', sm.noOwner, filter.ownerId === '-', { ownerId: filter.ownerId === '-' ? '' : '-' }),
      chip('동의 미확인', sm.unconfirmed, filter.consent === '미확인', { consent: filter.consent === '미확인' ? '' : '미확인' })));

    // 3) 검색·조건
    var q = h('input', { type: 'search', value: filter.q, placeholder: '이름, 전화번호 전체 또는 뒤 4자리' });
    var status = h('select', null, option('', '상태 전체'), res.statuses.map(function (x) { return option(x, x + ' (' + sm.statuses[x] + ')', filter.status === x); }));
    var owner = h('select', null, option('', '담당 전체'), option('-', '담당 없음', filter.ownerId === '-'), res.staff.map(function (x) { return option(x.id, x.name, filter.ownerId === x.id); }));
    var source = h('select', null, option('', '출처 전체'), res.sources.map(function (x) { return option(x, x, filter.source === x); }));
    var sort = h('select', null, ['최근', '등급', '이름'].map(function (x) { return option(x, x === '최근' ? '최근 활동순' : x + '순', filter.sort === x); }));
    var callable = h('input', { type: 'checkbox', checked: filter.callable });
    var find = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    var reset = h('button', { type: 'button', class: 'btn small' }, '조건 지우기');
    var run = function () { return go({ q: q.value, status: status.value, ownerId: owner.value, source: source.value, sort: sort.value, callable: callable.checked }); };
    find.addEventListener('click', run);
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    [status, owner, source, sort, callable].forEach(function (el) { el.addEventListener('change', run); });
    reset.addEventListener('click', function () { filter = Object.assign({}, EMPTY); runBusy(reset, again); });
    var add = h('button', { type: 'button', class: 'btn small' }, '+ 고객 등록');
    add.addEventListener('click', function () { openAdd(again); });
    var exp = h('button', { type: 'button', class: 'btn small' }, '내보내기 (CSV)');
    exp.addEventListener('click', function () {
      if (!confirm('지금 조건에 맞는 고객 ' + res.matched + '명을 전화번호 원문과 함께 내려받습니다. 내려받은 기록이 남습니다. 계속할까요?')) return;
      runBusy(exp, exportCsv);
    });
    root.appendChild(h('div', { class: 'toolbar filterbar' }, q, status, owner, res.sources.length ? source : null, sort,
      h('label', { class: 'check', style: 'margin:0' }, callable, ' 연락 가능한 고객만'), find, reset, h('span', { style: 'flex:1' }), add, exp));

    // 4) 목록
    var rows = res.customers.map(function (c) {
      var tr = h('tr', { class: 'clickable' },
        h('td', null, h('div', { class: 'cust-name' }, c.name || '(이름 없음)', c.dnc ? [' ', h('span', { class: 'badge danger' }, '연락 거부')] : null),
          h('div', { class: 'cust-sub' }, c.phone + (c.consent === '미확인' ? ' · 동의 미확인' : ''))),
        h('td', null, gradeBadge(c.grade), c.gradeSource === '수동' ? h('span', { class: 'cust-sub' }, ' 직접') : null),
        h('td', null, h('span', { class: 'badge ' + (STATUS_BADGE[c.status] || '') }, c.status)),
        h('td', null, c.channels.map(function (x) { return [h('span', { class: 'badge ' + CHANNEL_BADGE[x] }, x), ' ']; }), c.source ? h('div', { class: 'cust-sub' }, c.source) : null),
        h('td', null, c.surveys ? '설문 ' + c.surveys + '회' + (c.intent ? ' · 의향 ' + (INTENT[c.intent] || c.intent) : '') : '',
          c.visits ? h('div', null, '방문 ' + c.visits + '회' + (c.people > c.visits ? ' (동반 포함 ' + c.people + '명)' : '')) : null,
          c.contract ? h('div', null, '계약 ' + c.contract.dongho) : null,
          c.realtor ? h('div', null, '중개업소 ' + c.realtor.office + (c.realtor.mgm ? ' · MGM ' + c.realtor.mgm : '') + ' · 소개 ' + c.realtor.referCount + '명') : null,
          !c.surveys && !c.visits && !c.contract && !c.realtor ? h('span', { class: 'muted' }, c.interest || c.region || '-') : null),
        h('td', null, c.notes ? c.notes + '건' : h('span', { class: 'muted' }, '-'), c.lastNote ? h('div', { class: 'cust-sub' }, String(c.lastNote).slice(5, 10)) : null),
        h('td', null, c.owner || h('span', { class: 'muted' }, '-')),
        h('td', null, c.last || '-'));
      tr.addEventListener('click', function () { openDetail(c.id, again); });
      return tr;
    });
    root.appendChild(simpleTable(['고객', '등급', '진행 상태', '유입 경로', '설문·방문·계약', '상담 기록', '담당', '최근 활동'], rows));

    var from = res.matched ? (res.page - 1) * res.pageSize + 1 : 0, to = Math.min(res.page * res.pageSize, res.matched);
    var prev = h('button', { type: 'button', class: 'btn small', disabled: res.page <= 1 }, '← 이전');
    var next = h('button', { type: 'button', class: 'btn small', disabled: to >= res.matched }, '다음 →');
    prev.addEventListener('click', function () { filter.page = res.page - 1; runBusy(prev, again); });
    next.addEventListener('click', function () { filter.page = res.page + 1; runBusy(next, again); });
    root.appendChild(h('div', { class: 'pager' }, h('span', null, '조건에 맞는 고객 ' + res.matched.toLocaleString('ko-KR') + '명 중 ' + from + '–' + to + ' · 줄을 누르면 고객 상세가 열립니다'), h('span', null, prev, ' ', next)));
    root.appendChild(h('p', { class: 'muted' }, '설문·방명록은 개인정보에 동의한 건만 묶습니다. 외부 자료는 올릴 때 고른 출처와 동의 여부가 고객마다 기록됩니다. 전화번호는 가려서 보이고, 원문은 고객 상세의 [연락처 보기]에서 확인합니다(기록됨). ' +
      '등급은 고객관리 > 등급관리에서 정한 기준(설문·방문·부동산)으로 자동으로 매겨지고, 고객 상세에서 직접 정한 등급이 우선입니다. 진행 상태를 직접 정하지 않으면 계약 > 방문완료 > 신규 순으로 자동 표시됩니다.'));
  }

  async function exportCsv() {
    var ex = await Api.call('customer.export', filter);
    downloadCsv('고객DB_' + Hub.todayLocal() + '.csv', [['이름', '전화번호', '등급', '진행 상태', '유입 경로', '출처', '동의', '연락 거부', '설문 횟수', '분양 의향', '방문 횟수', '최근 방문', '계약 동호', '중개업소', 'MGM', '상담 기록 수', '담당', '지역', '관심', '메모', '최근 활동']].concat(
      ex.rows.map(function (c) {
        return [c.name, c.phone, c.grade, c.status, c.channels.join('+'), c.source, c.consent, c.dnc ? '거부' : '', c.surveys, c.intent, c.visits, c.lastVisit, c.contract ? c.contract.dongho : '', c.realtor ? c.realtor.office : '', c.realtor ? c.realtor.mgm : '', c.notes, c.owner, c.region, c.interest, c.memo, c.last];
      })));
    toast(ex.rows.length + '명을 내려받았습니다.' + (ex.rows.length >= ex.max ? ' (한 번에 ' + ex.max + '명까지 — 조건을 나눠 받아 주세요)' : '') + ' 개인정보가 들어 있으니 안전하게 보관해 주세요.');
  }

  // 고객 한 명 직접 등록
  function openAdd(again) {
    var name = h('input', { type: 'text', maxLength: 30 });
    var phone = h('input', { type: 'tel', placeholder: '010-0000-0000' });
    var source = h('input', { type: 'text', maxLength: 30, value: '직접 입력', placeholder: '예: 전화 문의, 지인 소개' });
    var consent = h('select', null, option('동의', '개인정보 수집·이용에 동의 받음'), option('미확인', '동의 미확인'));
    var memo = h('input', { type: 'text', maxLength: 500 });
    modal('고객 등록', h('div', null, field('이름', name), field('전화번호', phone), field('출처', source), field('개인정보 동의', consent), field('메모', memo)), [{
      label: '등록', primary: true, onClick: async function (close) {
        var r = await Api.call('customer.import', { kind: '명단', source: source.value, consent: consent.value, direct: true, rows: [{ name: name.value, phone: phone.value, memo: memo.value }] });
        if (r.skipped) throw new Error(r.errors[0].reason);
        close(); toast(r.added ? '등록했습니다.' : '이미 있는 고객입니다. 비어 있던 항목만 채웠습니다.'); await again();
      }
    }]);
  }

  // 고객 상세: 왼쪽 관리 정보, 오른쪽 상담 기록 입력 + 전체 이력
  async function openDetail(id, again) {
    var d = await Api.call('customer.get', { id: id });
    var c = d.customer;
    var staff = d.staff;
    var dirty = false;

    var phoneText = h('span', null, c.phone || '-');
    var reveal = h('button', { type: 'button', class: 'btn small' }, '연락처 보기');
    reveal.addEventListener('click', function () {
      runBusy(reveal, async function () {
        var r = await Api.call('customer.reveal', { id: id });
        phoneText.textContent = r.phone ? formatPhone(r.phone) : '(번호 없음)';
        reveal.remove();
      });
    });
    var gradeSel = h('select', null, option('', '자동 분류'), ['A', 'B', 'C', 'D'].map(function (g) { return option(g, g + ' 등급', c.gradeSource === '수동' && c.grade === g); }));
    var statusSel = h('select', null, option('', '자동 (' + (c.statusAuto ? c.status : '계약 > 방문완료 > 신규') + ')'), d.statuses.map(function (x) { return option(x, x, !c.statusAuto && c.status === x); }));
    var ownerSel = h('select', null, option('', '담당 없음'), staff.map(function (x) { return option(x.id, x.name, c.ownerId === x.id); }));
    var memo = h('textarea', { rows: 3, maxLength: 500, placeholder: '고객 메모' }, c.memo || '');
    var dnc = h('input', { type: 'checkbox', checked: c.dnc });
    var save = h('button', { type: 'button', class: 'btn primary' }, '관리 정보 저장');
    save.addEventListener('click', function () {
      runBusy(save, async function () {
        await Api.call('customer.save', { id: id, status: statusSel.value, ownerId: ownerSel.value, memo: memo.value, dnc: dnc.checked });
        var wasManual = c.gradeSource === '수동' ? c.grade : '';
        if (gradeSel.value !== wasManual) await Api.call('customer.gradeSave', { id: id, grade: gradeSel.value, memo: c.gradeMemo || '' });
        dirty = true; toast('저장했습니다.');
      });
    });
    var left = h('div', null,
      h('div', { class: 'profile' },
        h('div', { class: 'big' }, c.name || '(이름 없음)'),
        h('div', { class: 'phone' }, phoneText, reveal),
        h('div', { class: 'tags' }, c.channels.map(function (x) { return h('span', { class: 'badge ' + CHANNEL_BADGE[x] }, x); }), c.grade ? h('span', { class: 'badge ' + GRADE_BADGE[c.grade] }, c.grade + ' 등급') : null,
          h('span', { class: 'badge ' + (c.consent === '동의' ? 'ok' : 'warn') }, c.consent === '동의' ? '개인정보 동의' : '동의 미확인')),
        h('div', { class: 'cust-sub' }, [c.source ? '출처 ' + c.source : '', c.region ? '지역 ' + c.region : '', c.interest ? '관심 ' + c.interest : '', c.contract ? '계약 ' + c.contract.dongho + ' (' + c.contract.date + ')' : ''].filter(Boolean).join(' · ') || '추가 정보 없음')),
      h('div', { class: 'form-row' }, field('등급', gradeSel), field('진행 상태', statusSel)),
      field('담당 직원', ownerSel), field('메모', memo),
      h('label', { class: 'check' }, dnc, ' 연락 거부 (전화·문자 대상에서 제외)'), save);

    // 상담 기록 입력
    var kind = h('select', null, d.noteKinds.map(function (x) { return option(x, x); }));
    var now = new Date(), pad = function (n) { return ('0' + n).slice(-2); };
    var at = h('input', { type: 'datetime-local', value: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + 'T' + pad(now.getHours()) + ':' + pad(now.getMinutes()) });
    var result = h('input', { type: 'text', maxLength: 30, placeholder: '결과 (예: 방문약속)' });
    var content = h('textarea', { rows: 2, maxLength: 1000, placeholder: '상담 내용' });
    var quick = h('div', { class: 'quick' }, QUICK.map(function (x) {
      var b = h('button', { type: 'button', class: 'chip' }, x);
      b.addEventListener('click', function () { result.value = x; });
      return b;
    }));
    var list = h('ul', { class: 'timeline' });
    function drawTimeline(items) {
      list.innerHTML = '';
      if (!items.length) list.appendChild(h('li', null, h('span', { class: 'muted' }, '아직 이력이 없습니다.')));
      items.forEach(function (t) {
        var del = null;
        if (t.noteId) {
          del = h('button', { type: 'button', class: 'linkbtn', style: 'padding:0;font-size:12px' }, '삭제');
          del.addEventListener('click', function () {
            if (!confirm('이 기록을 삭제할까요?')) return;
            runBusy(del, async function () { await Api.call('customer.noteDelete', { noteId: t.noteId }); dirty = true; await reload(); });
          });
        }
        list.appendChild(h('li', null,
          h('div', { class: 't-head' }, h('span', { class: 'badge ' + (TYPE_BADGE[t.type] || '') }, t.type), h('strong', null, t.title), h('time', null, String(t.at).slice(0, 16)),
            t.by ? h('span', { class: 'cust-sub' }, t.by + (t.imported ? ' · 업로드' : '')) : null, del),
          t.text ? h('div', { class: 't-text' }, t.text) : null));
      });
    }
    async function reload() { drawTimeline((await Api.call('customer.get', { id: id })).timeline); }
    var addNote = h('button', { type: 'button', class: 'btn primary small' }, '기록 추가');
    addNote.addEventListener('click', function () {
      runBusy(addNote, async function () {
        await Api.call('customer.noteAdd', { id: id, kind: kind.value, at: at.value.replace('T', ' '), result: result.value, content: content.value });
        result.value = ''; content.value = ''; dirty = true;
        await reload(); toast('기록했습니다.');
      });
    });
    drawTimeline(d.timeline);
    var right = h('div', null,
      h('div', { class: 'card', style: 'padding:16px' }, h('h3', { style: 'margin:0 0 10px' }, '상담 기록 추가'),
        h('div', { class: 'form-row' }, kind, at), h('div', { style: 'height:8px' }), quick, result, h('div', { style: 'height:8px' }), content,
        h('div', { class: 'toolbar', style: 'margin:10px 0 0;justify-content:flex-end' }, addNote)),
      h('h3', { style: 'margin:0 0 12px' }, '전체 이력'), list);

    var m = modal('고객 상세', h('div', { class: 'detail-grid' }, left, right), [], { wide: true });
    // 창을 닫을 때 바뀐 것이 있으면 목록을 새로 그린다
    var overlay = document.querySelector('.modal-overlay:last-of-type');
    if (overlay) new MutationObserver(function (_, ob) { if (!document.body.contains(overlay)) { ob.disconnect(); if (dirty) runBusy(null, again); } }).observe(document.body, { childList: true });
    return m;
  }

  Hub.section('customers', { render: render });
})();
