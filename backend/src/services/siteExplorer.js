/**
 * Site Explorer — Multi-Page Crawl + Test-Account Login
 *
 * 1. detectLogin: finds the site's login page (password field, redirect to a
 *    login URL, or a "Log in" link).
 * 2. explorePublicPages: follows same-site links over plain HTTP (fast).
 * 3. loginAndExplore: logs in with the user's test account in headless Chrome,
 *    then visits pages behind the login (Chrome renders JavaScript apps).
 * 4. buildPageTests: turns per-page findings into site-wide test results.
 *
 * Safety: only links are followed — no buttons are clicked and no forms are
 * submitted except the login form. Destructive-looking URLs (logout, delete…)
 * and other domains are skipped, every URL passes the SSRF guard, and the
 * password is never logged, stored, or included in any message.
 */

const { crawlWebsite, analyzeHtml } = require('./websiteCrawler');
const { assertPublicUrl } = require('./urlGuard');
const selenium = require('./seleniumRunner');
const { setProgress, getSession } = require('./sessionStore');

const MAX_PUBLIC_PAGES = parseInt(process.env.CRAWL_MAX_PAGES || '20', 10);
const MAX_PRIVATE_PAGES = parseInt(process.env.CRAWL_MAX_LOGGED_IN_PAGES || '15', 10);
const PUBLIC_CONCURRENCY = 4;
const PUBLIC_TIME_BUDGET_MS = 90_000;
const PRIVATE_TIME_BUDGET_MS = 150_000;
const SLOW_PAGE_MS = 3000;

const SKIP_EXTENSIONS = /\.(pdf|zip|rar|7z|gz|tar|jpe?g|png|gif|svg|webp|avif|ico|bmp|mp4|webm|mov|mp3|wav|docx?|xlsx?|pptx?|csv|exe|dmg|apk|css|js|mjs|json|xml|txt|woff2?|ttf|eot)$/i;
const DESTRUCTIVE = /(log-?out|sign-?out|logoff|delete|destroy|remove|trash|unsubscribe|deactivate|cancel|revoke|disconnect)/i;
const LOGIN_PATH = /(^|\/)(log-?in|sign-?in|signin|auth\/login|users?\/sign_in|account\/login|wp-login\.php)(\/|$)/i;
// (No /wp-login.php guess: that's WordPress's admin login, not a user area)
const COMMON_LOGIN_PATHS = ['/login', '/signin', '/sign-in', '/auth/login', '/account/login', '/users/sign_in', '/user/login'];

// ─── URL helpers ────────────────────────────────────────────────────────────

/** Same-origin, crawlable, non-destructive URL without #hash — or null. */
function normalizeLink(href, origin) {
  let u;
  try {
    u = new URL(href);
  } catch {
    return null;
  }
  if (u.origin !== origin || !/^https?:$/.test(u.protocol)) return null;
  u.hash = '';
  if (SKIP_EXTENSIONS.test(u.pathname) || DESTRUCTIVE.test(u.pathname + u.search)) return null;
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.href;
}

function pathOf(url) {
  try {
    const u = new URL(url);
    return (u.pathname + u.search) || '/';
  } catch {
    return url;
  }
}

