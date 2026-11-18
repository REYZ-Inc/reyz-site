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
      if (notify) {
        root.dataset.userSelected = 'true';
        root.dispatchEvent(new CustomEvent('reyz:incomechange', { bubbles: true, detail: {
          id: choice.dataset.income, label: choice.querySelector('b')?.textContent || '', href: route.href,
        } }));
      }
    };
    for (const choice of choices) choice.addEventListener('click', () => select(choice));
    select(choices[active], false);
    if (scene) root.classList.add('is-ready');
  }

  // Keep the detailed review optional, while preserving direct links and real maps.
  const workflow = document.querySelector('details.workflow-detail');
  const openWorkflow = (panel, scroll = false) => {
    if (!workflow) return;
    workflow.open = true;
    if (panel) document.querySelector('#demoE .tab[data-t="' + panel + '"]')?.click();
    if (scroll) requestAnimationFrame(() => workflow.scrollIntoView({ block: 'start', behavior: 'instant' }));
  };
  for (const link of document.querySelectorAll('[data-open-check]')) link.addEventListener('click', () => openWorkflow('check'));
  for (const link of document.querySelectorAll('[data-open-map]')) link.addEventListener('click', () => openWorkflow('map'));
  const revealLinkedWorkflow = () => {
    if (location.hash === '#decide') openWorkflow(null, true);
  };
  for (const link of document.querySelectorAll('a[href="#decide"]')) link.addEventListener('click', () => openWorkflow(null));
  window.addEventListener('hashchange', revealLinkedWorkflow);
  revealLinkedWorkflow();
  const contactTypes = {
    creator: '活動・収益化の相談', creative: '目的の整理と進め方の相談',
    ai: 'AIを仕事に入れる（REYZ PLATFORM）', consensus: '公開前の確認と記録（REYZ CONSENSUS）',
  };
  for (const link of document.querySelectorAll('[data-consult-page], a.consult')) link.addEventListener('click', () => {
    const page = document.body.dataset.page;
    const type = contactTypes[page];
    if (!type) return;
    let body = '', map = null;
    try {
      map = JSON.parse(sessionStorage.getItem('reyz.map.r') || 'null');
    } catch (_) { /* An unreadable previous map must not override this page's contact type. */ }
    const who = page === 'creator' ? 'creator' : page === 'creative' ? 'company' : '';
    if (who && map?.who === who && [map.goal, map.place, map.step].every(value => typeof value === 'string' && value.length > 0)) {
      body = '【あなたの地図（ホームで選んだ内容）】\n目的: ' + map.goal + '\n今いる場所: ' + map.place + '\n最初の一歩: ' + map.step + (typeof map.conversation === 'string' ? map.conversation : '');
    }
    if (page === 'creator') {
      const choices = [], paths = document.querySelector('[data-paths]'), income = document.querySelector('[data-income-experience]');
      if (paths && (paths.dataset.userSelected === 'true' || link.closest('#path'))) {
        const goal = paths.querySelector('.path-goal[aria-pressed="true"]');
        if (goal) choices.push('相談したい目的: ' + goal.textContent.trim());
      }
      if (income?.dataset.userSelected === 'true') {
        const choice = income.querySelector('.income-choice[aria-pressed="true"] b');
        if (choice) choices.push('関心のある収益経路: ' + choice.textContent.trim());
      }
      if (choices.length) body += (body ? '\n\n' : '') + '【このページで選んだ内容】\n' + choices.join('\n');
    }
    try {
      sessionStorage.setItem('reyz.map', JSON.stringify({ type, body }));
    } catch (_) { /* The contact form remains usable when browser storage is unavailable. */ }
  });
})();

/* 2026-11-18 — 目的から道を選ぶ / 利益を残す（損益分岐） / 起きたことに自動で応える。
   押す・動かすで次が出るだけの小さな切替。通信しない。保存しない。数字は読み手の入力と公開している利用料だけから計算する。 */
