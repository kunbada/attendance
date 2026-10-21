// 방문·예약·방명록: 예약·방문 현황, 방명록 통계와 내보내기
(function () {
  var state = Hub.state, orgsOf = Hub.orgsOf, simpleTable = Hub.simpleTable, nameCell = Hub.nameCell, orgCell = Hub.orgCell;
  var statCard = Hub.statCard, DATE_STYLE = Hub.DATE_STYLE, todayLocal = Hub.todayLocal, downloadCsv = Hub.downloadCsv;

  var visitFilter = { from: '', to: '', headId: '', teamId: '', staffId: '' };

  async function renderVisits(root) {
    visitFilter.from = visitFilter.from || todayLocal().slice(0, 8) + '01';
    visitFilter.to = visitFilter.to || todayLocal();
    if (!state.staff.length) await Hub.loadStaff();
    if (!state.orgs.length) await Hub.loadOrgs();
    root.innerHTML = '';
    var from = h('input', { type: 'date', value: visitFilter.from, style: DATE_STYLE });
    var to = h('input', { type: 'date', value: visitFilter.to, style: DATE_STYLE });
    var head = h('select', null, option('', '본부 전체'), orgsOf('본부').map(function (o) { return option(o.id, o.name, o.id === visitFilter.headId); }));
    var team = h('select');
    var staffSel = h('select', null, option('', '직원 전체'), state.staff.filter(function (s) { return s.status !== '반려'; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); })
      .map(function (s) { return option(s.id, s.name + (s.nickname ? ' (' + s.nickname + ')' : ''), s.id === visitFilter.staffId); }));
    function syncTeams() {
      team.innerHTML = '';
      team.appendChild(option('', '팀 전체'));
      orgsOf('팀').filter(function (t) { return !head.value || t.parentId === head.value; })
        .forEach(function (t) { team.appendChild(option(t.id, t.name, t.id === visitFilter.teamId)); });
    }
    head.addEventListener('change', function () { visitFilter.teamId = ''; syncTeams(); });
    syncTeams();
    var go = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    var box = h('div');
    go.addEventListener('click', function () {
      visitFilter = { from: from.value, to: to.value, headId: head.value, teamId: team.value, staffId: staffSel.value };
      runBusy(go, function () { return loadVisitsTab(box); });
    });
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '조건'), h('div', { class: 'toolbar' }, from, '~', to, head, team, staffSel, go)));
    root.appendChild(box);
    await loadVisitsTab(box);
  }

  async function loadVisitsTab(box) {
    var q = { from: visitFilter.from, to: visitFilter.to, headId: visitFilter.headId, teamId: visitFilter.teamId, staffId: visitFilter.staffId };
    var results = await Promise.all([Api.call('admin.reservations', q), Api.call('admin.visits', q)]);
    var rs = results[0].reservations, vs = results[1].visits;
    box.innerHTML = '';

    var resCsv = h('button', { type: 'button', class: 'btn small' }, 'CSV 다운로드');
    resCsv.addEventListener('click', function () {
      downloadCsv('예약_' + q.from + '_' + q.to + '.csv', [['방문예정일', '뒤5자리', '성별', '직원', '직군', '본부', '팀', '메모', '상태', '등록일시']].concat(
        rs.map(function (r) { return [r.date, r.last5, r.gender, r.staff ? r.staff.name : '', r.staff ? r.staff.job : '', r.staff ? r.staff.headName : '', r.staff ? r.staff.teamName : '', r.memo, r.status, r.createdAt]; })));
    });
    box.appendChild(h('div', { class: 'card' }, h('h2', null, '예약 (' + rs.length + '건) '), h('div', { class: 'toolbar' }, resCsv),
      simpleTable(['방문예정일', '뒤5자리', '성별', '직원', '소속', '메모', '상태'], rs.map(function (r) {
        return h('tr', null, h('td', null, r.date), h('td', null, r.last5), h('td', null, r.gender), h('td', null, r.staff ? nameCell(r.staff) : '-'),
          h('td', null, r.staff ? orgCell(r.staff) : ''), h('td', null, r.memo), h('td', null, r.status));
      }))));

    var visCsv = h('button', { type: 'button', class: 'btn small' }, 'CSV 다운로드');
    visCsv.addEventListener('click', function () {
      downloadCsv('호출_' + q.from + '_' + q.to + '.csv', [['호출일시', '뒤5자리', '성별', '구분', '담당직원', '직군', '본부', '팀', '호출일시', '확인일시']].concat(
        vs.map(function (v) { return [v.at, v.last5, v.gender, v.kind, v.staff ? v.staff.name : '', v.staff ? v.staff.job : '', v.staff ? v.staff.headName : '', v.staff ? v.staff.teamName : '', v.calledAt, v.ackedAt]; })));
    });
    box.appendChild(h('div', { class: 'card' }, h('h2', null, '호출 (' + vs.length + '건) '), h('div', { class: 'toolbar' }, visCsv),
      simpleTable(['호출일시', '뒤5자리', '성별', '구분', '담당직원', '호출', '확인'], vs.map(function (v) {
        return h('tr', null, h('td', null, v.at), h('td', null, v.last5), h('td', null, v.gender), h('td', null, v.kind),
          h('td', null, v.staff ? nameCell(v.staff) : '-'), h('td', null, v.calledAt.slice(11, 16)), h('td', null, v.ackedAt.slice(11, 16)));
      }))));
  }


  var guestRange = { from: '', to: '' };
  var guestChart = null;

  async function renderGuestbook(root) {
    var today = todayLocal();
    guestRange.to = guestRange.to || today;
    guestRange.from = guestRange.from || today.slice(0, 8) + '01';
    root.innerHTML = '';
    var from = h('input', { type: 'date', value: guestRange.from, style: DATE_STYLE });
    var to = h('input', { type: 'date', value: guestRange.to, style: DATE_STYLE });
    var go = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    var box = h('div');
    go.addEventListener('click', function () {
      guestRange = { from: from.value, to: to.value };
      runBusy(go, function () { return loadGuestbook(box); });
    });
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '기간'), h('div', { class: 'toolbar' }, from, '~', to, go)));
    root.appendChild(box);
    await loadGuestbook(box);
  }

  async function loadGuestbook(box) {
    var q = { from: guestRange.from, to: guestRange.to };
    var results = await Promise.all([Api.call('admin.guestStats', q), Api.call('admin.guestbook', q)]);
    var st = results[0], list = results[1].guests;
    var t = st.total;
    box.innerHTML = '';

    box.appendChild(h('div', { class: 'summary' },
      statCard('방문 팀', t.teams, '건수 기준'), statCard('방문객', t.people, '본인 + 동반인'),
      statCard('단독 / 동반 팀', t.solo + ' / ' + t.groupTeams),
      statCard('분양 (팀 / 방문객)', t.assignedTeams + ' / ' + t.assignedPeople), statCard('워킹 (팀 / 방문객)', t.walkInTeams + ' / ' + t.walkInPeople),
      statCard('확인 필요', t.pending, '데스크 미확인'), statCard('개인정보 동의', t.consented + ' / ' + t.teams),
      statCard('성별 (남 / 여 / 미입력)', t.male + ' / ' + t.female + ' / ' + t.genderUnknown)));

    if (guestChart) { guestChart.destroy(); guestChart = null; }
    var canvas = h('canvas', { height: 90 });
    box.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '일별 방문 팀·방문객'), h('div', { style: 'position:relative' }, canvas)));
    if (window.Chart && st.byDay.length) {
      guestChart = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: st.byDay.map(function (x) { return x.date.slice(5); }),
          datasets: [
            { label: '방문 팀', data: st.byDay.map(function (x) { return x.teams; }), backgroundColor: '#2563eb' },
            { label: '방문객', data: st.byDay.map(function (x) { return x.people; }), backgroundColor: '#7c3aed' },
            { label: '워킹 팀', data: st.byDay.map(function (x) { return x.walkin; }), backgroundColor: '#9ca3af' }
          ]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
      });
    }

    var statCsv = h('button', { type: 'button', class: 'btn small' }, '통계 CSV');
    statCsv.addEventListener('click', function () {
      var rows = [['구분', '일자/본부', '팀', '방문 팀수', '방문객수', '워킹 팀수']];
      st.byDay.forEach(function (x) { rows.push(['일별', x.date, '', x.teams, x.people, x.walkin]); });
      st.byOrg.forEach(function (x) { rows.push(['본부/팀별', x.head, x.team, x.teams, x.people, '']); });
      rows.push(['합계', st.from + ' ~ ' + st.to, '', t.teams, t.people, t.walkInTeams]);
      downloadCsv('방명록통계_' + st.from + '_' + st.to + '.csv', rows);
    });
    box.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '담당 본부/팀별 (분양)  ', statCsv),
      simpleTable(['본부', '팀', '방문 팀', '방문객'], st.byOrg.map(function (x) {
        return h('tr', null, h('td', null, x.head), h('td', null, x.team), h('td', null, x.teams), h('td', null, x.people));
      }))));

    var csvBtn = h('button', { type: 'button', class: 'btn small primary' }, '방명록 CSV 내보내기');
    csvBtn.addEventListener('click', function () {
      var head = ['일자', '시각', '성명', '전화번호', '성별', '동행', '동반인수', '방문객수', '구분', '담당 본부', '담당 팀', '담당자', '개인정보동의', '동의일시', '입력', '호출', '확인'];
      var rows = [head].concat(list.map(function (g) {
        return [g.date, g.time, g.name, g.phone, g.gender, g.party, g.companions, g.people, g.category, g.head, g.team, g.staff, g.consent ? '동의' : '미동의', g.consentAt, g.source, g.called, g.acked];
      }));
      downloadCsv('방명록_' + st.from + '_' + st.to + '.csv', rows);
    });
    box.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '방명록 목록 (' + list.length + '건)  ', csvBtn),
      h('p', { class: 'muted' }, '전화번호 등 개인정보가 들어 있으니 내려받은 파일은 안전하게 보관해 주세요.'),
      simpleTable(['일자', '시각', '성명', '전화번호', '성별', '동행', '구분', '담당 본부/팀', '담당자', '동의', '입력'], list.map(function (g) {
        return h('tr', null, h('td', null, g.date), h('td', null, g.time), h('td', null, g.name), h('td', null, g.phone), h('td', null, g.gender),
          h('td', null, g.party + (g.companions ? ' ' + g.companions + '명' : '')), h('td', null, g.category),
          h('td', null, [g.head, g.team].filter(Boolean).join(' ')), h('td', null, g.staff), h('td', null, g.consent ? '동의' : '미동의'), h('td', { class: 'muted' }, g.source));
      }))));
  }

  var view = 'visits';
  Hub.section('visits', {
    render: async function (root) {
      root.innerHTML = '';
      var box = h('div');
      var tabs = h('div', { class: 'sub-tabs no-print' });
      [['visits', '예약·호출 현황'], ['guestbook', '방명록 (방문 통계)']].forEach(function (t) {
        var b = h('button', { type: 'button', class: 'btn' + (view === t[0] ? ' active' : '') }, t[1]);
        b.addEventListener('click', function () {
          view = t[0];
          $$('.btn', tabs).forEach(function (x) { x.classList.toggle('active', x === b); });
          runBusy(null, function () { return show(box); });
        });
        tabs.appendChild(b);
      });
      root.appendChild(tabs);
      root.appendChild(box);
      await show(box);
    }
  });

  function show(box) { return view === 'visits' ? renderVisits(box) : renderGuestbook(box); }
})();