function isLoginUrl(url) {
  try {
    return LOGIN_PATH.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

// ─── Per-page findings ──────────────────────────────────────────────────────

function toPageRecord(analysis, access, extra = {}) {
  const url = analysis.finalUrl || analysis.url;
  const record = {
    url,
    path: pathOf(url),
    access,
    statusCode: analysis.statusCode ?? null,
    title: analysis.title || '',
    loadTime: analysis.responseTime ?? null,
    jsErrors: extra.jsErrors || [],
    error: analysis.success === false ? analysis.error : null,
  };
  const h1 = analysis.headings?.h1?.length || 0;
  const missingAlt = analysis.images?.withoutAlt || 0;
  record.checks = analysis.success === false ? { unreachable: true } : {
    httpError: record.statusCode >= 400,
    noTitle: !record.title,
    noMetaDescription: !analysis.metaDescription,
    noH1: h1 === 0,
    missingAlt,
    slow: (record.loadTime || 0) > SLOW_PAGE_MS,
    jsErrors: record.jsErrors.length,
  };
  record.issues = describeIssues(record);
  return record;
}

function describeIssues(page) {
  const c = page.checks;
  if (c.unreachable) return [`Could not load: ${page.error}`];
  const issues = [];
  if (c.httpError) issues.push(`HTTP ${page.statusCode}`);
  if (c.noTitle) issues.push('Missing page title');
  if (c.noMetaDescription) issues.push('Missing meta description');
  if (c.noH1) issues.push('No H1 heading');
  if (c.missingAlt) issues.push(`${c.missingAlt} image(s) missing alt text`);
  if (c.slow) issues.push(`Slow load (${(page.loadTime / 1000).toFixed(1)}s)`);
  if (c.jsErrors) issues.push(`${c.jsErrors} JavaScript error(s)`);
  if (c.directLink404) issues.push('404 when opened directly (refresh/bookmark breaks)');
  return issues;
}

// ─── Login detection ────────────────────────────────────────────────────────

const DETECTION_TTL_MS = 10 * 60 * 1000;

/**
 * Find the site's login page. Returns { detected, loginUrl?, how? }.
 * Cached per user for 10 minutes (it runs on Save and again in the pipeline).
 */
async function detectLogin(startUrl, startAnalysis = null) {
  const S = getSession();
  const hit = S.loginDetection;
  if (hit && hit.url === startUrl && Date.now() - hit.at < DETECTION_TTL_MS) return hit.result;
  const detection = await detectLoginUncached(startUrl, startAnalysis);
  if (!detection.error) S.loginDetection = { url: startUrl, at: Date.now(), result: detection };
  return detection;
}

async function detectLoginUncached(startUrl, startAnalysis) {
  const start = startAnalysis || await crawlWebsite(startUrl);
  if (!start.success) return { detected: false, error: start.error };

  const landed = start.finalUrl || start.url;
  const origin = new URL(landed).origin;

  if (start.passwordFields > 0) {
    return { detected: true, loginUrl: landed, how: 'The start page has a login form.' };
  }
  if (landed !== start.url && isLoginUrl(landed)) {
    return { detected: true, loginUrl: landed, how: 'The site redirects visitors to a login page.' };
  }

  // Check "Log in" links first, then common login paths
  const linkCandidates = (start.loginLinks || []).filter(u => normalizeLink(u, origin));
  const candidates = [...new Set([...linkCandidates, ...COMMON_LOGIN_PATHS.map(p => origin + p)])].slice(0, 10);
  const results = await Promise.all(candidates.map(u => crawlWebsite(u).catch(() => null)));

  for (let i = 0; i < candidates.length; i++) {
    const a = results[i];
    if (!a?.success || a.statusCode >= 400) continue;
    const fromLink = linkCandidates.includes(candidates[i]);
    // Many JS apps return 200 for any path, so a common path only counts if it
    // really has a password field; a real "Log in" link is trusted more.
    if (a.passwordFields > 0 || (fromLink && isLoginUrl(a.finalUrl || a.url))) {
      return { detected: true, loginUrl: a.finalUrl || a.url, how: 'Found a login page.' };
    }
  }

  if (linkCandidates.length) {
    return { detected: true, loginUrl: linkCandidates[0], how: 'Found a "Log in" link (the form is built with JavaScript).' };
  }

  // JavaScript apps (React, Vue…) send almost no HTML — the login form only
  // exists after scripts run, so look again in a real browser.
  if ((start.links?.total || 0) < 3) return detectLoginInBrowser(landed);

  return { detected: false };
}

// Finds a visible "Log in"/"Sign in" link or button in a rendered page
const FIND_LOGIN_LINK = `
  const els = [...document.querySelectorAll('a[href], button, [role=button]')];
  const el = els.find(e => /^(log\\s?in|sign\\s?in|member login|my account)$/i.test((e.innerText || '').trim()));
  return el ? (el.href || null) : null;`;

async function detectLoginInBrowser(url) {
  if (!selenium.isSeleniumAvailable() || !(await selenium.acquireSlot())) return { detected: false };
  let driver = null;
  try {
    driver = await selenium.createDriver();
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 20000, script: 10000 });
    await driver.get(url);
    const fields = await waitForScript(driver, FIND_FIELDS, f => f && f.pw, 8000);
    const current = await driver.getCurrentUrl();
    if (fields?.pw) return { detected: true, loginUrl: current, how: 'Found a login form (built with JavaScript).' };
    const href = await driver.executeScript(FIND_LOGIN_LINK).catch(() => null);
    if (href && normalizeLink(href, new URL(current).origin)) {
      return { detected: true, loginUrl: href, how: 'Found a "Log in" link (built with JavaScript).' };
    }
    return { detected: false };
  } catch {
    return { detected: false };
  } finally {
    if (driver) await driver.quit().catch(() => {});
    selenium.releaseSlot();
  }
}

// ─── Public crawl (HTTP) ────────────────────────────────────────────────────