(() => {
  'use strict';
  const pick = (root, buttonSelector, panelSelector, key, after) => {
    const buttons = Array.from(root.querySelectorAll(buttonSelector));
    const panels = Array.from(root.querySelectorAll(panelSelector));
    const show = value => {
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset[key] === value));
      for (const p of panels) p.classList.toggle('is-on', p.dataset[key] === value);
      if (after) after(panels.find(p => p.dataset[key] === value));
    };
    for (const b of buttons) b.addEventListener('click', () => { root.dataset.userSelected = 'true'; show(b.dataset[key]); });
    const first = buttons.find(b => b.getAttribute('aria-pressed') === 'true') || buttons[0];
    if (first) show(first.dataset[key]);
  };

  for (const root of document.querySelectorAll('[data-paths]')) pick(root, '.path-goal', '.path-card', 'goal');

  for (const root of document.querySelectorAll('[data-guard]')) {
    const dots = Array.from(root.querySelectorAll('.guard-line li'));
    pick(root, '.guard-b', '.guard-res', 'ev', panel => {
      for (const d of dots) d.classList.toggle('is-at', !!panel && d.dataset.s === panel.dataset.at);
    });
  }

  // 利用料: 月額 50,000 円（20 本まで）＋ 21 本目から 1 本 1,250 円
  const FEE_BASE = 50000, FEE_INCLUDED = 20, FEE_OVER = 1250;
  const yen = n => Math.round(n).toLocaleString('ja-JP');
  for (const root of document.querySelectorAll('[data-gain]')) {
    const $ = id => root.querySelector('#' + id);
    const n = $('gainN'), m = $('gainM'), w = $('gainW');
    if (!n || !m || !w) continue;
    const update = () => {
      const count = Number(n.value), minutes = Number(m.value), wage = Number(w.value);
      const hours = count * minutes / 60, cost = hours * wage;
      const fee = FEE_BASE + FEE_OVER * Math.max(0, count - FEE_INCLUDED);
      const even = Math.ceil(fee * 60 / (count * wage));
      $('gainNo').textContent = count + '本'; $('gainMo').textContent = minutes + '分'; $('gainWo').textContent = yen(wage) + '円';
      $('gainNow').textContent = '月' + (Number.isInteger(hours) ? hours : hours.toFixed(1)) + '時間・' + yen(cost) + '円';
      $('gainFee').textContent = '月' + yen(fee) + '円';
      root.style.setProperty('--fee', Math.min(100, fee / cost * 100) + '%');
      root.style.setProperty('--even', Math.min(100, even / minutes * 100) + '%');
      // Feasibility uses the unrounded cost. A rounded minute threshold can equal
      // the current time even when the actual threshold is lower (65 × 20 × 5k).
      const equal = Math.abs(fee - cost) < 0.005;
      const possible = fee < cost || equal;
      const value = document.createElement('span'); value.className = 'gain-amount';
      const explanation = document.createElement('span'); explanation.className = 'gain-note';
      value.textContent = equal ? '全' + minutes + '分／本' : possible ? '約' + even + '分／本' : '利用料に届きません';
      explanation.textContent = equal ? '現在の作業時間をすべて削減すると、利用料と同額です。'
        : possible ? '利用料に相当する削減時間。分単位で切り上げています。'
        : '現在の作業時間をすべて削減しても、利用料を下回ります。';
      $('gainEven').classList.toggle('is-unreachable', !possible);
      $('gainEven').replaceChildren(value, explanation);
    };
    for (const input of [n, m, w]) input.addEventListener('input', update);
    update();
  }
})();

/* One illustrative case. No network, persistence, payment or real approval.
   Viewing a later stage never changes the evidence or completes a task. */
