// 地図を、あなたの言葉で（REYZ CONSENSUS の入口。docs/consensus-entry.md）。
// 1) 入口 Worker が無いとき: 入口は出ない（Home の地図は従来どおり選択だけで完結。Fail-Closed）
// 2) 入口 Worker（模擬）があるとき: 入口が出る → 送る → 返事が並ぶ → 地図が引き直される → chain がつながる → 相談へ引き継がれる → 選択を変えると捨てる
//    → 上限（turn_limit）で閉じる → 失敗（5xx）では入力に戻れる。モデルは呼ばない（模擬応答）。
// 使い方: node qa/talk_check.js site  → JSON { fails: [...] }（fails が空なら PASS）
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2] || 'site');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const NEW_GOAL = '週3回の配信を、半年続ける。';
const CANON_GOAL = '言葉にできている目的を、活動の順番にする。';

function makeServer(mock) {
  const seen = [];   // 模擬 Worker が受けた POST（body）
  let mode = 'ok';
  const server = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]);
    if (mock && u.startsWith('/api/consensus')) {
      if (u === '/api/consensus/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: true, ready: true })); }
      if (u === '/api/consensus/turn' && req.method === 'POST') {
        let body = ''; req.on('data', d => body += d); req.on('end', () => {
          let j = null; try { j = JSON.parse(body); } catch (err) { /* fall through */ }
          seen.push(j);
          const n = seen.length;
          if (mode === 'limit') { res.writeHead(409, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'turn_limit', consult: true })); }
          if (mode === 'fail') { res.writeHead(502, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'model' })); }
          const chain = ('a' + n).padEnd(64, '0');
          const out = n === 1
            ? { ok: true, reply: '半年続けるなら、まず曜日を決めましょう。何曜日が続けやすいですか。', map: { goal: NEW_GOAL, place: j.map.place, step: j.map.step }, consult: false, chain, turn: 1 }
            : { ok: true, reply: '地図は整いました。ここからは相談で、進め方を一緒に決めましょう。', map: null, consult: true, chain, turn: n };
          res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(out));
        }); return;
      }
      res.writeHead(404); return res.end();
    }
    let p = path.join(ROOT, u === '/' ? '/index.html' : u); if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html';
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  });
  return { server, seen, setMode: m => { mode = m; } };
}

