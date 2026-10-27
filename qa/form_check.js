// Contact flow: validation → confirm view (values, back button restores) → send (endpoint mocked / fallback copy), no page errors.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2]); const ENDPOINT = process.argv[3] === 'endpoint';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]); let p = path.join(ROOT, u === '/' ? '/index.html' : u); if (!fs.existsSync(p) && fs.existsSync(p + '.html')) p += '.html'; /* 公開 URL は .html なし（/ai → ai.html）。GitHub Pages と同じ解決 */ if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); } let body = fs.readFileSync(p); if (u.endsWith('site.js')) body = Buffer.from(body.toString().replace(/formEndpoint: '[^']*'/, ENDPOINT ? "formEndpoint: 'https://example.test/form'" : "formEndpoint: ''").replace(/turnstileSiteKey: '[^']*'/, "turnstileSiteKey: ''")); /* 送信先は試験用に差し替え（両モードを本番設定値に依存させない）。Turnstile は外部スクリプトのため無効化 */ res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(body); });
(async () => { await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}/`; const b = await chromium.launch(); const fails = []; const F = (k, v) => { if (!v) fails.push(k); }; const out = {};
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  let posted = null; await p.route('https://example.test/form', r => { posted = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await p.goto(base + 'contact.html', { waitUntil: 'load' }); await p.waitForTimeout(1900);
  // ラベル（DEC-20261027-18: メールは 1 欄、ご担当者は企業の用件のときだけ表示）
  out.labels = await p.evaluate(() => Array.from(document.querySelectorAll('#stepForm > label')).map(l => l.childNodes[0].textContent.trim()));
  out.visibleLabels = await p.evaluate(() => Array.from(document.querySelectorAll('#stepForm > label')).filter(l => !l.hidden && getComputedStyle(l).display !== 'none').map(l => l.childNodes[0].textContent.trim()));
  out.options = await p.evaluate(() => Array.from(document.querySelectorAll('#cType optgroup')).map(g => g.label + ': ' + Array.from(g.querySelectorAll('option')).map(o => o.textContent).join(' / ')));
  out.buttons = await p.evaluate(() => ({ confirm: document.getElementById('confirmBtn').textContent, send: document.getElementById('sendBtn').textContent, back: document.getElementById('backBtn').textContent, sendHidden: document.getElementById('stepConfirm').hidden }));
  F('labels', JSON.stringify(out.labels) === JSON.stringify(['お名前（個人名または会社名）', 'メールアドレス', 'ご用件', 'ご担当者', '内容']));
  F('visible labels at start (ご担当者 hidden)', JSON.stringify(out.visibleLabels) === JSON.stringify(['お名前（個人名または会社名）', 'メールアドレス', 'ご用件', '内容']));
  F('email is one field (no split)', await p.evaluate(() => { const e = document.getElementById('cEmail'); return !!e && e.type === 'email' && e.required && document.querySelectorAll('#stepForm input[type=email]').length === 1 && document.querySelectorAll('#stepForm select').length === 1; }));
  F('button 確認する', out.buttons.confirm === '確認する' && out.buttons.send === '送信' && out.buttons.sendHidden === true);
  F('no old lead', !(await p.evaluate(() => document.body.innerText.includes('窓口はひとつ'))));
  // validation: empty submit stays on form
  await p.click('#confirmBtn'); await p.waitForTimeout(300); F('empty submit stays', await p.evaluate(() => !document.getElementById('stepForm').hidden && document.getElementById('stepConfirm').hidden));
  await p.fill('#cName', '株式会社テスト'); await p.selectOption('#cType', { label: 'AIを仕事に入れる（REYZ PLATFORM）' }); await p.waitForTimeout(100);
  F('ご担当者 shown for 企業 option', await p.evaluate(() => !document.getElementById('personLabel').hidden && document.getElementById('cPerson').offsetHeight > 0));
  await p.fill('#cPerson', '山田'); await p.fill('#cMsg', '導入の相談です。\n2行目');
  await p.click('#confirmBtn'); await p.waitForTimeout(300); F('missing email blocks', await p.evaluate(() => document.getElementById('stepConfirm').hidden));
  await p.fill('#cEmail', 'Taro@Gmail.com');   // 大文字混じり → 確認画面では小文字
  await p.click('#confirmBtn'); await p.waitForTimeout(700);
  out.confirm = await p.evaluate(() => ({ formHidden: document.getElementById('stepForm').hidden, confirmShown: !document.getElementById('stepConfirm').hidden, rows: Array.from(document.querySelectorAll('#confirmList div')).map(d => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]), hash: location.hash, focused: document.activeElement && document.activeElement.id, top: Math.round(document.getElementById('contactForm').getBoundingClientRect().top) }));
  F('confirm view', out.confirm.formHidden && out.confirm.confirmShown && out.confirm.hash === '#confirm'); F('confirm rows', JSON.stringify(out.confirm.rows) === JSON.stringify([['お名前', '株式会社テスト'], ['ご担当者', '山田'], ['メールアドレス', 'taro@gmail.com'], ['ご用件', 'AIを仕事に入れる（REYZ PLATFORM）'], ['内容', '導入の相談です。\n2行目']])); F('focus on confirm title', out.confirm.focused === 'confirmTitle'); F('scrolled to form', out.confirm.top >= 0 && out.confirm.top < 420);
  await p.screenshot({ path: path.join(process.env.QA_OUT || path.dirname(process.argv[1]), 'form_confirm_390.png') });
  // back via 修正する (history.back) keeps values
  await p.click('#backBtn'); await p.waitForTimeout(500);
  out.back = await p.evaluate(() => ({ formShown: !document.getElementById('stepForm').hidden, name: document.getElementById('cName').value, msg: document.getElementById('cMsg').value, hash: location.hash }));
  F('back restores form with values', out.back.formShown && out.back.name === '株式会社テスト' && out.back.msg.startsWith('導入') && out.back.hash === '');
  // confirm again and send
  await p.click('#confirmBtn'); await p.waitForTimeout(500); await p.click('#sendBtn'); await p.waitForTimeout(800);
  out.send = await p.evaluate(() => ({ done: !document.getElementById('stepDone').hidden, status: document.getElementById('sendStatus').textContent, copyShown: !document.getElementById('copyLabel').hidden, copyText: document.getElementById('copyArea').value, hash: location.hash, disabled: document.getElementById('sendBtn').disabled }));
  if (ENDPOINT) { F('endpoint: done view', out.send.done && out.send.hash === '#sent'); F('endpoint: payload', posted && posted.name === '株式会社テスト' && posted.person === '山田' && posted.email === 'taro@gmail.com' && posted._replyto === 'taro@gmail.com' && posted.type === 'AIを仕事に入れる（REYZ PLATFORM）' && posted.message.startsWith('導入') && posted.website === '' && posted.turnstile === ''); }
  else { F('fallback: copy text shown', out.send.copyShown && out.send.copyText.includes('ご用件: AIを仕事に入れる（REYZ PLATFORM）') && out.send.copyText.includes('ご担当者: 山田') && out.send.copyText.includes('メール: taro@gmail.com') && /送信できない/.test(out.send.status) && !out.send.done); }
  await p.screenshot({ path: path.join(process.env.QA_OUT || path.dirname(process.argv[1]), `form_sent_390_${ENDPOINT ? 'endpoint' : 'fallback'}.png`) });
  // 1 欄メール: 形式の誤りは止まる（type=email を通る 'taro@gmail' も、ドメインに「.」がないので止める）。ご担当者の条件表示（DEC-20261027-18）
  await p.goto(base + 'contact.html', { waitUntil: 'load' }); await p.waitForTimeout(1900);
  await p.fill('#cName', 'テスト'); await p.selectOption('#cType', { label: '活動・収益化の相談' }); await p.fill('#cMsg', 'x'); await p.waitForTimeout(100);
  out.creator = await p.evaluate(() => ({ personHidden: document.getElementById('personLabel').hidden, personDisplay: getComputedStyle(document.getElementById('personLabel')).display }));
  F('ご担当者 hidden for クリエイター option', out.creator.personHidden && out.creator.personDisplay === 'none');
  await p.fill('#cEmail', 'taro@gmail'); await p.click('#confirmBtn'); await p.waitForTimeout(300);
  out.badEmail = await p.evaluate(() => ({ blocked: document.getElementById('stepConfirm').hidden, msg: document.getElementById('cEmail').validationMessage, status: document.getElementById('status').textContent }));
  F('invalid email blocks (domain without dot)', out.badEmail.blocked && /形式/.test(out.badEmail.msg) && /形式の誤り/.test(out.badEmail.status));
  await p.fill('#cEmail', 'bad domain@example.com'); await p.click('#confirmBtn'); await p.waitForTimeout(300); F('invalid email blocks (space)', await p.evaluate(() => document.getElementById('stepConfirm').hidden));
  await p.fill('#cEmail', 'Hanako@Example.co.jp'); await p.waitForTimeout(100); F('error clears while typing', await p.evaluate(() => document.getElementById('cEmail').validationMessage === ''));
  await p.click('#confirmBtn'); await p.waitForTimeout(500);
  out.lowerEmail = await p.evaluate(() => (Array.from(document.querySelectorAll('#confirmList div')).find(d => d.querySelector('dt').textContent === 'メールアドレス') || {}).querySelector?.('dd')?.textContent);
  F('email lowercased in confirm', out.lowerEmail === 'hanako@example.co.jp');
  F('no ご担当者 row for クリエイター', await p.evaluate(() => !Array.from(document.querySelectorAll('#confirmList dt')).some(d => d.textContent === 'ご担当者')));
  await p.click('#backBtn'); await p.waitForTimeout(400);
  // 企業 → ご担当者を入れる → その他／クリエイターに切り替えると隠れて値も消える
  await p.selectOption('#cType', { label: '動画・映像制作' }); await p.waitForTimeout(100); await p.fill('#cPerson', '佐藤');
  await p.selectOption('#cType', { label: '取材・提携' }); await p.waitForTimeout(100);
  out.switchOther = await p.evaluate(() => ({ hidden: document.getElementById('personLabel').hidden, value: document.getElementById('cPerson').value }));
  F('ご担当者 hidden and cleared for その他 option', out.switchOther.hidden && out.switchOther.value === '');
  await p.selectOption('#cType', { label: '目的の整理と進め方の相談' }); await p.waitForTimeout(100); await p.fill('#cPerson', '鈴木');
  await p.selectOption('#cType', { label: '映像制作の依頼' }); await p.waitForTimeout(100);
  out.switchCreator = await p.evaluate(() => ({ hidden: document.getElementById('personLabel').hidden, value: document.getElementById('cPerson').value }));
  F('ご担当者 hidden and cleared when switching back to クリエイター', out.switchCreator.hidden && out.switchCreator.value === '');
  out.layout = await p.evaluate(() => { const e = document.getElementById('cEmail').getBoundingClientRect(); const n = document.getElementById('cName').getBoundingClientRect(); return { emailH: Math.round(e.height), emailW: Math.round(e.width), nameW: Math.round(n.width), fullWidth: Math.abs(e.width - n.width) < 2 }; });
  F('email field full width, target ≥44px', out.layout.fullWidth && out.layout.emailH >= 44);
  F('no LINE on contact page', !(await p.evaluate(() => /LINE/.test(document.body.innerText))));
  await p.screenshot({ path: path.join(process.env.QA_OUT || path.dirname(process.argv[1]), 'form_email_390.png') });
  out.errs = errs; F('no page errors', errs.length === 0);
  await b.close(); server.close(); console.log(JSON.stringify({ mode: ENDPOINT ? 'endpoint' : 'fallback', fails, out }, null, 1)); })();