async function explorePublicPages(startAnalysis, maxPages = MAX_PUBLIC_PAGES) {
  const landed = startAnalysis.finalUrl || startAnalysis.url;
  const origin = new URL(landed).origin;
  const deadline = Date.now() + PUBLIC_TIME_BUDGET_MS;

  const pages = [toPageRecord(startAnalysis, 'public')];
  const visited = new Set([normalizeLink(startAnalysis.url, origin), normalizeLink(landed, origin)].filter(Boolean));
  const queue = [];
  const protectedUrls = []; // pages that bounced to a login page or returned 401/403

  const enqueue = (links) => {
    for (const href of links || []) {
      const n = normalizeLink(href, origin);
      if (n && !visited.has(n) && !queue.includes(n)) queue.push(n);
    }
  };
  enqueue(startAnalysis.links?.internalUrls);

  while (queue.length && pages.length < maxPages && Date.now() < deadline) {
    const batch = queue.splice(0, Math.min(PUBLIC_CONCURRENCY, maxPages - pages.length));
    batch.forEach(u => visited.add(u));
    setProgress(`Crawling public pages (${pages.length}/${maxPages})…`);

    const results = await Promise.all(batch.map(u => crawlWebsite(u).catch(err => ({ url: u, success: false, error: err.message }))));

    for (let i = 0; i < batch.length; i++) {
      const a = results[i];
      const final = a.finalUrl || a.url;
      // HTTP authentication (the browser's own username/password pop-up) is
      // separate from the site's login form — a test account can't unlock it
      if (a.success && a.statusCode === 401 && a.headers?.['www-authenticate']) continue;
      const bouncedToLogin = a.success && isLoginUrl(final) && !isLoginUrl(batch[i]);
      if (a.success && (a.statusCode === 401 || a.statusCode === 403 || bouncedToLogin)) {
        protectedUrls.push(batch[i]);
        continue;
      }
      const finalNorm = normalizeLink(final, origin);
      if (finalNorm && finalNorm !== batch[i] && visited.has(finalNorm)) continue; // redirect to a page we have
      if (finalNorm) visited.add(finalNorm);
      pages.push(toPageRecord(a, 'public'));
      if (a.success) enqueue(a.links?.internalUrls);
    }
  }

  // Every URL linked from public pages is reachable without logging in, even
  // if the page cap stopped us from testing it
  const publicLinks = new Set([...visited, ...queue].filter(u => !protectedUrls.includes(u)));

  // If the start URL showed a login form (or sent us to one), what lives there
  // for logged-in users is protected content, not a public page
  const startNorm = normalizeLink(startAnalysis.url, origin);
  if (startNorm && (startAnalysis.passwordFields > 0 || (landed !== startAnalysis.url && isLoginUrl(landed)))) {
    publicLinks.delete(startNorm);
    if (!protectedUrls.includes(startNorm)) protectedUrls.push(startNorm);
  }
  return { pages, protectedUrls, publicLinks };
}

// ─── Browser login + logged-in crawl (Selenium) ────────────────────────────

// Finds visible password/username fields (works with forms built by JS)
const FIND_FIELDS = `
  const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.disabled; };
  const pw = [...document.querySelectorAll('input[type=password]')].find(visible) || null;
  const scope = (pw && pw.form) || document;
  const sel = 'input[type=email], input[autocomplete=username], input[autocomplete=email], input[name*=user i], input[name*=email i], input[name*=login i], input[id*=user i], input[id*=email i], input[id*=login i], input[type=text], input:not([type])';
  const user = [...scope.querySelectorAll(sel)].filter(visible).find(el => el !== pw) || null;
  return { pw, user };`;

// Finds the submit button next to a field
const FIND_SUBMIT = `
  const field = arguments[0];
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !el.disabled; };
  const scope = (field && field.form) || document;
  const buttons = [...scope.querySelectorAll('button, input[type=submit], [role=button]')].filter(visible);
  const label = b => (b.innerText || b.value || b.getAttribute('aria-label') || '').trim();
  return buttons.find(b => /^(log\\s?in|sign\\s?in|continue|next|submit|enter)/i.test(label(b)))
    || buttons.find(b => (b.getAttribute('type') || '').toLowerCase() === 'submit')
    || null;`;

