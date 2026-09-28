// Typography check under the viewer skeleton and standalone: colours of every text role, tracked-text centring, arrow glyph, font stacks.
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const out = {};
  for (const f of ['__viewer_sim.html', 'index.html', 'creator.html', 'creative.html', 'ai.html', 'contact.html', 'legal.html', 'works.html']) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } }); await p.goto('file://' + path.resolve('site/' + f), { waitUntil: 'load' }); await p.waitForTimeout(1200);
    out[f] = await p.evaluate(() => {
      const lum = c => { const m = c.match(/[\d.]+/g).map(Number); const a = m[3] === undefined ? 1 : m[3]; const [r, g, b] = m; return Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) * a); };
      const dark = []; const sel = 'h1,h2,h3,p,dd,dt,a,button,label,span,small,em,address,li';
      for (const el of document.querySelectorAll(sel)) { if (!el.textContent.trim()) continue; const cs = getComputedStyle(el); if (cs.display === 'none' || el.closest('[hidden]')) continue; const l = lum(cs.color); if (l < 100 && !['rgb(6, 6, 9)', 'rgb(247, 21, 172)'].includes(cs.color)) dark.push(el.tagName + '.' + el.className + ' "' + el.textContent.trim().slice(0, 12) + '" ' + cs.color); }
      // centring of tracked text: compare the glyph box (Range) centre with the container centre
      const centre = []; for (const el of document.querySelectorAll('.chapter-stack .eyebrow, .gate .go')) { const r = document.createRange(); r.selectNodeContents(el); const g = r.getBoundingClientRect(); const c = el.parentElement.getBoundingClientRect(); const ls = parseFloat(getComputedStyle(el).letterSpacing) || 0; centre.push({ text: el.textContent.trim().slice(0, 14), glyphCentreOffsetPx: +((g.left + g.right) / 2 - ls / 2 - (c.left + c.right) / 2).toFixed(1) }); }
      const map = document.querySelector('.maplink'); const arrow = map ? getComputedStyle(map, '::after') : null;
      return { darkTextElements: dark, centring: centre, mapArrow: arrow ? { content: arrow.content, maskSet: (arrow.webkitMaskImage || arrow.maskImage || '').includes('svg') } : null, fonts: { body: getComputedStyle(document.body).fontFamily.split(',')[0], h1: document.querySelector('h1') ? getComputedStyle(document.querySelector('h1')).fontFamily.split(',')[0] : null, eyebrow: getComputedStyle(document.querySelector('.eyebrow')).fontFamily.split(',')[0] }, btnPrimary: document.querySelector('.btn.primary') ? getComputedStyle(document.querySelector('.btn.primary')).color : null };
    });
    await p.close();
  }
  await b.close(); console.log(JSON.stringify(out, null, 1));
})();
