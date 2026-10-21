// 고객관리: 설문고객(응답 고객 리스트), 데이터통합관리(설문+방문 고객 통합, 등급 분류)
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
    var openApp = h('button', { type: 'button', class: 'btn small primary' }, '+ 새 설문 (새 창)');
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
      h('span', { class: 'muted' }, '설문을 만들고 링크·QR 을 배포하는 일은 별도 설문 관리 앱(새 창)에서 합니다. 세부 응답은 다운로드하거나 데이터통합관리에서 확인하세요.')));

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
  // 데이터통합관리: 같은 전화번호(해시)의 설문·방문을 한 고객으로, 등급(A~D) 분류
  // ====================================================================
  var filter = { q: '', stage: '전체', grade: '' };
  var INTENT = { '1': '1점', '2': '2점', '3': '3점', '4': '4점', '5': '5점' };

  async function render(root) {
    var res = await Api.call('customer.list', { q: filter.q, stage: filter.stage, grade: filter.grade });
    root.innerHTML = '';
    var f = res.funnel;
    var rate = f.highIntent ? Math.round(f.highIntentVisited / f.highIntent * 100) + '%' : '-';
    root.appendChild(h('div', { class: 'summary' },
      statCard('A 등급', f.grades.A + '명'), statCard('B 등급', f.grades.B + '명'), statCard('C 등급', f.grades.C + '명'), statCard('D 등급', f.grades.D + '명'),
      statCard('설문 고객', f.surveyCustomers + '명'), statCard('방문 고객', f.visitCustomers + '명'),
      statCard('설문+방문', f.both + '명'), statCard('의향 높음 → 방문', f.highIntentVisited + ' / ' + f.highIntent + '명', '전환 ' + rate)));
    root.appendChild(h('p', { class: 'muted' }, '개인정보에 동의하고 전화번호를 남긴 설문 응답과 방명록(방문)을 같은 전화번호로 묶었습니다. 전화번호는 마스킹되어 보입니다. ' +
      '등급 기준 — 설문: 분양 의향 적극 있음 A · 있음 B · 고민 중 C · 낮음/없음 D (청약통장이 있으면 한 단계 위) / 방문 고객: C / 둘 다 있으면 높은 쪽 / TM 등에서 직접 정한 등급은 자동 분류보다 우선합니다.'));

    var q = h('input', { type: 'search', value: filter.q, placeholder: '이름 또는 전화번호 (3자리 이상)', style: 'max-width:240px' });
    var stage = h('select', null, ['전체', '설문+방문', '설문만', '방문만'].map(function (s) { return option(s, s, filter.stage === s); }));
    var grade = h('select', null, option('', '등급 전체'), ['A', 'B', 'C', 'D'].map(function (g) { return option(g, g + ' 등급', filter.grade === g); }));
    var go = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    function run() { filter = { q: q.value, stage: stage.value, grade: grade.value }; return runBusy(go, function () { return render(root); }); }
    go.addEventListener('click', run);
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    root.appendChild(h('div', { class: 'toolbar' }, q, stage, grade, go, h('span', { class: 'muted' }, '묶인 고객 ' + res.total + '명 중 ' + res.shown + '명 표시')));

    var rows = res.customers.map(function (c) {
      var cls = c.stage === '설문+방문' ? 'ok' : c.stage === '설문만' ? 'warn' : '';
      var edit = h('button', { type: 'button', class: 'btn small' }, '등급 수정');
      edit.addEventListener('click', function () { editGrade(c, root); });
      return h('tr', null, h('td', null, h('strong', null, c.name || '(이름 없음)')), h('td', null, c.phone),
        h('td', null, c.grade ? h('span', { class: 'badge ' + GRADE_BADGE[c.grade] }, c.grade) : '-', ' ', h('span', { class: 'muted' }, c.gradeSource + (c.memo ? ' · ' + c.memo : ''))),
        h('td', null, h('span', { class: 'badge ' + cls }, c.stage)),
        h('td', null, c.surveys ? c.surveys + '회 · ' + c.lastSurveyAt.slice(0, 10) : '-'),
        h('td', null, c.intent ? (INTENT[c.intent] || c.intent) : '-'),
        h('td', null, c.visits ? c.visits + '회 · ' + c.lastVisit + (c.people > c.visits ? ' (동반 포함 ' + c.people + '명)' : '') : '-'), h('td', null, edit));
    });
    root.appendChild(simpleTable(['이름', '전화번호', '등급', '구분', '설문', '분양 의향', '방문', ''], rows));
  }

  function editGrade(c, root) {
    var sel = h('select', null, option('', '자동 분류 (직접 입력 해제)'), ['A', 'B', 'C', 'D'].map(function (g) { return option(g, g + ' 등급', c.gradeSource === '수동' && c.grade === g); }));
    var memo = h('input', { type: 'text', maxLength: 200, value: c.memo || '', placeholder: '예: TM 통화 결과 — 방문 약속' });
    modal('등급 수정 — ' + (c.name || '(이름 없음)'), h('div', null,
      h('p', { class: 'muted' }, '현재 ' + (c.grade || '-') + ' 등급 (' + (c.gradeSource || '자료 없음') + '). 직접 입력한 등급은 자동 분류보다 우선합니다.'), field('등급', sel), field('메모', memo)), [{
      label: '저장', primary: true, onClick: async function (close) {
        await Api.call('customer.gradeSave', { id: c.id, grade: sel.value, memo: memo.value });
        close(); toast('저장했습니다.'); await render(root);
      }
    }]);
  }

  Hub.section('customers', { render: render });
})();