// Reads the page state after submitting the login form
const CHECK_STATE = `
  const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const text = ((document.body && document.body.innerText) || '').toLowerCase();
  const err = text.match(/(invalid|incorrect|wrong|does not match|doesn.t match|not recognized|unable to (log|sign) in|login failed|authentication failed)[^\\n]{0,80}/);
  return {
    url: location.href,
    ready: document.readyState === 'complete',
    pwVisible: [...document.querySelectorAll('input[type=password]')].some(visible),
    captcha: !!document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare"], .g-recaptcha, .h-captcha, .cf-turnstile'),
    otp: !!document.querySelector('input[autocomplete="one-time-code"]') || /verification code|two-factor|2fa|authenticator app|one-time (pass)?code/.test(text),
    oauthOnly: /(continue|sign in|log in) with (google|github|microsoft|apple|facebook)/.test(text),
    errorText: err ? err[0].trim() : null,
    rateLimited: /too many (attempts|requests|login)|try again (later|in a few)|rate limit/.test(text),
    sessionExpired: /session (has )?(expired|timed out)|please (log|sign) in again/.test(text),
    title: document.title || '',
  };`;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** Polls a script until `done(result)` or timeout; returns the last result. */
async function waitForScript(driver, script, done, timeoutMs, ...args) {
  const end = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < end) {
    try {
      last = await driver.executeScript(script, ...args);
      if (done(last)) return last;
    } catch {
      // page navigating — try again
    }
    await sleep(500);
  }
  return last;
}

async function submitNear(driver, field) {
  const { Key } = require('selenium-webdriver');
  const button = await driver.executeScript(FIND_SUBMIT, field).catch(() => null);
  if (button) {
    try {
      await button.click();
      return;
    } catch {
      // covered by an overlay etc. — fall back to Enter
    }
  }
  await field.sendKeys(Key.ENTER);
}

const result = (status, message, extra = {}) => ({ status, message, ...extra });

function explainFailure(state, loginPath) {
  if (state?.otp) return result('unsupported', 'The site asked for a verification (2FA) code, which can\'t be entered automatically. Use a test account without 2FA.');
  if (state?.captcha) return result('unsupported', 'The login page has a CAPTCHA, which can\'t be solved automatically.');
  if (state?.rateLimited) return result('failed', 'The site is rate-limiting login attempts ("too many attempts"). Wait 15 minutes and re-run.');
  if (state?.bounced || state?.sessionExpired) {
    return result('failed', 'The login was accepted, but the site immediately lost the session and returned to the login page. '
      + 'This usually means the login cookie comes from an API on a different domain (a third-party cookie). '
      + 'Safari, Firefox strict mode and incognito windows block these — real users on those browsers can\'t stay logged in either. '
      + 'Fix: serve the API from the same domain as the site (e.g. a /api rewrite/proxy) so the cookie is first-party.');
  }
  if (state?.errorText) return result('failed', `The site rejected the login: "${state.errorText.slice(0, 100)}". Check the email and password.`);
  return result('failed', `Login didn't complete — still on ${loginPath}. Check the email and password.`);
}

// Login fields plus whether the page is a 404 or still blank (app loading)
const PROBE_LOGIN_PAGE = FIND_FIELDS.replace('return { pw, user };', `
  const text = ((document.body && document.body.innerText) || '').trim();
  const notFound = /\\b404\\b|not[ _]found|page (doesn.t|does not|could not) (exist|be found)/i.test(document.title + ' ' + text.slice(0, 400));
  return { pw, user, notFound, textLength: text.length };`);

// Clicks a visible "Log in"/"Sign in" link or button, like a visitor would
const CLICK_LOGIN_LINK = `
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const el = [...document.querySelectorAll('a, button, [role=button]')].filter(visible)
    .find(e => /^(log\\s?in|sign\\s?in|member login)$/i.test((e.innerText || '').trim()));
  if (el) { el.click(); return true; }
  return false;`;

const LOGIN_FORM_WAIT_MS = 45_000; // apps can wait on a sleeping backend before showing the form
const LOGIN_FORM_IDLE_MS = 12_000; // a page with content but no form for this long → wrong page

async function waitForLoginForm(driver) {
  const start = Date.now();
  let probe = null;
  while (Date.now() - start < LOGIN_FORM_WAIT_MS) {
    probe = await driver.executeScript(PROBE_LOGIN_PAGE).catch(() => null);
    if (probe && (probe.pw || probe.user)) return { fields: probe };
    if (probe?.notFound) return { notFound: true };
    if (probe && probe.textLength > 50 && Date.now() - start > LOGIN_FORM_IDLE_MS) break;
    await sleep(500);
  }
  return { notFound: false };
}

/**
 * Opens the login form. Tries the login URL; if that shows a 404 or no form
 * (e.g. single-page apps whose hosting only serves "/"), starts from the home
 * page and clicks "Log in" like a visitor would.
 */
