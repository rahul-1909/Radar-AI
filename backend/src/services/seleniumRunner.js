/**
 * Selenium Runner — Real Browser UI Testing
 * 
 * Runs headless Chrome via Selenium WebDriver to execute
 * real browser-based frontend tests. Graceful fallback
 * if Chrome/Chromium is not available.
 */

let seleniumAvailable = false;
let Builder, By, until, Options, ServiceBuilder, logging;

if (process.env.SELENIUM_ENABLED === 'false') {
  console.log('[Selenium] Disabled via SELENIUM_ENABLED=false');
} else {
  try {
    const selenium = require('selenium-webdriver');
    const chrome = require('selenium-webdriver/chrome');
    Builder = selenium.Builder;
    By = selenium.By;
    until = selenium.until;
    Options = chrome.Options;
    ServiceBuilder = chrome.ServiceBuilder;
    logging = selenium.logging;
    seleniumAvailable = true;
    console.log('[Selenium] WebDriver loaded — Chrome tests enabled');
  } catch (err) {
    console.warn('[Selenium] WebDriver not available:', err.message);
  }
}

// Each headless Chrome uses ~200-300 MB, so on small hosted instances only a
// limited number may run at once. Extra runs wait in a queue for a slot.
const MAX_CONCURRENT = Math.max(1, parseInt(process.env.SELENIUM_MAX_CONCURRENCY || '1', 10));
// A logged-in crawl can hold Chrome for ~2 minutes, so waiters are patient
const QUEUE_WAIT_MS = 150000;
let activeRuns = 0;
const waiting = [];

function acquireSlot() {
  if (activeRuns < MAX_CONCURRENT) {
    activeRuns++;
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const entry = { resolve, timer: null };
    entry.timer = setTimeout(() => {
      waiting.splice(waiting.indexOf(entry), 1);
      resolve(false);
    }, QUEUE_WAIT_MS);
    waiting.push(entry);
  });
}

function releaseSlot() {
  const next = waiting.shift();
  if (next) {
    clearTimeout(next.timer);
    next.resolve(true); // hand the slot straight to the next waiter
  } else {
    activeRuns--;
  }
}

const TIMEOUT = 20000; // 20s per test
const NAVIGATION_TIMEOUT = 15000;

/**
 * Build a headless Chrome driver
 */
async function createDriver({ captureConsole = false } = {}) {
  const options = new Options();
  // Behave like default desktop Chrome: allow third-party cookies. Some
  // Chromium builds (e.g. Linux distro packages) block them, which breaks
  // logins on sites whose API lives on another domain.
  options.setUserPreferences({ 'profile.cookie_controls_mode': 0, 'profile.block_third_party_cookies': false });
  if (captureConsole) {
    // Collect page JavaScript errors (read back via driver.manage().logs())
    const prefs = new logging.Preferences();
    prefs.setLevel(logging.Type.BROWSER, logging.Level.SEVERE);
    options.setLoggingPrefs(prefs);
  }
  options.addArguments(
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--window-size=1920,1080',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
  );

  // In Docker, use the system Chromium + chromedriver (see backend/Dockerfile).
  // Otherwise Selenium Manager locates/downloads a matching driver.
  if (process.env.CHROME_BIN) options.setChromeBinaryPath(process.env.CHROME_BIN);
  const builder = new Builder().forBrowser('chrome').setChromeOptions(options);
  if (process.env.CHROMEDRIVER_PATH) builder.setChromeService(new ServiceBuilder(process.env.CHROMEDRIVER_PATH));

  const driver = await builder.build();

  await driver.manage().setTimeouts({
    implicit: 5000,
    pageLoad: NAVIGATION_TIMEOUT,
    script: 10000,
  });

  return driver;
}

/**
 * Run Selenium-based frontend tests against a URL
 * @param {string} url - The website URL to test
 * @param {object} siteAnalysis - Crawled site data for context
 * @returns {Promise<Array>} Test results in standard format
 */
async function runSeleniumTests(url, siteAnalysis) {
  if (!seleniumAvailable) {
    console.log('[Selenium] Skipped — Chrome not available');
    return [];
  }

  if (!(await acquireSlot())) {
    console.warn('[Selenium] Skipped — all browser slots busy');
    return [];
  }
  // The slot is held until Chrome has actually exited, even if we time out below
  const run = _runSeleniumTestsInternal(url, siteAnalysis).finally(releaseSlot);

  // Wrap in a timeout so Selenium never blocks the pipeline
  const SELENIUM_TIMEOUT = 30000; // 30s max for all Selenium tests
  return Promise.race([
    run,
    new Promise((resolve) => {
      setTimeout(() => {
        console.warn('[Selenium] Timed out after 30s — skipping');
        resolve([{
          id: 'SEL-TIMEOUT', type: 'ui', priority: 'medium', category: 'selenium',
          title: 'Selenium — Timeout',
          passed: false, expected: 'Tests complete within 30s',
          actual: 'Selenium tests timed out',
          explanation: 'Chrome-based tests did not complete within 30 seconds. Chrome may not be properly installed or is unresponsive.',
          duration: SELENIUM_TIMEOUT,
        }]);
      }, SELENIUM_TIMEOUT);
    }),
  ]);
}

