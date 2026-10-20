// 홈: 선택한 현장의 오늘 현황과 최근 추이
(function () {
  var simpleTable = Hub.simpleTable, statCard = Hub.statCard, DATE_STYLE = Hub.DATE_STYLE;

  var dashChart = null;
  var dashMonth = '';

  function rateTable(title, rows) {
    return h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, title),
      simpleTable(['구분', '출근 / 활동', '출근율'], rows.map(function (r) {
        return h('tr', null, h('td', null, r.name), h('td', null, r.present + ' / ' + r.total),
          h('td', { style: 'min-width:140px' }, h('div', { class: 'bar' }, h('span', { style: 'width:' + r.rate + '%' })), r.rate + '%'));
      })));
  }

  async function render(root) {
    var d = await Api.call('admin.dashboard', { month: dashMonth });
    dashMonth = d.month;
    root.innerHTML = '';
    var t = d.today;

    var monthIn = h('input', { type: 'month', value: d.month, style: DATE_STYLE });
    var go = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    go.addEventListener('click', function () { dashMonth = monthIn.value; runBusy(go, function () { return render(root); }); });
    var reload = h('button', { type: 'button', class: 'btn small' }, '새로고침');
    reload.addEventListener('click', function () { runBusy(reload, function () { return render(root); }); });

    root.appendChild(h('div', { class: 'toolbar' }, h('strong', null, t.date + ' 오늘 현황'), reload));
    root.appendChild(h('div', { class: 'summary' },
      statCard('오늘 출근', t.attendance + ' / ' + t.activeStaff, '출근율 ' + t.attendanceRate + '%'),
      statCard('오늘 예약', t.reservations), statCard('오늘 호출', t.visits),
      statCard('담당 없음', t.noStaffVisits),
      statCard('방명록 (팀 / 방문객)', t.guestTeams + ' / ' + t.guestPeople, '워킹 ' + t.walkIn + '팀'),
      statCard('승인 대기 직원', t.pendingStaff, t.guestPending ? '방명록 확인 필요 ' + t.guestPending : '')));

    var canvas = h('canvas', { height: 110 });
    root.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '최근 14일 추이'), h('div', { style: 'position:relative' }, canvas)));
    if (dashChart) { dashChart.destroy(); dashChart = null; }
    if (window.Chart) {
      var labels = d.trend.map(function (x) { return x.date.slice(5); });
      var line = function (label, key, color) {
        return { label: label, data: d.trend.map(function (x) { return x[key]; }), borderColor: color, backgroundColor: color, tension: .25, pointRadius: 3 };
      };
      dashChart = new Chart(canvas, {
        type: 'line',
        data: { labels: labels, datasets: [line('출근', 'attendance', '#2563eb'), line('예약', 'reservations', '#d97706'), line('호출', 'visits', '#16a34a'), line('방명록 방문객', 'guestPeople', '#7c3aed')] },
        options: { responsive: true, interaction: { mode: 'index', intersect: false }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
      });
    } else {
      canvas.parentNode.appendChild(h('p', { class: 'muted' }, '차트 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
    }

    root.appendChild(h('h3', null, '오늘 출근율'));
    root.appendChild(h('div', { class: 'grid3' }, rateTable('본부별', d.attendanceRate.byHead), rateTable('팀별', d.attendanceRate.byTeam), rateTable('직군별', d.attendanceRate.byJob)));

    root.appendChild(h('div', { class: 'toolbar', style: 'margin-top:16px' }, h('strong', null, '월별 실적'), monthIn, go));
    root.appendChild(h('div', { class: 'summary' },
      statCard(d.month + ' 예약 대비 방문율', d.visitRate.rate + '%', '예약 ' + d.visitRate.reservations + '건 중 방문 ' + d.visitRate.visited + '건 (오늘까지 도래한 예약 기준)')));
    root.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, d.month + ' 직원별 예약·방문 TOP 10'),
      simpleTable(['순위', '직원', '직군 / 소속', '예약', '방문', '방문율'], d.topStaff.map(function (x, i) {
        return h('tr', null, h('td', null, i + 1), h('td', null, h('strong', null, x.name)), h('td', null, x.org), h('td', null, x.reservations), h('td', null, x.visited),
          h('td', null, x.reservations ? Math.round(x.visited / x.reservations * 100) + '%' : '-'));
      }))));
  }

  Hub.register({ key: 'home', label: '홈', render: render });
})();