async function openLoginForm(driver, loginUrl) {
  const home = new URL(loginUrl).origin + '/';
  const attempts = normalizeLink(loginUrl, new URL(loginUrl).origin) === normalizeLink(home, new URL(home).origin)
    ? [home] : [loginUrl, home];
  let directLoginBroken = false;

  for (const [i, url] of attempts.entries()) {
    await driver.get(url);
    let found = await waitForLoginForm(driver);
    if (!found.fields) {
      const clicked = await driver.executeScript(CLICK_LOGIN_LINK).catch(() => false);
      if (clicked) found = await waitForLoginForm(driver);
    }
    if (found.fields) return { fields: found.fields, directLoginBroken };
    if (i === 0 && found.notFound) directLoginBroken = true;
  }
  return { fields: null, directLoginBroken };
}

async function performLogin(driver, loginUrl, username, password) {
  const loginPath = pathOf(loginUrl);
  setProgress('Opening the login page…');
  const opened = await openLoginForm(driver, loginUrl);
  const directNote = opened.directLoginBroken
    ? ` Note: opening ${loginPath} directly shows a 404 page — see the "Pages open directly" test.` : '';

  let fields = opened.fields;
  if (!fields) {
    const state = await driver.executeScript(CHECK_STATE).catch(() => null);
    if (state?.oauthOnly) return result('unsupported', 'This site only offers "Sign in with Google/GitHub/…", which can\'t be automated.');
    if (state?.captcha) return result('unsupported', 'The login page has a CAPTCHA, which can\'t be solved automatically.');
    return result('failed', `Couldn't find a login form on ${loginPath}. Check the login page URL.${directNote}`);
  }

  setProgress('Logging in with the test account…');
  if (fields.user) {
    await fields.user.clear().catch(() => {});
    await fields.user.sendKeys(username);
  }

  if (!fields.pw) {
    // Two-step login: email first, then the password page
    await submitNear(driver, fields.user);
    fields = await waitForScript(driver, FIND_FIELDS, f => f && f.pw, 10000);
    if (!fields?.pw) {
      const state = await driver.executeScript(CHECK_STATE).catch(() => null);
      return explainFailure(state, loginPath);
    }
  }

  await fields.pw.sendKeys(password);
  await submitNear(driver, fields.pw);

  // Wait for the password field to disappear, an error, or a 2FA prompt
  await sleep(1000);
  const formUrl = await driver.getCurrentUrl().catch(() => loginUrl);
  // Both signals are brief (a flash of the dashboard, a toast), so remember them
  let leftLoginPage = false;
  let sawSessionExpired = false;
  const state = await waitForScript(driver, CHECK_STATE, (s) => {
    if (!s) return false;
    if (!urlMatches(s.url, formUrl)) leftLoginPage = true;
    if (s.sessionExpired) sawSessionExpired = true;
    const bouncedBack = leftLoginPage && s.pwVisible && urlMatches(s.url, formUrl);
    return s.ready && (!s.pwVisible || s.errorText || s.otp || s.rateLimited || s.sessionExpired || bouncedBack);
  }, 15000);
  // Went somewhere (e.g. the dashboard) and got sent back to a login form
  if (state && state.pwVisible && (leftLoginPage || sawSessionExpired)) state.bounced = true;
  if (state && !state.pwVisible) {
    // Some apps show the dashboard, then bounce back once an API call fails
    await sleep(2500);
    const later = await driver.executeScript(CHECK_STATE).catch(() => null);
    if (later?.pwVisible && (later.sessionExpired || isLoginUrl(later.url) || urlMatches(later.url, formUrl))) {
      const failure = explainFailure({ ...later, bounced: true }, loginPath);
      failure.message += directNote;
      return failure;
    }
  }
  if (!state || state.pwVisible || state.otp) {
    const failure = explainFailure(state, loginPath);
    failure.message += directNote;
    return failure;
  }

  return result('success', `Logged in as ${username}.${directNote}`, { landedUrl: state.url, directLoginBroken: opened.directLoginBroken });
}

async function readConsoleErrors(driver) {
  try {
    const logging = selenium.logging();
    const entries = await driver.manage().logs().get(logging.Type.BROWSER);
    return entries
      .filter(e => e.level?.name === 'SEVERE' && !/favicon/i.test(e.message))
      .map(e => e.message.slice(0, 200))
      .slice(0, 5);
  } catch {
    return [];
  }
}

// Waits until the number of links stops changing (JS apps draw menus late)
const LINK_COUNT = "return document.querySelectorAll('a[href]').length;";