async function _runSeleniumTestsInternal(url, siteAnalysis) {

  const results = [];
  let testId = 500;
  const id = () => `SEL-${String(testId++).padStart(3, '0')}`;
  let driver = null;

  try {
    driver = await createDriver();
    console.log('[Selenium] Chrome driver created — running UI tests...');

    // ── Test 1: Page Load & Title ──
    try {
      const startTime = Date.now();
      await driver.get(url);
      const loadTime = Date.now() - startTime;
      const title = await driver.getTitle();
      const hasTitle = title && title.trim().length > 0;
      results.push({
        id: id(), type: 'ui', priority: 'high', category: 'selenium',
        title: 'Selenium — Page Load & Title',
        passed: hasTitle && loadTime < 10000,
        expected: 'Page loads within 10s with a valid title',
        actual: `Loaded in ${loadTime}ms, title: "${title?.substring(0, 60) || 'None'}"`,
        explanation: hasTitle
          ? `Page loaded successfully in ${loadTime}ms with title "${title.substring(0, 60)}".`
          : 'Page loaded but has no title tag. Every page should have a descriptive title.',
        duration: loadTime,
      });
    } catch (err) {
      results.push({
        id: id(), type: 'ui', priority: 'critical', category: 'selenium',
        title: 'Selenium — Page Load & Title',
        passed: false, expected: 'Page loads within 10s', actual: `Error: ${err.message}`,
        explanation: `Page failed to load in Chrome: ${err.message}. This is a critical issue.`,
        duration: 0,
      });
    }

    // ── Test 2: JavaScript Errors ──
    try {
      const logs = await driver.manage().logs().get('browser');
      const jsErrors = logs.filter(l => l.level.name === 'SEVERE');
      results.push({
        id: id(), type: 'functional', priority: 'high', category: 'selenium',
        title: 'Selenium — No JavaScript Console Errors',
        passed: jsErrors.length === 0,
        expected: 'No SEVERE console errors',
        actual: jsErrors.length === 0
          ? 'No JavaScript errors detected'
          : `${jsErrors.length} error(s): ${jsErrors.slice(0, 2).map(e => e.message.substring(0, 80)).join('; ')}`,
        explanation: jsErrors.length === 0
          ? 'Chrome console shows no JavaScript errors — the page runs cleanly.'
          : `${jsErrors.length} JavaScript error(s) found in the console. These can cause features to break for users.`,
        duration: 0,
      });
    } catch {
      // Some Chrome versions don't support log access
    }

    // ── Test 3: Interactive Elements Exist ──
    try {
      const buttons = await driver.findElements(By.css('button, [role="button"], input[type="submit"]'));
      const links = await driver.findElements(By.css('a[href]'));
      const inputs = await driver.findElements(By.css('input, textarea, select'));
      const totalInteractive = buttons.length + links.length + inputs.length;
      results.push({
        id: id(), type: 'ui', priority: 'medium', category: 'selenium',
        title: 'Selenium — Interactive Elements Present',
        passed: totalInteractive > 0,
        expected: 'Page has interactive elements (buttons, links, inputs)',
        actual: `${buttons.length} buttons, ${links.length} links, ${inputs.length} inputs`,
        explanation: totalInteractive > 0
          ? `Page has ${totalInteractive} interactive elements (${buttons.length} buttons, ${links.length} links, ${inputs.length} inputs).`
          : 'No interactive elements found. The page may not be fully rendered or is purely static.',
        duration: 0,
      });
    } catch (err) {
      results.push({
        id: id(), type: 'ui', priority: 'medium', category: 'selenium',
        title: 'Selenium — Interactive Elements Present',
        passed: false, expected: 'Interactive elements found', actual: `Error: ${err.message}`,
        explanation: 'Could not query interactive elements from the rendered page.', duration: 0,
      });
    }

    // ── Test 4: Responsive — Mobile Viewport (375px) ──
    try {
      await driver.manage().window().setRect({ width: 375, height: 812 });
      await driver.sleep(500);
      const bodyWidth = await driver.executeScript('return document.body.scrollWidth');
      const viewportWidth = await driver.executeScript('return window.innerWidth');
      const hasOverflow = bodyWidth > viewportWidth + 10;
      results.push({
        id: id(), type: 'ui', priority: 'high', category: 'selenium',
        title: 'Selenium — Mobile Responsive (375px)',
        passed: !hasOverflow,
        expected: 'No horizontal overflow at 375px width',
        actual: hasOverflow
          ? `Horizontal overflow detected: body=${bodyWidth}px, viewport=${viewportWidth}px`
          : `No overflow: body fits within ${viewportWidth}px viewport`,
        explanation: hasOverflow
          ? `At 375px (iPhone), the page content overflows horizontally (${bodyWidth}px wide). Users will need to scroll sideways.`
          : 'Page renders correctly at mobile width (375px) with no horizontal scrolling needed.',
        duration: 0,
      });
      // Reset viewport
      await driver.manage().window().setRect({ width: 1920, height: 1080 });
    } catch (err) {
      results.push({
        id: id(), type: 'ui', priority: 'high', category: 'selenium',
        title: 'Selenium — Mobile Responsive (375px)',
        passed: false, expected: 'No overflow at mobile width', actual: `Error: ${err.message}`,
        explanation: 'Could not test mobile responsiveness.', duration: 0,
      });
    }

    // ── Test 5: Responsive — Tablet Viewport (768px) ──
    try {
      await driver.manage().window().setRect({ width: 768, height: 1024 });
      await driver.sleep(500);
      const bodyWidth = await driver.executeScript('return document.body.scrollWidth');
      const viewportWidth = await driver.executeScript('return window.innerWidth');
      const hasOverflow = bodyWidth > viewportWidth + 10;
      results.push({
        id: id(), type: 'ui', priority: 'medium', category: 'selenium',
        title: 'Selenium — Tablet Responsive (768px)',
        passed: !hasOverflow,
        expected: 'No horizontal overflow at 768px width',
        actual: hasOverflow
          ? `Overflow: body=${bodyWidth}px, viewport=${viewportWidth}px`
          : `No overflow at ${viewportWidth}px`,
        explanation: hasOverflow
          ? `At tablet width (768px), content overflows horizontally.`
          : 'Page renders correctly at tablet width (768px).',
        duration: 0,
      });
      await driver.manage().window().setRect({ width: 1920, height: 1080 });
    } catch {
      // Skip silently
    }

    // ── Test 6: First Contentful Paint ──
    try {
      const fcp = await driver.executeScript(`
        const entries = performance.getEntriesByName('first-contentful-paint');
        return entries.length > 0 ? entries[0].startTime : null;
      `);
      if (fcp !== null) {
        results.push({
          id: id(), type: 'performance', priority: 'high', category: 'selenium',
          title: 'Selenium — First Contentful Paint',
          passed: fcp < 3000,
          expected: 'FCP under 3 seconds',
          actual: `${Math.round(fcp)}ms`,
          explanation: fcp < 3000
            ? `First Contentful Paint at ${Math.round(fcp)}ms — good performance.`
            : `First Contentful Paint at ${Math.round(fcp)}ms — exceeds 3s threshold. Users may experience slow loading.`,
          duration: Math.round(fcp),
        });
      }
    } catch {
      // Not all pages support performance API
    }

    // ── Test 7: Images Render (no broken images) ──
    try {
      const brokenImages = await driver.executeScript(`
        const imgs = document.querySelectorAll('img');
        let broken = 0;
        imgs.forEach(img => { if (!img.complete || img.naturalWidth === 0) broken++; });
        return { total: imgs.length, broken };
      `);
      if (brokenImages.total > 0) {
        results.push({
          id: id(), type: 'ui', priority: 'medium', category: 'selenium',
          title: 'Selenium — No Broken Images',
          passed: brokenImages.broken === 0,
          expected: 'All images load successfully',
          actual: brokenImages.broken === 0
            ? `All ${brokenImages.total} images loaded`
            : `${brokenImages.broken}/${brokenImages.total} images broken`,
          explanation: brokenImages.broken === 0
            ? `All ${brokenImages.total} images rendered successfully in the browser.`
            : `${brokenImages.broken} out of ${brokenImages.total} images failed to load. Visitors will see broken image placeholders.`,
          duration: 0,
        });
      }
    } catch {
      // Skip silently
    }

    // ── Test 8: No Mixed Content ──
    try {
      if (url.startsWith('https://')) {
        const mixedContent = await driver.executeScript(`
          const elements = document.querySelectorAll('img[src^="http:"], script[src^="http:"], link[href^="http:"]');
          return elements.length;
        `);
        results.push({
          id: id(), type: 'security', priority: 'high', category: 'selenium',
          title: 'Selenium — No Mixed Content',
          passed: mixedContent === 0,
          expected: 'No HTTP resources on HTTPS page',
          actual: mixedContent === 0 ? 'No mixed content' : `${mixedContent} HTTP resource(s) on HTTPS page`,
          explanation: mixedContent === 0
            ? 'No mixed content detected — all resources loaded over HTTPS.'
            : `${mixedContent} resource(s) loaded over HTTP on an HTTPS page. Browsers may block these or show warnings.`,
          duration: 0,
        });
      }
    } catch {
      // Skip silently
    }

    console.log(`[Selenium] ✓ Completed ${results.length} UI tests`);
  } catch (err) {
    console.error('[Selenium] Driver error:', err.message);
    results.push({
      id: id(), type: 'ui', priority: 'critical', category: 'selenium',
      title: 'Selenium — Browser Setup',
      passed: false, expected: 'Chrome launches successfully',
      actual: `Failed: ${err.message}`,
      explanation: `Could not start headless Chrome: ${err.message}. Ensure Chrome/Chromium is installed.`,
      duration: 0,
    });
  } finally {
    if (driver) {
      try { await driver.quit(); } catch {}
    }
  }

  return results;
}

module.exports = {
  runSeleniumTests,
  createDriver,
  acquireSlot,
  releaseSlot,
  isSeleniumAvailable: () => seleniumAvailable,
  logging: () => logging,
};
