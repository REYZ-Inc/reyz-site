// Every page, opened directly and via every internal link from the bottom of every other page, must start at the top.
// Also: a host that re-applies an old scroll position after load (simulated) must be overridden within the settle window.
const { chromium } = require('playwright'); const http = require('http'); const path = require('path'); const fs = require('fs');
// 公開 URL は .html なし（/ai → ai.html）。ファイルを直接開く方式では解決できないため、GitHub Pages と同じ解決をする簡易サーバで配信して検査する。
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const mkServer = () => http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]); let p = path.join(ROOT, u === '/' ? '/index.html' : u); if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html'; if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
const ROOT = path.resolve(process.argv[2]); const PAGES = fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && !f.startsWith('__'));
(async () => {
  const server = mkServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); const BASE = `http://127.0.0.1:${server.address().port}/`;
  const b = await chromium.launch(); const fails = []; let transitions = 0;
  for (const vp of [{ w: 390, h: 844, m: true }, { w: 1440, h: 900 }]) {
    const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h }, isMobile: !!vp.m, hasTouch: !!vp.m }); const p = await ctx.newPage();
    for (const src of PAGES) {
      await p.goto(BASE + src, { waitUntil: 'load' }); await p.waitForTimeout(300);
      const direct = await p.evaluate(() => window.scrollY); if (direct !== 0) fails.push(`${vp.w} direct ${src}: ${direct}`);
      const links = await p.evaluate(() => [...new Set(Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href')).filter(h => !/^(https?:|mailto:|data:|#)/.test(h) && !h.includes('#')))]);   // 内部ページへのリンク（アンカー付きは対象外: 着地点が先頭ではないため）
      for (const href of links) {
        await p.goto(BASE + src, { waitUntil: 'load' }); await p.waitForTimeout(200);
        await p.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })); await p.waitForTimeout(150);
        const sel = `a[href="${href}"]`; const visible = await p.evaluate(s => { const els = Array.from(document.querySelectorAll(s)); const el = els.find(e => e.getBoundingClientRect().width > 0); if (el) { el.click(); return true; } return false; }, sel);
        if (!visible) { await p.click('#menuBtn'); await p.click(`.sheet ${sel}`); }
        await p.waitForLoadState('load'); await p.waitForTimeout(350); transitions++;
        const y = await p.evaluate(() => window.scrollY); if (y !== 0) fails.push(`${vp.w} ${src} → ${href}: ${y}`);
      }
    }
    // host re-applying an old position after load
    await p.goto(BASE + 'contact', { waitUntil: 'load' });
    await p.evaluate(() => window.scrollTo({ top: 1800, behavior: 'instant' })); await p.waitForTimeout(120);
    const a = await p.evaluate(() => window.scrollY); await p.waitForTimeout(600); const bY = await p.evaluate(() => window.scrollY);
    if (bY !== 0) fails.push(`${vp.w} host-restore not overridden: ${a} → ${bY}`);
    // but a reader's own scroll is respected
    await p.goto(BASE + 'creator', { waitUntil: 'load' }); await p.waitForTimeout(100);
    await p.mouse.move(200, 400); await p.mouse.wheel(0, 900); await p.waitForTimeout(700); const own = await p.evaluate(() => window.scrollY);
    if (own === 0) fails.push(`${vp.w} reader scroll was cancelled`);
    await ctx.close();
  }
  await b.close(); server.close(); console.log(JSON.stringify({ pages: PAGES.length, transitions, fails }, null, 1));
})();