async function waitForRender(driver) {
  const end = Date.now() + 5000;
  let last = -1;
  await sleep(600);
  while (Date.now() < end) {
    const count = await driver.executeScript(LINK_COUNT).catch(() => -1);
    if (count === last && count >= 0) return;
    last = count;
    await sleep(400);
  }
}

// Clicks a link to `url` on the current page (same thing a user does)
const CLICK_LINK_TO = `
  const target = arguments[0].replace(/\\/+$/, '');
  const norm = h => { try { const u = new URL(h); u.hash = ''; return u.href.replace(/\\/+$/, ''); } catch { return ''; } };
  const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const link = [...document.querySelectorAll('a[href]')].find(a => norm(a.href) === target && visible(a) && a.target !== '_blank');
  if (!link) return false;
  link.click();
  return true;`;

// Asks a single-page app's router to show `url` (as the Back/Forward buttons do)
const ROUTER_GO = `
  history.pushState(history.state, '', arguments[0]);
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));`;

const PAGE_FINGERPRINT = "return document.title + '|' + ((document.body && document.body.innerText) || '').slice(0, 500);";

const urlMatches = (a, b) => a.replace(/#.*$/, '').replace(/\/+$/, '') === b.replace(/#.*$/, '').replace(/\/+$/, '');

async function waitForUrl(driver, url, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const current = await driver.getCurrentUrl().catch(() => '');
    if (current && urlMatches(current, url)) return true;
    await sleep(250);
  }
  return false;
}

/**
 * Goes to `url` like a user: click a link to it; else ask the app's router;
 * load the URL directly only as a last resort. Many single-page apps are
 * hosted so that only "/" loads directly — typing a deep URL gives a 404 even
 * though the page works fine inside the app.
 */
async function navigateInApp(driver, url) {
  if (await driver.executeScript(CLICK_LINK_TO, url).catch(() => false)) {
    if (await waitForUrl(driver, url)) return 'click';
  }

  const before = await driver.executeScript(PAGE_FINGERPRINT).catch(() => '');
  await driver.executeScript(ROUTER_GO, url).catch(() => {});
  await sleep(700);
  const after = await driver.executeScript(PAGE_FINGERPRINT).catch(() => '');
  const probe = await driver.executeScript(PROBE_LOGIN_PAGE).catch(() => null);
  // The app re-rendered for the new URL (a plain website wouldn't react)
  if (after && after !== before && !probe?.notFound) return 'router';

  await driver.get(url);
  return 'direct';
}

/**
 * Plain HTTP check: does each URL load when opened directly (refresh,
 * bookmark, shared link)? Single-page apps without a catch-all rewrite
 * return 404 here. Marks `checks.directLink404` on affected pages.
 */
async function checkDirectLinks(pages) {
  await Promise.all(pages.map(async (page) => {
    try {
      await assertPublicUrl(page.url);
      const res = await fetch(page.url, { redirect: 'follow', signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'RadarAI/2.0 (+https://github.com/rahul-1909/Radar-AI)' } });
      if (res.status === 404) {
        page.checks.directLink404 = true;
        page.issues = describeIssues(page);
      }
    } catch {
      // network hiccup — don't flag
    }
  }));
}

