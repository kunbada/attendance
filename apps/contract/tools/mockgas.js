// Code.gs 를 그대로 실행하는 모의 Apps Script 서버
const http = require('http'), fs = require('fs'), vm = require('vm');
const sheets = {}; const props = {};
function mkSheet(name) {
  const rows = []; // 2D, 1-based access
  const sh = {
    name, rows,
    getLastRow: () => rows.length,
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') return { setNumberFormat() { return this; } };
      nr = nr || 1; nc = nc || 1;
      return {
        getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) { const v = row[c - 1 + j]; o.push(v === undefined ? '' : String(v)); } out.push(o); } return out; },
        setValues(v) { for (let i = 0; i < nr; i++) { rows[r - 1 + i] = rows[r - 1 + i] || []; for (let j = 0; j < nc; j++) rows[r - 1 + i][c - 1 + j] = v[i][j] === undefined ? '' : String(v[i][j]); } return this; },
        setFontWeight() { return this; }, setBackground() { return this; }, setNumberFormat() { return this; }
      };
    },
    setFrozenRows() { }, setColumnWidth() { }
  };
  return sh;
}
const cacheM = {}; const books = {}; let ssSeq = 0;
const mkSS = (id, map) => ({ getId: () => id, getUrl: () => 'https://mock/' + id, getSheetByName: n => map[n] || null, insertSheet: n => (map[n] = mkSheet(n)), getSheets: () => Object.values(map), deleteSheet: sh => { delete map[sh.name]; } });
const ctx = {
  SpreadsheetApp: {
    getActiveSpreadsheet: () => mkSS('active', sheets),
    create: name => { const id = 'ss' + (++ssSeq); books[id] = { '시트1': mkSheet('시트1') }; return mkSS(id, books[id]); },
    openById: id => { if (!books[id]) throw new Error('시트 없음 ' + id); return mkSS(id, books[id]); }
  },
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; }, deleteProperty: k => { delete props[k]; }, getProperties: () => Object.assign({}, props) }) },
  CacheService: { getScriptCache: () => ({ get: k => cacheM[k] ?? null, put: (k, v) => { cacheM[k] = v; }, remove: k => { delete cacheM[k]; } }) },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'sha256' },
    computeDigest: (alg, str) => Array.from(require('crypto').createHash('sha256').update(str, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
    getUuid: () => require('crypto').randomUUID(),
    formatDate: () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19)
  },
  Date, Math,
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() { } }) },
  ContentService: { createTextOutput: s => ({ s, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
  JSON, String, Number, Object
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require('path').join(__dirname, '../gas/Code.gs'), 'utf8').replace(/const TOKEN = '[^']*'/, "const TOKEN = 'test123'"), ctx);
http.createServer((req, res) => {
  let body = ''; req.on('data', d => body += d); req.on('end', () => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    if (req.url.startsWith('/dump')) { res.end(JSON.stringify(Object.fromEntries(Object.entries(sheets).map(([k, s]) => [k, s.rows.length]).concat(Object.entries(books).map(([id, m]) => [id, Object.keys(m).length]))))); return; }
    if (process.env.DOWN && fs.existsSync('/tmp/down')) { req.socket.destroy(); return; }
    const t0 = Date.now();
    const out = req.method === 'POST' ? ctx.doPost({ postData: { contents: body } }) : ctx.doGet();
    res.setHeader('Content-Type', 'application/json'); res.end(out.s);
    console.log(req.method, body.length, '->', out.s.length, (Date.now() - t0) + 'ms');
  });
}).listen(8765, () => console.log('mock on 8765'));
