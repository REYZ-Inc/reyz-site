// Creator copy line composition: no phrase (.ph) may wrap internally; print resulting lines per block at each width.
const { chromium } = require('playwright'); const path = require('path');
(async () => { const b = await chromium.launch(); const res = {}; const fails = [];
  for (const w of [320, 360, 375, 390, 412, 430, 440, 768, 1024, 1440]) {
    const p = await b.newPage({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
    await p.goto('file://' + path.resolve('site/creator.html'), { waitUntil: 'load' }); await p.waitForTimeout(300);
    const r = await p.evaluate(() => { const out = []; for (const blk of document.querySelectorAll('.item h3, .item p, .step p')) { const phs = Array.from(blk.querySelectorAll('.ph')).filter(ph => !ph.querySelector('.ph')); if (!phs.length) continue; const lines = new Map(); let internalWrap = []; for (const ph of phs) { const rects = ph.getClientRects(); const rg = document.createRange(); rg.selectNodeContents(ph); const frag = Array.from(rg.getClientRects()).filter(r => r.width > 0); const tops = new Set(frag.map(r => Math.round(r.top))); if (tops.size > 1) internalWrap.push(ph.textContent); const top = Math.round(rects[0].top); if (!lines.has(top)) lines.set(top, []); lines.get(top).push(ph.textContent); } const cs = getComputedStyle(blk); out.push({ block: blk.tagName + (blk.className ? '.' + blk.className : ''), fs: +parseFloat(cs.fontSize).toFixed(1), width: Math.round(blk.getBoundingClientRect().width), lines: Array.from(lines.values()).map(a => a.join('')), internalWrap, overflow: blk.scrollWidth > blk.clientWidth + 1 }); } return out; });
    res[w] = r; for (const x of r) { if (x.internalWrap.length) fails.push(`${w}px ${x.block}: internal wrap in ${x.internalWrap.join(' / ')}`); if (x.overflow) fails.push(`${w}px ${x.block}: overflow`); }
    await p.close(); }
  await b.close(); console.log(JSON.stringify({ fails, res }, null, 1)); })();