async function crawlLoggedIn(driver, { origin, startUrls, skip, loginUrl, maxPages }) {
  const deadline = Date.now() + PRIVATE_TIME_BUDGET_MS;
  const loginNorm = normalizeLink(loginUrl, origin);
  const visited = new Set();
  const queue = [...new Set(startUrls.map(u => normalizeLink(u, origin)).filter(Boolean))]
    .filter(u => u !== loginNorm);
  const pages = [];
  let sessionLost = false;
  let first = true; // the page the login just landed on — we're already there

  while ((first || queue.length) && pages.length < maxPages && Date.now() < deadline) {
    const t0 = Date.now();
    let url;
    if (first) {
      url = (await driver.getCurrentUrl().catch(() => null)) || loginUrl;
    } else {
      url = queue.shift();
      if (visited.has(url)) continue;
      try {
        await assertPublicUrl(url);
      } catch {
        continue;
      }
      setProgress(`Testing logged-in pages (${pages.length + 1}/${maxPages})…`);
      try {
        await navigateInApp(driver, url);
      } catch (err) {
        visited.add(url);
        pages.push(toPageRecord({ url, success: false, error: err.message.split('\n')[0] }, 'private'));
        continue;
      }
    }
    visited.add(normalizeLink(url, origin));

    const state = await waitForScript(driver, CHECK_STATE, s => s && s.ready, 10000);
    await waitForRender(driver);

    const current = (await driver.getCurrentUrl().catch(() => url)) || url;
    const currentNorm = normalizeLink(current, origin);
    // A visible login form on the login page → the session ended. (The login
    // URL alone isn't enough: many apps show the dashboard at that same URL
    // once you're logged in, and "change password" pages have a password field.)
    if (!first && state?.pwVisible && (isLoginUrl(current) || currentNorm === loginNorm)) {
      sessionLost = true;
      break;
    }

    const loadTime = first ? null : (await driver.executeScript(
      "const n = performance.getEntriesByType('navigation')[0]; return n ? Math.round(n.loadEventEnd || n.duration) : null;",
    ).catch(() => null) || (Date.now() - t0));
    const html = await driver.getPageSource();
    const looks404 = /\b404\b|page not found/i.test(state?.title || '');
    const analysis = analyzeHtml(current, html, { statusCode: looks404 ? 404 : 200, responseTime: loadTime, finalUrl: current });
    const jsErrors = await readConsoleErrors(driver);

    // Redirected to a page we've already tested (e.g. / → /dashboard)
    const duplicate = currentNorm && currentNorm !== normalizeLink(url, origin) && visited.has(currentNorm);
    if (currentNorm) visited.add(currentNorm);
    // Public pages aren't re-tested — except the post-login landing page, whose
    // content is the logged-in view even when its URL showed the login form
    if (!duplicate && (first ? (currentNorm === loginNorm || !skip.has(currentNorm)) : !skip.has(currentNorm))) {
      pages.push(toPageRecord(analysis, 'private', { jsErrors }));
    }
    first = false;

    for (const href of analysis.links?.internalUrls || []) {
      const n = normalizeLink(href, origin);
      if (n && n !== loginNorm && !visited.has(n) && !queue.includes(n) && !isLoginUrl(n) && !skip.has(n)) queue.push(n);
    }
  }

  return { pages, sessionLost };
}

async function loginAndExplore({ origin, loginUrl, auth, startUrls, skip, maxPages = MAX_PRIVATE_PAGES }) {
  if (!selenium.isSeleniumAvailable()) {
    return { login: result('unavailable', 'Browser testing isn\'t available on this server, so logged-in pages couldn\'t be tested.'), pages: [] };
  }
  try {
    await assertPublicUrl(loginUrl);
  } catch (err) {
    return { login: result('failed', `Login page URL rejected: ${err.message}`), pages: [] };
  }

  setProgress('Waiting for the test browser…');
  if (!(await selenium.acquireSlot())) {
    return { login: result('busy', 'The test browser is busy with other users. Try again in a minute.'), pages: [] };
  }

  let driver = null;
  try {
    driver = await selenium.createDriver({ captureConsole: true });
    await driver.manage().setTimeouts({ implicit: 0, pageLoad: 20000, script: 10000 });

    const login = await performLogin(driver, loginUrl, auth.username, auth.password);
    if (login.status !== 'success') return { login, pages: [] };

    await readConsoleErrors(driver); // discard messages from the login step itself
    const crawl = await crawlLoggedIn(driver, {
      origin, loginUrl, maxPages, skip,
      startUrls,
    });
    setProgress('Checking that pages open directly by URL…');
    await checkDirectLinks(crawl.pages);
    if (crawl.sessionLost) login.message += ' The session ended partway through, so fewer pages were tested.';
    return { login, pages: crawl.pages };
  } catch (err) {
    // Never echo request data here — only the browser's own error line
    return { login: result('failed', `Browser error during login: ${String(err.message).split('\n')[0]}`), pages: [] };
  } finally {
    if (driver) await driver.quit().catch(() => {});
    selenium.releaseSlot();
  }
}

// ─── Site-wide test results ─────────────────────────────────────────────────

