// 고객관리 > 등급관리: 고객 DB 자동 등급(A~D) 기준을 현장별로 정한다. 설문·방문·부동산(분양 의향 + 소개 의향 혼합)
(function () {
  var simpleTable = Hub.simpleTable;
  var GRADES = ['A', 'B', 'C', 'D'];
  var GRADE_BADGE = { A: 'danger', B: 'warn', C: 'ok', D: '' };
  var RT_LABEL = ['', '매우 낮음', '낮음', '보통', '높음', '매우 높음'];

  function badge(g) { return g ? h('span', { class: 'badge ' + GRADE_BADGE[g] }, g) : h('span', { class: 'muted' }, '없음'); }
  function up(g) { var i = GRADES.indexOf(g); return i > 0 ? GRADES[i - 1] : g; }
  // 서버(server/src/customer/grade.js)와 같은 계산
  function score(i, r, w) { return Math.round((i * w / 100 + r * (1 - w / 100)) * 100) / 100; }
  function rtGrade(i, r, rt, mgm) {
    var sc = score(i, r, rt.wIntent);
    var g = sc >= rt.cutA ? 'A' : sc >= rt.cutB ? 'B' : sc >= rt.cutC ? 'C' : 'D';
    return rt.mgmUp && mgm ? up(g) : g;
  }
  function gradeSelect(v, allowEmpty) {
    return h('select', { style: 'width:auto;min-width:110px' }, allowEmpty ? option('', '등급 없음', v === '') : null, GRADES.map(function (g) { return option(g, g + ' 등급', v === g); }));
  }

  async function render(root) {
    var d = await Api.call('customer.gradeRules');
    draw(root, d, JSON.parse(JSON.stringify(d.rules)));
  }

  function draw(root, d, rules) {
    root.innerHTML = '';
    var again = function () { return render(root); };

    // 0) 원칙 + 현재 분포
    var st = d.stats;
    var distRow = function (label, m) { return h('tr', null, h('td', null, h('strong', null, label)), GRADES.concat(['없음']).map(function (g) { return h('td', null, String(m[g] || 0)); })); };
    root.appendChild(h('div', { class: 'card' },
      h('h3', { style: 'margin-top:0' }, '등급은 이렇게 정해집니다'),
      h('ol', { style: 'margin:0 0 12px;padding-left:20px;line-height:1.8' },
        h('li', null, '고객 상세에서 ', h('strong', null, '직접 정한 등급'), '이 있으면 그 등급이 가장 우선입니다. (지금 ' + st.manual + '명)'),
        h('li', null, '없으면 아래 기준으로 ', h('strong', null, '설문 · 방문 · 부동산'), ' 등급을 각각 매기고, 그중 ', h('strong', null, '가장 높은 등급'), '을 씁니다.'),
        h('li', null, '기준을 바꾸고 저장하면 고객 DB 의 자동 등급이 바로 다시 계산됩니다. (직접 정한 등급은 그대로)')),
      h('div', { class: 'muted', style: 'margin-bottom:6px' }, '현재 등급 분포 (명)'),
      simpleTable(['구분', 'A', 'B', 'C', 'D', '등급 없음'], [distRow('전체', st.total), distRow('설문 고객', st.channels.설문), distRow('방문 고객', st.channels.방문), distRow('부동산 고객', st.channels.부동산)])));

    // 1) 설문
    var svRows = [5, 4, 3, 2, 1].map(function (n) {
      var sel = gradeSelect(rules.survey.map[n] || '', true);
      sel.addEventListener('change', function () { rules.survey.map[n] = sel.value; });
      return h('tr', null, h('td', null, n + '점'), h('td', null, d.surveyLabels[String(n)] || ''), h('td', null, sel));
    });
    var subscr = h('input', { type: 'checkbox', checked: rules.survey.subscrUp });
    subscr.addEventListener('change', function () { rules.survey.subscrUp = subscr.checked; });
    root.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '① 설문 고객 — 분양 의향으로'),
      simpleTable(['분양 의향', '응답 보기', '등급'], svRows),
      h('label', { class: 'check', style: 'margin-top:10px' }, subscr, ' 청약통장이 있으면 한 단계 위로 (예: B → A)')));

    // 2) 방문
    var vsel = gradeSelect(rules.visit.grade, true);
    vsel.addEventListener('change', function () { rules.visit.grade = vsel.value; });
    root.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '② 방문 고객 — 모델하우스에 방문한 고객'),
      h('div', { class: 'toolbar', style: 'margin:0' }, '방문한 고객은 ', vsel, h('span', { class: 'muted' }, '설문 등 다른 경로의 등급이 더 높으면 높은 쪽을 씁니다.'))));

    // 3) 부동산: 분양 의향 + 소개 의향 혼합 점수
    var rt = rules.realtor;
    var w = h('input', { type: 'range', min: 0, max: 100, step: 10, value: rt.wIntent, style: 'width:220px' });
    var wText = h('strong');
    var num = function (v) { return h('input', { type: 'number', min: 1, max: 5, step: 0.1, value: v, style: 'width:80px' }); };
    var cA = num(rt.cutA), cB = num(rt.cutB), cC = num(rt.cutC);
    var mgm = h('input', { type: 'checkbox', checked: rt.mgmUp });
    var formula = h('p', { style: 'margin:8px 0;font-size:15px' });
    var grid = h('div');
    function sync() {
      rt.wIntent = Number(w.value);
      rt.cutA = Number(cA.value); rt.cutB = Number(cB.value); rt.cutC = Number(cC.value); rt.mgmUp = mgm.checked;
      wText.textContent = '분양 의향 ' + rt.wIntent + '% : 소개 의향 ' + (100 - rt.wIntent) + '%';
      formula.innerHTML = '';
      formula.appendChild(document.createTextNode('점수 = 분양 의향 × ' + (rt.wIntent / 100) + ' + 소개 의향 × ' + ((100 - rt.wIntent) / 100) + '  →  '));
      formula.appendChild(h('strong', null, 'A ' + rt.cutA + '점 이상 · B ' + rt.cutB + '점 이상 · C ' + rt.cutC + '점 이상 · 나머지 D'));
      if (rt.mgmUp) formula.appendChild(document.createTextNode('  (MGM 참여면 한 단계 위)'));
      var bad = !(rt.cutA >= rt.cutB && rt.cutB >= rt.cutC);
      grid.innerHTML = '';
      if (bad) { grid.appendChild(h('p', { style: 'color:#d64545;font-weight:600' }, '기준 점수는 A ≥ B ≥ C 순서여야 합니다.')); return; }
      // 분양 의향(세로) × 소개 의향(가로) 표: 칸마다 점수와 등급
      var head = h('tr', null, h('th', null, '분양 의향 ↓ / 소개 의향 →'), [5, 4, 3, 2, 1].map(function (r) { return h('th', { style: 'text-align:center' }, r + ' ' + RT_LABEL[r]); }));
      var body = [5, 4, 3, 2, 1].map(function (i) {
        return h('tr', null, h('th', null, i + ' ' + RT_LABEL[i]), [5, 4, 3, 2, 1].map(function (r) {
          var g = rtGrade(i, r, rt, false), gm = rtGrade(i, r, rt, true);
          return h('td', { style: 'text-align:center' }, badge(g), h('div', { class: 'cust-sub' }, score(i, r, rt.wIntent) + '점' + (rt.mgmUp && gm !== g ? ' · MGM ' + gm : '')));
        }));
      });
      grid.appendChild(h('div', { class: 'table-wrap' }, h('table', null, h('thead', null, head), h('tbody', null, body))));
    }
    [w, cA, cB, cC].forEach(function (el) { el.addEventListener('input', sync); });
    mgm.addEventListener('change', sync);
    sync();
    root.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '③ 부동산 고객 — 분양 의향과 소개 의향을 섞은 점수로'),
      h('p', { class: 'muted', style: 'margin-top:0' }, '중개업소 조사의 가장 최근 응답을 씁니다. 두 항목은 모두 1(매우 낮음)~5(매우 높음)점입니다.'),
      h('div', { class: 'toolbar', style: 'margin:0 0 6px' }, '비중 ', w, wText),
      h('div', { class: 'toolbar', style: 'margin:0 0 6px' }, 'A 기준 ', cA, ' 점 이상 · B ', cB, ' 점 이상 · C ', cC, ' 점 이상 · 나머지 D'),
      h('label', { class: 'check' }, mgm, ' 부동산 MGM "참여"면 한 단계 위로'),
      formula, h('div', { class: 'muted', style: 'margin:4px 0' }, '미리보기 — 바꾸는 즉시 아래 표가 바뀝니다'), grid));

    // 저장
    var save = h('button', { type: 'button', class: 'btn primary', style: 'max-width:220px' }, '저장하고 다시 계산');
    save.addEventListener('click', function () {
      runBusy(save, async function () {
        var r = await Api.call('customer.gradeRulesSave', { rules: rules });
        d.rules = r.rules; d.stats = r.stats;
        draw(root, d, JSON.parse(JSON.stringify(r.rules)));
        toast('저장했습니다. 고객 DB 등급을 다시 계산했습니다.');
      });
    });
    var def = h('button', { type: 'button', class: 'btn', style: 'max-width:160px' }, '기본값으로');
    def.addEventListener('click', function () { draw(root, d, JSON.parse(JSON.stringify(d.defaults))); toast('기본값을 불러왔습니다. [저장]을 눌러야 반영됩니다.'); });
    var cancel = h('button', { type: 'button', class: 'btn', style: 'max-width:160px' }, '바꾼 내용 취소');
    cancel.addEventListener('click', function () { runBusy(cancel, again); });
    root.appendChild(h('div', { class: 'toolbar' }, save, def, cancel));
  }

  Hub.section('customer-grades', { render: render });
})();
