// Contact flow: validation → confirm view (values, back button restores) → send (endpoint mocked / fallback copy), no page errors.
const { chromium } = require('playwright'); const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.resolve(process.argv[2]); const ENDPOINT = process.argv[3] === 'endpoint';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => { const u = decodeURIComponent(req.url.split('?')[0].split('#')[0]); let p = path.join(ROOT, u === '/' ? '/index.html' : u); if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); } let body = fs.readFileSync(p); if (u.endsWith('site.js')) body = Buffer.from(body.toString().replace(/formEndpoint: '[^']*'/, ENDPOINT ? "formEndpoint: 'https://example.test/form'" : "formEndpoint: ''").replace(/turnstileSiteKey: '[^']*'/, "turnstileSiteKey: ''")); /* 送信先は試験用に差し替え（両モードを本番設定値に依存させない）。Turnstile は外部スクリプトのため無効化 */ res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' }); res.end(body); });
(async () => { await new Promise(r => server.listen(0, '127.0.0.1', r)); const base = `http://127.0.0.1:${server.address().port}/`; const b = await chromium.launch(); const fails = []; const F = (k, v) => { if (!v) fails.push(k); }; const out = {};
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] }); const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  let posted = null; await p.route('https://example.test/form', r => { posted = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }); });
  await p.goto(base + 'contact.html', { waitUntil: 'load' }); await p.waitForTimeout(1900);
  out.labels = await p.evaluate(() => Array.from(document.querySelectorAll('#stepForm > label, #stepForm > .field')).map(l => l.classList.contains('field') ? l.querySelector('.field-label').textContent.trim() : l.childNodes[0].textContent.trim()));
  out.options = await p.evaluate(() => Array.from(document.querySelectorAll('#cType optgroup')).map(g => g.label + ': ' + Array.from(g.querySelectorAll('option')).map(o => o.textContent).join(' / ')));
  out.buttons = await p.evaluate(() => ({ confirm: document.getElementById('confirmBtn').textContent, send: document.getElementById('sendBtn').textContent, back: document.getElementById('backBtn').textContent, sendHidden: document.getElementById('stepConfirm').hidden }));
  F('labels', JSON.stringify(out.labels) === JSON.stringify(['お名前（個人名または会社名）', 'ご担当者様', 'メールアドレス', 'ご用件', '内容（ご要望・質問・相談等）']));
  F('button 確認する', out.buttons.confirm === '確認する' && out.buttons.send === '送信' && out.buttons.sendHidden === true);
  F('no old lead', !(await p.evaluate(() => document.body.innerText.includes('窓口はひとつ'))));
  // validation: empty submit stays on form
  await p.click('#confirmBtn'); await p.waitForTimeout(300); F('empty submit stays', await p.evaluate(() => !document.getElementById('stepForm').hidden && document.getElementById('stepConfirm').hidden));
  await p.fill('#cName', '株式会社テスト'); await p.fill('#cPerson', '山田'); await p.selectOption('#cType', { label: 'AI基盤「Z」・SaaS導入' }); await p.fill('#cMsg', '導入の相談です。\n2行目');
  await p.click('#confirmBtn'); await p.waitForTimeout(300); F('missing email blocks', await p.evaluate(() => document.getElementById('stepConfirm').hidden));
  await p.fill('#cLocal', 'taro'); await p.selectOption('#cDomain', 'gmail.com');
  await p.click('#confirmBtn'); await p.waitForTimeout(700);
  out.confirm = await p.evaluate(() => ({ formHidden: document.getElementById('stepForm').hidden, confirmShown: !document.getElementById('stepConfirm').hidden, rows: Array.from(document.querySelectorAll('#confirmList div')).map(d => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]), hash: location.hash, focused: document.activeElement && document.activeElement.id, top: Math.round(document.getElementById('contactForm').getBoundingClientRect().top) }));
  F('confirm view', out.confirm.formHidden && out.confirm.confirmShown && out.confirm.hash === '#confirm'); F('confirm rows', JSON.stringify(out.confirm.rows) === JSON.stringify([['お名前', '株式会社テスト'], ['ご担当者様', '山田'], ['メールアドレス', 'taro@gmail.com'], ['ご用件', 'AI基盤「Z」・SaaS導入'], ['内容', '導入の相談です。\n2行目']])); F('focus on confirm title', out.confirm.focused === 'confirmTitle'); F('scrolled to form', out.confirm.top >= 0 && out.confirm.top < 420);
  await p.screenshot({ path: path.join(process.env.QA_OUT || path.dirname(process.argv[1]), 'form_confirm_390.png') });
  // back via 修正する (history.back) keeps values
  await p.click('#backBtn'); await p.waitForTimeout(500);
  out.back = await p.evaluate(() => ({ formShown: !document.getElementById('stepForm').hidden, name: document.getElementById('cName').value, msg: document.getElementById('cMsg').value, hash: location.hash }));
  F('back restores form with values', out.back.formShown && out.back.name === '株式会社テスト' && out.back.msg.startsWith('導入') && out.back.hash === '');
  // confirm again and send
  await p.click('#confirmBtn'); await p.waitForTimeout(500); await p.click('#sendBtn'); await p.waitForTimeout(800);
  out.send = await p.evaluate(() => ({ done: !document.getElementById('stepDone').hidden, status: document.getElementById('sendStatus').textContent, copyShown: !document.getElementById('copyLabel').hidden, copyText: document.getElementById('copyArea').value, hash: location.hash, disabled: document.getElementById('sendBtn').disabled }));
  if (ENDPOINT) { F('endpoint: done view', out.send.done && out.send.hash === '#sent'); F('endpoint: payload', posted && posted.name === '株式会社テスト' && posted.person === '山田' && posted.email === 'taro@gmail.com' && posted._replyto === 'taro@gmail.com' && posted.type === 'AI基盤「Z」・SaaS導入' && posted.message.startsWith('導入') && posted.website === '' && posted.turnstile === ''); }
  else { F('fallback: copy text shown', out.send.copyShown && out.send.copyText.includes('ご用件: AI基盤「Z」・SaaS導入') && out.send.copyText.includes('ご担当者様: 山田') && out.send.copyText.includes('メール: taro@gmail.com') && /準備中/.test(out.send.status) && !out.send.done); }
  await p.screenshot({ path: path.join(process.env.QA_OUT || path.dirname(process.argv[1]), `form_sent_390_${ENDPOINT ? 'endpoint' : 'fallback'}.png`) });
  // email variants: その他 (custom domain), pasted full address, invalid custom domain
  await p.goto(base + 'contact.html', { waitUntil: 'load' }); await p.waitForTimeout(1900);
  await p.fill('#cName', 'テスト'); await p.selectOption('#cType', { label: '成長設計・マーケティング' }); await p.fill('#cMsg', 'x');
  await p.fill('#cLocal', 'info'); await p.selectOption('#cDomain', '__other'); await p.waitForTimeout(100);
  out.other = await p.evaluate(() => ({ otherShown: !document.getElementById('cDomainOther').hidden, required: document.getElementById('cDomainOther').required }));
  F('その他 reveals domain input', out.other.otherShown && out.other.required);
  await p.fill('#cDomainOther', 'bad domain'); await p.click('#confirmBtn'); await p.waitForTimeout(300); F('invalid custom domain blocks', await p.evaluate(() => document.getElementById('stepConfirm').hidden));
  await p.fill('#cDomainOther', 'Example.co.jp'); await p.click('#confirmBtn'); await p.waitForTimeout(500);
  out.customEmail = await p.evaluate(() => (Array.from(document.querySelectorAll('#confirmList div')).find(d => d.querySelector('dt').textContent === 'メールアドレス') || {}).querySelector?.('dd')?.textContent);
  F('custom domain email composed (lowercased)', out.customEmail === 'info@example.co.jp');
  await p.click('#backBtn'); await p.waitForTimeout(400);
  await p.fill('#cLocal', 'hanako@icloud.com'); await p.press('#cLocal', 'Tab'); await p.waitForTimeout(100);
  out.pasted = await p.evaluate(() => ({ local: document.getElementById('cLocal').value, domain: document.getElementById('cDomain').value, otherHidden: document.getElementById('cDomainOther').hidden }));
  F('pasted full address splits', out.pasted.local === 'hanako' && out.pasted.domain === 'icloud.com' && out.pasted.otherHidden);
  await p.fill('#cLocal', 'sales@corp-example.jp'); await p.press('#cLocal', 'Tab'); await p.waitForTimeout(100);
  out.pasted2 = await p.evaluate(() => ({ local: document.getElementById('cLocal').value, domain: document.getElementById('cDomain').value, other: document.getElementById('cDomainOther').value }));
  F('pasted unknown domain → その他', out.pasted2.local === 'sales' && out.pasted2.domain === '__other' && out.pasted2.other === 'corp-example.jp');
  out.layout = await p.evaluate(() => { const r = document.querySelector('.email-row').getBoundingClientRect(); const l = document.getElementById('cLocal').getBoundingClientRect(); const d = document.getElementById('cDomain').getBoundingClientRect(); return { rowW: Math.round(r.width), localW: Math.round(l.width), selW: Math.round(d.width), oneLine: Math.abs(l.top - d.top) < 2 && l.height >= 44 }; });
  F('email row on one line, targets ≥44px', out.layout.oneLine);
  await p.screenshot({ path: path.join(process.env.QA_OUT || path.dirname(process.argv[1]), 'form_email_390.png') });
  out.errs = errs; F('no page errors', errs.length === 0);
  await b.close(); server.close(); console.log(JSON.stringify({ mode: ENDPOINT ? 'endpoint' : 'fallback', fails, out }, null, 1)); })();
