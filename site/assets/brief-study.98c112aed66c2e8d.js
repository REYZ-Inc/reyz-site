(() => {
  'use strict';

  const nav = document.querySelector('.study-roles');
  const creator = document.getElementById('creator');
  const company = document.getElementById('company');
  const art = document.querySelector('.study-art');
  const artVersion = art.querySelector('[data-art-version]');
  const roleLinks = [...nav.querySelectorAll('a[data-role]')];
  const creatorTitle = creator.querySelector('h2');
  const creatorStatus = creator.querySelector('[role="status"]');
  const creatorFacts = creator.querySelectorAll('[data-creator-scope]');
  const offerFacts = creator.querySelector('[data-creator-offer]');
  const statementFacts = creator.querySelector('[data-creator-statement]');
  const companyStatus = company.querySelector('[role="status"]');
  const companyVersion = company.querySelector('[data-company-version]');
  const companyApproval = company.querySelector('[data-company-approval]');
  const companyResult = company.querySelector('[data-company-result]');
  const terms = creator.querySelector('[data-action="terms"]');
  const accept = creator.querySelector('[data-action="accept"]');
  const resetCreator = creator.querySelector('[data-action="reset-creator"]');
  const swap = company.querySelector('[data-action="swap"]');
  const approve = company.querySelector('[data-action="approve"]');
  const proceed = company.querySelector('[data-action="proceed"]');
  const resetCompany = company.querySelector('[data-action="reset-company"]');

  const offerTitle = creatorTitle.textContent;
  const offerStatus = creatorStatus.textContent;
  const initialCompanyStatus = companyStatus.textContent;
  let activeRole = 'creator';
  let version = 1;
  let approvedVersion = 1;
  let checkedVersion = null;
  document.documentElement.setAttribute('data-study-enhanced', '');

  function drawArt() {
    const visibleVersion = activeRole === 'company' ? version : 1;
    art.dataset.version = String(visibleVersion);
    artVersion.textContent = '素材 v' + visibleVersion;
  }

  function followLocation() {
    activeRole = window.location.hash === '#company' ? 'company' : 'creator';
    creator.hidden = activeRole !== 'creator';
    company.hidden = activeRole !== 'company';
    for (const link of roleLinks) {
      if (link.dataset.role === activeRole) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    }
    drawArt();
  }

  for (const link of roleLinks) {
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (!window.history.pushState) return;
      event.preventDefault();
      if (window.location.hash !== link.hash) {
        try {
          window.history.pushState(null, '', link.hash);
        } catch {
          window.location.hash = link.hash;
        }
      }
      followLocation();
    });
  }
  window.addEventListener('popstate', followLocation);
  window.addEventListener('hashchange', followLocation);

  function renderCreator(state) {
    creator.dataset.state = state;
    const initial = state === 'offer';
    offerFacts.hidden = state === 'statement';
    statementFacts.hidden = state !== 'statement';
    for (const fact of creatorFacts) fact.hidden = initial;
    terms.hidden = !initial;
    accept.hidden = state !== 'terms';
    resetCreator.hidden = initial;
    if (initial) {
      creatorTitle.textContent = offerTitle;
      creatorStatus.textContent = offerStatus;
    } else if (state === 'terms') {
      creatorTitle.textContent = '受ける前に、条件を確認。';
      creatorStatus.textContent = '利用する場所と期間、報酬額と支払日を、企業と確認してから受けます。';
    } else {
      creatorTitle.textContent = 'この案件の報酬明細。';
      creatorStatus.textContent = '明細に1件入りました。見本では個別の報酬額・支払日を省いています。';
    }
  }

  terms.addEventListener('click', () => {
    renderCreator('terms');
    accept.focus({ preventScroll: true });
  });
  accept.addEventListener('click', () => {
    if (creator.dataset.state !== 'terms') return;
    renderCreator('statement');
    resetCreator.focus({ preventScroll: true });
  });
  resetCreator.addEventListener('click', () => {
    renderCreator('offer');
    terms.focus({ preventScroll: true });
  });

  function renderCompany(message) {
    const approved = approvedVersion === version;
    const checked = checkedVersion === version;
    const step = checked ? 'checked' : approved ? 'approved' : 'review';
    company.dataset.state = step + '-v' + version;
    companyVersion.textContent = '紹介動画 v' + version;
    companyApproval.textContent = approved ? '承認済み' : '再承認が必要';
    companyResult.textContent = approved ? '公開可' : '公開不可';
    companyStatus.textContent = message;
    swap.hidden = version !== 1;
    approve.hidden = approved;
    proceed.hidden = checked;
    proceed.disabled = !approved;
    resetCompany.hidden = version === 1 && !checked;
    drawArt();
  }

  swap.addEventListener('click', () => {
    if (version !== 1) return;
    version = 2;
    checkedVersion = null;
    renderCompany('v1の承認はv2に引き継がれません。v2を確認するまで公開は保留です。');
    approve.focus({ preventScroll: true });
  });
  approve.addEventListener('click', () => {
    if (version !== 2 || approvedVersion === version) return;
    approvedVersion = version;
    renderCompany('v2と利用条件を再承認しました。この版の公開判断を試せます。');
    proceed.focus({ preventScroll: true });
  });
  proceed.addEventListener('click', () => {
    if (approvedVersion !== version || checkedVersion === version) return;
    checkedVersion = version;
    renderCompany('v' + version + 'は公開できます。見本のため実際の公開は行いません。');
    (version === 1 ? swap : resetCompany).focus({ preventScroll: true });
  });
  resetCompany.addEventListener('click', () => {
    version = 1;
    approvedVersion = 1;
    checkedVersion = null;
    renderCompany(initialCompanyStatus);
    swap.focus({ preventScroll: true });
  });

  renderCreator('offer');
  renderCompany(initialCompanyStatus);
  followLocation();
})();