(async () => {
  const fails = []; const F = (k, v) => { if (!v) fails.push(k); return v; }; const out = {};
  const b = await chromium.launch();
  const t = s => s.replace(/ /g, ' ').trim();
  const open = async (base, vp) => {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(base + 'index.html', { waitUntil: 'load' }); await p.waitForTimeout(1700);
    const pick = async (q, aud, v) => { const sel = `.mq[data-q="${q}"][data-for="${aud}"] .opt[data-v="${v}"]`; await p.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }), sel); await p.waitForTimeout(150); await p.click(sel, { force: true }); await p.waitForTimeout(120); };
    const creator = async () => { await pick('who', 'all', 'creator'); await pick('goal', 'creator', 'yes'); await pick('place', 'creator', 'yes'); await pick('style', 'creator', 'live'); await pick('make', 'creator', 'share'); await pick('value', 'creator', 'last'); await p.waitForTimeout(400); };
    return { ctx, p, errs, pick, creator };
  };
  const VPS = [['m390', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['d1440', { width: 1440, height: 900 }]];

  // 1) 入口 Worker なし
  { const { server } = makeServer(false); await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}/`;
    for (const [name, vp] of VPS) { const { ctx, p, errs, creator } = await open(base, vp); await creator();
      const s = await p.evaluate(() => ({ card: document.getElementById('mapCard').hidden, talk: document.getElementById('mapTalk').hidden, goal: document.getElementById('mapGoal').innerText.replace(/ /g, ' ').trim() }));
      F(`${name}/no-worker: card shown, talk hidden`, !s.card && s.talk); F(`${name}/no-worker: canonical goal`, s.goal === CANON_GOAL); F(`${name}/no-worker: no page errors`, errs.length === 0);
      await ctx.close(); }
    server.close(); }

  // 2) 入口 Worker（模擬）あり
  { const { server, seen, setMode } = makeServer(true); await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}/`;
    for (const [name, vp] of VPS) { seen.length = 0; setMode('ok'); const { ctx, p, errs, pick, creator } = await open(base, vp); await creator();
      F(`${name}: talk shown`, await p.evaluate(() => !document.getElementById('mapTalk').hidden));
      F(`${name}: send button >= 44`, await p.evaluate(() => document.getElementById('talkSend').getBoundingClientRect().height >= 44));
      const say = async (text) => { await p.evaluate(() => document.getElementById('talkInput').scrollIntoView({ block: 'center', behavior: 'instant' })); await p.fill('#talkInput', text); await p.click('#talkSend', { force: true }); await p.waitForFunction(() => !document.querySelector('.talk-line.pending') && !document.getElementById('mapTalk').classList.contains('is-busy'), null, { timeout: 5000 }); await p.waitForTimeout(150); };
      // 1 往復目: 返事が並び、地図が引き直され、sessionStorage と chain が更新される
      await say('週3回の配信を半年続けたい。');
      let s = await p.evaluate(() => ({ lines: Array.from(document.querySelectorAll('.talk-line')).map(l => l.className + '|' + l.innerText.trim()), goal: document.getElementById('mapGoal').innerText.replace(/ /g, ' ').trim(), live: document.getElementById('mapCard').classList.contains('is-live'), stored: JSON.parse(sessionStorage.getItem('reyz.map.r') || 'null'), next: document.getElementById('mapGo').classList.contains('is-next'), note: document.getElementById('talkNote').hidden }));
      F(`${name}: two lines (user, ai)`, s.lines.length === 2 && s.lines[0].startsWith('talk-line user|週3回') && s.lines[1].startsWith('talk-line ai|半年続けるなら'));
      F(`${name}: map redrawn with AI goal`, s.goal === NEW_GOAL && s.live);
      F(`${name}: stored map carries AI goal`, s.stored && s.stored.goal === NEW_GOAL && s.stored.who === 'creator');
      F(`${name}: not yet consult`, !s.next && s.note);
      F(`${name}: request 1 shape`, seen.length === 1 && seen[0].who === 'creator' && seen[0].chain === '' && seen[0].messages.length === 1 && seen[0].map.goal === CANON_GOAL);
      // 2 往復目: chain がつながり、全文（3 件）が送られ、consult で相談が示される
      await say('土日なら続けられる。');
      s = await p.evaluate(() => ({ n: document.querySelectorAll('.talk-line').length, next: document.getElementById('mapGo').classList.contains('is-next'), goal: document.getElementById('mapGoal').innerText.replace(/ /g, ' ').trim() }));
      F(`${name}: request 2 chain + history`, seen.length === 2 && seen[1].chain === ('a1').padEnd(64, '0') && seen[1].messages.length === 3 && seen[1].map.goal === NEW_GOAL);
      F(`${name}: four lines, consult shown, goal kept`, s.n === 4 && s.next && s.goal === NEW_GOAL);
      await p.evaluate(() => document.getElementById('mapCard').scrollIntoView({ block: 'start', behavior: 'instant' })); await p.waitForTimeout(400); await p.screenshot({ path: path.join(process.env.QA_OUT || path.dirname(__filename), `talk_${name}_chat.png`) });
      // 失敗（5xx）: 入力に戻れる。送れなかった発話は履歴から外れる
      setMode('fail'); await say('もう一言。');
      s = await p.evaluate(() => ({ n: document.querySelectorAll('.talk-line').length, note: document.getElementById('talkNote').innerText, disabled: document.getElementById('talkInput').disabled }));
      F(`${name}: failure keeps input open with note`, !s.disabled && /返事が届きませんでした/.test(s.note) && s.n === 5);
      setMode('ok'); await say('もう一言。');
      F(`${name}: failed turn not in history`, seen.length === 4 && seen[3].messages.length === 5);
      // 上限: 閉じる（入力不可、相談を示す）
      setMode('limit'); await say('まだある。');
      s = await p.evaluate(() => ({ disabled: document.getElementById('talkInput').disabled && document.getElementById('talkSend').disabled, note: document.getElementById('talkNote').innerText, next: document.getElementById('mapGo').classList.contains('is-next') }));
      F(`${name}: turn_limit closes input`, s.disabled && /相談/.test(s.note) && s.next);
      // 相談へ: 地図（AI の言葉）とやりとりが引き継がれる
      await p.evaluate(() => document.getElementById('mapGo').scrollIntoView({ block: 'center', behavior: 'instant' })); await p.waitForTimeout(150);
      await Promise.all([p.waitForNavigation({ waitUntil: 'load' }), p.click('#mapGo', { force: true })]); await p.waitForTimeout(300);
      const c = await p.evaluate(() => ({ url: location.pathname, type: document.getElementById('cType').value, msg: document.getElementById('cMsg').value }));
      F(`${name}: contact carries AI goal + transcript`, /contact$/.test(c.url) && c.type === '活動・収益化の相談' && c.msg.includes('目的: ' + NEW_GOAL) && c.msg.includes('【地図について、やりとりした内容】') && c.msg.includes('あなた: 週3回の配信を半年続けたい。') && c.msg.includes('AI: 半年続けるなら'));
      // 選択を変えると捨てる（正本の文に戻り、ログは空）
      await p.goBack({ waitUntil: 'load' }); await p.waitForTimeout(1700); await creator(); setMode('ok'); await say('一言。');
      await pick('value', 'creator', 'start');
      s = await p.evaluate(() => ({ goal: document.getElementById('mapGoal').innerText.replace(/ /g, ' ').trim(), n: document.querySelectorAll('.talk-line').length, next: document.getElementById('mapGo').classList.contains('is-next'), stored: JSON.parse(sessionStorage.getItem('reyz.map.r') || 'null') }));
      F(`${name}: changing an answer discards AI map and log`, s.goal === CANON_GOAL && s.n === 0 && !s.next && s.stored && s.stored.goal === CANON_GOAL);
      F(`${name}: no page errors`, errs.length === 0);
      await p.screenshot({ path: path.join(process.env.QA_OUT || path.dirname(__filename), `talk_${name}.png`) });
      out[name] = { requests: seen.length }; await ctx.close(); }
    server.close(); }
  await b.close(); out.fails = fails; console.log(JSON.stringify(out, null, 1));
})();