const PAGE_CHECKS = [
  { key: 'directLink404', type: 'functional', priority: 'high', title: 'Pages open directly by URL (refresh & bookmarks work)',
    browserOnly: true,
    fails: p => p.checks.directLink404,
    expected: 'Every page loads when its URL is opened directly',
    explain: 'These pages work when reached by clicking inside the app, but opening the URL directly (refreshing, a bookmark, a shared link) shows 404. Single-page apps need the server to send every route to index.html — on Vercel, add a vercel.json with { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }.' },
  { key: 'unreachable', type: 'functional', priority: 'high', title: 'Pages load without errors',
    fails: p => p.checks.unreachable || p.checks.httpError,
    expected: 'Every linked page loads successfully',
    explain: 'Broken pages frustrate users and hurt search rankings. Fix or remove links to these pages.' },
  { key: 'jsErrors', type: 'functional', priority: 'high', title: 'No JavaScript errors',
    browserOnly: true,
    fails: p => p.checks.jsErrors > 0,
    expected: 'Pages run without console errors',
    explain: 'JavaScript errors often mean broken buttons, forms, or data that never loads.' },
  { key: 'noTitle', type: 'functional', priority: 'medium', title: 'Every page has a title',
    fails: p => p.checks.noTitle,
    expected: 'A <title> on every page',
    explain: 'Titles appear in browser tabs and search results; missing ones look broken.' },
  { key: 'noMetaDescription', type: 'functional', priority: 'low', title: 'Every page has a meta description',
    fails: p => p.checks.noMetaDescription,
    expected: 'A <meta name="description"> on every page',
    explain: 'Search engines show the meta description under your link.' },
  { key: 'noH1', type: 'accessibility', priority: 'medium', title: 'Every page has an H1 heading',
    fails: p => p.checks.noH1,
    expected: 'One main heading per page',
    explain: 'Screen-reader users and search engines rely on the H1 to understand each page.' },
  { key: 'missingAlt', type: 'accessibility', priority: 'medium', title: 'Images have alt text on all pages',
    fails: p => p.checks.missingAlt > 0,
    expected: 'Alt text on every image',
    explain: 'Images without alt text are invisible to screen-reader users.' },
  { key: 'slow', type: 'performance', priority: 'medium', title: `Pages load in under ${SLOW_PAGE_MS / 1000}s`,
    fails: p => p.checks.slow,
    expected: `Load time under ${SLOW_PAGE_MS / 1000}s`,
    explain: 'Slow pages lose visitors; optimize images, scripts, and server response time.' },
];

function buildPageTests(pages) {
  if (!pages.length) return [];
  const label = p => `${p.access === 'private' ? '🔒 ' : ''}${p.path}`;
  const tests = [];

  PAGE_CHECKS.forEach((check, i) => {
    // Some checks are only measured on pages visited in the browser (logged-in pages)
    const applicable = check.browserOnly ? pages.filter(p => p.access === 'private') : pages;
    if (!applicable.length) return;
    const failing = applicable.filter(p => !p.checks.unreachable || check.key === 'unreachable').filter(check.fails);
    tests.push({
      id: `PG-${String(i + 1).padStart(3, '0')}`,
      type: check.type,
      priority: check.priority,
      category: 'pages',
      title: `${check.title} (${applicable.length} pages)`,
      passed: failing.length === 0,
      expected: check.expected,
      actual: failing.length
        ? `${failing.length} of ${applicable.length} pages: ${failing.slice(0, 5).map(label).join(', ')}${failing.length > 5 ? ', …' : ''}`
        : `All ${applicable.length} pages pass`,
      explanation: failing.length ? check.explain : `Checked ${applicable.length} pages — no problems found.`,
      duration: 0,
      pages: failing.map(label),
    });
  });

  return tests;
}

// ─── Orchestration ──────────────────────────────────────────────────────────

/**
 * Explore the site from its start page. `auth` is the user's test account
 * ({ loginUrl?, username, password }) or null.
 */
async function exploreSite(startAnalysis, auth) {
  const landed = startAnalysis.finalUrl || startAnalysis.url;
  const origin = new URL(landed).origin;

  const publicCrawl = await explorePublicPages(startAnalysis);

  setProgress('Looking for a login page…');
  const detection = auth?.loginUrl
    ? { detected: true, loginUrl: auth.loginUrl }
    : await detectLogin(startAnalysis.url, startAnalysis);

  let login;
  let privatePages = [];

  if (auth) {
    if (!detection.detected) {
      login = result('failed', 'Couldn\'t find the login page automatically. Enter the login page URL in Project Configuration.');
    } else {
      const explored = await loginAndExplore({
        origin,
        auth,
        loginUrl: detection.loginUrl,
        startUrls: [...publicCrawl.protectedUrls, landed],
        skip: publicCrawl.publicLinks,
      });
      login = explored.login;
      privatePages = explored.pages;
    }
  } else if (detection.detected) {
    login = result('not-provided', `Found a login page at ${pathOf(detection.loginUrl)}. Add a test account to test the pages behind it.`);
  } else {
    login = result('none', 'No login page found — all reachable pages are public.');
  }

  const pages = [...publicCrawl.pages, ...privatePages];
  return {
    login: { ...login, loginUrl: detection.loginUrl || null, username: auth?.username || null },
    pages,
    counts: {
      public: publicCrawl.pages.length,
      private: privatePages.length,
      protectedFound: publicCrawl.protectedUrls.length,
    },
    tests: buildPageTests(pages),
  };
}

module.exports = { detectLogin, exploreSite };
