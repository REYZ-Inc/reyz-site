// /creator・/creative の「3 つの画面」見本（1 台の画面を実際に触る）: Home の地図が 1 画面目に入る／入口で「受ける」と明細に並ぶ／確認は 止まる → 直して通る → 人が決める → 記録に 1 行。
// 使い方: node qa/demo_check.js site  → JSON { fails: [...] }（fails が空なら PASS）
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2] || 'site');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]); let p = path.join(ROOT, u === '/' ? '/index.html' : u); if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html'; if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
const EXPECT = {
  creator: { place: '場所は決まっている。費用ゼロのLIVE支援と、商品紹介・案件を重ねる段階。', step: '企画・撮影・編集をREYZと分け、目標が変わっても続く進め方を決める。', goal: '言葉にできている目的を、活動の順番にする。' },
  company: { place: '定型業務をAIと仕組みへ移し、最小の人数で最大の利益を生む体制をつくる段階。', step: '経営と現場が「はい」か「いいえ」で迷わず決められるよう、判断の材料を揃える。', goal: 'まず、何を優先すれば一番利益が残るかを一緒に整理する。' },
  sampleMap: { creator: '場所は決まっている。費用ゼロのLIVE支援と、商品紹介・案件を重ねる段階。', company: '事業と表現をつなぐ段階。映像制作・SNS運用と、クリエイターとの販売設計を重ねる。' }
};
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}/`;
  const b = await chromium.launch(); const fails = []; const F = (k, v) => { if (!v) fails.push(k); return v; }; const out = {};
  const t = s => (s || '').replace(/ /g, ' ').trim();
  for (const [name, vp] of [['m390', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['d1440', { width: 1440, height: 900 }]]) {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    const tap = async sel => { await p.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }), sel); await p.waitForTimeout(120); await p.click(sel, { force: true }); await p.waitForTimeout(120); };
    const pick = async (q, aud, v) => tap(`.mq[data-q="${q}"][data-for="${aud}"] .opt[data-v="${v}"]`);
    // 1) 地図なし: /creator の 1 画面目は見本の地図
    await p.goto(base + 'creator.html', { waitUntil: 'load' }); await p.waitForTimeout(1700);
    out.creatorSample = await p.evaluate(() => ({ place: document.getElementById('dmPlace').innerText, from: document.getElementById('dmFrom').innerText, pane: document.querySelector('#demoC .pane:not([hidden])').dataset.p, tabs: Array.from(document.querySelectorAll('#demoC .tab')).map(x => x.getAttribute('aria-selected')) }));
    F(`${name}: creator sample map`, t(out.creatorSample.place) === EXPECT.sampleMap.creator && t(out.creatorSample.from).startsWith('見本の地図です') && out.creatorSample.pane === 'map' && JSON.stringify(out.creatorSample.tabs) === JSON.stringify(['true', 'false', 'false']));
    F(`${name}: all visible controls >= 44px`, await p.evaluate(() => Array.from(document.querySelectorAll('#demoC button')).filter(el => !el.closest('[hidden]')).every(el => { const r = el.getBoundingClientRect(); return r.height >= 44 && r.width >= 44; })));
    // 2) 入口で「受ける」→ 明細に並ぶ（押し直すと外れる）
    await tap('#demoC [data-next="gate"]'); F(`${name}: gate pane`, await p.evaluate(() => document.querySelector('#demoC .pane:not([hidden])').dataset.p === 'gate' && document.querySelector('#demoC .tab[data-t="gate"]').getAttribute('aria-selected') === 'true'));
    await tap('#demoC .take[data-k="案件"]'); await tap('#demoC .take[data-k="LIVE支援"]');
    out.gate = await p.evaluate(() => ({ pressed: Array.from(document.querySelectorAll('#demoC .take')).map(x => x.getAttribute('aria-pressed') + ':' + x.textContent), badge: document.querySelector('#demoC .tab[data-t="stmt"] .n').textContent, badgeHidden: document.querySelector('#demoC .tab[data-t="stmt"] .n').hidden }));
    F(`${name}: taken state`, JSON.stringify(out.gate.pressed) === JSON.stringify(['true:受けた', 'false:受ける', 'true:受けた']) && out.gate.badge === '2' && !out.gate.badgeHidden);
    await tap('#demoC [data-next="stmt"]'); await p.waitForTimeout(1600);
    out.stmt = await p.evaluate(() => ({ pane: document.querySelector('#demoC .pane:not([hidden])').dataset.p, rows: Array.from(document.querySelectorAll('#dmRows li')).map(li => li.className + ':' + li.innerText.replace(/\s+/g, ' ').trim()), sumHidden: document.getElementById('dmSum').hidden, fullW: Array.from(document.querySelectorAll('#demoC .pane:not([hidden]) .scr-bar.full i')).map(i => Math.round(i.getBoundingClientRect().width / i.parentElement.getBoundingClientRect().width * 100)) }));
    F(`${name}: statement rows (${JSON.stringify(out.stmt.rows)})`, out.stmt.pane === 'stmt' && out.stmt.rows.length === 2 && out.stmt.rows[0] === ':案件 全額あなたへ' && out.stmt.rows[1] === ':LIVE支援 費用 0' && !out.stmt.sumHidden);
    F(`${name}: bars filled (${JSON.stringify(out.stmt.fullW)})`, out.stmt.fullW.length === 2 && out.stmt.fullW.every(w => w >= 99));
    await tap('#demoC .tab[data-t="gate"]'); await tap('#demoC .take[data-k="案件"]'); await tap('#demoC .tab[data-t="stmt"]');
    F(`${name}: untake removes the row`, await p.evaluate(() => document.querySelectorAll('#dmRows li:not(.empty)').length === 1 && document.querySelector('#demoC .tab[data-t="stmt"] .n').textContent === '1'));
    // 3) Home で地図をつくる → /creator・/creative の 1 画面目にそのまま入る
    await p.goto(base + 'index.html', { waitUntil: 'load' }); await p.waitForTimeout(1700);
    await pick('who', 'all', 'creator'); await pick('goal', 'creator', 'yes'); await pick('place', 'creator', 'yes'); await pick('style', 'creator', 'live'); await pick('make', 'creator', 'share'); await pick('value', 'creator', 'last');
    await p.goto(base + 'creator.html', { waitUntil: 'load' }); await p.waitForTimeout(1700);
    out.creatorMap = await p.evaluate(() => ({ place: document.getElementById('dmPlace').innerText, step: document.getElementById('dmStep').innerText, goal: document.getElementById('dmGoal').innerText, from: document.getElementById('dmFrom').innerText, has: document.getElementById('demoC').classList.contains('has-map') }));
    F(`${name}: creator map carried`, t(out.creatorMap.place) === EXPECT.creator.place && t(out.creatorMap.step) === EXPECT.creator.step && t(out.creatorMap.goal) === EXPECT.creator.goal && t(out.creatorMap.from) === 'ホームで作った、あなたの地図。' && out.creatorMap.has);
    await p.goto(base + 'creative.html', { waitUntil: 'load' }); await p.waitForTimeout(1700);
    F(`${name}: creator map does not leak into company demo`, await p.evaluate(() => !document.getElementById('demoE').classList.contains('has-map') && document.getElementById('dnFrom').innerText.replace(/ /g, ' ').startsWith('見本の地図です')));
    await p.goto(base + 'index.html', { waitUntil: 'load' }); await p.waitForTimeout(1700);
    await pick('who', 'all', 'company'); await pick('goal', 'company', 'no'); await pick('focus', 'company', 'ops'); await pick('first', 'company', 'speed');
    await p.goto(base + 'creative.html', { waitUntil: 'load' }); await p.waitForTimeout(1700);
    out.companyMap = await p.evaluate(() => ({ place: document.getElementById('dnPlace').innerText, step: document.getElementById('dnStep').innerText, goal: document.getElementById('dnGoal').innerText, from: document.getElementById('dnFrom').innerText }));
    F(`${name}: company map carried`, t(out.companyMap.place) === EXPECT.company.place && t(out.companyMap.step) === EXPECT.company.step && t(out.companyMap.goal) === EXPECT.company.goal && t(out.companyMap.from) === 'ホームで作った、あなたの地図。');
    F(`${name}: all visible controls >= 44px (company)`, await p.evaluate(() => Array.from(document.querySelectorAll('#demoE button')).filter(el => !el.closest('[hidden]')).every(el => { const r = el.getBoundingClientRect(); return r.height >= 44 && r.width >= 44; })));
    // 4) 確認: 「業界No.1」→ 一致せず止まる（理由つき）→ 直して通る → 人が「はい」→ 記録に 1 行
    await tap('#demoE [data-next="check"]');
    await tap('#demoE .sample[data-s="no1"]'); await p.waitForTimeout(2500);
    out.stop = await p.evaluate(() => ({ run: document.getElementById('demoE').dataset.run, lanes: Array.from(document.querySelectorAll('#deLanes .lane')).map(l => l.className.replace('lane', '').trim()), v: document.getElementById('deV').innerText, why: document.getElementById('deWhy').innerText, fixHidden: document.getElementById('deFix').hidden, humanHidden: document.getElementById('deHuman').hidden, phrase: document.getElementById('dePhrase').innerText }));
    F(`${name}: No.1 stops (${JSON.stringify(out.stop)})`, out.stop.run === 'stop' && JSON.stringify(out.stop.lanes) === JSON.stringify(['on ok', 'on ng', 'on ng']) && out.stop.v === '一致しない。止まりました。' && out.stop.why === 'No.1の根拠が示されていない（No.1表示の4要件）。' && !out.stop.fixHidden && out.stop.humanHidden && out.stop.phrase === '業界No.1');
    await tap('#deFix'); await p.waitForTimeout(2500);
    out.pass = await p.evaluate(() => ({ run: document.getElementById('demoE').dataset.run, lanes: Array.from(document.querySelectorAll('#deLanes .lane')).map(l => l.className.replace('lane', '').trim()), v: document.getElementById('deV').innerText, cut: document.getElementById('dePhrase').classList.contains('cut'), fixed: document.getElementById('deFixed').innerText, fixedHidden: document.getElementById('deFixed').hidden, humanHidden: document.getElementById('deHuman').hidden }));
    F(`${name}: fixed passes (${JSON.stringify(out.pass)})`, out.pass.run === 'pass' && JSON.stringify(out.pass.lanes) === JSON.stringify(['on ok', 'on ok', 'on ok']) && out.pass.v === '3つのAIが一致。通りました。' && out.pass.cut && out.pass.fixed === 'No.1（調査名・時期・対象を添える）' && !out.pass.fixedHidden && !out.pass.humanHidden);
    await tap('#deHuman [data-d="はい"]'); await p.waitForTimeout(400);
    out.rec = await p.evaluate(() => ({ pane: document.querySelector('#demoE .pane:not([hidden])').dataset.p, rows: Array.from(document.querySelectorAll('#deRec li')).map(li => li.innerText.replace(/\s+/g, ' ').trim()), badge: document.querySelector('#demoE .tab[data-t="rec"] .n').textContent, run: document.getElementById('demoE').dataset.run, postHidden: document.getElementById('dePost').hidden }));
    F(`${name}: record line (${JSON.stringify(out.rec)})`, out.rec.pane === 'rec' && out.rec.rows.length === 1 && /^「業界No\.1」と書いた紹介 \d\d:\d\d No\.1表示の4要件 ・ AI 止 → 直して通 ・ 人 はい$/.test(out.rec.rows[0]) && out.rec.badge === '1' && out.rec.run === '' && out.rec.postHidden);
    // 「必ず効く」→ 3 つとも × で止まる／「#PR」→ 通る → 「いいえ」も記録に残る
    await tap('#deP3 [data-next="check"]'); await tap('#demoE .sample[data-s="cure"]'); await p.waitForTimeout(2500);
    F(`${name}: cure stops with all ng`, await p.evaluate(() => document.getElementById('demoE').dataset.run === 'stop' && document.querySelectorAll('#deLanes .lane.ng').length === 3 && document.getElementById('deV').innerText === '3つのAIが×。止まりました。' && document.getElementById('deWhy').innerText === '効果を断定している（薬機法第66条・健康増進法）。'));
    await tap('#demoE .sample[data-s="pr"]'); await p.waitForTimeout(2500);
    F(`${name}: PR passes`, await p.evaluate(() => document.getElementById('demoE').dataset.run === 'pass' && document.querySelectorAll('#deLanes .lane.ok').length === 3 && document.getElementById('deWhy').innerText === 'ステマ告示に照らしました。'));
    await tap('#deHuman [data-d="いいえ"]'); await p.waitForTimeout(400);
    F(`${name}: second record first (newest on top)`, await p.evaluate(() => { const r = Array.from(document.querySelectorAll('#deRec li')).map(li => li.innerText.replace(/\s+/g, ' ').trim()); return r.length === 2 && /^#PR をつけた、新商品の紹介 \d\d:\d\d ステマ告示 ・ AI 通 ・ 人 いいえ$/.test(r[0]) && document.querySelector('#demoE .tab[data-t="rec"] .n').textContent === '2'; }));
    F(`${name}: no horizontal overflow`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    F(`${name}: no page errors`, errs.length === 0);
    await ctx.close();
  }
  // 5) motion 抑制: 待たずに結果が出る
  { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }); const p = await ctx.newPage();
    await p.goto(base + 'creative.html', { waitUntil: 'load' }); await p.waitForTimeout(1700);
    await p.evaluate(() => { document.querySelector('#demoE [data-next="check"]').click(); document.querySelector('#demoE .sample[data-s="no1"]').click(); });
    F('reduce: immediate stop', await p.evaluate(() => document.getElementById('demoE').dataset.run === 'stop' && !document.getElementById('deFix').hidden));
    await ctx.close(); }
  // 6) JavaScript なし: 3 画面が縦に並び、見本の文が読める
  { const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false }); const p = await ctx.newPage();
    await p.goto(base + 'creator.html', { waitUntil: 'load' });
    out.nojs = await p.evaluate(() => ({ panes: Array.from(document.querySelectorAll('#demoC .pane')).map(x => getComputedStyle(x).display), tabs: getComputedStyle(document.querySelector('#demoC .tabs')).display, place: document.getElementById('dmPlace').innerText.replace(/ /g, ' ') }));
    F(`no-js: panes stacked (${JSON.stringify(out.nojs)})`, out.nojs.panes.every(d => d === 'flex') && out.nojs.tabs === 'none' && out.nojs.place === EXPECT.sampleMap.creator);
    await ctx.close(); }
  await b.close(); server.close(); out.fails = fails; console.log(JSON.stringify(out, null, 1));
})();
