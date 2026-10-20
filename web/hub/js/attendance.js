// 근태: 오늘 출근 QR 발급, 일별·월별 출근 현황
(function () {
  var simpleTable = Hub.simpleTable, nameCell = Hub.nameCell, orgCell = Hub.orgCell, DATE_STYLE = Hub.DATE_STYLE;
  var todayLocal = Hub.todayLocal, downloadCsv = Hub.downloadCsv;

  async function renderQr(root) {
    var info = await Api.call('admin.currentQr');
    root.innerHTML = '';
    var issueBtn = h('button', { type: 'button', class: 'btn primary', style: 'max-width:260px' }, info.issued ? '오늘 QR 다시 만들기' : '오늘 QR 만들기');
    issueBtn.addEventListener('click', function () {
      runBusy(issueBtn, async function () {
        if (info.issued && !confirm('QR을 다시 만들면 이미 인쇄한 QR은 쓸 수 없게 됩니다. 계속할까요?')) return;
        var pos = await getPosition();
        var acc = Math.round(pos.coords.accuracy);
        if (acc > 100 && !confirm('위치 정확도가 낮습니다 (오차 약 ' + acc + 'm).\n실외나 창가에서 다시 시도하는 것을 권장합니다.\n그래도 이 위치를 기준으로 만들까요?')) return;
        await Api.call('admin.issueQr', { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: acc });
        toast('오늘 QR을 만들었습니다. (위치 오차 약 ' + acc + 'm)');
        await renderQr(root);
      });
    });
    var card = h('div', { class: 'card' }, h('h2', null, '오늘 출근 QR'),
      h('p', { class: 'muted no-print' }, '이 버튼을 누른 곳의 위치가 오늘 출근의 기준점이 됩니다. 반드시 현장에서 누르세요.'),
      h('div', { class: 'no-print' }, issueBtn));
    root.appendChild(card);

    if (info.issued) {
      var box = h('div', { class: 'qr-box' });
      var printBtn = h('button', { type: 'button', class: 'btn no-print', style: 'max-width:160px;margin:12px auto 0' }, '인쇄');
      printBtn.addEventListener('click', function () {
        document.body.classList.add('print-qr');
        window.print();
        document.body.classList.remove('print-qr');
      });
      var big = h('div', { class: 'qr-big' }, box, h('p', { class: 'qr-title' }, info.date + ' 출근 QR'),
        h('p', { class: 'muted' }, '발급 ' + info.issuedAt + ' · 위치 오차 약 ' + info.accuracy + 'm'), printBtn);
      card.appendChild(h('hr', { class: 'no-print', style: 'border:0;border-top:1px solid var(--line);margin:16px 0' }));
      card.appendChild(big);
      if (window.QRCode) new QRCode(box, { text: info.qr, width: 280, height: 280 });
      else box.textContent = 'QR 라이브러리를 불러오지 못했습니다.';
    } else {
      card.appendChild(h('p', { class: 'badge warn no-print', style: 'margin-top:12px' }, '오늘 QR이 아직 없습니다'));
    }
  }

  var attView = { date: '', month: '' };
  async function renderAttendance(root) {
    attView.date = attView.date || todayLocal();
    attView.month = attView.month || todayLocal().slice(0, 7);
    root.innerHTML = '';
    var dayBox = h('div'), monthBox = h('div');

    var dateIn = h('input', { type: 'date', value: attView.date, style: DATE_STYLE });
    var dayBtn = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    dayBtn.addEventListener('click', function () { runBusy(dayBtn, function () { attView.date = dateIn.value; return loadDay(dayBox); }); });
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '일별 근태'), h('div', { class: 'toolbar' }, dateIn, dayBtn), dayBox));

    var monthIn = h('input', { type: 'month', value: attView.month, style: DATE_STYLE });
    var monthBtn = h('button', { type: 'button', class: 'btn small primary' }, '조회');
    monthBtn.addEventListener('click', function () { runBusy(monthBtn, function () { attView.month = monthIn.value; return loadMonth(monthBox); }); });
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '월별 근태'), h('div', { class: 'toolbar' }, monthIn, monthBtn), monthBox));

    await Promise.all([loadDay(dayBox), loadMonth(monthBox)]);
  }

  async function loadDay(box) {
    var d = await Api.call('admin.attendance', { date: attView.date });
    box.innerHTML = '';
    box.appendChild(h('div', { class: 'summary' },
      h('div', { class: 'card' }, h('span', { class: 'num' }, d.present.length + ' / ' + d.activeCount), '출근 / 활동 인원'),
      h('div', { class: 'card' }, h('span', { class: 'num' }, d.failures.length), '실패 기록')));
    box.appendChild(h('h3', null, '출근자'));
    box.appendChild(simpleTable(['성명(예명)', '직군 / 소속', '시각', '거리'], d.present.map(function (p) {
      return h('tr', null, h('td', null, nameCell(p)), h('td', null, orgCell(p)), h('td', null, p.time), h('td', null, p.distance + 'm'));
    })));
    box.appendChild(h('h3', null, '미출근자 (' + d.absent.length + '명)'));
    box.appendChild(simpleTable(['성명(예명)', '직군 / 소속'], d.absent.map(function (p) {
      return h('tr', null, h('td', null, nameCell(p)), h('td', null, orgCell(p)));
    })));
    box.appendChild(h('h3', null, '실패 기록'));
    box.appendChild(simpleTable(['시각', '성명', '사유'], d.failures.map(function (f) {
      return h('tr', null, h('td', null, f.time), h('td', null, f.name), h('td', null, f.reason));
    })));
  }

  async function loadMonth(box) {
    var m = await Api.call('admin.attendance', { month: attView.month });
    box.innerHTML = '';
    var csvBtn = h('button', { type: 'button', class: 'btn small' }, 'CSV 다운로드');
    csvBtn.addEventListener('click', function () {
      var head = ['성명', '예명', '직군', '본부', '팀', '출근일수'];
      for (var d = 1; d <= m.daysInMonth; d++) head.push(d + '일');
      var rows = [head].concat(m.staff.map(function (p) {
        var r = [p.name, p.nickname, p.job, p.headName, p.teamName, p.days.length];
        for (var d = 1; d <= m.daysInMonth; d++) r.push(p.days.indexOf(d) >= 0 ? 'O' : '');
        return r;
      }));
      downloadCsv('근태_' + m.month + '.csv', rows);
    });
    box.appendChild(h('div', { class: 'toolbar' }, csvBtn));
    box.appendChild(simpleTable(['성명(예명)', '직군 / 소속', '출근일수', '출근한 날'], m.staff.map(function (p) {
      return h('tr', null, h('td', null, nameCell(p)), h('td', null, orgCell(p)), h('td', null, p.days.length + '일'),
        h('td', { class: 'muted' }, p.days.join(', ')));
    })));
  }

  Hub.register({
    key: 'attendance', label: '근태',
    render: async function (root) {
      root.innerHTML = '';
      var qrBox = h('div'), attBox = h('div');
      root.appendChild(qrBox);
      root.appendChild(attBox);
      await Promise.all([renderQr(qrBox), renderAttendance(attBox)]);
    }
  });
})();