(() => {
  'use strict';
  for (const root of document.querySelectorAll('[data-cycle]')) {
    const $ = id => root.querySelector('#' + id);
    const steps = Array.from(root.querySelectorAll('[data-cycle-step]'));
    const next = $('cycleNext');
    let state;
    const key = () => state.asset + ':' + state.terms;
    const active = () => ['requested', 'unknown', 'confirmed', 'stop-pending'].includes(state.publication);
    const record = text => {
      state.history.push(text);
      state.history = state.history.slice(-14);
    };
    const reset = () => {
      state = { step: 0, asset: 1, terms: 1, days: 30, approval: null,
        publication: 'none', publishedKey: null, result: false, statement: false,
        expired: false, changed: false, notice: '工程を選ぶと、その段階で任せることと、決めることが見えます。',
        history: ['企画の整理から開始（見本）'] };
      render();
    };
    const stages = [
      ['01 / PLAN', 'やることと、決めることを。', '目的、制作物、担当、使う場所。最初の地図で、仕事の全体をそろえます。', 'REYZ：進め方と判断の材料を整理 ／ お客様：目的と条件を決める'],
      ['02 / CREATE + CHECK', '出すものと、使い方を確かめる。', '素材、表現、利用条件をそろえ、どの版に承認したかを残します。条件が変われば、その承認を取り直します。', 'REYZ：制作と確認の流れを整理 ／ お客様：対象の版と条件を承認する'],
      ['03 / PUBLISH', '指示した。と、終わった。を分ける。', '公開の要求と、公開されたことの確認を分けます。結果が分からない間は、同じ要求を重ねません。', 'REYZ：実行状況と結果の確認を追う ／ お客様：契約で決めた範囲を判断する'],
      ['04 / MEASURE', '届けた、その先を見る。', '公開した素材と結果を同じ案件へ。取れていない数値は未取得と示し、取得した結果と混ぜません。', 'REYZ：取得できる結果を照合 ／ お客様：結果を見て次の施策を決める'],
      ['05 / RECORD', '仕事の終わりを、次の始まりに。', '条件、承認、実行の記録、結果、費用と報酬の明細。同じ案件として振り返り、次の仕事につなぎます。', 'REYZ：記録と明細を整理 ／ お客様：内容を確認し、支払いを決める'],
    ];
    function render() {
      const approved = state.approval === key();
      const row = stages[state.step];
      $('cycleKicker').textContent = row[0]; $('cycleTitle').textContent = row[1];
      $('cycleCopy').textContent = row[2]; $('cycleOwner').textContent = row[3];
      $('cycleVersion').textContent = 'v' + state.asset;
      $('cycleTerms').textContent = state.days + '日・条件版 ' + state.terms + (state.expired ? '（期限到来）' : approved ? '（見本で合意）' : '（合意前）');
      $('cycleApproval').textContent = approved ? 'v' + state.asset + '・条件版 ' + state.terms + ' を承認（見本）' : state.changed ? '以前の承認は失効・再確認待ち' : '未承認';
      const publication = { none: '未実行', requested: '公開要求済み・確認待ち', unknown: '公開結果が未確認・再送しない', confirmed: '公開確認済み（見本）', 'stop-pending': '停止未確認・完了にしない', stopped: '停止確認済み（見本）' };
      $('cyclePublication').textContent = publication[state.publication];
      $('cycleOutcome').textContent = state.statement ? '結果の取込・明細の照合済み（見本）' : state.result ? '結果の取込済み・明細の照合待ち（見本）' : '未取得・未確定';
      $('cycleResult').textContent = state.notice;
      $('cycleStatus').textContent = state.publication === 'stop-pending' ? '停止未確認' : state.publication === 'unknown' ? '結果未確認' : state.expired ? '期限終了・条件更新待ち' : state.statement ? '明細まで確認（見本）' : state.changed && !approved ? '再承認待ち' : ['企画を整理', '素材と条件を確認', '公開の確認', '結果を確認', '明細を確認'][state.step];
      root.dataset.state = state.publication === 'stop-pending' || state.publication === 'unknown' ? 'pending' : state.expired ? 'changed' : state.statement ? 'complete' : state.changed && !approved ? 'changed' : 'brief';
      root.dataset.step = String(state.step);
      for (const b of steps) b.setAttribute('aria-pressed', String(Number(b.dataset.cycleStep) === state.step));
      next.disabled = false;
      if (state.publication === 'stop-pending') next.textContent = '停止を確認する（見本）';
      else if (state.expired && state.publication === 'stopped') { next.textContent = '利用条件の更新が必要です'; next.disabled = true; }
      else if (state.step === 0) next.textContent = '制作・確認へ';
      else if (state.step === 1) next.textContent = approved ? '公開の確認へ' : 'この版と条件を承認する（見本）';
      else if (state.step === 2) next.textContent = !approved ? '素材と条件を確認する' : ['requested', 'unknown'].includes(state.publication) ? '公開の結果を確認する（見本）' : state.publication === 'confirmed' ? '結果の確認へ' : '公開を要求する（見本）';
      else if (state.step === 3) next.textContent = state.publication === 'confirmed' ? '結果を取り込む（見本）' : '公開の状態を確かめる';
      else next.textContent = state.statement ? 'もう一度体験する' : state.result ? '明細を照合する（見本）' : '結果の確認へ';
      const expire = root.querySelector('[data-cycle-action="expire"]');
      const network = root.querySelector('[data-cycle-action="network"]');
      expire.disabled = !active() || state.expired;
      network.disabled = state.publication !== 'requested';
      expire.title = expire.disabled ? '公開を要求した後に試せます' : '';
      network.title = network.disabled ? '公開を要求し、確認する前に試せます' : '';
      const history = $('cycleHistory'); history.replaceChildren();
      for (const text of state.history) { const li = document.createElement('li'); li.textContent = text; history.append(li); }
      const preview = $('cyclePreview');
      if (preview) {
        const src = state.asset % 2 ? 'assets/editorial/creator-film.webp' : 'assets/editorial/production-editorial-20261119.webp';
        if (preview.getAttribute('src') !== src) preview.src = src;
      }
      const caption = $('cycleMediaCaption'); if (caption) caption.textContent = state.asset % 2 ? '素材イメージ' : 'AI生成イメージ';
      const badge = $('cycleScreenVersion'); if (badge) badge.textContent = 'v' + state.asset;
    }
    function advance() {
      if (state.publication === 'stop-pending') {
        state.publication = 'stopped'; state.publishedKey = null;
        state.notice = state.expired
          ? '期限が終了した素材の停止を確認しました。再開する場合は「利用条件を変える」で条件を更新し、あらためて確認・承認します。'
          : '停止の確認が取れました。新しい素材や条件は、あらためて確認・承認してから進めます。';
        record('停止の確認を記録（見本）'); state.step = state.expired ? 4 : 1;
      } else if (state.expired) return;
      else if (state.step === 0) { state.step = 1; state.notice = '同じ案件の素材と条件を確認します。まだ公開は行いません。'; }
      else if (state.step === 1) {
        state.approval = key(); state.step = 2;
        state.notice = 'v' + state.asset + ' と条件版 ' + state.terms + ' への承認を記録しました。公開の要求とは別です。';
        record('v' + state.asset + '・条件版 ' + state.terms + ' を承認（見本）');
      } else if (state.step === 2) {
        if (state.approval !== key()) { state.step = 1; state.notice = 'この版・条件への承認が必要です。以前の承認は使いません。'; }
        else if (['requested', 'unknown'].includes(state.publication)) {
          state.publication = 'confirmed'; state.publishedKey = key(); state.step = 3;
          state.notice = '公開の確認を記録しました。次は、この素材に対応する結果を確認します。'; record('公開の確認を記録（見本）');
        } else if (state.publication === 'confirmed') state.step = 3;
        else { state.publication = 'requested'; state.notice = '公開を要求した段階です。結果を確認するまでは、公開済みにしません。'; record('公開を要求・結果の確認待ち（見本）'); }
      } else if (state.step === 3) {
        if (state.publication !== 'confirmed') { state.step = 2; state.notice = 'まず公開されたことを確認します。未確認の結果は埋めません。'; }
        else { state.result = true; state.step = 4; state.notice = '結果の取り込みを体験しました。売上や再生数の実績を示すものではありません。'; record('公開素材に対応する結果を取り込む（見本）'); }
      } else if (state.statement) { reset(); return; }
      else if (!state.result) { state.step = 3; state.notice = '結果の確認と、明細の照合を分けて進めます。'; }
      else { state.statement = true; state.notice = '条件から明細までが同じ案件に残ります。この見本から支払いは行われません。'; record('条件と費用・報酬の明細を照合（見本）'); }
      render();
    }
    root.addEventListener('click', e => {
      const step = e.target.closest('[data-cycle-step]');
      if (step) { state.step = Number(step.dataset.cycleStep); render(); return; }
      const button = e.target.closest('[data-cycle-action]'); if (!button || button.disabled) return;
      const action = button.dataset.cycleAction;
      if (action === 'reset') { reset(); return; }
      if (action === 'next') { advance(); return; }
      if (action === 'asset' || action === 'terms') {
        if (action === 'asset') state.asset++;
        else { state.terms++; state.days = state.days === 30 ? 60 : 30; state.expired = false; }
        const wasActive = active();
        state.approval = null; state.result = false; state.statement = false; state.changed = true; state.step = 1;
        if (wasActive) state.publication = 'stop-pending';
        state.notice = (action === 'asset' ? '素材が変わったため、以前の版への承認は失効しました。' : '利用条件が変わったため、以前の条件への承認は失効しました。') + (state.expired
          ? '利用期限も終了しています。停止を確認後、「利用条件を変える」で条件を更新してください。'
          : wasActive ? 'まず旧条件の停止を確認し、新しい承認を取り直します。' : '必要な確認から続け、承認を取り直します。');
        record((action === 'asset' ? '素材を v' + state.asset + ' に差し替え' : '条件版 ' + state.terms + ' に変更') + '・承認失効（見本）');
      } else if (action === 'expire') {
        state.expired = true; state.approval = null; state.publication = 'stop-pending'; state.step = 2;
        state.notice = '利用期限に達しました。停止要求を出しただけでは完了にせず、停止が確認できるまで追います。'; record('期限到来・停止未確認（見本）');
      } else if (action === 'network') {
        state.publication = 'unknown'; state.step = 2;
        state.notice = '要求のあとに通信が途切れました。公開結果が分かるまで、同じ要求を送り直しません。'; record('通信断・公開結果未確認（見本）');
      }
      render();
    });
    reset();
  }
})();

