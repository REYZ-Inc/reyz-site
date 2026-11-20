// Verify the public case study through the controls a visitor can use.
// The surrounding experience suite blocks all non-read network requests.
const path = require('node:path');

async function checkLayout(page, scope, label, check) {
  const bounds = await scope.locator('button:visible, a[href]:visible').evaluateAll(elements =>
    elements.map(el => {
      const r = el.getBoundingClientRect();
      return { name: el.textContent.trim(), x: r.x, width: r.width, height: r.height };
    })
  );
  const width = await page.evaluate(() => document.documentElement.clientWidth);
  check(label + ': interaction targets fit the page width',
    bounds.length > 0 && bounds.every(b => b.x >= -1 && b.x + b.width <= width + 1), bounds);
  const undersized = bounds.filter(b => b.width < 44 || b.height < 44);
  check(label + ': controls have a 44px touch target', undersized.length === 0, undersized);
  check(label + ': no horizontal scrolling',
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
}

async function briefStudy(page, label, base, check, out) {
  const files = [];
  const entry = base + '/brief';
  const creator = page.locator('.case-view#creator');
  const company = page.locator('.case-view#company');
  const roles = page.locator('.study-roles');
  const art = page.locator('figure.study-art');
  const action = (view, name) => view.locator('button[data-action="' + name + '"]:visible');
  const role = name => roles.locator('a[data-role="' + name + '"]');
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  const expect = (name, value, detail) => check(label + '/brief: ' + name, value, detail);

  async function use(control) {
    if (touch) await control.tap();
    else await control.click();
  }
  async function snapshot(name) {
    const filename = label + '-brief-' + name + '.png';
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: path.join(out, filename), animations: 'disabled' });
    files.push(filename);
  }
  async function state(view, name, version) {
    expect('visible case state ' + name, await view.isVisible() && await view.getAttribute('data-state') === name);
    expect(name + ' shows artwork version ' + version,
      await art.getAttribute('data-version') === String(version)
      && (await page.locator('[data-art-version]').innerText()).toLowerCase().includes('v' + version));
  }
  async function layout(view, name) {
    await checkLayout(page, view, label + '/brief/' + name, check);
    const region = await art.boundingBox();
    expect(name + ' shows the case artwork', region && region.width > 0 && region.height > 0);
  }
  async function follow(view, name, destination, anchor) {
    const link = view.locator('a.study-next[href$="' + anchor + '"]:visible');
    const href = new URL(await link.getAttribute('href'), page.url());
    expect(name + ' links to its published terms',
      href.origin === new URL(base).origin && href.pathname.replace(/\.html$/, '') === '/' + destination && href.hash === anchor,
      href.href);
    const [response] = await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), use(link)]);
    const target = page.locator(anchor);
    expect(name + ' destination is a working site page',
      !!response && response.ok() && new URL(page.url()).hash === anchor && await target.count() === 1);
  }
  async function roleVisible(active, hidden, name) {
    await active.waitFor({ state: 'visible' });
    expect(name + ' shows only the selected role', await hidden.isHidden());
    const status = active.locator('.study-status[role="status"]');
    expect(name + ' exposes status updates to assistive technology', await status.count() === 1);
  }
  const savedState = () => page.evaluate(() =>
    [sessionStorage.getItem('reyz.map'), sessionStorage.getItem('reyz.map.r')]);

  await page.goto(entry, { waitUntil: 'load' });
  await roleVisible(creator, company, 'initial Creator');
  await state(creator, 'offer', 1);
  const initialStorage = await savedState();
  expect('study uses original case artwork without loading a film', await page.locator('video, video source').count() === 0);
  expect('statement is absent before agreement', await creator.locator('[data-creator-statement]').isHidden());
  expect('offer cannot be accepted before inspecting its terms', await action(creator, 'accept').count() === 0
    || await action(creator, 'accept').isDisabled());
  await layout(creator, 'Creator offer');
  await checkLayout(page, roles, label + '/brief/role-navigation', check);
  await snapshot('creator');

  await use(action(creator, 'terms'));
  await state(creator, 'terms', 1);
  const terms = (await creator.innerText()).replace(/\s/g, '');
  expect('terms show the use period, compensation, payment arrangements and commission together',
    ['30日', '報酬', '支払', '0円'].every(word => terms.includes(word)), terms);
  const accept = action(creator, 'accept');
  await accept.focus();
  await page.keyboard.press('Space');
  await state(creator, 'statement', 1);
  const statement = (await creator.locator('[data-creator-statement]:visible').innerText()).replace(/\s/g, '');
  expect('creator receives a sample statement showing its commission',
    ['明細', '新商品の紹介動画', '30日', '報酬', '支払', '0円'].every(word => statement.includes(word)), statement);
  await snapshot('creator-statement');

  // Keyboard traversal uses the real links; browser history must restore the
  // selected audience without applying actions from the other side.
  if (touch) {
    await use(role('company'));
  } else {
    await role('creator').focus();
    await page.keyboard.press('Tab');
    expect('keyboard can reach Company from Creator', await role('company').evaluate(el => el === document.activeElement));
    await page.keyboard.press('Enter');
  }
  await roleVisible(company, creator, 'Company');
  expect('Company has a shareable address', new URL(page.url()).hash === '#company');
  await state(company, 'approved-v1', 1);
  await layout(company, 'Company original');
  await snapshot('enterprise');
  const stage = art.locator('.art-stage');
  const originalArtwork = await stage.screenshot({ animations: 'disabled' });
  await use(action(company, 'swap'));
  await state(company, 'review-v2', 2);
  const replacementArtwork = await stage.screenshot({ animations: 'disabled' });
  expect('the depicted material itself changes at replacement', !originalArtwork.equals(replacementArtwork));
  expect('replacement visibly reports a changed approval and withheld publication',
    /再承認が必要/.test(await company.locator('[data-company-approval]').innerText())
    && /保留|不可|停止/.test(await company.locator('[data-company-result]').innerText()));
  expect('replacement cannot proceed under the old approval', await action(company, 'proceed').isDisabled());
  await layout(company, 'Company replacement');
  await snapshot('enterprise-v2');

  await page.goBack();
  await roleVisible(creator, company, 'browser Back');
  await state(creator, 'statement', 1);
  await page.goForward();
  await roleVisible(company, creator, 'browser Forward');
  await state(company, 'review-v2', 2);
  expect('history keeps the replacement blocked', await action(company, 'proceed').isDisabled());
  await use(action(company, 'approve'));
  await state(company, 'approved-v2', 2);
  expect('only the new approval releases the next step', await action(company, 'proceed').isEnabled());
  await use(action(company, 'proceed'));
  await state(company, 'checked-v2', 2);

  await use(action(company, 'reset-company'));
  await state(company, 'approved-v1', 1);
  await use(action(company, 'proceed'));
  await state(company, 'checked-v1', 1);
  await use(role('creator'));
  await roleVisible(creator, company, 'Creator return');
  await state(creator, 'statement', 1);
  await use(action(creator, 'reset-creator'));
  await state(creator, 'offer', 1);
  expect('the sample does not add an agreement or a case to the inquiry handoff',
    JSON.stringify(await savedState()) === JSON.stringify(initialStorage));
  await follow(creator, 'Creator', 'creator', '#creator-terms');
  await page.goto(entry + '#company', { waitUntil: 'load' });
  await roleVisible(company, creator, 'direct Company link');
  await state(company, 'approved-v1', 1);
  await follow(company, 'Company', 'creative', '#gain');
  await page.goto(entry + '#company', { waitUntil: 'load' });
  await follow(company, 'Company complete case', 'creative', '#guard');
  return files;
}

module.exports = briefStudy;
