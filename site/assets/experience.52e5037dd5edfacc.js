/* REYZ — choices change the composition and preserve the visitor's intent.
   These scenes describe the services. They do not simulate customers or live AI results. */
(() => {
  'use strict';

  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coarse = window.matchMedia('(pointer: coarse)');
  const PINK = '#F715AC';
  const WHITE = '#FAFAFA';
  const BLACK = '#0A0A0A';
  const clamp = (n, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, n));
  const ease = n => 1 - Math.pow(1 - clamp(n), 3);
  const surfaces = new Set();

  // A finite, visible-only sequence. A single still is drawn for reduced motion.
  function surface(canvas, paint, duration, onFrame) {
    if (!canvas) return null;
    let ctx;
    try { ctx = canvas.getContext('2d', { alpha: false }); } catch (_) { return null; }
    if (!ctx) return null;
    let width = 0, height = 0, ratio = 1, elapsed = 0, last = 0, raf = 0;
    let visible = !('IntersectionObserver' in window), playing = !motion.matches;
    let previousPaint = 0, dirty = false;
    const draw = () => {
      if (!width || !height) return;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint(ctx, width, height, clamp(elapsed / duration));
      if (onFrame) onFrame(clamp(elapsed / duration), playing && elapsed < duration);
    };
    const stopFrame = () => { cancelAnimationFrame(raf); raf = 0; last = 0; };
    const frame = now => {
      raf = 0;
      if (!playing || !visible || document.hidden || motion.matches) { last = 0; return; }
      if (last) elapsed = Math.min(duration, elapsed + Math.min(now - last, 80));
      last = now;
      if (!coarse.matches || now - previousPaint >= 32 || elapsed >= duration) { draw(); previousPaint = now; }
      if (elapsed < duration) raf = requestAnimationFrame(frame);
      else { playing = false; last = 0; draw(); }
    };
    const resume = () => {
      if (dirty && visible && !document.hidden) { draw(); dirty = false; }
      if (playing && visible && !document.hidden && !motion.matches && !raf) raf = requestAnimationFrame(frame);
    };
    const resize = () => {
      const box = canvas.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return;
      width = box.width; height = box.height;
      ratio = Math.min(window.devicePixelRatio || 1, coarse.matches ? 1.5 : 2, 2000 / width);
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
      draw();
    };
    const api = {
      restart() { stopFrame(); elapsed = motion.matches ? duration : 0; playing = !motion.matches; draw(); resume(); },
      toggle() {
        if (motion.matches) { elapsed = duration; playing = false; draw(); return; }
        if (playing) { playing = false; stopFrame(); }
        else { if (elapsed >= duration) elapsed = 0; playing = true; resume(); }
        draw();
      },
      seek(value) { stopFrame(); playing = false; elapsed = clamp(value) * duration; draw(); },
      visibility() { if (document.hidden) stopFrame(); else resume(); },
      reduce() { if (motion.matches) { stopFrame(); elapsed = duration; playing = false; draw(); } },
      invalidate() { dirty = true; resume(); },
      draw,
    };
    if ('ResizeObserver' in window) new ResizeObserver(resize).observe(canvas);
    else window.addEventListener('resize', resize, { passive: true });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting);
        if (visible) resume(); else stopFrame();
      }, { threshold: 0.05 }).observe(canvas);
    }
    surfaces.add(api);
    elapsed = motion.matches ? duration : 0;
    resize(); resume();
    return api;
  }
  document.addEventListener('visibilitychange', () => { for (const item of surfaces) item.visibility(); });
  motion.addEventListener('change', () => { for (const item of surfaces) item.reduce(); });

  function ground(ctx, width, height) {
    ctx.globalAlpha = 1;
    const wash = ctx.createLinearGradient(0, 0, width * 0.7, height);
    wash.addColorStop(0, '#181818'); wash.addColorStop(0.55, '#101010'); wash.addColorStop(1, BLACK);
    ctx.fillStyle = wash; ctx.fillRect(0, 0, width, height);
    ctx.lineWidth = 0.5; ctx.strokeStyle = 'rgba(250,250,250,0.025)';
    for (let y = 0.5; y < height; y += 4) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
  }

  function pathPoint(x0, y0, x1, y1, x2, y2, x3, y3, t) {
    const s = 1 - t;
    return [s * s * s * x0 + 3 * s * s * t * x1 + 3 * s * t * t * x2 + t * t * t * x3,
      s * s * s * y0 + 3 * s * s * t * y1 + 3 * s * t * t * y2 + t * t * t * y3];
  }

  // Six available routes stay readable. The chosen route changes the connected action.
  for (const root of document.querySelectorAll('[data-income-experience]')) {
    const choices = Array.from(root.querySelectorAll('.income-choice'));
    if (!choices.length) continue;
    let active = Math.max(0, choices.findIndex(item => item.getAttribute('aria-pressed') === 'true'));
    const next = root.querySelector('.income-next');
    const routes = {
      live: { href: '#services', label: '提供すること' },
      product: { href: '#model', label: '仕組みを見る' },
      campaign: { href: '#model', label: '仕組みを見る' },
      direct: { href: '#model', label: '仕組みを見る' },
      media: { href: '#model', label: '仕組みを見る' },
      ip: { href: '#services', label: '提供すること' },
    };
    const draw = (ctx, width, height, progress) => {
      ground(ctx, width, height);
      const left = width * 0.17, right = width * 0.73, centre = height * 0.48;
      const radius = Math.min(width, height) * 0.125;
      const end = right - radius;
      ctx.lineCap = 'round';
      for (let i = 0; i < choices.length; i++) {
        const y = height * (0.17 + i * 0.125);
        const selected = i === active;
        const points = [left, y, width * 0.44, y, width * 0.43, centre, end, centre];
        ctx.beginPath(); ctx.moveTo(left, y); ctx.bezierCurveTo(...points.slice(2));
        ctx.strokeStyle = selected ? 'rgba(247,21,172,0.8)' : 'rgba(250,250,250,0.13)';
        ctx.lineWidth = selected ? 1.8 : 0.8; ctx.stroke();
        ctx.beginPath(); ctx.arc(left, y, selected ? 4 : 2.4, 0, Math.PI * 2);
        ctx.fillStyle = selected ? PINK : '#646464'; ctx.fill();
        ctx.font = '500 11px Inter, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        ctx.fillStyle = selected ? WHITE : '#858585'; ctx.fillText(String(i + 1).padStart(2, '0'), left - 14, y);
        if (selected && progress < 0.98 && !motion.matches) {
          for (let j = 0; j < 3; j++) {
            const at = clamp(ease(progress) * 1.25 - j * 0.14);
            if (at <= 0 || at >= 1) continue;
            const point = pathPoint(...points, at);
            ctx.beginPath(); ctx.arc(point[0], point[1], 2.6 - j * 0.45, 0, Math.PI * 2);
            ctx.fillStyle = j === 0 ? WHITE : PINK; ctx.fill();
          }
        }
      }
      const hub = ctx.createLinearGradient(right - radius, centre - radius, right + radius, centre + radius);
      hub.addColorStop(0, '#303030'); hub.addColorStop(0.45, '#161616'); hub.addColorStop(1, '#0D0D0D');
      ctx.fillStyle = hub; ctx.beginPath(); ctx.arc(right, centre, radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(250,250,250,0.36)'; ctx.lineWidth = 0.7; ctx.stroke();
      ctx.beginPath(); ctx.arc(right, centre, radius + 8, Math.PI * 0.65, Math.PI * 1.35);
      ctx.strokeStyle = PINK; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = WHITE; ctx.textAlign = 'center'; ctx.font = '400 ' + Math.max(12, width * 0.034) + 'px "Noto Sans JP", sans-serif';
      ctx.fillText('あなた', right, centre);
      ctx.strokeStyle = 'rgba(250,250,250,0.12)'; ctx.lineWidth = 0.7;
      ctx.beginPath(); ctx.moveTo(width * 0.08, height * 0.91); ctx.lineTo(width * 0.92, height * 0.91); ctx.stroke();
      ctx.fillStyle = '#A0A0A0'; ctx.font = '500 10px Inter, sans-serif'; ctx.textAlign = 'left';
      ctx.fillText('0' + (active + 1) + ' / 06', width * 0.08, height * 0.95);
    };
    const scene = surface(root.querySelector('.income-canvas'), draw, 1350);
    const select = (choice, notify = true) => {
      active = choices.indexOf(choice);
      for (const item of choices) item.setAttribute('aria-pressed', String(item === choice));
      const route = routes[choice.dataset.income] || routes.live;
      if (next) { next.href = route.href; next.textContent = route.label; }
      root.dataset.income = choice.dataset.income;
      if (scene) scene.restart();
      if (notify) root.dispatchEvent(new CustomEvent('reyz:incomechange', { bubbles: true, detail: {
        id: choice.dataset.income, label: choice.querySelector('b')?.textContent || '', href: route.href,
      } }));
    };
    for (const choice of choices) choice.addEventListener('click', () => select(choice));
    select(choices[active], false);
    if (scene) root.classList.add('is-ready');
  }

  // A material plane changes its camera, layers and framing for each purpose.
  function plate(ctx, x, y, width, height, angle, opacity, accent = false) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.globalAlpha = opacity;
    const sheen = ctx.createLinearGradient(-width / 2, -height / 2, width / 2, height / 2);
    sheen.addColorStop(0, '#777777'); sheen.addColorStop(0.045, '#303030'); sheen.addColorStop(0.46, '#161616'); sheen.addColorStop(1, '#303030');
    ctx.fillStyle = sheen; ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.strokeStyle = 'rgba(250,250,250,0.3)'; ctx.lineWidth = 0.6; ctx.strokeRect(-width / 2, -height / 2, width, height);
    ctx.beginPath(); ctx.moveTo(-width / 2, -height / 2); ctx.lineTo(-width / 2, height / 2);
    ctx.strokeStyle = accent ? PINK : 'rgba(250,250,250,0.7)'; ctx.lineWidth = accent ? 2 : 0.7; ctx.stroke();
    ctx.strokeStyle = 'rgba(250,250,250,0.045)'; ctx.lineWidth = 0.5;
    for (let i = 1; i < 12; i++) { const line = -width / 2 + width * i / 12; ctx.beginPath(); ctx.moveTo(line, -height / 2); ctx.lineTo(line, height / 2); ctx.stroke(); }
    ctx.restore();
  }

  // REYZ's own rendered ribbon is decoded once, only as a scene approaches view.
  // Fixed canvas geometry prevents a late image from moving any content.
  const ribbonURL = new URL('brand/infinity-ribbon.webp', document.currentScript?.src
    || new URL('assets/experience.js', document.baseURI)).href;
  let ribbonLoad;
  function loadRibbon() {
    if (!ribbonLoad) ribbonLoad = new Promise(resolve => {
      const asset = new Image();
      asset.decoding = 'async'; asset.width = 1440; asset.height = 810;
      asset.onload = () => {
        const decoded = typeof asset.decode === 'function' ? asset.decode() : Promise.resolve();
        decoded.then(() => resolve(asset), () => resolve(null));
      };
      asset.onerror = () => resolve(null);
      asset.src = ribbonURL;
    });
    return ribbonLoad;
  }
  function whenNear(element, ready) {
    const start = () => { loadRibbon().then(ready); };
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); start(); }
      }, { rootMargin: '240px' });
      observer.observe(element);
    } else start();
  }

  // Each plane is a different crop of the same object. The image is composited
  // inside a changing frame, with a travelling highlight and separate edges.
  function ribbonPlane(ctx, asset, x, y, width, height, angle, crop, light, opacity = 1) {
    let [sx, sy, sw, sh] = crop;
    sx *= asset.naturalWidth; sw *= asset.naturalWidth;
    sy *= asset.naturalHeight; sh *= asset.naturalHeight;
    const aspect = width / height;
    if (sw / sh > aspect) { const fit = sh * aspect; sx += (sw - fit) / 2; sw = fit; }
    else { const fit = sw / aspect; sy += (sh - fit) / 2; sh = fit; }
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle); ctx.globalAlpha = opacity;
    ctx.fillStyle = '#111111'; ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.save(); ctx.beginPath(); ctx.rect(-width / 2, -height / 2, width, height); ctx.clip();
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(asset, sx, sy, sw, sh, -width / 2, -height / 2, width, height);
    const at = -width * 0.65 + light * width * 1.3;
    const sheen = ctx.createLinearGradient(at - width * 0.3, 0, at + width * 0.3, 0);
    sheen.addColorStop(0, 'rgba(250,250,250,0)');
    sheen.addColorStop(0.5, 'rgba(250,250,250,0.1)');
    sheen.addColorStop(1, 'rgba(250,250,250,0)');
    ctx.fillStyle = sheen; ctx.fillRect(-width / 2, -height / 2, width, height);
    ctx.restore();
    ctx.strokeStyle = 'rgba(250,250,250,0.22)'; ctx.lineWidth = 0.6;
    ctx.strokeRect(-width / 2, -height / 2, width, height);
    ctx.restore();
  }

  function ribbonComposition(ctx, asset, width, height, key, progress) {
    const t = ease(progress);
    if (key === 'awareness') {
      const cx = width * (0.7 - t * 0.015), cy = height * 0.4;
      const w = width * (0.94 - t * 0.12), h = height * (0.66 - t * 0.06);
      for (let i = 2; i >= 1; i--) plate(ctx, cx + i * width * 0.013, cy + i * height * 0.035,
        w, h, -0.12 + t * 0.055 + i * 0.02, 0.22, false);
      ribbonPlane(ctx, asset, cx, cy, w, h, -0.12 + t * 0.055,
        [0.015, 0.12, 0.97, 0.71], t, 1);
      ctx.strokeStyle = PINK; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(width * 0.07, height * 0.72);
      ctx.lineTo(width * (0.07 + 0.2 * ease(progress * 2)), height * 0.72); ctx.stroke();
    } else if (key === 'trust') {
      for (let i = 2; i >= 0; i--) {
        const reveal = ease(progress * 1.7 - i * 0.1);
        const x = width * (0.4 + i * 0.22 + (i - 1) * 0.065 * (1 - reveal));
        const y = height * (0.34 + i * 0.065);
        ribbonPlane(ctx, asset, x, y, width * 0.22, height * 0.5,
          -0.12 + i * 0.07, [0.035 + i * 0.31, 0.13, 0.31, 0.66], t - i * 0.12, 0.65 + reveal * 0.35);
        ctx.strokeStyle = 'rgba(250,250,250,' + (0.1 + reveal * 0.18) + ')'; ctx.lineWidth = 0.65;
        ctx.beginPath(); ctx.moveTo(x - width * 0.1, y + height * 0.24);
        ctx.lineTo(width * (0.28 + i * 0.08), height * 0.77); ctx.stroke();
      }
    } else {
      const focus = ease(progress * 1.5), cx = width * 0.73, cy = height * 0.4;
      const w = width * (0.58 - focus * 0.29), h = height * (0.5 + focus * 0.12);
      plate(ctx, cx + width * 0.018, cy + height * 0.025, w, h, -0.05, 0.4, false);
      ribbonPlane(ctx, asset, cx, cy, w, h, -0.08 * (1 - focus),
        [0.23 + focus * 0.12, 0.12, 0.72 - focus * 0.1, 0.72], t, 1);
      const y = cy + h / 2 + height * 0.025;
      const end = cx - width * 0.3 * ease((progress - 0.32) * 2);
      ctx.strokeStyle = PINK; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, y + height * 0.035);
      ctx.lineTo(end, y + height * 0.035); ctx.stroke();
      ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(end, y + height * 0.035, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    // This quiet region belongs to the words, regardless of which crop is chosen.
    const shade = ctx.createLinearGradient(0, 0, width * 0.64, 0);
    shade.addColorStop(0, 'rgba(10,10,10,0.7)'); shade.addColorStop(1, 'rgba(10,10,10,0)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, width * 0.64, height);
  }

  for (const figure of document.querySelectorAll('[data-cinematic]')) {
    const showcase = figure.closest('.showcase');
    const choices = Array.from(showcase?.querySelectorAll('.type-choice') || []);
    if (!choices.length) continue;
    let key = 'awareness', ribbon = null;
    const caption = figure.querySelector('figcaption');
    const controls = document.createElement('div'); controls.className = 'cinematic-controls';
    const toggle = document.createElement('button'); toggle.className = 'cinematic-toggle'; toggle.type = 'button'; toggle.textContent = '一時停止';
    const scrub = document.createElement('input'); scrub.type = 'range'; scrub.className = 'cinematic-scrub';
    scrub.min = '0'; scrub.max = '100'; scrub.step = '1'; scrub.value = '0'; scrub.setAttribute('aria-label', '映像の位置');
    controls.append(toggle, scrub);
    let phase = 0;
    const scene = surface(figure.querySelector('.cinematic-canvas'), (ctx, width, height, progress) => {
      ground(ctx, width, height);
      const t = ease(progress), cx = width * 0.72, cy = height * 0.44;
      const unit = Math.min(width * 0.47, height * 0.82);
      // Composition follows the selected purpose, rather than changing only its colour.
      if (ribbon) {
        ribbonComposition(ctx, ribbon, width, height, key, progress);
      } else if (key === 'awareness') {
        const spread = (1 - ease(progress * 1.5)) * 0.5 + 0.12;
        for (let i = 7; i >= 0; i--) {
          const offset = (i - 3.5) * spread;
          plate(ctx, cx + Math.sin(offset) * unit * 0.22, cy + i * unit * 0.025, unit * (0.7 + t * 0.15), unit * 0.88,
            -0.24 + offset * 0.21, 0.35 + (7 - i) * 0.09, i === 0);
        }
        ctx.strokeStyle = PINK; ctx.lineWidth = Math.max(1, height * 0.004);
        ctx.beginPath(); ctx.moveTo(width * 0.07, height * 0.72); ctx.lineTo(width * (0.07 + 0.2 * ease(progress * 2)), height * 0.72); ctx.stroke();
      } else if (key === 'trust') {
        for (let i = 3; i >= 0; i--) {
          const reveal = ease(progress * 1.8 - i * 0.13);
          const offset = (i - 1.5) * unit * 0.18 * reveal;
          plate(ctx, cx + offset, cy - offset * 0.65, unit * 0.63, unit * 0.7, -0.17, 0.35 + reveal * 0.55, i === 0);
          ctx.strokeStyle = 'rgba(250,250,250,' + (0.08 + reveal * 0.16) + ')'; ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(cx + offset - unit * 0.31, cy - offset * 0.65 + unit * 0.35);
          ctx.lineTo(cx - unit * 0.7, height * (0.72 + i * 0.025)); ctx.stroke();
        }
      } else {
        const focus = ease(progress * 1.5);
        const pw = unit * (0.92 - focus * 0.42), ph = unit * (0.55 + focus * 0.32);
        plate(ctx, cx, cy, pw, ph, -0.12 + focus * 0.12, 1, true);
        const y = cy + ph / 2 + unit * 0.06;
        ctx.strokeStyle = PINK; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx, y); ctx.lineTo(cx, y + unit * 0.08 * t);
        ctx.lineTo(cx - unit * 0.3 * ease((progress - 0.35) * 2), y + unit * 0.08 * t); ctx.stroke();
        ctx.fillStyle = WHITE; ctx.beginPath(); ctx.arc(cx - unit * 0.3 * ease((progress - 0.35) * 2), y + unit * 0.08 * t, 2, 0, Math.PI * 2); ctx.fill();
      }
      // Fine framing marks, kept away from the readable typography.
      ctx.globalAlpha = 1; ctx.strokeStyle = 'rgba(250,250,250,0.28)'; ctx.lineWidth = 0.6;
      for (const [x, y, sx, sy] of [[width * 0.05, height * 0.08, 1, 1], [width * 0.95, height * 0.08, -1, 1]]) {
        ctx.beginPath(); ctx.moveTo(x + sx * 12, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * 12); ctx.stroke();
      }
    }, 4800, (progress, playing) => {
      scrub.value = String(Math.round(progress * 100));
      toggle.textContent = motion.matches ? '全体を見る' : playing ? '一時停止' : progress >= 1 ? 'もう一度再生' : '再生する';
      toggle.setAttribute('aria-label', toggle.textContent);
      const nextPhase = motion.matches ? 3 : Math.min(3, Math.floor(progress * 3) + 1);
      if (nextPhase !== phase) { phase = nextPhase; figure.dataset.phase = String(phase); }
    });
    const select = choice => {
      key = choice.dataset.scene;
      figure.dataset.scene = key;
      for (const item of choices) item.setAttribute('aria-pressed', String(item === choice));
      if (scene) scene.restart();
    };
    for (const choice of choices) choice.addEventListener('click', () => select(choice));
    if (scene) {
      if (caption) caption.append(controls); else figure.append(controls);
      toggle.addEventListener('click', () => scene.toggle());
      scrub.addEventListener('input', () => scene.seek(Number(scrub.value) / 100));
      figure.classList.add('is-ready');
      whenNear(figure, asset => {
        if (!asset) return;
        ribbon = asset; figure.dataset.material = 'ribbon'; scene.invalidate();
      });
    }
    select(choices.find(item => item.getAttribute('aria-pressed') === 'true') || choices[0]);
  }

  // Landing on the requested panel and carrying a real visitor's map into contact.
  for (const link of document.querySelectorAll('[data-open-check]')) link.addEventListener('click', () => {
    document.querySelector('#demoE .tab[data-t="check"]')?.click();
  });
  for (const link of document.querySelectorAll('[data-open-map]')) link.addEventListener('click', () => {
    document.querySelector('#demoE .tab[data-t="map"]')?.click();
  });
  const contactTypes = {
    creator: '活動・収益化の相談', creative: '目的の整理と進め方の相談',
    ai: 'AIを仕事に入れる（REYZ PLATFORM）', consensus: '公開前の確認と記録（REYZ CONSENSUS）',
  };
  for (const link of document.querySelectorAll('[data-consult-page]')) link.addEventListener('click', () => {
    if (link.matches('a.consult')) return;
    const page = document.body.dataset.page;
    const type = contactTypes[page];
    if (!type) return;
    let body = '', map = null;
    try {
      map = JSON.parse(sessionStorage.getItem('reyz.map.r') || 'null');
    } catch (_) { /* An unreadable previous map must not override this page's contact type. */ }
    const who = page === 'creator' ? 'creator' : page === 'creative' ? 'company' : '';
    if (who && map?.who === who && [map.goal, map.place, map.step].every(value => typeof value === 'string' && value.length > 0)) {
      body = '【あなたの地図（ホームで選んだ内容）】\n目的: ' + map.goal + '\n今いる場所: ' + map.place + '\n最初の一歩: ' + map.step;
    }
    try {
      sessionStorage.setItem('reyz.map', JSON.stringify({ type, body }));
    } catch (_) { /* The contact form remains usable when browser storage is unavailable. */ }
  });
})();
