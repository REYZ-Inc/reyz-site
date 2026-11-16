// Typography check under the viewer skeleton and standalone: colours of every text role, tracked-text centring, arrow glyph, font stacks.
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
(async () => {
  const b = await chromium.launch(); const out = {};
  const shots = path.join(process.env.QA_OUT || 'qa/out', 'typography'); fs.mkdirSync(shots, { recursive: true });
  for (const f of ['__viewer_sim.html', 'index.html', 'creator.html', 'creative.html', 'ai.html', 'consensus.html', 'contact.html', 'manual.html', 'legal.html']) {
    const p = await b.newPage({ viewport: { width: 390, height: 844 } }); await p.goto('file://' + path.resolve('site/' + f), { waitUntil: 'load' }); await p.waitForTimeout(1200);
    if (f === 'creative.html') {
      // Inspect the observed dark-on-pink pair in its real expanded state.
      const human = p.locator('.shift .bar.human');
      await p.locator('details').filter({ has: human }).locator('summary').click();
      await p.locator('.shift').scrollIntoViewIfNeeded();
      await p.waitForFunction(() => Number(getComputedStyle(document.querySelector('.shift')).opacity) >= 0.99);
      await p.locator('.shift').screenshot({ path: path.join(shots, 'creative-human-contrast.png'), animations: 'disabled' });
    }
    out[f] = await p.evaluate(() => {
      const lum = c => { const m = c.match(/[\d.]+/g).map(Number); const a = m[3] === undefined ? 1 : m[3]; const [r, g, b] = m; return Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) * a); };
      // Resolve an opaque CSS background and measure actual text contrast.
      // Brand pink with #0a0a0a text is 5.334:1; a brightness-only cutoff
      // misclassifies this readable pair. No dark RGB value is exempted here.
      // https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
      const rgb = color => {
        if (!/^rgba?\(/.test(color)) return null;
        const values = color.match(/[\d.]+/g)?.map(Number);
        return values?.length >= 3 ? { channels: values.slice(0, 3), alpha: values[3] ?? 1 } : null;
      };
      const relativeLuminance = channels => channels.map(channel => {
        const value = channel / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      }).reduce((value, channel, i) => value + channel * [0.2126, 0.7152, 0.0722][i], 0);
      const readableDarkText = [];
      const onReadableBackground = el => {
        const foreground = rgb(getComputedStyle(el).color);
        if (!foreground) return false;
        for (let node = el; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          // Unknown image/blend or partly transparent backgrounds stay failures.
          if (style.backgroundImage !== 'none' || style.mixBlendMode !== 'normal') return false;
          const background = rgb(style.backgroundColor);
          if (!background) return false;
          if (background.alpha === 1) {
            const ink = foreground.channels.map((channel, i) =>
              channel * foreground.alpha + background.channels[i] * (1 - foreground.alpha));
            const a = relativeLuminance(ink), b = relativeLuminance(background.channels);
            const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            if (ratio >= 4.5) readableDarkText.push({ element: el.tagName + '.' + el.className,
              text: el.textContent.trim().slice(0, 30), foreground: getComputedStyle(el).color,
              background: style.backgroundColor, contrastRatio: ratio });
            return ratio >= 4.5;
          }
          if (background.alpha > 0) return false;
        }
        return false;
      };
      const dark = []; const sel = 'h1,h2,h3,p,dd,dt,a,button,label,span,small,em,address,li';
      for (const el of document.querySelectorAll(sel)) { if (!el.textContent.trim()) continue; const cs = getComputedStyle(el); if (cs.display === 'none' || el.closest('[hidden]')) continue; const l = lum(cs.color); if (l < 100 && cs.color !== 'rgb(247, 21, 172)' && !onReadableBackground(el)) dark.push(el.tagName + '.' + el.className + ' "' + el.textContent.trim().slice(0, 12) + '" ' + cs.color); }
      // centring of tracked text: compare the glyph box (Range) centre with the container centre
      const centre = []; for (const el of document.querySelectorAll('.chapter-stack .eyebrow, .gate .go')) { const r = document.createRange(); r.selectNodeContents(el); const g = r.getBoundingClientRect(); const c = el.parentElement.getBoundingClientRect(); const ls = parseFloat(getComputedStyle(el).letterSpacing) || 0; centre.push({ text: el.textContent.trim().slice(0, 14), glyphCentreOffsetPx: +((g.left + g.right) / 2 - ls / 2 - (c.left + c.right) / 2).toFixed(1) }); }
      const map = document.querySelector('.maplink'); const arrow = map ? getComputedStyle(map, '::after') : null;
      return { darkTextElements: dark, readableDarkText, centring: centre, mapArrow: arrow ? { content: arrow.content, maskSet: (arrow.webkitMaskImage || arrow.maskImage || '').includes('svg') } : null, fonts: { body: getComputedStyle(document.body).fontFamily.split(',')[0], h1: document.querySelector('h1') ? getComputedStyle(document.querySelector('h1')).fontFamily.split(',')[0] : null, eyebrow: getComputedStyle(document.querySelector('.eyebrow')).fontFamily.split(',')[0] }, btnPrimary: document.querySelector('.btn.primary') ? getComputedStyle(document.querySelector('.btn.primary')).color : null };
    });
    await p.close();
  }
  await b.close(); console.log(JSON.stringify(out, null, 1));
})();
