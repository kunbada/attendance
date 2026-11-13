// 홈 대시보드: 인력현황 · 고객현황 · 계약현황. 각 묶음은 숫자 카드 + 작은 그래프 하나, 자세한 표는 [상세 보기]에서
(function () {
  var simpleTable = Hub.simpleTable, DATE_STYLE = Hub.DATE_STYLE;
  var charts = [];
  var C = { blue: '#2457d6', blueSoft: 'rgba(36,87,214,.12)', gray: '#9aa4b2', green: '#16a34a', amber: '#d97706', violet: '#7c3aed', teal: '#0d9488' };

  var num = function (n) { return Number(n || 0).toLocaleString('ko-KR'); };
  function won(n) { n = Number(n || 0); return n >= 1e8 ? (Math.round(n / 1e7) / 10).toLocaleString('ko-KR') + '억원' : num(n) + '원'; }
  function tile(label, value, sub, tone) {
    return h('div', { class: 'tile' + (tone ? ' ' + tone : '') }, h('div', { class: 'lbl' }, label), h('div', { class: 'val' }, value), sub ? h('div', { class: 'sub' }, sub) : null);
  }
  function miniBars(title, rows, fmt) {
    return h('div', { class: 'mini' }, h('div', { class: 'mini-title' }, title), rows.length ? rows.map(function (r) {
      var w = r.max ? Math.round(r.value / r.max * 100) : 0;
      return h('div', { class: 'mini-row' }, h('span', { class: 'mini-name' }, r.name), h('span', { class: 'mini-bar' }, h('i', { style: 'width:' + w + '%' })), h('span', { class: 'mini-val' }, fmt(r)));
    }) : h('div', { class: 'muted' }, '자료 없음'));
  }
  function section(title, sub, detailLabel, onDetail, left, chartTitle, chartFn) {
    var head = h('div', { class: 'dash-head' }, h('h2', null, title), sub ? h('span', { class: 'muted' }, sub) : null, h('span', { style: 'flex:1' }));
    if (onDetail) { var b = h('button', { type: 'button', class: 'btn small' }, detailLabel + ' →'); b.addEventListener('click', function () { runBusy(b, onDetail); }); head.appendChild(b); }
    var canvas = h('canvas');
    var right = h('div', { class: 'chart-card' }, h('h4', null, chartTitle), h('div', { class: 'chart-box' }, canvas));
    var sec = h('div', { class: 'dash-sec' }, head, h('div', { class: 'dash-grid' }, h('div', null, left), right));
    if (window.Chart && chartFn) charts.push(new Chart(canvas, chartFn()));
    else if (!window.Chart) right.appendChild(h('p', { class: 'muted' }, '그래프를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
    return sec;
  }
  var axisX = function (stacked) { return { stacked: !!stacked, grid: { display: false }, ticks: { font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }; };
  var axisY = function (stacked) { return { stacked: !!stacked, beginAtZero: true, ticks: { precision: 0, font: { size: 10 } }, grid: { color: '#eef0f4' } }; };
  var baseOpts = function (scales) {
    return {
      responsive: true, maintainAspectRatio: false, animation: { duration: 700 }, interaction: { mode: 'index', intersect: false },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } } } },
      scales: scales || { x: axisX(), y: axisY() }
    };
  };

  async function render(root) {
    var both = await Promise.all([Api.call('admin.dashboard', {}), Api.call('contract.summary').catch(function () { return null; })]);
    var d = both[0], ct = both[1] || {};
    charts.forEach(function (c) { c.destroy(); }); charts = [];
    root.innerHTML = '';
    var t = d.today, st = d.staffStats, cs = d.customerStats;
    var reload = h('button', { type: 'button', class: 'btn small' }, '새로고침');
    reload.addEventListener('click', function () { runBusy(reload, function () { return render(root); }); });
    var alerts = [t.pendingStaff ? '승인 대기 직원 ' + t.pendingStaff + '명' : '', t.guestPending ? '방명록 확인 필요 ' + t.guestPending + '건' : ''].filter(Boolean);
    root.appendChild(h('div', { class: 'toolbar' }, h('strong', { style: 'font-size:16px' }, t.date + ' 현황'), reload, alerts.length ? h('span', { class: 'badge warn' }, alerts.join(' · ')) : null));
    var labels30 = d.trend30.map(function (x) { return x.date.slice(5).replace('-', '/'); });

    // ① 인력현황
    var maxAtt = Math.max.apply(null, d.trend30.map(function (x) { return x.attendance; }).concat([0]));
    root.appendChild(section('인력현황', '본부 ' + st.heads + ' · 팀 ' + st.teams, '본부·팀·직군별 상세', function () { openStaffDetail(d); },
      [h('div', { class: 'tiles' },
        tile('등록 인원', num(st.active) + '명', '활동 중인 직원'),
        tile('오늘 출근', num(t.attendance) + '명', '출근율 ' + t.attendanceRate + '%'),
        tile('이번 달 하루 평균', st.avgAttendanceMonth + '명', '최근 30일 최대 ' + maxAtt + '명'),
        tile('승인 대기', num(t.pendingStaff) + '명', '가입 신청', t.pendingStaff ? 'warn' : ''),
        tile('텔레그램 미연결', num(st.noTelegram) + '명', '고객 호출을 못 받음', st.noTelegram ? 'warn' : ''),
        tile('오늘 호출', num(t.visits) + '건', '담당 없음 ' + t.noStaffVisits + '건')),
       miniBars('직군별 오늘 출근', st.byJob.slice(0, 6).map(function (j) { return { name: j.name, value: j.present, max: j.total, present: j.present, total: j.total }; }), function (r) { return r.present + ' / ' + r.total; })],
      '최근 30일 출근 인원', function () {
        return {
          type: 'line',
          data: { labels: labels30, datasets: [
            { label: '출근', data: d.trend30.map(function (x) { return x.attendance; }), borderColor: C.blue, backgroundColor: C.blueSoft, fill: true, tension: .3, pointRadius: 2, pointHoverRadius: 5 },
            { label: '등록 인원', data: d.trend30.map(function () { return st.active; }), borderColor: C.gray, borderDash: [4, 4], borderWidth: 1, pointRadius: 0, fill: false }] },
          options: baseOpts()
        };
      }));

    // ② 고객현황
    root.appendChild(section('고객현황', '설문 · 방문 · 예약 · 부동산', '직원별 예약·방문', function () { return openCustomerDetail(d.month); },
      [h('div', { class: 'tiles' },
        tile('설문 응답', num(cs.surveys) + '건', '오늘 ' + cs.surveysToday + ' · 개인정보 동의 ' + num(cs.surveyConsent)),
        tile('이번 달 방문', num(cs.guestTeamsMonth) + '팀', num(cs.guestPeopleMonth) + '명 · 오늘 ' + t.guestTeams + '팀'),
        tile('오늘 방문예약', num(t.reservations) + '건', '앞으로 7일 ' + num(cs.reservationsNext7) + '건'),
        tile('예약 → 방문율', d.visitRate.rate + '%', Number(d.month.slice(5)) + '월 ' + d.visitRate.visited + ' / ' + d.visitRate.reservations + '건'),
        tile('부동산(중개업소)', num(cs.realtorPeople) + '명', 'MGM 참여 ' + cs.realtorMgm + ' · 소개 가능 ' + num(cs.realtorRefer) + '명'),
        tile('상담 고객', num(cs.counselCustomers) + '명', '이번 달 상담 ' + num(cs.counselNotesMonth) + '건 · 외부 자료 ' + num(cs.external) + '명')),
       (cs.typeInterest || []).length ? (function () {
         var mx = Math.max.apply(null, cs.typeInterest.map(function (x) { return x.survey + x.customers; }).concat([1]));
         return miniBars('관심 타입군 (설문 응답 + 고객 관심)', cs.typeInterest.map(function (x) { return { name: x.label, value: x.survey + x.customers, max: mx, s: x.survey, c: x.customers, u: x.units }; }),
           function (r) { return '설문 ' + r.s + ' · 고객 ' + r.c + (r.u ? ' · ' + r.u + '세대' : ''); });
       })() : null],
      '최근 30일 고객 유입', function () {
        var ds = function (label, key, color) { return { label: label, data: d.trend30.map(function (x) { return x[key]; }), backgroundColor: color, borderRadius: 3, stack: 'in', maxBarThickness: 14, order: 1 }; };
        return {
          type: 'bar',
          data: { labels: labels30, datasets: [ds('설문', 'surveys', C.blue), ds('방문객', 'guests', C.green), ds('부동산', 'realtors', C.violet),
            { type: 'line', order: 0, label: '방문예약', data: d.trend30.map(function (x) { return x.reservations; }), borderColor: C.amber, backgroundColor: C.amber, tension: .3, pointRadius: 0, borderWidth: 2 }] },
          options: baseOpts({ x: axisX(true), y: axisY(true) })
        };
      }));

    // ③ 계약현황
    if (!ct.units) {
      root.appendChild(h('div', { class: 'dash-sec' }, h('div', { class: 'dash-head' }, h('h2', null, '계약현황')),
        h('div', { class: 'card' }, h('p', { class: 'muted', style: 'margin:0' }, '아직 계약 데이터가 없습니다. 계약앱에서 자료를 올리면 세대수·계약률·월별 추이가 여기에 나옵니다.'))));
    } else {
      var thisMonth = d.contractMonthly[d.contractMonthly.length - 1] || { contracts: 0, cancels: 0 };
      root.appendChild(section('계약현황', '기준일 ' + ct.asOf, '계약관리 현황 요약', function () { return Hub.open('contract'); },
        [h('div', { class: 'tiles' },
          tile('총 세대', num(ct.units) + '세대', '잔여 ' + num(ct.remain) + ' · 잠금 ' + num(ct.lock)),
          tile('계약', num(ct.contract) + '세대', '계약률 ' + ct.contractRate + '%'),
          tile('가계약', num(ct.pre) + '세대', '가계약 포함 ' + ct.withPreRate + '%'),
          tile('이번 달 계약', num(thisMonth.contracts) + '건', '오늘 ' + num(ct.todayContracts) + '건' + (thisMonth.cancels ? ' · 해약 ' + thisMonth.cancels : '')),
          tile('총 수납액', won(ct.totalIn), '오늘 입금 ' + num(ct.todayDeposits) + '건'),
          tile('미분류 입금', num(ct.unclassified) + '건', ct.unclassified ? '계약앱에서 구분 지정 필요' : '정리 완료', ct.unclassified ? 'warn' : '')),
         miniBars('타입별 계약률', (ct.types || []).slice(0, 6).map(function (x) { return { name: x.type || '-', value: x.contract, max: x.supply, contract: x.contract, supply: x.supply }; }), function (r) { return r.contract + ' / ' + r.supply + ' (' + (r.supply ? Math.round(r.contract / r.supply * 100) : 0) + '%)'; })],
        '월별 계약 추이 (최근 12개월)', function () {
          var y2 = axisY(); y2.position = 'right'; y2.grid = { display: false };
          return {
            type: 'bar',
            data: { labels: d.contractMonthly.map(function (x) { return x.month.slice(2).replace('-', '.'); }), datasets: [
              { label: '월 계약', data: d.contractMonthly.map(function (x) { return x.contracts; }), backgroundColor: C.teal, borderRadius: 4, maxBarThickness: 26, yAxisID: 'y', order: 1 },
              { type: 'line', order: 0, label: '누적 계약', data: d.contractMonthly.map(function (x) { return x.cumulative; }), borderColor: C.blue, backgroundColor: C.blue, tension: .3, pointRadius: 2, yAxisID: 'y2' }] },
            options: baseOpts({ x: axisX(), y: axisY(), y2: y2 })
          };
        }));
    }
  }

  // ---------- 상세 ----------
  function rateTable(title, rows) {
    return h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, title),
      rows.length ? simpleTable(['구분', '출근 / 활동', '출근율'], rows.map(function (r) {
        return h('tr', null, h('td', null, r.name), h('td', null, r.present + ' / ' + r.total),
          h('td', { style: 'min-width:120px' }, h('div', { class: 'bar' }, h('span', { style: 'width:' + r.rate + '%' })), r.rate + '%'));
      })) : h('p', { class: 'muted' }, '자료 없음'));
  }
  function openStaffDetail(d) {
    modal('오늘 출근 상세 — ' + d.today.date, h('div', { class: 'grid3' }, rateTable('본부별', d.attendanceRate.byHead), rateTable('팀별', d.attendanceRate.byTeam), rateTable('직군별', d.attendanceRate.byJob)), [], { wide: true });
  }
  async function openCustomerDetail(month) {
    var body = h('div');
    async function draw(m) {
      var d = await Api.call('admin.dashboard', { month: m });
      body.innerHTML = '';
      var monthIn = h('input', { type: 'month', value: d.month, style: DATE_STYLE });
      monthIn.addEventListener('change', function () { runBusy(null, function () { return draw(monthIn.value); }); });
      body.appendChild(h('div', { class: 'toolbar' }, '월 ', monthIn, h('span', { class: 'muted' }, '예약 대비 방문율 ' + d.visitRate.rate + '% (예약 ' + d.visitRate.reservations + '건 중 방문 ' + d.visitRate.visited + '건, 오늘까지 도래한 예약 기준)')));
      body.appendChild(simpleTable(['순위', '직원', '직군 / 소속', '예약', '방문', '방문율'], d.topStaff.map(function (x, i) {
        return h('tr', null, h('td', null, i + 1), h('td', null, h('strong', null, x.name)), h('td', null, x.org), h('td', null, x.reservations), h('td', null, x.visited),
          h('td', null, x.reservations ? Math.round(x.visited / x.reservations * 100) + '%' : '-'));
      })));
      if (!d.topStaff.length) body.appendChild(h('p', { class: 'muted' }, '이 달의 예약이 없습니다.'));
    }
    await draw(month);
    modal('직원별 예약·방문 TOP 10', body, [], { wide: true });
  }

  Hub.section('home', { render: render });
})();
