/* REYZ Inc. — 共通スクリプト
   FIELD: 一系統の粒子。ページの中央線を通り、各章の錨（[data-word]）で語として留まる。
   スクロールとともに語はほどけて一本の流れになり、次の章で次の語として現れる。章の本文は語の明瞭さと同じ関数で現れ、消える。 */
(() => {
  'use strict';
  document.documentElement.classList.remove('no-js');
  // a page opened from a link starts at its top (back/forward keeps the browser's own restoration)
  // a page opened from a link starts at its top. the host (an embedding viewer, a restoring browser) may re-apply an old
  // position after load, so the top is re-asserted for a short settle window — until the reader touches, scrolls or types.
  try {
    const nav = performance.getEntriesByType('navigation')[0];
    if (!location.hash && (!nav || nav.type === 'navigate')) {
      let touched = false; const stop = () => { touched = true; };
      for (const ev of ['touchstart', 'wheel', 'pointerdown', 'keydown']) window.addEventListener(ev, stop, { passive: true, once: true });
      const top = () => { if (!touched && window.scrollY !== 0) window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); };
      top(); window.addEventListener('load', top, { once: true }); window.addEventListener('pageshow', e => { if (!e.persisted) top(); }, { once: true });
      for (const ms of [50, 150, 300, 600, 1000, 1500]) setTimeout(top, ms);
    }
  } catch (err) { /* ignore */ }

  /* ===== 公開前に設定する項目（空欄の項目は表示されません） ===== */
  const CONFIG = {
    formEndpoint: '/api/contact',     // 同一ドメインの受付 Worker（workers/contact）→「送信」で直接送信（POST, JSON）。空にすると「文面をコピー」の暫定挙動に戻る
    turnstileSiteKey: '0x4AAAAAAFIPs9iKoP2Ouj0x',   // Cloudflare Turnstile のサイトキー（公開値。ウィジェット reyz-site-contact）。確認ページにボット対策の確認を表示し、送信時にトークンを添える
    contactEmail: 'contact@reyz.inc', // 代替経路（送れなかったときの「メールアプリで送る」）とフッターの連絡先表示。空にすると非表示
    lineUrl: ''                       // 例: 'https://lin.ee/xxxx' → 予備の連絡手段として案内文に表示
  };

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = t => t * t * (3 - 2 * t);
  const rnd = (i, k) => { const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x); };

  /* ================================================================
     FIELD
     ================================================================ */
  try { (() => {
    const canvas = document.getElementById('field');
    const slots = Array.from(document.querySelectorAll('[data-word]'));
    if (!canvas || !slots.length) return;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    let vw = 0, vh = 0, dpr = 1, N = 0, alphaGlobal = 1, skip = 1, lastNow = 0;
    let px, py, psize, palpha, pphase, sprites = [], frameCost = [];
    let keys = [];             // { el, copy, word, box, cx, cy, kin, kout, soff, pts (local, centred), am }
    const bornAt = performance.now(); // intro: the first word gathers over ~1.2s and its copy appears with it
    let streamPts = null, streamLoop = null;   // local thread shapes (chapter travel / footer ∞), re-generated on layout
    let laneX = 0;             // viewport x of the travel lane
    const pointer = { x: -9999, y: -9999, active: false };
    const rectPage = el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top + window.scrollY, w: r.width, h: r.height }; };

    function makeSprite(r) {
      const c = document.createElement('canvas'); const s = Math.ceil(r * 4) + 2; c.width = c.height = s;
      const g = c.getContext('2d'); const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, r * 2);
      grad.addColorStop(0, 'rgba(247, 21, 172, 1)'); grad.addColorStop(0.45, 'rgba(247, 21, 172, 0.6)'); grad.addColorStop(1, 'rgba(247, 21, 172, 0)');
      g.fillStyle = grad; g.fillRect(0, 0, s, s); return { c, s };
    }
    function sortByAngle(pts) {
      const n = pts.length / 2, idx = Array.from({ length: n }, (_, i) => i);
      idx.sort((a, b) => Math.atan2(pts[a * 2 + 1], pts[a * 2]) - Math.atan2(pts[b * 2 + 1], pts[b * 2]));
      const out = new Float32Array(n * 2); for (let i = 0; i < n; i++) { out[i * 2] = pts[idx[i] * 2]; out[i * 2 + 1] = pts[idx[i] * 2 + 1]; } return out;
    }
    /* --- shapes: local coordinates, centred on (0,0), fitted to a box of w×h --- */
    function lemniscate(w, h, scale) {
      const out = new Float32Array(N * 2); let a = w * 0.46 * scale; if (a * 0.72 > h * 0.9) a = h * 0.9 / 0.72;
      for (let i = 0; i < N; i++) { const t = (i / N) * Math.PI * 2, d = 1 + Math.sin(t) * Math.sin(t), st = ((i % 7) - 3) * a * 0.012; out[i * 2] = (a * Math.cos(t)) / d + Math.cos(t * 3) * st; out[i * 2 + 1] = (a * Math.sin(t) * Math.cos(t)) / d + Math.sin(t * 2) * st; }
      return out;
    }
    function seed(w, h) {
      const R = Math.min(w, h) * 0.3, out = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) { const r = R * Math.pow(rnd(i, 3), 0.72), a = rnd(i, 4) * Math.PI * 2; out[i * 2] = Math.cos(a) * r; out[i * 2 + 1] = Math.sin(a) * r * 0.92; }
      return sortByAngle(out);
    }
    function ripple(w, h) {
      const R = Math.min(w, h) * 0.5, out = new Float32Array(N * 2);
      for (let i = 0; i < N; i++) { const k = i % 3, a = (i / N) * Math.PI * 6, r = R * (0.28 + k * 0.3) * (1 + (rnd(i, 8) - 0.5) * 0.05); out[i * 2] = Math.cos(a) * r; out[i * 2 + 1] = Math.sin(a) * r; }
      return sortByAngle(out);
    }
    function line(w, h) {
      const out = new Float32Array(N * 2), x0 = -w * 0.46, x1 = w * 0.46;
      for (let i = 0; i < N; i++) { const g = (rnd(i, 9) + rnd(i, 10) + rnd(i, 11) - 1.5) * 2.2; out[i * 2] = x0 + (x1 - x0) * (i / N); out[i * 2 + 1] = g * 4.5; }
      return out;
    }
    function text(str, w, h) {
      const W = Math.max(4, Math.round(w)), H = Math.max(4, Math.round(h));
      const off = document.createElement('canvas'); off.width = W; off.height = H; const c = off.getContext('2d');
      c.fillStyle = '#000'; c.fillRect(0, 0, W, H); c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
      const font = s => `300 ${s}px "Helvetica Neue", Inter, Helvetica, Arial, sans-serif`;
      let size = Math.min(H * 0.6, 420); c.font = font(size); const mw = c.measureText(str).width; if (mw > W * 0.86) { size *= (W * 0.86) / mw; c.font = font(size); }
      c.fillText(str, W / 2, H / 2);
      const d = c.getImageData(0, 0, W, H).data, cand = []; for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (d[(y * W + x) * 4] > 128) cand.push(x, y);
      const M = cand.length / 2, out = new Float32Array(N * 2);
      if (!M) return out;
      const idx = Array.from({ length: M }, (_, i) => i); idx.sort((p, q) => (cand[p * 2 + 1] - cand[q * 2 + 1]) || (cand[p * 2] - cand[q * 2]));
      for (let i = 0; i < N; i++) { const k = idx[Math.floor(i * M / N)]; out[i * 2] = cand[k * 2] - W / 2 + (rnd(i, 1) - 0.5) * 2.4; out[i * 2 + 1] = cand[k * 2 + 1] - H / 2 + (rnd(i, 2) - 0.5) * 2.4; }
      return out;
    }
    // the travel form: a thin vertical thread the cloud dissolves into while it moves between chapters
    function stream(len) {
      const out = new Float32Array(N * 2);
      const wobble = vw < 820 ? 1.2 : 2.2; for (let i = 0; i < N; i++) { const g = (rnd(i, 12) + rnd(i, 13) + rnd(i, 14) - 1.5) * 1.6; out[i * 2] = g * wobble; out[i * 2 + 1] = -len / 2 + len * (i / N) + (rnd(i, 15) - 0.5) * 6; }
      return out;
    }
    const GEN = { infinity: (w, h) => lemniscate(w, h, 1), loop: (w, h) => lemniscate(w, h, 0.9), seed, ripple, line };
    const ALPHA = { seed: 0.85, line: 0.42, loop: 0.9, ripple: 0.9 };
    const shapeFor = (word, w, h) => (GEN[word] ? GEN[word](w, h) : text(word, w, h));

    function layout() {
      vw = window.innerWidth; vh = window.innerHeight; dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const wantN = vw < 820 ? 1200 : 2400, aScale = vw < 820 ? 0.62 : 1;
      if (wantN !== N || aScale !== layout.aScale) {
        layout.aScale = aScale; N = wantN;
        px = new Float32Array(N); py = new Float32Array(N); psize = new Uint8Array(N); palpha = new Float32Array(N); pphase = new Float32Array(N);
        for (let i = 0; i < N; i++) { psize[i] = (i % 5 === 0) ? 1 : 0; palpha[i] = (0.36 + (i % 10) * 0.07) * aScale; pphase[i] = (i / N) * Math.PI * 2; }
        sprites = [makeSprite(1.3), makeSprite(2.1)]; layout.done = false;
      }
      keys = slots.map(el => { const r = rectPage(el); const w = el.dataset.word; const stack = el.parentElement; const copy = stack ? stack.querySelector('.copy') : null;
        return { el, copy, word: w, box: r, cx: 0, cy: 0, kin: 0, kout: 0, soff: 0, pts: shapeFor(w, r.w, r.h), am: ALPHA[w] || 1 }; });
      const first = keys[0].box; alphaGlobal = clamp(Math.sqrt((first.w * first.h) / (520 * 390)), 0.6, 1);
      streamPts = stream(Math.min(vh * 0.62, 460));
      const loop = keys.find(k => k.word === 'loop'); streamLoop = stream(loop ? loop.box.h * 1.4 : Math.min(vh * 0.4, 300));
      measureKeys();
      if (!layout.done) { // first paint: gather into the first shape from a loose scatter (static when motion is reduced)
        layout.done = true; const k0 = keys[0]; const sc = reduce ? 0 : 1;
        for (let i = 0; i < N; i++) { px[i] = k0.cx + k0.pts[i * 2] + (rnd(i, 21) - 0.5) * vw * 0.9 * sc; py[i] = k0.cy - window.scrollY + k0.pts[i * 2 + 1] + (rnd(i, 22) - 0.5) * vh * 0.9 * sc; }
      }
    }
    // scroll marks, all in scrollY terms:
    //   kin  — the word is fully formed (its slot centred in the viewport)
    //   kout — the word starts to dissolve: the chapter (slot + copy) has been read — its bottom has risen to 55% of the viewport
    //          (clamped between kin + 12vh and the next kin − 45vh so a word never dissolves before it is seen, nor too late to travel)
    //   soff — the slot has left the viewport entirely
    function measureKeys() {
      const maxS = Math.max(0, document.documentElement.scrollHeight - vh);
      for (const k of keys) {
        const r = rectPage(k.el); k.box = r; k.cx = r.x + r.w / 2; k.cy = r.y + r.h / 2;
        const stack = k.copy ? rectPage(k.el.parentElement) : r;
        k.kin = clamp(k.cy - vh * 0.5, 0, maxS); k.kout = stack.y + stack.h - vh * 0.55; k.soff = r.y + r.h;
      }
      keys.sort((a, b) => a.kin - b.kin);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i], nx = keys[i + 1];
        if (nx) { if (nx.kin <= k.kin) nx.kin = k.kin + 2; const lo = k.kin + vh * 0.12, hi = nx.kin - vh * 0.45; k.kout = lo <= hi ? clamp(k.kout, lo, hi) : (k.kin + nx.kin) / 2; }
      }
      laneX = keys[0].cx;
    }
    function segment() {
      const s = window.scrollY; if (keys.length === 1) return { A: keys[0], B: keys[0], s };
      let k = 0; while (k < keys.length - 2 && s >= keys[k + 1].kin) k++;
      return { A: keys[k], B: keys[k + 1], s };
    }
    let lastA = null, lastB = null, prevPos = null;
    function syncCopy(k, clarity) {
      if (!k.copy || reduce) return; const v = clarity.toFixed(3); if (k.copy.dataset.c === v) return; k.copy.dataset.c = v;
      k.copy.style.opacity = v; k.copy.style.transform = clarity >= 0.999 ? '' : `translateY(${((1 - clarity) * 14).toFixed(1)}px)`;
    }
    function draw(now) {
      const t0 = performance.now(); const dt = lastNow ? Math.min(now - lastNow, 100) : 16.7; lastNow = now;
      const { A, B, s } = segment(); const sy = s; const mid = vh * 0.5;
      const intro = reduce ? 1 : smooth(clamp((now - bornAt) / 1200, 0, 1));
      // rhythm. the word holds while its chapter is read; then, as the reader moves on, the word dissolves into a thread that
      // detaches from the page and hangs in the middle of the screen; the next word forms as its chapter arrives. the copy of a
      // chapter appears and fades with exactly the clarity of its word. into the footer ∞: the last word simply scrolls away with
      // its chapter, and the ∞ forms inside the footer as it rises into view.
      let fa = 0, fb = 0, posY = A.cy - sy, posX = A.cx, S = streamPts, cA = 1, cB = 0;
      if (B !== A && B.word !== 'loop') {
        const p = clamp((s - A.kout) / Math.max(1, B.kin - A.kout), 0, 1);
        fa = smooth(clamp(p / 0.4, 0, 1)); fb = smooth(clamp((p - 0.55) / 0.45, 0, 1));
        if (p < 0.5) { posY = (A.cy - sy) + (mid - (A.cy - sy)) * fa; posX = A.cx + (laneX - A.cx) * fa; }
        else { posY = mid + ((B.cy - sy) - mid) * fb; posX = laneX + (B.cx - laneX) * fb; }
        cA = 1 - fa; cB = fb;
      } else if (B !== A) {
        const off = s >= A.soff; S = streamLoop;
        if (off) { fa = 1; fb = smooth(clamp((s - (B.kin - vh * 0.9)) / (vh * 0.9) - 0.35, 0, 0.65) / 0.65); posY = B.cy - sy; posX = B.cx; }
        cA = 1; cB = 1;
      }
      syncCopy(A, cA * (A === keys[0] ? intro : 1)); if (B !== A) syncCopy(B, cB);
      if (lastA !== A || lastB !== B) { for (const k of keys) if (k !== A && k !== B && k.copy && k.copy.dataset.c !== '0.000') syncCopy(k, 0); lastA = A; lastB = B; }
      // a jump between two off-screen positions (the word left at the top, the ∞ waits below) is taken at once, never eased across the screen
      const snap = prevPos !== null && Math.abs(posY - prevPos) > vh * 0.8; prevPos = posY;
      const am = (A.am + (B.am - A.am) * (fa === 1 ? 1 : fa)) * (1 - 0.6 * Math.min(fa, 1 - fb));
      const ease = (reduce || snap) ? 1 : 1 - Math.pow(0.86, dt / 16.67), breath = reduce ? 0 : 2.4;
      ctx.clearRect(0, 0, vw, vh); ctx.globalCompositeOperation = 'lighter';
      const R = 110, R2 = R * R, pointerOn = pointer.active && fine && !reduce;
      const P = A.pts, Q = B.pts, firstHalf = fa < 1 || fb === 0;
      for (let i = 0; i < N; i++) {
        const i2 = i * 2, ph = pphase[i], br = Math.sin(now * 0.0018 + ph) * breath;
        let lx, ly;
        if (firstHalf && fb === 0) { lx = P[i2] + (S[i2] - P[i2]) * fa; ly = P[i2 + 1] + (S[i2 + 1] - P[i2 + 1]) * fa; }
        else { lx = S[i2] + (Q[i2] - S[i2]) * fb; ly = S[i2 + 1] + (Q[i2 + 1] - S[i2 + 1]) * fb; }
        let tx = posX + lx + Math.cos(ph + now * 0.001) * br, ty = posY + ly + Math.sin(ph + now * 0.001) * br;
        if (pointerOn) { const dx = px[i] - pointer.x, dy = py[i] - pointer.y, d2 = dx * dx + dy * dy; if (d2 < R2 && d2 > 0.01) { const d = Math.sqrt(d2), f = 1 - d / R; tx += (dx / d) * f * f * 34; ty += (dy / d) * f * f * 34; } }
        px[i] += (tx - px[i]) * ease; py[i] += (ty - py[i]) * ease;
        if (skip > 1 && (i % skip)) continue;
        const y = py[i]; if (y < -8 || y > vh + 8) continue; const x = px[i]; if (x < -8 || x > vw + 8) continue;
        const sp = sprites[psize[i]]; ctx.globalAlpha = palpha[i] * am * alphaGlobal; ctx.drawImage(sp.c, x - sp.s / 2, y - sp.s / 2, sp.s, sp.s);
      }
      ctx.globalAlpha = 1;
      frameCost.push(performance.now() - t0); if (frameCost.length >= 90) { const avg = frameCost.reduce((a, c) => a + c, 0) / frameCost.length; skip = avg > 9 ? 2 : 1; frameCost.length = 0; }
    }
    let raf = 0, running = true;
    function loop(now) { if (!running) return; draw(now); raf = requestAnimationFrame(loop); }
    function start() { running = true; cancelAnimationFrame(raf); lastNow = 0; raf = requestAnimationFrame(loop); }
    function stop() { running = false; cancelAnimationFrame(raf); }
    // resize: a small height change (browser toolbar) only re-sizes the canvas and re-reads the marks; anything else re-samples
    let resizeT = 0, lastW = 0, lastH = 0;
    const remember = () => { lastW = window.innerWidth; lastH = window.innerHeight; };
    const relayout = () => { clearTimeout(resizeT); resizeT = setTimeout(() => {
      const dw = Math.abs(window.innerWidth - lastW), dh = Math.abs(window.innerHeight - lastH);
      if (dw === 0 && dh < 160) { vw = window.innerWidth; vh = window.innerHeight; canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); measureKeys(); }
      else layout();
      remember(); if (reduce) draw(performance.now()); }, 120); };
    window.addEventListener('resize', relayout);
    if ('ResizeObserver' in window) new ResizeObserver(relayout).observe(document.body);
    if (fine) { window.addEventListener('pointermove', e => { pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true; }, { passive: true }); document.addEventListener('mouseleave', () => { pointer.active = false; }); }
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (!reduce) start(); });
    if (reduce) window.addEventListener('scroll', () => draw(performance.now()), { passive: true });
    layout(); remember();
    if (reduce) draw(performance.now()); else start();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { layout(); remember(); if (reduce) draw(performance.now()); });
  })(); } catch (err) { /* the field is decorative: never let it take the page down */ }

  /* ================================================================
     HEADER / MENU
     ================================================================ */
  const header = document.getElementById('siteHeader');
  if (header) { const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 40); window.addEventListener('scroll', onScroll, { passive: true }); onScroll(); }
  const menuBtn = document.getElementById('menuBtn'), sheet = document.getElementById('sheet');
  if (menuBtn && sheet) {
    let openedAt = 0; const onScroll = () => { if (!sheet.hidden && Math.abs(window.scrollY - openedAt) > 12) closeSheet(); };
    const closeSheet = () => { sheet.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); menuBtn.setAttribute('aria-label', 'メニューを開く'); window.removeEventListener('scroll', onScroll); };
    const openSheet = () => { sheet.hidden = false; menuBtn.setAttribute('aria-expanded', 'true'); menuBtn.setAttribute('aria-label', 'メニューを閉じる'); openedAt = window.scrollY; window.addEventListener('scroll', onScroll, { passive: true }); };
    menuBtn.addEventListener('click', () => { if (sheet.hidden) openSheet(); else closeSheet(); });
    sheet.addEventListener('click', e => { if (e.target.tagName === 'A') closeSheet(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !sheet.hidden) { closeSheet(); menuBtn.focus(); } });
  }
  // gates / rows: light follows the pointer (desktop only)
  if (fine) document.querySelectorAll('.gate').forEach(card => card.addEventListener('pointermove', e => { const r = card.getBoundingClientRect(); card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%'); card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%'); }, { passive: true }));

  /* ================================================================
     WORKS — YouTube はクリックまで iframe を読み込まない（サムネイル＋再生マーク）。再生中は1本だけ。
             mp4 はファイルが無ければ自ら非表示。全部消えたら「準備中」の注記だけが残る
     ================================================================ */
  const works = document.getElementById('works');
  if (works) {
    const figs = Array.from(works.querySelectorAll('.work'));
    const check = () => { if (figs.every(f => f.hidden)) { const e = document.getElementById('worksEmpty'); if (e) e.hidden = false; } };
    // --- YouTube facade
    const yts = figs.filter(f => f.dataset.yt);
    let warmed = false;
    const warm = () => { if (warmed) return; warmed = true; for (const h of ['https://www.youtube-nocookie.com', 'https://i.ytimg.com']) { const l = document.createElement('link'); l.rel = 'preconnect'; l.href = h; document.head.appendChild(l); } };
    const stopOthers = (except) => { for (const f of yts) { if (f === except || !f._iframe) continue; f._iframe.replaceWith(f._facade); f._iframe = null; f.classList.remove('playing'); } };
    const play = (f) => {
      const a = f.querySelector('a.yt'); if (!a) return;
      stopOthers(f);
      const title = (a.getAttribute('aria-label') || '動画').replace(/^再生: ?/, '');
      const ifr = document.createElement('iframe');
      ifr.src = 'https://www.youtube-nocookie.com/embed/' + f.dataset.yt + '?autoplay=1&rel=0&playsinline=1';
      ifr.title = title; ifr.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen'; ifr.setAttribute('allowfullscreen', ''); ifr.referrerPolicy = 'strict-origin-when-cross-origin'; ifr.loading = 'eager';
      f._facade = a; f._iframe = ifr; a.replaceWith(ifr); f.classList.add('playing'); ifr.focus({ preventScroll: true });
    };
    for (const f of yts) {
      const a = f.querySelector('a.yt'), img = f.querySelector('img');
      if (!a) continue;
      a.addEventListener('click', e => { e.preventDefault(); play(f); });
      a.addEventListener('pointerenter', warm, { once: true }); a.addEventListener('touchstart', warm, { once: true, passive: true }); a.addEventListener('focus', warm, { once: true });
      if (img) {
        img.addEventListener('error', () => { img.hidden = true; });                       // サムネイル取得不可 → 暗い面＋再生マークのまま
        if (!f.dataset.poster) {                                                            // 高解像度サムネイルがあれば差し替え（無い動画は 120×90 の代替画が返る）
          const hi = new Image(); hi.onload = () => { if (hi.naturalWidth > 120) img.src = hi.src; }; hi.src = 'https://i.ytimg.com/vi/' + f.dataset.yt + '/maxresdefault.jpg';
        }
      }
    }
    // --- self-hosted mp4
    figs.filter(f => !f.dataset.yt).forEach(f => { const v = f.querySelector('video'); const src = f.querySelector('source'); const gone = () => { f.hidden = true; check(); }; if (src) src.addEventListener('error', gone); if (v) { v.addEventListener('error', gone); const probe = () => { if (v.networkState === 3) gone(); }; probe(); setTimeout(probe, 400); v.addEventListener('loadedmetadata', () => { f.hidden = false; }); } });
    check(); // 0 件（every([]) === true）でも注記が出る
  }

  /* ================================================================
     CONTACT — 入力 → 確認ページ → 送信。
     送信先 CONFIG.formEndpoint（受付 Worker）に honeypot（#cWebsite）と Turnstile トークンを添えて JSON で POST する。
     送信者の環境に依存しない設計:
       - Turnstile は「読めたら使う」。読めない（拡張機能・企業ネットワーク）／描画失敗／時間切れでも送信を止めず、
         状態（client.turnstile）を添えて送る。Worker 側は未検証として受け付ける（控えに [未検証]、確認メールなし）
       - トークン不受理は 1 回だけ取り直して再送、通信断は 1 回だけ再試行
       - それでも送れなければ、文面のコピーとメールアプリ（CONFIG.contactEmail）の代替経路を必ず示す
     送信先未設定（formEndpoint 空）のときは「文面をコピー」の暫定挙動。
     ================================================================ */
  const form = document.getElementById('contactForm');
  if (form) {
    const $ = id => document.getElementById(id);
    const stepForm = $('stepForm'), stepConfirm = $('stepConfirm'), stepDone = $('stepDone'), status = $('status'), sendStatus = $('sendStatus'), list = $('confirmList'), copyLabel = $('copyLabel'), copyArea = $('copyArea'), sendBtn = $('sendBtn'), mailBtn = $('mailBtn'), doneNote = $('doneNote');
    const line = $('contactLine'); if (line && CONFIG.contactEmail) { line.textContent = 'お問い合わせ: ' + CONFIG.contactEmail; line.hidden = false; }
    const LABELS = { name: 'お名前', person: 'ご担当者様', email: 'メールアドレス', type: 'ご用件', msg: '内容' };
    // メールアドレス: @より前（入力）＋ドメイン（選択。会社ドメイン等は「その他」で入力）。貼り付けで全体が入った場合は自動で分割
    const local = $('cLocal'), domainSel = $('cDomain'), domainOther = $('cDomainOther'), emailHidden = $('cEmail');
    const LOCAL_RE = /^[A-Za-z0-9._%+\-]+$/, DOMAIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
    const syncOther = () => { const other = domainSel.value === '__other'; domainOther.hidden = !other; domainOther.required = other; if (other && document.activeElement === domainSel) domainOther.focus(); };
    domainSel.addEventListener('change', syncOther); syncOther();
    const splitPasted = () => { const v = local.value.trim(); const at = v.indexOf('@'); if (at < 0) return; const l = v.slice(0, at), d = v.slice(at + 1).toLowerCase(); local.value = l; const opt = Array.from(domainSel.options).find(o => o.value === d); if (opt) { domainSel.value = d; } else { domainSel.value = '__other'; domainOther.value = d; } syncOther(); };
    local.addEventListener('change', splitPasted); local.addEventListener('blur', splitPasted); local.addEventListener('paste', () => setTimeout(splitPasted, 0));
    const domain = () => (domainSel.value === '__other' ? domainOther.value.trim().toLowerCase() : domainSel.value);
    const email = () => (local.value.trim() && domain()) ? local.value.trim() + '@' + domain() : '';
    const validateEmail = () => {
      local.setCustomValidity(''); domainOther.setCustomValidity('');
      if (local.value.trim() && !LOCAL_RE.test(local.value.trim())) local.setCustomValidity('@より前の部分に使えない文字が含まれています。');
      if (domainSel.value === '__other' && domainOther.value.trim() && !DOMAIN_RE.test(domainOther.value.trim())) domainOther.setCustomValidity('ドメインの形式を確認してください（例: example.co.jp）。');
      emailHidden.value = email();
    };
    const fields = () => ({ name: $('cName').value.trim(), person: $('cPerson').value.trim(), email: email(), type: $('cType').value, msg: $('cMsg').value.trim() });
    const text = f => '[REYZ お問い合わせ]\nご用件: ' + f.type + '\nお名前: ' + f.name + (f.person ? '\nご担当者様: ' + f.person : '') + '\nメール: ' + f.email + '\n内容:\n' + f.msg;
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    /* Turnstile（ボット対策）。状態: off（サイトキー未設定）/ pending / blocked（スクリプトが読めない）/ rendered / ok（トークン取得）/ error:<code> / render-error / unsupported
       入力開始時にスクリプトを先読みし、確認ページで描画（appearance=interaction-only: 必要なときだけ表示）。 */
    // 注意: 要素の id を "turnstile" にしてはならない（id 付き要素は window.turnstile として見え、API の window.turnstile を隠す）
    const tsBox = $('turnstileBox'); const ts = { state: (CONFIG.turnstileSiteKey && tsBox) ? 'pending' : 'off', token: '', widget: null, loading: null, error: '' };
    const tsApi = () => (window.turnstile && typeof window.turnstile.render === 'function') ? window.turnstile : null;
    window.__reyzContact = ts;   // 通し確認（qa/e2e_contact.js）用の読み取り口
    const tsLoad = () => {
      if (ts.state === 'off') return Promise.resolve(false);
      if (tsApi()) return Promise.resolve(true);
      if (!ts.loading) ts.loading = new Promise(resolve => {
        const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.defer = true;
        const t = setTimeout(() => resolve(!!tsApi()), 8000);
        s.onload = () => { clearTimeout(t); resolve(!!tsApi()); }; s.onerror = () => { clearTimeout(t); resolve(false); };
        document.head.append(s);
      });
      return ts.loading;
    };
    const tsReset = () => { ts.token = ''; if (ts.widget !== null && tsApi()) { try { tsApi().reset(ts.widget); } catch (err) {} } };
    const tsRender = async () => {
      if (ts.state === 'off') return;
      if (!(await tsLoad())) { ts.state = 'blocked'; return; }
      if (ts.widget !== null) { tsReset(); return; }
      const api = tsApi();
      const render = () => {
        try {
          tsBox.hidden = false;
          ts.widget = api.render(tsBox, {
            sitekey: CONFIG.turnstileSiteKey, theme: 'dark', language: 'ja', appearance: 'interaction-only', retry: 'auto', 'refresh-expired': 'auto',
            callback: t => { ts.token = t; ts.state = 'ok'; },
            'expired-callback': () => { ts.token = ''; },
            'error-callback': code => { ts.token = ''; ts.state = 'error'; ts.error = String(code || ''); return true; },
            'unsupported-callback': () => { ts.state = 'unsupported'; }
          });
          if (ts.state === 'pending') ts.state = (ts.widget !== undefined && ts.widget !== null) ? 'rendered' : 'render-error';
        } catch (err) { ts.state = 'render-error'; ts.error = String(err && err.message || err).slice(0, 80); }
      };
      if (typeof api.ready === 'function') api.ready(render); else render();
    };
    const tsState = () => (ts.token ? 'ok' : ts.state + (ts.error ? ':' + ts.error : ''));
    const tsWait = async ms => {   // トークンを最大 ms 待つ（読み込み中／照合中のみ。表示された対話式チェックはユーザー操作待ちなので待たない）
      const until = Date.now() + ms;
      while (!ts.token && Date.now() < until && (ts.state === 'pending' || ts.state === 'rendered') && !(tsBox && tsBox.offsetHeight > 20)) await sleep(200);
      return ts.token;
    };
    form.addEventListener('focusin', () => { tsLoad(); }, { once: true });   // 入力開始時に先読み（確認ページで待たせない）

    const show = (step) => {
      for (const el of [stepForm, stepConfirm, stepDone]) el.hidden = el !== step;
      const sec = form.closest('.section') || form; const top = sec.getBoundingClientRect().top + window.scrollY + 8;   // 見出し「お問い合わせ」から見える位置へ
      window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'instant' : 'smooth' });
      const h = step.querySelector('h3, label'); if (h && h.tagName === 'H3') h.focus({ preventScroll: true });
      if (step === stepConfirm) tsRender();
    };
    // 入力 → 確認（履歴に1段積む: 戻るボタンで入力へ）
    form.addEventListener('submit', e => {
      e.preventDefault(); status.textContent = ''; splitPasted(); validateEmail();
      if (!form.reportValidity()) { status.textContent = '未入力または形式の誤りがある項目があります。'; return; }
      const f = fields(); list.textContent = '';
      for (const k of ['name', 'person', 'email', 'type', 'msg']) { if (!f[k]) continue; const row = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = LABELS[k]; const dd = document.createElement('dd'); dd.textContent = f[k]; row.append(dt, dd); list.append(row); }
      sendStatus.textContent = ''; copyLabel.hidden = true; if (mailBtn) mailBtn.hidden = true; sendBtn.disabled = false;
      try { history.pushState({ step: 'confirm' }, '', '#confirm'); } catch (err) {}
      show(stepConfirm);
    });
    $('backBtn').addEventListener('click', () => { if (history.state && history.state.step === 'confirm') history.back(); else show(stepForm); });
    window.addEventListener('popstate', () => { if (stepForm.hidden && !(history.state && history.state.step)) show(stepForm); });
    if (location.hash === '#confirm' || location.hash === '#sent') { try { history.replaceState(null, '', location.pathname); } catch (err) {} }

    // 送れなかったとき: 文面をコピー ＋ メールアプリで送る（連絡経路を必ず残す）
    const fallback = (msg, body) => {
      copyLabel.hidden = false; copyArea.value = body;
      if (mailBtn && CONFIG.contactEmail) { mailBtn.href = 'mailto:' + CONFIG.contactEmail + '?subject=' + encodeURIComponent('REYZ お問い合わせ') + '&body=' + encodeURIComponent(body); mailBtn.hidden = false; }
      sendStatus.textContent = msg; sendBtn.disabled = false;
    };
    const post = async (f, token, state) => {
      const website = $('cWebsite');
      const payload = { name: f.name, person: f.person, email: f.email, type: f.type, message: f.msg, website: website ? website.value : '', turnstile: token, client: { turnstile: state }, _subject: 'REYZ お問い合わせ', _replyto: f.email };
      try {
        const res = await fetch(CONFIG.formEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: JSON.stringify(payload) });
        let j = null; try { j = await res.json(); } catch (err) {}
        return { status: res.status, j: j || {} };
      } catch (err) { return { status: 0, j: { error: 'network' } }; }
    };
    // 送信
    sendBtn.addEventListener('click', async () => {
      const f = fields(); const body = text(f); sendBtn.disabled = true; copyLabel.hidden = true; if (mailBtn) mailBtn.hidden = true;
      if (!CONFIG.formEndpoint) {   // 送信先が未設定: 文面をコピーして案内（公開前の暫定挙動）
        const note = CONFIG.lineUrl ? 'メールまたはLINEでお送りください。' : 'メールでお送りください。';
        try { await navigator.clipboard.writeText(body); fallback('送信先を準備中のため、文面をコピーしました。' + note, body); }
        catch (err) { fallback('送信先を準備中です。下の文面をコピーして' + note, body); copyArea.focus(); copyArea.select(); }
        return;
      }
      if (tsBox && tsBox.offsetHeight > 20 && !ts.token) { sendStatus.textContent = '上の確認（ボット対策）を完了してから「送信」を押してください。'; sendBtn.disabled = false; return; }
      sendStatus.textContent = '送信中…';
      let token = await tsWait(6000);
      let r = await post(f, token, token ? 'ok' : tsState());
      if (r.status === 403 && r.j.error === 'turnstile' && token) {   // トークン不受理: 取り直して 1 回だけ再送。それでも駄目なら未検証として送る
        const codes = (r.j.codes || []).join(',');
        tsReset(); token = await tsWait(6000);
        r = await post(f, token, token ? 'retry:' + codes : 'rejected:' + codes);
        if (r.status === 403 && r.j.error === 'turnstile' && token) r = await post(f, '', 'rejected:' + ((r.j.codes || []).join(',') || codes));
      } else if (r.status === 0 || r.status >= 500) {   // 通信断・一時的な失敗: 1 回だけ再試行
        await sleep(1500); r = await post(f, token, token ? 'ok' : tsState());
      }
      if (r.status === 200 && r.j.ok) {
        try { history.replaceState({ step: 'done' }, '', '#sent'); } catch (err) {}
        if (doneNote) doneNote.hidden = r.j.confirmation !== false;   // 確認メールが送られなかった場合の注記
        form.reset(); show(stepDone); return;
      }
      try { console.warn('contact form: ' + (r.j.error || ('HTTP ' + r.status)) + ' ' + (r.j.stage || '') + ' ' + (r.j.detail || (r.j.codes || []).join(','))); } catch (e2) {}   // 原因調査用（本文・個人情報は含まない）
      if (r.j.error === 'validation') { sendStatus.textContent = '入力内容に確認が必要な項目があります。「修正する」から見直してください。'; sendBtn.disabled = false; return; }
      fallback(r.j.error === 'rate_limited' ? '短時間に多くの送信がありました。しばらく待ってから再度お試しいただくか、下の文面をメールでお送りください。'
        : '送信できませんでした。お手数ですが、下の文面をコピーするか「メールアプリで送る」からお送りください。', body);
    });
  }
})();
