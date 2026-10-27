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
    let px, py, psize, palpha, pphase, sprites = [], frameCost = [], skipChecked = false;
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
      // cand is already in row-major order (y outer, x inner): sample it evenly, no sort needed
      for (let i = 0; i < N; i++) { const k = Math.floor(i * M / N); out[i * 2] = cand[k * 2] - W / 2 + (rnd(i, 1) - 0.5) * 2.4; out[i * 2 + 1] = cand[k * 2 + 1] - H / 2 + (rnd(i, 2) - 0.5) * 2.4; }
      return out;
    }
    // the travel form: a thin vertical thread the cloud dissolves into while it moves between chapters
    function stream(len) {
      const out = new Float32Array(N * 2);
      const wobble = vw < 820 ? 1.2 : 2.2; for (let i = 0; i < N; i++) { const g = (rnd(i, 12) + rnd(i, 13) + rnd(i, 14) - 1.5) * 1.6; out[i * 2] = g * wobble; out[i * 2 + 1] = -len / 2 + len * (i / N) + (rnd(i, 15) - 0.5) * 6; }
      return out;
    }
    // the map: three points（今いる場所 → 最初の一歩 → 目的）joined by one track（正本 §10・§13: 紙の形ではなく、3 つの点が線で結ばれる軌道）
    function map(w, h) {
      const out = new Float32Array(N * 2), ax = w * 0.4, ay = h * 0.32;
      const P = [[-ax, ay], [0, -ay * 0.15], [ax, -ay]], dotR = Math.min(w, h) * 0.075, nDot = Math.floor(N * 0.16);
      for (let i = 0; i < N; i++) {
        const k = i % 3;
        if (i < nDot * 3) { const r = dotR * Math.pow(rnd(i, 31), 0.6), a = rnd(i, 32) * Math.PI * 2; out[i * 2] = P[k][0] + Math.cos(a) * r; out[i * 2 + 1] = P[k][1] + Math.sin(a) * r * 0.9; }
        else { const t = (i - nDot * 3) / (N - nDot * 3), seg = t < 0.5 ? 0 : 1, u = (t - seg * 0.5) * 2, g = (rnd(i, 33) + rnd(i, 34) + rnd(i, 35) - 1.5) * 2.4;
          out[i * 2] = P[seg][0] + (P[seg + 1][0] - P[seg][0]) * u + g * 0.6; out[i * 2 + 1] = P[seg][1] + (P[seg + 1][1] - P[seg][1]) * u + g * 1.6; }
      }
      return out;
    }
    const GEN = { infinity: (w, h) => lemniscate(w, h, 1), loop: (w, h) => lemniscate(w, h, 0.9), seed, ripple, line, map };
    const ALPHA = { seed: 0.85, line: 0.42, loop: 0.9, ripple: 0.9, map: 0.9 };
    const shapeFor = (word, w, h) => (GEN[word] ? GEN[word](w, h) : text(word, w, h));
    // shapes are sampled on first use (the chapter in view and the next one), the rest in idle time; identical sizes reuse the
    // sample, so a re-layout (fonts loaded, toolbar resize) costs nothing for the words that did not move
    const shapeCache = new Map();
    function shapeOf(k) {
      if (k.pts) return k.pts;
      const id = k.word + '|' + N + '|' + k.box.w + '|' + k.box.h; let p = shapeCache.get(id);
      if (!p) { if (shapeCache.size > 48) shapeCache.clear(); p = shapeFor(k.word, k.box.w, k.box.h); shapeCache.set(id, p); }
      k.pts = p; return p;
    }
    let warming = false;
    const idle = window.requestIdleCallback ? (f => window.requestIdleCallback(f, { timeout: 1500 })) : (f => setTimeout(f, 120));
    function warm() { const k = keys.find(k => !k.pts); if (!k) { warming = false; return; } shapeOf(k); idle(warm); }
    function startWarm() { if (warming) return; warming = true; idle(warm); }

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
        return { el, copy, word: w, box: r, cx: 0, cy: 0, kin: 0, kout: 0, soff: 0, pts: null, am: ALPHA[w] || 1 }; });
      const first = keys[0].box; alphaGlobal = clamp(Math.sqrt((first.w * first.h) / (520 * 390)), 0.6, 1);
      streamPts = stream(Math.min(vh * 0.62, 460));
      const loop = keys.find(k => k.word === 'loop'); streamLoop = stream(loop ? loop.box.h * 1.4 : Math.min(vh * 0.4, 300));
      measureKeys();
      if (!layout.done) { // first paint: gather into the first shape from a loose scatter (static when motion is reduced)
        layout.done = true; const k0 = keys[0], P0 = shapeOf(k0); const sc = reduce ? 0 : 1;
        for (let i = 0; i < N; i++) { px[i] = k0.cx + P0[i * 2] + (rnd(i, 21) - 0.5) * vw * 0.9 * sc; py[i] = k0.cy - window.scrollY + P0[i * 2 + 1] + (rnd(i, 22) - 0.5) * vh * 0.9 * sc; }
      }
      startWarm();
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
      // 語が溶けている間も本文は読める下限（0.35）を残す。2026-10-27 模擬ユーザー 2/2「章の間で止まると文字が薄くて読めない」
      k.copy.style.opacity = (clarity >= 0.999 ? 1 : 0.35 + 0.65 * clarity).toFixed(3); k.copy.style.transform = clarity >= 0.999 ? '' : `translateY(${((1 - clarity) * 14).toFixed(1)}px)`;
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
      const P = shapeOf(A), Q = B === A ? P : shapeOf(B), firstHalf = fa < 1 || fb === 0;
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
      // a slow device draws every second particle: decided after the first 24 frames, then re-checked every 90
      frameCost.push(performance.now() - t0); if (frameCost.length >= (skipChecked ? 90 : 24)) { const avg = frameCost.reduce((a, c) => a + c, 0) / frameCost.length; skip = avg > 9 ? 2 : 1; frameCost.length = 0; skipChecked = true; }
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
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { shapeCache.clear(); layout(); remember(); if (reduce) draw(performance.now()); });
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
     MAP — Home 章 3「あなたの地図」。選ぶたびに次の問いが現れ、揃ったら 目的／今いる場所／最初の一歩 を返す。
           文は事業正本（クリエイター正本 v1.0.1 §10・企業正本 v1.0.0 §13）のまま。
           「この内容で相談する」→ contact（ご用件と内容を sessionStorage で引き継ぐ。送るのは本人）。
     ================================================================ */
  const MAP_TEXT = {
    creator: {
      goal: { yes: '言葉にできている目的を、活動の順番にする。', no: 'まず、目指すものをあなたの言葉で確かめる。' },
      place: { 'yes:live': '場所は決まっている。費用ゼロのLIVE支援と、商品紹介・案件を重ねる段階。',
               'yes:post': '場所は決まっている。案件や商品の紹介、ファンへの直販で収益をつくる段階。',
               'no:live': 'LIVEから始める。合う場所と時間を決め、費用ゼロで立ち上げる段階。',
               'no:post': 'あなたに合う場所を先に決め、案件や商品の紹介から始める段階。' },
      step: { 'share:last': '企画・撮影・編集をREYZと分け、目標が変わっても続く進め方を決める。',
              'share:start': '企画・撮影・編集を、REYZと分ける。',
              'own:last': '目標が変わっても止まらない進め方を、AIと一緒に決める。',
              'own:start': 'どこで、何を、いつ出すかをAIと一緒に決める。' },
      type: '活動・収益化の相談', order: ['goal', 'place', 'style', 'make', 'value'] },
    company: {
      goal: { yes: '決まっている目的から逆算し、最短で届く手段と順番を決める。', no: 'まず、何を優先すれば一番利益が残るかを一緒に整理する。' },
      place: { media: '事業と表現をつなぐ段階。映像制作・SNS運用と、クリエイターとの販売設計を重ねる。',
               ops: '定型業務をAIと仕組みへ移し、最小の人数で最大の利益を生む体制をつくる段階。',
               abroad: '国内の基盤を固めながら、アジアへの越境販売と多言語での発信を設計する段階。' },
      step: { law: '公開前に4つの法令（ステマ規制・景表法・医療広告・薬機法）に照らして確認する流れを組み込み、判断の材料を揃える。',
              speed: '経営と現場が「はい」か「いいえ」で迷わず決められるよう、判断の材料を揃える。' },
      type: '目的の整理と進め方の相談', order: ['goal', 'focus', 'first'] }
  };
  const mapper = document.getElementById('mapper');
  if (mapper) {
    const groups = Array.from(mapper.querySelectorAll('.mq'));
    const card = document.getElementById('mapCard'), noteLive = document.getElementById('mapNoteLive');
    const screens = document.getElementById('mapScreens'); if (screens) { const h = screens.getAttribute('href'); screens.dataset.creator = h; screens.dataset.company = h.replace(/^creator(\.html)?#model$/, 'creative$1#decide'); }   // 本番は拡張子なし、試写は .html つき: 元の href から両方を組む
    const out = { goal: document.getElementById('mapGoal'), place: document.getElementById('mapPlace'), step: document.getElementById('mapStep') };
    const ans = {};
    // 文節（「、」「。」「）」の直後と「（」の直前）でだけ折り返す（build.py の jp() と同じ規則＋括弧）
    const phrase = (el, text) => { el.textContent = ''; for (const t of text.split(/(?<=[、。）])|(?=（)/)) { if (!t) continue; const sp = document.createElement('span'); sp.className = 'ph'; sp.textContent = t; el.append(sp); } };
    const groupOf = (q, aud) => groups.find(g => g.dataset.q === q && g.dataset.for === aud);
    const compose = () => {
      const who = ans.who, T = MAP_TEXT[who]; if (!T) return null;
      if (who === 'creator') {
        if (!(ans.goal && ans.place && ans.style && ans.make && ans.value)) return null;
        return { goal: T.goal[ans.goal], place: T.place[ans.place + ':' + ans.style], step: T.step[ans.make + ':' + ans.value], live: ans.style === 'live', type: T.type };
      }
      if (!(ans.goal && ans.focus && ans.first)) return null;
      return { goal: T.goal[ans.goal], place: T.place[ans.focus], step: T.step[ans.first], live: false, type: T.type };
    };
    const render = () => {
      const who = ans.who;
      for (const g of groups) { const aud = g.dataset.for; g.hidden = !(aud === 'all' || aud === who); }
      if (who) { const order = MAP_TEXT[who].order; let open = true;
        for (const q of order) { const g = groupOf(q, who); if (!g) continue; g.hidden = !open; if (open && !ans[q]) open = false; } }
      for (const g of groups) for (const b of g.querySelectorAll('.opt')) b.setAttribute('aria-pressed', String(ans[g.dataset.q] === b.dataset.v && (g.dataset.for === 'all' || g.dataset.for === who)));
      const r = compose(); mapper.dataset.done = r ? 'true' : 'false';
      if (r) { phrase(out.goal, r.goal); phrase(out.place, r.place); phrase(out.step, r.step); noteLive.hidden = !r.live; card.dataset.who = who; card.hidden = false;
        drawRoute(); card.classList.remove('is-live'); void card.offsetWidth; card.classList.add('is-live');   // 地図を引き直す（線が点を結んでいく）
        try { sessionStorage.setItem('reyz.map.r', JSON.stringify({ who, goal: r.goal, place: r.place, step: r.step })); } catch (err) { /* 保持できないときは見本の地図のまま */ }   // /creator・/creative の 1 画面目にそのまま入る
        if (screens) screens.setAttribute('href', who === 'company' ? screens.dataset.company : screens.dataset.creator);   // 地図 → その人の枝の 3 つの画面へ
        if (!render.shown) { render.shown = true; card.setAttribute('tabindex', '-1'); card.focus({ preventScroll: true });
          // 地図ができたことが分かるように、カードの頭まで送る（最後の答えの直下に出ると気づきにくい）
          const top = card.getBoundingClientRect().top + window.scrollY - 84; if (card.getBoundingClientRect().top > window.innerHeight * 0.55) window.scrollTo({ top, behavior: reduce ? 'instant' : 'smooth' }); } }
      else { card.hidden = true; card.classList.remove('is-live'); render.shown = false; }
    };
    // 地図の線: 3 つの点（今いる場所 → 最初の一歩 → 目的）の中心を 1 本の線で結ぶ。縦並びなら直線、階段状なら S 字で。脈（route-pulse）はこの線の上を走る
    const route = document.getElementById('mapRoute');
    function drawRoute() {
      if (!route || card.hidden) return;
      const svg = route.querySelector('.route-svg'), path = svg && svg.querySelector('path'); if (!path) return;
      const R = route.getBoundingClientRect(); if (R.width < 10) return;
      const pts = Array.from(route.querySelectorAll('.node .dot')).map(d => { const r = d.getBoundingClientRect(); return [r.left + r.width / 2 - R.left, r.top + r.height / 2 - R.top]; });
      if (pts.length < 2) return;
      svg.setAttribute('viewBox', `0 0 ${Math.round(R.width)} ${Math.round(R.height)}`);
      let d = `M${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
        if (Math.abs(x1 - x0) < 4) d += ` L${x1.toFixed(1)} ${y1.toFixed(1)}`;
        else { const cy = (y0 + y1) / 2; d += ` C${x0.toFixed(1)} ${cy.toFixed(1)}, ${x1.toFixed(1)} ${cy.toFixed(1)}, ${x1.toFixed(1)} ${y1.toFixed(1)}`; } }   // 点からは縦に出て、縦に入る（文字の上を横切らない）
      path.setAttribute('d', d); const len = path.getTotalLength(); path.style.setProperty('--len', len.toFixed(1));
      const pulse = svg.querySelector('.route-pulse'); if (pulse) { const am = pulse.querySelector('animateMotion'); if (am) { const nu = am.cloneNode(true); am.replaceWith(nu); } }   // 線が変わったら脈も新しい線に乗せ直す
      if (reduce) { try { svg.pauseAnimations(); } catch (err) { /* 古い環境では無視 */ } }
    }
    let routeT = 0; window.addEventListener('resize', () => { clearTimeout(routeT); routeT = setTimeout(drawRoute, 150); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawRoute);
    mapper.addEventListener('click', e => {
      const b = e.target.closest('.opt'); if (!b) return; const g = b.closest('.mq'); const q = g.dataset.q;
      if (q === 'who' && ans.who !== b.dataset.v) { for (const k of Object.keys(ans)) delete ans[k]; }
      else if (ans[q] !== b.dataset.v) { const order = MAP_TEXT[ans.who] ? MAP_TEXT[ans.who].order : []; const i = order.indexOf(q); for (const k of order.slice(i + 1)) delete ans[k]; }
      ans[q] = b.dataset.v; render();
    });
    const reset = document.getElementById('mapReset'); if (reset) reset.addEventListener('click', () => { for (const k of Object.keys(ans)) delete ans[k]; try { sessionStorage.removeItem('reyz.map.r'); } catch (err) { /* 無視 */ } render(); const first = groups[0].querySelector('.opt'); if (first) first.focus({ preventScroll: true }); });
    const go = document.getElementById('mapGo'); if (go) go.addEventListener('click', () => {
      const r = compose(); if (!r) return;
      const body = '【あなたの地図（ホームで選んだ内容）】\n目的: ' + r.goal + '\n今いる場所: ' + r.place + '\n最初の一歩: ' + r.step;
      try { sessionStorage.setItem('reyz.map', JSON.stringify({ type: r.type, body })); } catch (err) { /* 引き継げないときは空のフォームへ */ }
    });
    render();
  }

  /* ================================================================
     INSTRUMENTS — 2026-10-26 G-UX8「点・線・記録」: 文で説明せず、仕組みそのものを目の前で動かす。
       bend（続く）: 画面に入ったら線が引かれる。check（確認）: 複数の AI が確かめ → 人が決める → 記録。2 回目は一致せず止まる。
       motion 抑制時は完成した状態を静止表示。
     ================================================================ */
  const live = el => el.classList.add('is-live');
  const ioLive = ('IntersectionObserver' in window) ? new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) { live(e.target); ioLive.unobserve(e.target); } }, { threshold: 0.35 }) : null;
  for (const el of document.querySelectorAll('.bend')) { if (reduce) { live(el); const svg = el.querySelector('svg'); if (svg) { try { svg.pauseAnimations(); } catch (err) { /* 無視 */ } } } else if (ioLive) ioLive.observe(el); else live(el); }
  // 見本（3 つの画面・映像の型）は画面に入ったら 1 回だけ動き、そのまま止まる。タップでもう一度
  const replay = el => { el.classList.remove('is-live'); void el.offsetWidth; el.classList.add('is-live'); };
  for (const el of document.querySelectorAll('.showcase')) { if (reduce) live(el); else if (ioLive) ioLive.observe(el); else live(el); el.addEventListener('click', () => { if (!reduce) replay(el); }); }
  for (const check of document.querySelectorAll('.check')) {
    const lanes = Array.from(check.querySelectorAll('.lane')), human = check.querySelector('.check-human'), rec = check.querySelector('.check-rec');
    let timers = [], running = false, runIdx = 0;
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    const clear = () => { for (const t of timers) clearTimeout(t); timers = []; for (const l of lanes) l.classList.remove('on', 'ok', 'ng'); human.classList.remove('on', 'stop'); rec.classList.remove('on'); check.dataset.run = ''; };
    const done = () => { clear(); for (const l of lanes) l.classList.add('on', 'ok'); human.classList.add('on'); rec.classList.add('on'); check.dataset.run = 'done'; };
    const run = () => {
      clear(); const ng = runIdx % 2 === 1; runIdx++; check.dataset.run = ng ? 'stop' : 'go';
      lanes.forEach((l, i) => { at(200 + i * 280, () => l.classList.add('on')); at(950 + i * 280, () => l.classList.add(ng && i === 1 ? 'ng' : 'ok')); });
      if (ng) { at(2200, () => human.classList.add('stop')); at(5400, run); }
      else { at(2200, () => human.classList.add('on')); at(3000, () => rec.classList.add('on')); if (runIdx < 3) at(6400, run); }   // 通る → 止まる → 通る、で止まる（タップでもう一度）
    };
    if (reduce || !('IntersectionObserver' in window)) done();
    else {
      const io = new IntersectionObserver(es => { for (const e of es) { if (e.isIntersecting && !running) { running = true; runIdx = 0; run(); } else if (!e.isIntersecting && running) { running = false; done(); } } }, { threshold: 0.3 });
      io.observe(check); check.addEventListener('click', () => { if (running) { runIdx = 0; run(); } });
    }
  }

  /* ================================================================
     DEMOS — 2026-10-27 CEO「体験イメージを持てるか」: 3 つの画面を 1 台で実際に触る（設計上の見本）。
       creator（/creator）: 地図（Home で作ったもの）→ 入口で「受ける」→ 明細に並ぶ（報酬から引かない: 手数料 0・費用 0）。
       company（/creative）: 地図 → 確認（例を選ぶ → 提供元の異なる複数の AI → 一致しないものは止まる → 直して再確認 → 人が はい／いいえ）→ 記録に 1 行。
       文は正本のまま。名前・社名・金額は置かない。motion 抑制時は待たずに結果を出す。
     ================================================================ */
  for (const demo of document.querySelectorAll('.demo')) {
    const who = demo.dataset.demo, tabs = Array.from(demo.querySelectorAll('.tab')), panes = Array.from(demo.querySelectorAll('.pane'));
    const echo = demo.parentElement.querySelector('.echo'), ECHO = who === 'creator' ? { map: '地図から、始める。', gate: '受けるかは、あなた。', stmt: '報酬から、引かない。' } : { map: '目的から、逆算。', check: '選ぶと、動く。', go: '確かめている。', stop: '止まる。', pass: '通る。', rec: '残る。' };
    const say = k => { if (!echo || !ECHO[k]) return; echo.textContent = ECHO[k]; echo.classList.remove('is-live'); void echo.offsetWidth; echo.classList.add('is-live'); };
    const badge = (key, n) => { const t = tabs.find(x => x.dataset.t === key); const b = t && t.querySelector('.n'); if (!b) return; b.textContent = String(n); b.hidden = n === 0; };
    const show = (key, focus) => {
      for (const t of tabs) { const on = t.dataset.t === key; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; if (on) t.classList.add('seen'); }
      for (const p of panes) { const on = p.dataset.p === key; p.hidden = !on; if (on) { p.classList.remove('is-live'); void p.offsetWidth; p.classList.add('is-live'); if (focus) p.focus({ preventScroll: true }); } }
      demo.dataset.pane = key; say(key);
    };
    demo.addEventListener('click', e => {
      const t = e.target.closest('.tab'); if (t) { show(t.dataset.t); return; }
      const n = e.target.closest('[data-next]'); if (n) { if (n.dataset.reset && demo.resetCheck) demo.resetCheck(); show(n.dataset.next, true); }
    });
    const list = demo.querySelector('.tabs'); if (list) list.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
      const i = tabs.findIndex(t => t.getAttribute('aria-selected') === 'true'); let j = i;
      if (e.key === 'ArrowRight') j = (i + 1) % tabs.length; else if (e.key === 'ArrowLeft') j = (i - 1 + tabs.length) % tabs.length; else if (e.key === 'Home') j = 0; else j = tabs.length - 1;
      show(tabs[j].dataset.t); tabs[j].focus(); e.preventDefault();
    });
    // 最後の画面 → 相談: Home で作った地図があれば、ご用件と内容に引き継ぐ（相談用の 'reyz.map'。送るのは本人）
    let carried = null;
    for (const a of demo.querySelectorAll('a.consult')) a.addEventListener('click', () => {
      const type = MAP_TEXT[who === 'creator' ? 'creator' : 'company'].type;   // ご用件は Home の地図と同じ
      const body = carried ? '【あなたの地図（ホームで選んだ内容）】\n目的: ' + carried.goal + '\n今いる場所: ' + carried.place + '\n最初の一歩: ' + carried.step : '';
      try { sessionStorage.setItem('reyz.map', JSON.stringify({ type, body })); } catch (err) { /* 引き継げないときは空のフォームへ */ }
    });
    // 1 画面目: Home で作った地図があれば、見本の地図と入れ替える
    try { const raw = sessionStorage.getItem('reyz.map.r'); if (raw) { const m = JSON.parse(raw); if (m && m.who === who && m.goal && m.place && m.step) { carried = m;
      const id = who === 'creator' ? 'dm' : 'dn'; const put = (k, v) => { const el = document.getElementById(id + k); if (el) el.textContent = v; };
      put('Place', m.place); put('Step', m.step); put('Goal', m.goal); put('From', 'ホームで作った、あなたの地図。'); const from = document.getElementById(id + 'From'); if (from) from.hidden = false; const home = document.getElementById(id + 'Home'); if (home) home.hidden = true; demo.classList.add('has-map'); ECHO.map = 'あなたの地図。'; } } } catch (err) { /* 見本の地図のまま */ }
    say('map');
    if (who === 'creator') {
      // 入口 → 明細: 「受ける」を押したものだけが明細に並ぶ（押し直すと外れる）
      const rows = document.getElementById('dmRows'), sum = document.getElementById('dmSum'), takes = Array.from(demo.querySelectorAll('.take'));
      const draw = () => {
        const on = takes.filter(b => b.getAttribute('aria-pressed') === 'true'); rows.textContent = '';
        if (!on.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = '入口で「受ける」と、ここに並ぶ。'; rows.append(li); }
        for (const b of on) { const li = document.createElement('li'); const name = document.createElement('b'); name.textContent = b.dataset.k;
          const bar = document.createElement('span'); bar.className = 'scr-bar' + (b.dataset.v === 'full' ? ' full' : ''); bar.append(document.createElement('i'));
          const em = document.createElement('em'); em.textContent = b.dataset.v === 'full' ? '手数料 0' : '費用 0'; li.append(name, bar, em); rows.append(li); }
        sum.hidden = !on.length; badge('stmt', on.length);
      };
      for (const b of takes) b.addEventListener('click', () => { const now = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(now)); b.textContent = now ? '受けた' : '受ける'; draw(); });
      demo.resetCheck = () => { for (const b of takes) { b.setAttribute('aria-pressed', 'false'); b.textContent = '受ける'; } draw(); };   // 「最初から」: 受けたものも戻す
      draw();
    } else {
      // 確認: 例を選ぶ → 3 つの AI が確かめる → 一致しなければ止まる（理由を添える）→ 直して再確認 → 人が決める → 記録に 1 行
      const S = {
        pr:   { name: '#PR をつけた、新商品の紹介', phrase: '#PR', rule: 'ステマ告示', ng: [] },
        no1:  { name: '「業界No.1」と書いた紹介', phrase: '業界No.1', rule: 'No.1表示の4要件', ng: [1, 2], why: 'No.1の根拠が示されていない', fix: 'No.1（調査名・時期・対象を添える）' },
        cure: { name: '「必ず効く」と書いた紹介', phrase: '必ず効く', rule: '薬機法第66条・健康増進法', ng: [0, 1, 2], why: '効果を断定している', fix: '効果を断定しない表現に' } };
      const lanes = Array.from(demo.querySelectorAll('.lane')), laneBox = document.getElementById('deLanes'), post = document.getElementById('dePost'), phrase = document.getElementById('dePhrase'), fixed = document.getElementById('deFixed');
      const verdict = document.getElementById('deVerdict'), vb = document.getElementById('deV'), why = document.getElementById('deWhy'), fixBtn = document.getElementById('deFix'), human = document.getElementById('deHuman'), rec = document.getElementById('deRec');
      let timers = [], cur = null, fixedNow = false, count = 0;
      const at = (ms, fn) => { if (reduce) fn(); else timers.push(setTimeout(fn, ms)); };
      const clear = () => { for (const t of timers) clearTimeout(t); timers = []; for (const l of lanes) l.classList.remove('on', 'ok', 'ng'); verdict.hidden = true; vb.textContent = ''; why.textContent = ''; fixBtn.hidden = true; human.hidden = true; };
      const run = () => {
        const d = S[cur], ng = fixedNow ? [] : d.ng; clear(); laneBox.hidden = false; demo.dataset.run = 'go'; say('go');
        lanes.forEach((l, i) => { at(200 + i * 280, () => l.classList.add('on')); at(900 + i * 280, () => l.classList.add(ng.includes(i) ? 'ng' : 'ok')); });
        at(2000, () => { verdict.hidden = false;
          if (ng.length) { demo.dataset.run = 'stop'; say('stop'); vb.textContent = (ng.length === lanes.length ? '3つのAIが×。' : '一致しない。') + '止まりました。'; why.textContent = d.why + '（' + d.rule + '）。'; fixBtn.hidden = false; }
          else { demo.dataset.run = 'pass'; say('pass'); vb.textContent = '3つのAIが一致。通りました。'; why.textContent = fixedNow ? '直した表現で、もう一度確かめました。' : d.rule + 'に照らしました。'; human.hidden = false; } });
      };
      demo.resetCheck = () => { clear(); cur = null; fixedNow = false; demo.dataset.run = ''; post.hidden = true; laneBox.hidden = true; for (const b of demo.querySelectorAll('.sample')) b.setAttribute('aria-pressed', 'false'); };
      for (const b of demo.querySelectorAll('.sample')) b.addEventListener('click', () => {
        cur = b.dataset.s; fixedNow = false; for (const x of demo.querySelectorAll('.sample')) x.setAttribute('aria-pressed', String(x === b));
        phrase.textContent = S[cur].phrase; phrase.classList.remove('cut'); fixed.hidden = true; post.hidden = true; void post.offsetWidth; post.hidden = false; run();
      });
      fixBtn.addEventListener('click', () => { if (!cur) return; fixedNow = true; phrase.classList.add('cut'); fixed.textContent = S[cur].fix; fixed.hidden = false; run(); });
      for (const b of human.querySelectorAll('[data-d]')) b.addEventListener('click', () => {
        if (!cur) return; const d = S[cur]; const now = new Date(), hh = String(now.getHours()).padStart(2, '0'), mm = String(now.getMinutes()).padStart(2, '0');
        const empty = rec.querySelector('.empty'); if (empty) empty.remove();
        const li = document.createElement('li'); li.className = 'new';
        const what = document.createElement('b'); what.textContent = d.name;
        const when = document.createElement('span'); when.className = 'when'; when.textContent = hh + ':' + mm;
        const how = document.createElement('span'); how.className = 'how';
        how.append(d.rule + ' ・ AI ' + (d.ng.length ? '止まった → 直して通った' : '通った') + ' ・ 人 '); const em = document.createElement('em'); em.textContent = b.dataset.d; how.append(em);
        li.append(what, when, how); rec.prepend(li); count++; badge('rec', count);
        demo.resetCheck(); show('rec', true);
      });
    }
  }

  /* ================================================================
     WORKS — YouTube はクリックまで iframe を読み込まない（サムネイル＋再生マーク）。再生中は1本だけ。
             mp4 はファイルが無ければ自ら非表示
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
    const LABELS = { name: 'お名前', person: 'ご担当者', email: 'メールアドレス', type: 'ご用件', msg: '内容' };
    // Home 章 3「あなたの地図」から来たとき: ご用件と内容を引き継ぐ（本人が確認して送る。引き継いだら消す）
    try { const raw = sessionStorage.getItem('reyz.map'); if (raw) { const m = JSON.parse(raw); sessionStorage.removeItem('reyz.map');
      const sel = $('cType'); if (m.type && Array.from(sel.options).some(o => o.textContent === m.type)) sel.value = m.type;
      const msg = $('cMsg'); if (m.body && !msg.value) msg.value = m.body + '\n\n'; } } catch (err) { /* 引き継ぎなし */ }
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
    const text = f => '[REYZ お問い合わせ]\nご用件: ' + f.type + '\nお名前: ' + f.name + (f.person ? '\nご担当者: ' + f.person : '') + '\nメール: ' + f.email + '\n内容:\n' + f.msg;
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
      render();   // api.js は async/defer で読み込むため turnstile.ready() は使えない（呼ぶと例外）。onload 後なので直接描画する
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
        try { await navigator.clipboard.writeText(body); fallback('この環境からは送信できないため、文面をコピーしました。' + note, body); }
        catch (err) { fallback('この環境からは送信できません。下の文面をコピーして' + note, body); copyArea.focus(); copyArea.select(); }
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
        if (doneNote) doneNote.hidden = !(r.j.verified === false || r.j.confirmation === false);   // 未検証受付、または確認メールが送れなかった場合の注記
        form.reset(); show(stepDone); return;
      }
      try { console.warn('contact form: ' + (r.j.error || ('HTTP ' + r.status)) + ' ' + (r.j.stage || '') + ' ' + (r.j.detail || (r.j.codes || []).join(','))); } catch (e2) {}   // 原因調査用（本文・個人情報は含まない）
      if (r.j.error === 'validation') { sendStatus.textContent = '入力内容に確認が必要な項目があります。「修正する」から見直してください。'; sendBtn.disabled = false; return; }
      fallback(r.j.error === 'rate_limited' ? '短時間に多くの送信がありました。しばらく待ってから再度お試しいただくか、下の文面をメールでお送りください。'
        : '送信できませんでした。お手数ですが、下の文面をコピーするか「メールアプリで送る」からお送りください。', body);
    });
  }
})();
