// DEC-20261027-04（Home の地図 → 3 つの画面 → 相談の連動）
// Home 章 3「あなたの地図」: 選択 → 結果（正本の文のまま）→ 「この内容で相談する」→ contact にご用件・内容が引き継がれる。
// 使い方: node qa/map_check.js site  → JSON { fails: [...] }（fails が空なら PASS）
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2] || 'site');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]); let p = path.join(ROOT, u === '/' ? '/index.html' : u); if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html'; if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
const EXPECT = {
  creator: { goal: '言葉にできている目的を、活動の順番にする。', place: '場所は決まっている。費用ゼロのLIVE支援と、商品紹介・案件を重ねる段階。', step: '企画・撮影・編集をREYZと分け、目標が変わっても続く進め方を決める。',
    live: '※私達は、TikTok社から委託を受けて運営しているため、\nライバーさんの収益から手数料を搾取するモデルではありません。' },
  company: { goal: 'まず、何を優先すれば一番利益が残るかを一緒に整理する。', place: '定型業務をAIと仕組みへ移し、最小の人数で最大の利益を生む体制をつくる段階。', step: '経営と現場が「はい」か「いいえ」で迷わず決められるよう、判断の材料を揃える。', type: '目的の整理と進め方の相談' }
};
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}/`;
  const b = await chromium.launch(); const fails = []; const F = (k, v) => { if (!v) fails.push(k); return v; }; const out = {};
  for (const [name, vp] of [['m390', { width: 390, height: 844, isMobile: true, hasTouch: true }], ['d1440', { width: 1440, height: 900 }]]) {
    const ctx = await b.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
    await p.goto(base + 'index.html', { waitUntil: 'load' }); await p.waitForTimeout(1700);   // 読込直後 1.5 秒は先頭位置を保つ（start-at-top）ため、その後に操作する
    const t = s => s.replace(/ /g, ' ').trim();
    // 章の本文は粒子の明瞭度に合わせて数 px 動く（transform）ため「静止待ち」はしない: 位置へ即時スクロールし、そのまま押す
    const pick = async (q, aud, v) => { const sel = `.mq[data-q="${q}"][data-for="${aud}"] .opt[data-v="${v}"]`; await p.evaluate(s => document.querySelector(s).scrollIntoView({ block: 'center', behavior: 'instant' }), sel); await p.waitForTimeout(150); await p.click(sel, { force: true }); await p.waitForTimeout(120); };
    const visibleQs = () => p.evaluate(() => Array.from(document.querySelectorAll('.mq')).filter(g => !g.hidden).map(g => g.dataset.for + ':' + g.dataset.q));
    // 最初は「あなたは」だけ、結果は隠れている
    F(`${name}: only who at start`, JSON.stringify(await visibleQs()) === JSON.stringify(['all:who']) && await p.evaluate(() => document.getElementById('mapCard').hidden));
    F(`${name}: option tap size >= 44`, await p.evaluate(() => Array.from(document.querySelectorAll('.mq .opt')).every(b => b.getBoundingClientRect().height >= 44 || b.closest('.mq').hidden)));
    // クリエイターの枝
    await pick('who', 'all', 'creator'); F(`${name}: creator shows goal`, JSON.stringify(await visibleQs()) === JSON.stringify(['all:who', 'creator:goal']));
    await pick('goal', 'creator', 'yes'); await pick('place', 'creator', 'yes'); await pick('style', 'creator', 'live'); await pick('make', 'creator', 'share'); await pick('value', 'creator', 'last');
    out.creator = await p.evaluate(() => { const t = el => el.innerText.replace(/ /g, ' ').trim(); return { hidden: document.getElementById('mapCard').hidden, goal: t(document.getElementById('mapGoal')), place: t(document.getElementById('mapPlace')), step: t(document.getElementById('mapStep')), liveHidden: document.getElementById('mapNoteLive').hidden, live: t(document.getElementById('mapNoteLive')), pressed: Array.from(document.querySelectorAll('.opt[aria-pressed="true"]')).map(b => b.dataset.v) }; });
    F(`${name}: creator card shown`, !out.creator.hidden);
    // 地図の線: 3 つの点を結ぶ path が引かれている（長さ > 0、点は 3 つ）
    const route = await p.evaluate(() => { const path = document.querySelector('#mapRoute path'); return { len: path ? path.getTotalLength() : 0, dots: document.querySelectorAll('#mapRoute .dot').length, live: document.getElementById('mapCard').classList.contains('is-live') }; });
    F(`${name}: route drawn (${JSON.stringify(route)})`, route.len > 50 && route.dots === 3 && route.live);
    F(`${name}: creator goal text`, out.creator.goal === EXPECT.creator.goal); F(`${name}: creator place text`, out.creator.place === EXPECT.creator.place); F(`${name}: creator step text`, out.creator.step === EXPECT.creator.step);
    F(`${name}: LIVE note is the fixed text`, !out.creator.liveHidden && out.creator.live === EXPECT.creator.live);
    F(`${name}: pressed states`, JSON.stringify(out.creator.pressed) === JSON.stringify(['creator', 'yes', 'yes', 'live', 'share', 'last']));
    // 途中の答えを変えると、後の問いと結果が消える
    await pick('style', 'creator', 'post'); F(`${name}: change clears later answers`, await p.evaluate(() => document.getElementById('mapCard').hidden) && JSON.stringify(await visibleQs()) === JSON.stringify(['all:who', 'creator:goal', 'creator:place', 'creator:style', 'creator:make']));
    // 最初から
    await pick('make', 'creator', 'own'); await pick('value', 'creator', 'start'); await p.click('#mapReset'); await p.waitForTimeout(120);
    F(`${name}: reset`, JSON.stringify(await visibleQs()) === JSON.stringify(['all:who']) && await p.evaluate(() => document.getElementById('mapCard').hidden && document.querySelectorAll('.opt[aria-pressed="true"]').length === 0));
    // 企業の枝 → 相談へ引き継ぎ
    await pick('who', 'all', 'company'); await pick('goal', 'company', 'no'); await pick('focus', 'company', 'ops'); await pick('first', 'company', 'speed');
    out.company = await p.evaluate(() => { const t = el => el.innerText.replace(/ /g, ' ').trim(); return { hidden: document.getElementById('mapCard').hidden, goal: t(document.getElementById('mapGoal')), place: t(document.getElementById('mapPlace')), step: t(document.getElementById('mapStep')), liveHidden: document.getElementById('mapNoteLive').hidden }; });
    F(`${name}: company card`, !out.company.hidden && out.company.goal === EXPECT.company.goal && out.company.place === EXPECT.company.place && out.company.step === EXPECT.company.step && out.company.liveHidden);
    await p.evaluate(() => document.getElementById('mapGo').scrollIntoView({ block: 'center', behavior: 'instant' })); await p.waitForTimeout(150); await Promise.all([p.waitForNavigation({ waitUntil: 'load' }), p.click('#mapGo', { force: true })]); await p.waitForTimeout(300);
    out.contact = await p.evaluate(() => ({ url: location.pathname, type: document.getElementById('cType').value, msg: document.getElementById('cMsg').value, stored: sessionStorage.getItem('reyz.map') }));
    F(`${name}: contact url`, /contact$/.test(out.contact.url)); F(`${name}: type carried`, out.contact.type === EXPECT.company.type);
    F(`${name}: message carried`, out.contact.msg.startsWith('【あなたの地図（ホームで選んだ内容）】\n目的: ' + EXPECT.company.goal) && out.contact.msg.includes('最初の一歩: ' + EXPECT.company.step));
    F(`${name}: carried once`, out.contact.stored === null);
    F(`${name}: no page errors`, errs.length === 0);
    await p.screenshot({ path: path.join(process.env.QA_OUT || path.dirname(__filename), `map_${name}.png`) });
    await ctx.close();
  }
  await b.close(); server.close(); out.fails = fails; console.log(JSON.stringify(out, null, 1));
})();