/* Self-hosted editorial footage. The poster is the first render; media stays
   unloaded until visible or explicitly played. Every automatic action is local. */
(() => {
  'use strict';
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  for (const root of document.querySelectorAll('[data-editorial], [data-brand-film]')) {
    const video = root.querySelector('video[data-editorial-video], video[data-brand-video]');
    const button = root.querySelector('[data-editorial-toggle], [data-brand-toggle]');
    if (!video || !button) continue;
    let visible = false, manuallyPaused = false, failed = false;
    let wantsPlayback = false, playRequest = 0;
    video.muted = true;
    const sync = () => {
      button.textContent = failed ? '静止画を表示' : video.paused ? '映像を再生' : '一時停止';
      button.setAttribute('aria-pressed', String(!video.paused));
      root.classList.toggle('is-playing', !video.paused);
    };
    const pause = () => {
      wantsPlayback = false; playRequest++;
      video.pause(); sync();
    };
    const enforceIntent = () => {
      // A delayed native play/playing event can arrive after a user stop,
      // notably while WebKit finishes a seek. The latest request wins.
      if (!wantsPlayback || failed) video.pause();
      sync();
    };
    const play = async () => {
      if (failed) return;
      wantsPlayback = true;
      const request = ++playRequest;
      if (!video.getAttribute('src')) { video.src = video.dataset.src; video.load(); }
      try { await video.play(); } catch (_) {
        // A stale rejected request must not cancel a newer explicit play.
        if (request === playRequest) wantsPlayback = false;
      }
      enforceIntent();
    };
    const automatic = () => {
      if (!visible || document.hidden || motion.matches || manuallyPaused || navigator.connection?.saveData) pause();
      else play();
      sync();
    };
    button.hidden = false;
    button.addEventListener('click', () => {
      if (video.paused) { manuallyPaused = false; play(); }
      else { manuallyPaused = true; pause(); }
      sync();
    });
    video.addEventListener('play', enforceIntent); video.addEventListener('playing', enforceIntent);
    video.addEventListener('pause', sync);
    video.addEventListener('error', () => { failed = true; pause(); button.disabled = true; sync(); });
    video.addEventListener('timeupdate', () => {
      const progress = Number.isFinite(video.duration) && video.duration > 0 ? video.currentTime / video.duration : 0;
      root.style.setProperty('--film-progress', progress.toFixed(4));
    });
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        visible = entries[0].isIntersecting && entries[0].intersectionRatio >= 0.2;
        automatic();
      }, { threshold: 0.2 });
      observer.observe(video);
    }
    document.addEventListener('visibilitychange', automatic);
    motion.addEventListener('change', automatic);
    sync();
  }
})();
