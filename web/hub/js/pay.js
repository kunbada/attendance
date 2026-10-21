// 용역관리: 일급 정산(회차 만들기 → 검토 → 확정 → 지급완료), 개인별 지급 설정. 선택한 현장 기준.
// 판매수수료 정산은 계약관리 연동 후(5단계) 이 메뉴에 추가한다.
(function () {
  var simpleTable = Hub.simpleTable, downloadCsv = Hub.downloadCsv, DATE_STYLE = Hub.DATE_STYLE;
  var STATUS_BADGE = { '작성': 'warn', '검토': 'warn', '확정': 'ok', '지급완료': 'ok' };
  var won = function (n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; };

  function pad(n) { return ('0' + n).slice(-2); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

  // ====================================================================
  // 지급 설정 (개인별 일당·주기·일급/수수료 대상·3.3% 공제)
  // ====================================================================
  async function renderSettings(root) {
    var results = await Promise.all([Api.call('pay.settingList'), Api.call('pay.jobList'), Api.call('pay.supplierList')]);
    var res = results[0], jobs = results[1].jobs, suppliers = results[2].suppliers;
    root.innerHTML = '';

    // 1) 직군별 기본 지급: 개인 설정이 없는 직원에게 적용된다
    var jobRows = jobs.map(function (j) {
      var c = j.current;
      var edit = h('button', { type: 'button', class: 'btn small' }, c ? '변경' : '설정');
      edit.addEventListener('click', function () { openJobSetting(j, root, suppliers); });
      return h('tr', null,
        h('td', null, h('strong', null, j.job)), h('td', null, j.people + '명'),
        h('td', null, c ? won(c.dailyWage) : h('span', { class: 'muted' }, '미설정')),
        h('td', null, c ? c.cycle : ''), h('td', null, c ? (c.dailyEnabled ? '대상' : '아님') : ''),
        h('td', null, c ? (c.feeEnabled ? '대상' : '아님') : (j.defaults.feeEnabled ? '(기본 대상)' : '')),
        h('td', null, c ? modeText(c) : ''),
        h('td', { class: 'muted' }, c ? c.effectiveFrom + '부터' + (j.upcoming.length ? ' (예정 ' + j.upcoming[0].effectiveFrom + '~)' : '') : ''), h('td', null, edit));
    });
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '직군별 기본 지급'),
      h('p', { class: 'muted' }, '직군(상담사·홍보단·도우미·영업 등)마다 기본 일당과 지급 주기를 정해 두면, 개인 설정이 없는 직원에게 자동 적용됩니다. 직원 개인 설정이 있으면 그 직원은 개인 설정이 우선합니다. (용어: "일당"은 하루 기준 금액, "일당 지급 대상"은 출근 일수에 일당을 곱해 지급하는 방식의 대상이라는 뜻입니다)'),
      simpleTable(['직군', '활동 인원', '기본 일당', '주기', '일당 지급', '판매수수료', '지급 방식', '적용', ''], jobRows)));

    // 2) 개인별 설정 (직군 기본 위에 덮어쓰기)
    root.appendChild(h('div', { class: 'card' }, h('h2', null, '개인별 지급 설정'),
      h('p', { class: 'muted' }, '직군 기본과 다르게 줄 직원만 개인 설정을 합니다. 적용 시작일을 바꿔 저장하면 이력이 쌓이고, 정산은 날짜별로 그날 적용된 일당으로 계산합니다. 판매수수료 대상은 영업 직군이 기본이며 나머지 직군은 필요할 때만 켭니다. (수수료 정산은 계약관리 연동 후 추가됩니다)')));
    var rows = res.staff.map(function (st) {
      var c = st.current;
      var edit = h('button', { type: 'button', class: 'btn small' }, st.personal ? '변경' : '개인 설정');
      edit.addEventListener('click', function () { openSetting(st, root, suppliers); });
      var cells = [edit];
      if (st.personal) {
        var clear = h('button', { type: 'button', class: 'btn small' }, '직군 기준으로');
        clear.addEventListener('click', function () {
          if (!confirm(st.name + ' 님의 개인 설정을 모두 지우고 직군 기본을 따르게 할까요? (확정된 정산은 그대로)')) return;
          runBusy(clear, async function () { await Api.call('pay.settingClear', { staffId: st.id }); await renderSettings(root); toast('직군 기본을 따르게 했습니다.'); });
        });
        cells.push(' ', clear);
      }
      return h('tr', null,
        h('td', null, h('strong', null, st.name), st.nickname ? ' (' + st.nickname + ')' : ''),
        h('td', null, st.job + (st.grade !== '직원' ? ' · ' + st.grade : '')),
        h('td', null, c ? won(c.dailyWage) : h('span', { class: 'badge warn' }, '미설정')),
        h('td', null, c ? c.cycle : ''),
        h('td', null, c ? (c.dailyEnabled ? '대상' : '아님') : ''),
        h('td', null, c ? (c.feeEnabled ? '대상' : '아님') : (st.defaults.feeEnabled ? '(기본 대상)' : '')),
        h('td', null, c ? modeText(c) : ''),
        h('td', null, c ? h('span', { class: 'badge ' + (c.source === '개인' ? 'ok' : '') }, c.source === '개인' ? '개인' : '직군 기본') : ''),
        h('td', null, cells));
    });
    root.appendChild(simpleTable(['성명(예명)', '직군', '일당', '주기', '일당 지급', '판매수수료', '지급 방식', '적용', ''], rows));
    root.appendChild(supplierCard(suppliers, root));
  }

  function modeText(c) {
    if (c.payMode === '업체일괄') return '업체 일괄: ' + (c.supplierName || '?');
    return c.payMode === '3.3%' ? '3.3% 공제' : '공제 없음';
  }

  // 인력공급업체: 용역비를 개인이 아니라 업체에 일괄 지급할 때 (공급가 = 일당 × 출근일수, 부가세 10% 별도)
  function supplierCard(suppliers, root) {
    var add = h('button', { type: 'button', class: 'btn small' }, '+ 업체 등록');
    add.addEventListener('click', function () { openSupplier(null, root); });
    var rows = suppliers.map(function (sp) {
      var edit = h('button', { type: 'button', class: 'btn small' }, '수정');
      edit.addEventListener('click', function () { openSupplier(sp, root); });
      return h('tr', null, h('td', null, h('strong', null, sp.name)), h('td', null, sp.bizNo ? sp.bizNo.replace(/^(\d{3})(\d{2})(\d{5})$/, '$1-$2-$3') : ''),
        h('td', null, sp.bank ? sp.bank + ' · ' + (sp.accountSet ? '계좌 등록됨' : '계좌 없음') + (sp.holder ? ' · ' + sp.holder : '') : ''), h('td', null, sp.contact),
        h('td', null, h('span', { class: 'badge ' + (sp.active ? 'ok' : '') }, sp.active ? '사용' : '중지')), h('td', null, edit));
    });
    return h('div', { class: 'card' }, h('h2', null, '인력공급업체 ', add),
      h('p', { class: 'muted' }, '개인이 아니라 업체에 용역비를 일괄 지급하는 경우에 등록합니다. 위 지급 설정에서 지급 방식을 "인력공급업체 일괄지급"으로 고르면, 정산 때 일당 × 출근일수가 공급가가 되고 부가세(10%)는 별도로 더해 업체 한 건으로 묶어 보여 줍니다. 개인 3.3% 공제·개인 지급은 없습니다.'),
      simpleTable(['업체', '사업자번호', '입금 계좌', '연락처', '상태', ''], rows));
  }

  function openSupplier(sp, root) {
    var name = h('input', { type: 'text', maxLength: 40, value: sp ? sp.name : '' });
    var biz = h('input', { type: 'text', value: sp ? sp.bizNo : '', placeholder: '숫자 10자리' });
    var bank = h('input', { type: 'text', maxLength: 20, value: sp ? sp.bank : '', placeholder: '예: 신한' });
    var acct = h('input', { type: 'text', autocomplete: 'off', placeholder: sp && sp.accountSet ? '바꾸지 않으려면 비워 두세요' : '계좌번호' });
    var holder = h('input', { type: 'text', maxLength: 30, value: sp ? sp.holder : '' });
    var contact = h('input', { type: 'text', maxLength: 40, value: sp ? sp.contact : '' });
    var active = h('select', null, option('Y', '사용', !sp || sp.active), option('N', '사용 중지', sp && !sp.active));
    modal(sp ? '인력공급업체 수정' : '인력공급업체 등록', h('div', null, field('업체 이름', name), field('사업자등록번호', biz), field('입금 은행', bank), field('입금 계좌번호', acct, '화면에는 다시 보이지 않고, 이체 파일을 만들 때만 사용됩니다 (기록됨)'),
      field('예금주', holder), field('연락처', contact), field('상태', active)), [{
        label: '저장', primary: true, onClick: async function (close) {
          await Api.call('pay.supplierSave', { id: sp ? sp.id : '', name: name.value, bizNo: biz.value, bank: bank.value, accountNo: acct.value, holder: holder.value, contact: contact.value, active: active.value === 'Y' });
          close(); await renderSettings(root); toast('저장했습니다.');
        }
      }]);
  }

  // 공통 입력 창: 개인·직군 설정 모두 같은 항목
  function settingForm(title, cur, defaults, hist, suppliers, onSave) {
    var wage = h('input', { type: 'number', min: 0, step: 1000, value: cur ? cur.dailyWage : '' });
    var cycle = h('select', null, option('월', '월 (한 달 단위 지급)', !cur || cur.cycle === '월'), option('주', '주 (한 주 단위 지급)', cur && cur.cycle === '주'));
    var daily = h('input', { type: 'checkbox', checked: cur ? cur.dailyEnabled : true });
    var fee = h('input', { type: 'checkbox', checked: cur ? cur.feeEnabled : defaults.feeEnabled });
    var mode = h('select', null, option('3.3%', '3.3% 공제 후 개인에게 지급 (소득세 3% + 지방소득세 0.3%)', !cur || cur.payMode === '3.3%'),
      option('공제없음', '공제 없이 개인에게 지급', cur && cur.payMode === '공제없음'), option('업체일괄', '인력공급업체에 일괄 지급 (공급가 = 일당 × 출근일수, 부가세 10% 별도)', cur && cur.payMode === '업체일괄'));
    var activeSup = suppliers.filter(function (x) { return x.active; });
    var sup = h('select', null, option('', activeSup.length ? '업체를 선택해 주세요' : '(등록된 업체가 없습니다 — 아래 [인력공급업체]에서 먼저 등록)'),
      activeSup.map(function (x) { return option(x.id, x.name, cur && cur.supplierId === x.id); }));
    var supField = field('인력공급업체', sup);
    function syncMode() { supField.classList.toggle('hidden', mode.value !== '업체일괄'); }
    mode.addEventListener('change', syncMode);
    syncMode();
    var from = h('input', { type: 'date', value: ymd(new Date()), style: DATE_STYLE });
    var histText = hist.length ? h('p', { class: 'muted' }, '이력: ' + hist.map(function (x) { return x.effectiveFrom + ' ' + won(x.dailyWage) + '/' + x.cycle; }).join(' → ')) : null;
    modal(title, h('div', null, field('일당 (원)', wage, '하루 기준 금액. 반일은 절반으로 계산하고 원 단위 미만은 버립니다.'), field('지급 주기', cycle),
      h('label', { class: 'check' }, daily, ' 일당 지급 대상 (출근 일수 × 일당으로 정산)'),
      h('label', { class: 'check' }, fee, ' 판매수수료 대상 (계약 담당자로 연결된 경우, 5단계에서 사용)'),
      field('지급 방식', mode), supField,
      field('적용 시작일', from, '이 날짜부터 새 설정이 적용됩니다.'), histText), [{
        label: '저장', primary: true, onClick: async function (close) {
          await onSave({ dailyWage: Number(wage.value), cycle: cycle.value, dailyEnabled: daily.checked, feeEnabled: fee.checked, payMode: mode.value, supplierId: sup.value, effectiveFrom: from.value });
          close();
        }
      }]);
  }

  function openSetting(st, root, suppliers) {
    settingForm('개인 지급 설정 — ' + st.name, st.current, st.defaults, st.history, suppliers, async function (v) {
      v.staffId = st.id;
      await Api.call('pay.settingSave', v);
      await renderSettings(root); toast('저장했습니다.');
    });
  }

  function openJobSetting(j, root, suppliers) {
    settingForm('직군 기본 지급 — ' + j.job, j.current, j.defaults, j.history, suppliers, async function (v) {
      v.job = j.job;
      await Api.call('pay.jobSave', v);
      await renderSettings(root); toast('저장했습니다. 개인 설정이 없는 ' + j.job + ' 직원에게 적용됩니다.');
    });
  }

  // ====================================================================
  // 일급 정산 회차
  // ====================================================================
  var openRunId = '';

  async function renderRuns(root) {
    if (openRunId) { try { await renderRunDetail(root, openRunId); return; } catch (e) { openRunId = ''; } }
    var res = await Api.call('pay.runList');
    root.innerHTML = '';
    var add = h('button', { type: 'button', class: 'btn small primary' }, '+ 새 정산');
    add.addEventListener('click', function () { openCreate(root); });
    root.appendChild(h('div', { class: 'toolbar' }, h('strong', null, '일급 정산 회차'), add,
      h('span', { class: 'muted' }, '정산은 "현장 + 기간" 단위입니다. 기간 안에 이 현장에서 일한 사람이 대상이며, 다른 현장으로 옮긴 사람도 이 현장에서 일한 날은 이 현장 정산에 들어갑니다.')));
    var rows = res.runs.map(function (r) {
      var open = h('button', { type: 'button', class: 'btn small primary' }, '열기');
      open.addEventListener('click', function () { openRunId = r.id; runBusy(open, function () { return renderRuns(root); }); });
      return h('tr', null, h('td', null, h('strong', null, r.title)), h('td', null, r.cycle), h('td', null, r.from + ' ~ ' + r.to),
        h('td', null, h('span', { class: 'badge ' + STATUS_BADGE[r.status] }, r.status)), h('td', null, r.people + '명'),
        h('td', null, won(r.gross)), h('td', null, won(r.tax)), h('td', null, h('strong', null, won(r.net))),
        h('td', null, r.supply ? won(r.supplyTotal) + ' (공급가 ' + won(r.supply) + ')' : ''), h('td', null, open));
    });
    root.appendChild(simpleTable(['회차', '주기', '기간', '상태', '인원', '개인 지급액', '공제', '개인 실지급액', '업체 청구(부가세 포함)', ''], rows));
  }

  function openCreate(root) {
    var now = new Date();
    var prevMonthFirst = new Date(now.getFullYear(), now.getMonth() - 1, 1), prevMonthLast = new Date(now.getFullYear(), now.getMonth(), 0);
    var cycle = h('select', null, option('월', '월 단위'), option('주', '주 단위 (7일 이내)'));
    var from = h('input', { type: 'date', value: ymd(prevMonthFirst), style: DATE_STYLE });
    var to = h('input', { type: 'date', value: ymd(prevMonthLast), style: DATE_STYLE });
    var title = h('input', { type: 'text', maxLength: 40, placeholder: '비우면 자동 (예: 2026-09-01 ~ 2026-09-30 월급)' });
    modal('새 일급 정산', h('div', null, field('지급 주기', cycle, '이 주기로 설정된 직원만 대상이 됩니다.'), field('시작일', from), field('종료일', to), field('회차 이름', title)), [{
      label: '만들기', primary: true, onClick: async function (close) {
        var res = await Api.call('pay.runCreate', { cycle: cycle.value, from: from.value, to: to.value, title: title.value });
        close(); openRunId = res.id; await renderRuns(root);
        toast(res.people + '명 (개인 실지급 ' + won(res.net) + (res.supplierTotal ? ' + 업체 청구 ' + won(res.supplierTotal) : '') + ') 으로 작성했습니다.' + (res.notIncluded.length ? ' (제외된 사람 ' + res.notIncluded.length + '명 — 아래 안내 확인)' : ''));
      }
    }]);
  }

  async function renderRunDetail(root, runId) {
    var d = await Api.call('pay.runGet', { runId: runId });
    var r = d.run;
    root.innerHTML = '';
    var editable = r.status === '작성' || r.status === '검토';
    var back = h('button', { type: 'button', class: 'btn small' }, '← 목록');
    back.addEventListener('click', function () { openRunId = ''; runBusy(back, function () { return renderRuns(root); }); });
    var again = function () { return renderRunDetail(root, runId); };
    var act = function (label, cls, fn, confirmText) {
      var b = h('button', { type: 'button', class: 'btn small ' + (cls || '') }, label);
      b.addEventListener('click', function () {
        if (confirmText && !confirm(confirmText)) return;
        runBusy(b, async function () { await fn(); await again(); });
      });
      return [b, ' '];
    };
    var buttons = [];
    if (editable) buttons.push(act('다시 계산', '', async function () { await Api.call('pay.runRecalc', { runId: runId }); toast('근태 보정·지급 설정을 반영해 다시 계산했습니다.'); }, '근태 보정과 지급 설정을 반영해 다시 계산합니다. (조정 금액은 유지, 검토 상태는 작성으로 돌아갑니다)'));
    if (r.status === '작성') buttons.push(act('검토 요청', 'primary', function () { return Api.call('pay.runReview', { runId: runId }); }));
    if (r.status === '검토' && d.canConfirm) buttons.push(act('확정', 'primary', function () { return Api.call('pay.runConfirm', { runId: runId }); }, '확정하면 이 회차는 수정할 수 없습니다 (정정은 다음 회차의 조정 금액으로). 확정할까요?'));
    if (r.status === '확정' && d.canConfirm) buttons.push(act('지급완료 처리', 'primary', function () { return Api.call('pay.runPaid', { runId: runId }); }, '이체를 마쳤다면 지급완료로 표시합니다.'));
    if (editable) buttons.push(act('삭제', 'danger', async function () { await Api.call('pay.runDelete', { runId: runId }); openRunId = ''; }, '이 회차를 삭제할까요?'));
    if (r.status === '확정' || r.status === '지급완료') {
      var tf = h('button', { type: 'button', class: 'btn small' }, '이체 파일 (CSV)');
      tf.addEventListener('click', function () {
        if (!confirm('은행·계좌번호 원문이 들어간 파일을 만듭니다. 만든 기록이 남습니다. 계속할까요?')) return;
        runBusy(tf, async function () {
          var t = await Api.call('pay.transferExport', { runId: runId });
          downloadCsv('이체_' + r.from + '_' + r.to + '.csv', [['구분', '성명(업체)', '은행', '계좌번호', '예금주', '이체금액', '공급가', '부가세']].concat(t.rows.map(function (x) { return [x.kind, x.name, x.bank, x.accountNo, x.holder, x.amount, x.supply || '', x.vat || '']; })));
          var miss = t.rows.filter(function (x) { return x.missing; }).length;
          toast('이체 파일을 만들었습니다. 개인정보가 들어 있으니 안전하게 보관해 주세요.' + (miss ? ' (계좌 정보가 없는 ' + miss + '건 있음)' : ''), !!miss);
        });
      });
      buttons.push(tf, ' ');
      var csv = h('button', { type: 'button', class: 'btn small' }, '명세 CSV');
      csv.addEventListener('click', function () {
        downloadCsv('정산명세_' + r.from + '_' + r.to + '.csv', [['성명', '지급 방식', '업체', '일수', '일급 합계', '조정', '조정 사유', '지급액(업체는 공급가)', '소득세', '지방소득세', '실지급액']].concat(d.items.map(function (i) {
          return [i.name, i.payMode, i.supplierName, i.days, i.baseAmount, i.adjustAmount, i.adjustMemo, i.gross, i.incomeTax, i.localTax, i.net];
        })));
      });
      buttons.push(csv, ' ');
    }
    var print = h('button', { type: 'button', class: 'btn small no-print' }, '인쇄');
    print.addEventListener('click', function () { window.print(); });
    buttons.push(print);

    root.appendChild(h('div', { class: 'toolbar no-print' }, back));
    root.appendChild(h('div', { class: 'card' },
      h('h2', null, r.title + ' ', h('span', { class: 'badge ' + STATUS_BADGE[r.status] }, r.status)),
      h('div', { class: 'muted' }, r.cycle + ' 단위 · ' + r.from + ' ~ ' + r.to + ' · 작성 ' + r.createdBy + (r.confirmedAt ? ' · 확정 ' + r.confirmedBy + ' ' + r.confirmedAt : '') + (r.paidAt ? ' · 지급완료 ' + r.paidAt : '')),
      h('div', { class: 'no-print', style: 'margin-top:10px' }, buttons)));
    root.appendChild(h('div', { class: 'summary' },
      Hub.statCard('대상', d.totals.people + '명'), Hub.statCard('개인 지급액', won(d.totals.gross), d.totals.ownPeople + '명'), Hub.statCard('공제 합계(3.3%)', won(d.totals.tax)), Hub.statCard('개인 실지급액', won(d.totals.net)),
      d.totals.suppliers.length ? Hub.statCard('업체 일괄 청구', won(d.totals.supplierTotal), '공급가 ' + won(d.totals.supply) + ' + 부가세 ' + won(d.totals.vat)) : null));
    if (d.totals.suppliers.length) {
      root.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '인력공급업체 일괄 지급'),
        h('p', { class: 'muted' }, '공급가 = 일당 × 출근일수(보정 반영). 부가세는 업체별 공급가 합계의 10%(원 단위 절사)를 별도로 더합니다. 개인에게는 지급하지 않습니다.'),
        simpleTable(['업체', '인원', '공급가', '부가세 10%', '지급 합계'], d.totals.suppliers.map(function (b) {
          return h('tr', null, h('td', null, h('strong', null, b.name)), h('td', null, b.people + '명'), h('td', null, won(b.supply)), h('td', null, won(b.vat)), h('td', null, h('strong', null, won(b.total))));
        }))));
    }
    if (d.notIncluded.length) {
      root.appendChild(h('div', { class: 'card' }, h('h3', { style: 'margin-top:0' }, '이 기간에 일했지만 포함되지 않은 사람 (' + d.notIncluded.length + '명)'),
        h('p', { class: 'muted' }, '지급 설정을 한 뒤 [다시 계산]하면 반영됩니다.'),
        simpleTable(['성명', '이유'], d.notIncluded.map(function (n) { return h('tr', null, h('td', null, n.name), h('td', null, n.reason)); }))));
    }
    var rows = d.items.map(function (i) {
      var detailBtn = h('button', { type: 'button', class: 'btn small no-print' }, '명세');
      detailBtn.addEventListener('click', function () { openDetail(r, i); });
      var cells = [detailBtn];
      if (editable) {
        var adj = h('button', { type: 'button', class: 'btn small no-print' }, '조정');
        adj.addEventListener('click', function () { openAdjust(r, i, again); });
        cells.push(' ', adj);
      }
      var viaSup = i.payMode === '업체일괄';
      return h('tr', null, h('td', null, h('strong', null, i.name), viaSup ? [' ', h('span', { class: 'badge' }, '업체 ' + i.supplierName)] : null), h('td', null, i.days + '일'), h('td', null, won(i.baseAmount)),
        h('td', null, i.adjustAmount ? won(i.adjustAmount) + ' (' + i.adjustMemo + ')' : ''), h('td', null, viaSup ? won(i.gross) + ' (공급가)' : won(i.gross)),
        h('td', null, viaSup ? '-' : won(i.incomeTax)), h('td', null, viaSup ? '-' : won(i.localTax)), h('td', null, viaSup ? '업체 지급' : h('strong', null, won(i.net))), h('td', null, cells));
    });
    rows.push(h('tr', null, h('td', null, h('strong', null, '개인 지급 합계')), h('td'), h('td'), h('td'), h('td', null, h('strong', null, won(d.totals.gross))),
      h('td', { colspan: 2 }, h('strong', null, won(d.totals.tax))), h('td', null, h('strong', null, won(d.totals.net))), h('td')));
    root.appendChild(simpleTable(['성명', '근무일수', '일급 합계', '조정', '지급액', '소득세 3%', '지방소득세 0.3%', '실지급액', ''], rows));
  }

  // 개인 명세: 날짜별 내역
  function openDetail(r, i) {
    var rows = i.detail.map(function (x) {
      return h('tr', null, h('td', null, x.date), h('td', null, x.note), h('td', null, (x.units / 2) + '일'), h('td', null, won(x.wage)), h('td', null, won(x.amount)));
    });
    modal('개인 명세 — ' + i.name, h('div', null,
      h('p', { class: 'muted' }, r.title + ' (' + r.from + ' ~ ' + r.to + ')'),
      simpleTable(['날짜', '구분', '일수', '일당', '금액'], rows),
      h('div', { class: 'stat' }, h('span', null, '일급 합계 (' + i.days + '일)'), h('strong', null, won(i.baseAmount))),
      i.adjustAmount ? h('div', { class: 'stat' }, h('span', null, '조정 (' + i.adjustMemo + ')'), h('strong', null, won(i.adjustAmount))) : null,
      h('div', { class: 'stat' }, h('span', null, '지급액'), h('strong', null, won(i.gross))),
      h('div', { class: 'stat' }, h('span', null, '소득세 3%'), h('span', null, '-' + won(i.incomeTax))),
      h('div', { class: 'stat' }, h('span', null, '지방소득세 0.3%'), h('span', null, '-' + won(i.localTax))),
      h('div', { class: 'stat' }, h('span', null, '실지급액'), h('strong', null, won(i.net)))), [{ label: '인쇄', onClick: function () { window.print(); } }]);
  }

  function openAdjust(r, i, again) {
    var amount = h('input', { type: 'number', step: 1000, value: i.adjustAmount });
    var memo = h('input', { type: 'text', maxLength: 100, value: i.adjustMemo, placeholder: '예: 선지급 차감, 이전 회차 정정' });
    modal('조정 금액 — ' + i.name, h('div', null,
      h('p', { class: 'muted' }, '일급 합계 ' + won(i.baseAmount) + ' 에 더하거나 뺄 금액입니다 (빼려면 마이너스). 세금은 조정 후 금액으로 다시 계산됩니다. 확정된 회차의 정정은 다음 회차에서 이 조정으로 처리하세요.'),
      field('조정 금액 (원)', amount), field('사유 (필수)', memo)), [{
        label: '저장', primary: true, onClick: async function (close) {
          await Api.call('pay.itemSave', { runId: r.id, staffId: i.staffId, adjustAmount: Number(amount.value || 0), adjustMemo: memo.value });
          close(); await again(); toast('조정했습니다. (검토 중이었다면 다시 검토 요청이 필요합니다)');
        }
      }]);
  }

  Hub.section('paysettings', { render: renderSettings });
  Hub.section('payruns', { render: renderRuns });
})();
