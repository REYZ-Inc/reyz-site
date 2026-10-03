// v13 acceptance: brand Z colour, menu sheet (colour / X close / scroll close / Escape / link), works empty note (JS on & off), creator copy, excluded strings.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2]);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]); const p = path.join(ROOT, u === '/' ? '/index.html' : u); if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res); });
const PINK = 'rgb(247, 21, 172)', SHEET = 'rgb(28, 28, 28)';
(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}/`;
  const b = await chromium.launch(); const out = { fails: [] }; const F = (k, v) => { if (!v) out.fails.push(k); return v; };
  // 1) static: excluded strings, creator copy, 「所属」
  const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
  const EXCL = ['話してみる', '© 2026 REYZ Inc.', '恵比寿ビジネスタワー10階</p>', 'このサイトは、REYZの人とAIが共に設計・制作しました。', '人とAIの共生を前提に、最小の組織で事業を運営しています。', '所属'];
  for (const pg of pages) { const h = fs.readFileSync(path.join(ROOT, pg), 'utf8'); for (const s of EXCL) if (h.includes(s)) { if (pg === 'legal.html' && s.startsWith('恵比寿')) continue; if (pg === 'index.html' && s.startsWith('恵比寿')) continue; out.fails.push(`excluded string "${s}" in ${pg}`); } }
  // creator copy: rendered text (innerText keeps <br> as newlines) must equal the CEO-specified lines (2026-09-27)
  const EXPECT = {
    'services p1': 'TikTok正規一次代理店として、\nライブ初心者から収益化までを支援します。',
    'services p2': '費用・ノルマ・ペナルティなどは一切なく、\nギフト報酬は100%還元致します。',
    'services note': '※私達は、TikTok社から委託を受けて運営しているため、\nライバーさんの収益から手数料を搾取するモデルではありません。',
    'video h3': '動画・映像制作（PR・PV・MV・ドキュメンタリー・ドラマ）',
    'video p': 'インフルエンス力向上、ブランド化、リブランディングなど、\nそれぞれが抱える現状の課題や目的を明確にし、\nその目的を実現させるための企画、撮影、編集までを、\n自社ですべて行います。',
    'step 01': 'まずは現在の状況を伺います。\nその上で、その人に合った活動方法を共に考えます。',
    'step 02': '活動方法が決まったら、\nいつから、何を、どのように進めていくか。\n様々な視点から、戦略や計画を設計します。',
    'step 03': '状況や状態を確認しながら、\n目的実現に向けて共に進んでいきます。' };
  { const ctx0 = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p0 = await ctx0.newPage(); await p0.goto(base + 'creator.html', { waitUntil: 'load' });
    const got = await p0.evaluate(() => { const ps = document.querySelectorAll('.item p'); const h3 = document.querySelectorAll('.item h3'); const st = document.querySelectorAll('.step p'); const t = el => el.innerText.replace(/\u00a0/g, ' ').trim(); return { 'services p1': t(ps[0]), 'services p2': t(ps[1]), 'services note': t(ps[2]), 'video h3': t(h3[1]), 'video p': t(ps[3]), 'step 01': t(st[0]), 'step 02': t(st[1]), 'step 03': t(st[2]), lead: t(document.querySelector('.head.copy .lead')), h1: t(document.querySelector('h1')), steps: document.querySelectorAll('.step').length, worksLink: !!document.querySelector('.item a.go[href="works.html"]') }; });
    for (const [k, v] of Object.entries(EXPECT)) F(`creator copy "${k}" = ${JSON.stringify(got[k])}`, got[k] === v);
    F('creator lead', got.lead === 'あなたの活動を収入に変える設計を。'); F('creator h1', got.h1 === '「生き方」を職業に。'); F('3 steps', got.steps === 3); F('works link', got.worksLink); await ctx0.close(); }
  // company: business description (2026-09-27 CEO: generic, enterprise-facing; no service names, no real estate / reuse), no large company-name heading
  { const ctx0 = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p0 = await ctx0.newPage(); await p0.goto(base + 'index.html', { waitUntil: 'load' });
    const got = await p0.evaluate(() => { const t = el => el.innerText.replace(/\u00a0/g, ' ').trim(); return { lead: t(document.querySelector('#reyz .biz-lead')), labels: Array.from(document.querySelectorAll('#reyz .biz .k')).map(t), items: Array.from(document.querySelectorAll('#reyz .biz .v')).map(t), visibleH2: Array.from(document.querySelectorAll('#reyz h2')).filter(h => h.getBoundingClientRect().width > 2).length, text: document.querySelector('#reyz').innerText }; });
    F('company lead', got.lead === 'クリエイターエコノミーとAIの交点に、\n人とAIが共に価値を生む事業基盤を築く。\n国内から世界へ、次の10年の標準をつくる。');
    F('company labels', JSON.stringify(got.labels) === JSON.stringify(['クリエイターエコノミー事業', 'エンタープライズ事業', 'AIプラットフォーム事業']));
    F('company item 1', got.items[0] === '個人の創造性と影響力を、持続する経済価値へ。\n発掘から育成、収益化までを一体で設計・運営する。');
    F('company item 2', got.items[1] === '戦略・ブランド・マーケティングを、AIとデータで企業の成長設計へ統合する。\n表現と広告の適法性検証まで、一貫して担う。');
    F('company item 3', got.items[2] === '複数のAIエージェントをクリエイターエコノミーと統合運用する\n自社AI基盤「Z-PLATFORM」の開発・提供。\n業務の設計から実装、検証・運用までを、AIと共に。\n複数のAIによる相互検証と記録を標準とし、\n監査可能なAI運用を設計段階から組み込む。');
    F('no visible h2 in company', got.visibleH2 === 0); F('no service names / excluded businesses in company', !/ライブ配信|映像制作|不動産|リユース|TikTok|クリエイター起点/.test(got.text));
    await ctx0.close(); }
  // 2) runtime, mobile
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(base + 'index.html', { waitUntil: 'load' }); await p.waitForTimeout(600);
  out.brand = await p.evaluate(() => { const z = document.querySelector('.site-header .brand .z'); const b = document.querySelector('.site-header .brand'); const r = document.createRange(); r.selectNodeContents(b.querySelector('span')); return { z: getComputedStyle(z).color, rest: getComputedStyle(b).color, footerZ: document.querySelector('footer .brand .z') ? getComputedStyle(document.querySelector('footer .brand .z')).color : 'none', text: b.textContent.replace(/\s+/g, ' ').trim() }; });
  F('brand Z pink', out.brand.z === PINK); F('brand rest not pink', out.brand.rest !== PINK); F('brand text REYZ Inc.', out.brand.text === 'REYZ Inc.');
  const menuState = () => p.evaluate(() => { const s = document.getElementById('sheet'), btn = document.getElementById('menuBtn'); const a = s.querySelector('a'); return { hidden: s.hidden, expanded: btn.getAttribute('aria-expanded'), label: btn.getAttribute('aria-label'), bg: getComputedStyle(s).backgroundColor, link: a ? getComputedStyle(a).color : null, links: Array.from(s.querySelectorAll('a')).map(x => x.textContent.trim()), bars: btn.querySelectorAll('.bar').length, barTransforms: Array.from(btn.querySelectorAll('.bar')).map(x => getComputedStyle(x).transform), scrollY: window.scrollY }; });
  const closed0 = await menuState(); F('menu initially hidden', closed0.hidden === true); F('3 bars', closed0.bars === 3);
  await p.click('#menuBtn'); await p.waitForTimeout(350); const open1 = await menuState(); out.menuOpen = open1;
  F('menu opens', open1.hidden === false && open1.expanded === 'true'); F('sheet bg #1c1c1c', open1.bg === SHEET); F('sheet link pink', open1.link === PINK); F('menu items', JSON.stringify(open1.links) === JSON.stringify(['Creator', 'Creative', 'AI', 'Company', 'Contact'])); F('bars become X (transformed)', open1.barTransforms.filter(t => t !== 'none').length >= 2);
  await p.click('#menuBtn'); await p.waitForTimeout(200); const closed1 = await menuState(); F('X closes menu', closed1.hidden === true && closed1.expanded === 'false' && closed1.label === 'メニューを開く');
  await p.click('#menuBtn'); await p.waitForTimeout(200); await p.evaluate(() => window.scrollTo({ top: 8, behavior: 'instant' })); await p.waitForTimeout(150); const small = await menuState(); F('8px scroll keeps menu (threshold 12px)', small.hidden === false);
  await p.evaluate(() => window.scrollTo({ top: 60, behavior: 'instant' })); await p.waitForTimeout(200); const scrolled = await menuState(); F('scroll closes menu', scrolled.hidden === true && scrolled.expanded === 'false');
  await p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await p.waitForTimeout(100); await p.click('#menuBtn'); await p.waitForTimeout(200); await p.keyboard.press('Escape'); await p.waitForTimeout(150); F('Escape closes menu', (await menuState()).hidden === true);
  await p.click('#menuBtn'); await p.waitForTimeout(200); await Promise.all([p.waitForNavigation({ waitUntil: 'load' }), p.click('#sheet a[href="creator.html"]')]); await p.waitForTimeout(400); F('menu link navigates to creator', p.url().endsWith('creator.html')); F('menu closed after nav', (await menuState()).hidden === true);
  // 3) works page — empty note, JS on
  await p.goto(base + 'works.html', { waitUntil: 'load' }); await p.waitForTimeout(900);
  out.works = await p.evaluate(() => { const e = document.getElementById('worksEmpty'); const r = e.getBoundingClientRect(); return { hidden: e.hidden, visible: r.height > 0 && getComputedStyle(e).display !== 'none', text: e.textContent, figs: document.querySelectorAll('.work').length, opacity: +getComputedStyle(e).opacity, revealOpacity: +getComputedStyle(document.getElementById('works')).opacity }; });
  F('works empty note visible (JS on)', out.works.visible && !out.works.hidden && out.works.figs === 0);
  await p.screenshot({ path: path.join(process.env.QA_OUT || path.dirname(__filename), 'works_m390.png') });
  out.errors = errs; F('no page errors', errs.length === 0); await ctx.close();
  // 4) works page — JS off
  const ctx2 = await b.newContext({ viewport: { width: 390, height: 844 }, javaScriptEnabled: false }); const p2 = await ctx2.newPage(); await p2.goto(base + 'works.html', { waitUntil: 'load' });
  out.worksNoJs = await p2.evaluate(() => { const e = document.getElementById('worksEmpty'); const r = e.getBoundingClientRect(); return { hidden: e.hidden, visible: r.height > 0, opacity: +getComputedStyle(e).opacity, h1: document.querySelector('h1').getBoundingClientRect().height > 0 }; });
  F('works empty note visible (no JS)', out.worksNoJs.visible && out.worksNoJs.opacity > 0.9); await ctx2.close();
  // 5) desktop: sheet not used; nav visible with pink links; brand Z pink
  const ctx3 = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p3 = await ctx3.newPage(); await p3.goto(base + 'index.html', { waitUntil: 'load' }); await p3.waitForTimeout(400);
  out.desktop = await p3.evaluate(() => ({ menuBtnShown: getComputedStyle(document.getElementById('menuBtn')).display !== 'none', navLink: getComputedStyle(document.querySelector('.site-header .nav a')).color, z: getComputedStyle(document.querySelector('.site-header .brand .z')).color, navShown: getComputedStyle(document.querySelector('.site-header .nav')).display !== 'none' }));
  F('desktop nav pink', out.desktop.navLink === PINK); F('desktop Z pink', out.desktop.z === PINK); await ctx3.close();
  await b.close(); server.close(); console.log(JSON.stringify(out, null, 1));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
