/**
 * Newman Runner — Automated Postman/API Testing
 * 
 * Auto-generates Postman collections from crawled site data
 * and runs them via Newman CLI. No manual collection setup needed.
 */

const newman = require('newman');

/**
 * Generate a Postman collection JSON from crawled site analysis
 * @param {string} url - Base URL
 * @param {object} siteAnalysis - Crawled site data
 * @returns {object} Postman Collection v2.1 format
 */
function generateCollection(url, siteAnalysis) {
  const items = [];

  // ── Main page GET ──
  items.push({
    name: 'Homepage — GET',
    request: {
      method: 'GET',
      url: url,
      header: [{ key: 'User-Agent', value: 'RadarAI/2.0 Newman Prober' }],
    },
    event: [{
      listen: 'test',
      script: {
        exec: [
          'pm.test("Status code is 200", function () { pm.response.to.have.status(200); });',
          'pm.test("Response time < 5s", function () { pm.expect(pm.response.responseTime).to.be.below(5000); });',
          'pm.test("Has HTML content", function () { pm.expect(pm.response.headers.get("Content-Type")).to.include("text/html"); });',
        ],
      },
    }],
  });

  // ── HEAD request ──
  items.push({
    name: 'Homepage — HEAD',
    request: {
      method: 'HEAD',
      url: url,
      header: [{ key: 'User-Agent', value: 'RadarAI/2.0 Newman Prober' }],
    },
    event: [{
      listen: 'test',
      script: {
        exec: [
          'pm.test("HEAD returns 200", function () { pm.response.to.have.status(200); });',
          'pm.test("No response body", function () { pm.expect(pm.response.text()).to.have.lengthOf(0); });',
        ],
      },
    }],
  });

  // ── Security headers check ──
  items.push({
    name: 'Security Headers',
    request: {
      method: 'GET',
      url: url,
      header: [{ key: 'User-Agent', value: 'RadarAI/2.0 Newman Prober' }],
    },
    event: [{
      listen: 'test',
      script: {
        exec: [
          'pm.test("Has X-Frame-Options or CSP", function () {',
          '  const xfo = pm.response.headers.get("X-Frame-Options");',
          '  const csp = pm.response.headers.get("Content-Security-Policy");',
          '  pm.expect(xfo || csp).to.not.be.undefined;',
          '});',
          'pm.test("Has X-Content-Type-Options", function () {',
          '  pm.expect(pm.response.headers.get("X-Content-Type-Options")).to.not.be.undefined;',
          '});',
        ],
      },
    }],
  });

  // ── Internal link checks (up to 5) ──
  const internalLinks = (siteAnalysis.links?.internalUrls || []).slice(0, 5);
  internalLinks.forEach((link, i) => {
    items.push({
      name: `Internal Link ${i + 1} — ${new URL(link, url).pathname}`,
      request: {
        method: 'GET',
        url: link,
        header: [{ key: 'User-Agent', value: 'RadarAI/2.0 Newman Prober' }],
      },
      event: [{
        listen: 'test',
        script: {
          exec: [
            `pm.test("Link ${i + 1} returns success", function () { pm.response.to.have.status(200); });`,
            `pm.test("Link ${i + 1} responds < 5s", function () { pm.expect(pm.response.responseTime).to.be.below(5000); });`,
          ],
        },
      }],
    });
  });

  // ── Form action endpoints ──
  const forms = (siteAnalysis.forms || []).slice(0, 3);
  forms.forEach((form, i) => {
    if (form.action && form.action.length > 0) {
      let formUrl;
      try { formUrl = new URL(form.action, url).href; } catch { return; }
      items.push({
        name: `Form Endpoint ${i + 1} — ${form.method || 'GET'} ${form.action}`,
        request: {
          method: form.method || 'GET',
          url: formUrl,
          header: [{ key: 'User-Agent', value: 'RadarAI/2.0 Newman Prober' }],
        },
        event: [{
          listen: 'test',
          script: {
            exec: [
              `pm.test("Form endpoint responds", function () { pm.response.to.not.have.status(404); });`,
              `pm.test("Form endpoint responds < 5s", function () { pm.expect(pm.response.responseTime).to.be.below(5000); });`,
            ],
          },
        }],
      });
    }
  });

  // ── Favicon check ──
  items.push({
    name: 'Favicon',
    request: {
      method: 'GET',
      url: `${new URL(url).origin}/favicon.ico`,
    },
    event: [{
      listen: 'test',
      script: {
        exec: [
          'pm.test("Favicon exists", function () { pm.expect([200, 301, 302]).to.include(pm.response.code); });',
        ],
      },
    }],
  });

  // ── robots.txt check ──
  items.push({
    name: 'Robots.txt',
    request: {
      method: 'GET',
      url: `${new URL(url).origin}/robots.txt`,
    },
    event: [{
      listen: 'test',
      script: {
        exec: [
          'pm.test("robots.txt exists", function () { pm.expect([200, 301, 302]).to.include(pm.response.code); });',
        ],
      },
    }],
  });

  return {
    info: {
      name: `RadarAI API Prober — ${url}`,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      description: `RadarAI automated API test collection for ${url}`,
    },
    item: items,
  };
}

/**
 * Run Newman tests against the target URL
 * @param {string} url - The website URL
 * @param {object} siteAnalysis - Crawled site data
 * @returns {Promise<Array>} Test results in standard format
 */
async function runNewmanTests(url, siteAnalysis) {
  return new Promise((resolve) => {
    try {
      const collection = generateCollection(url, siteAnalysis);
      console.log(`[Newman] Running ${collection.item.length} API tests...`);

      const results = [];
      let testId = 600;
      const id = () => `NWM-${String(testId++).padStart(3, '0')}`;

      newman.run({
        collection,
        reporters: ['cli'],
        silent: true,
        timeout: 30000,
        timeoutRequest: 10000,
      }, (err, summary) => {
        if (err) {
          console.error('[Newman] Run error:', err.message);
          results.push({
            id: id(), type: 'api', priority: 'high', category: 'newman',
            title: 'Newman — Collection Execution',
            passed: false, expected: 'Newman runs successfully', actual: `Error: ${err.message}`,
            explanation: `Newman failed to execute: ${err.message}`, duration: 0,
          });
          return resolve(results);
        }

        const run = summary.run;

        // Map each execution to a test result
        (run.executions || []).forEach((exec) => {
          const itemName = exec.item?.name || 'Unknown';
          const responseCode = exec.response?.code || 0;
          const responseTime = exec.response?.responseTime || 0;
          const assertions = exec.assertions || [];

          const allPassed = assertions.every(a => !a.error);
          const failedAssertions = assertions.filter(a => a.error);

          results.push({
            id: id(), type: 'api', priority: failedAssertions.length > 0 ? 'high' : 'medium',
            category: 'newman',
            title: `Newman — ${itemName}`,
            passed: allPassed && responseCode > 0 && responseCode < 400,
            expected: assertions.map(a => a.assertion).join('; ') || 'Request succeeds',
            actual: responseCode > 0
              ? `Status ${responseCode}, ${responseTime}ms${failedAssertions.length > 0 ? `, ${failedAssertions.length} assertion(s) failed` : ''}`
              : 'No response received',
            explanation: allPassed
              ? `${itemName}: All ${assertions.length} assertions passed. Response: ${responseCode} in ${responseTime}ms.`
              : `${itemName}: ${failedAssertions.length} of ${assertions.length} assertions failed. ${failedAssertions.map(a => a.error?.message || a.assertion).join('; ')}`,
            duration: responseTime,
          });
        });

        // Summary test
        results.push({
          id: id(), type: 'api', priority: 'medium', category: 'newman',
          title: 'Newman — Overall API Health',
          passed: (run.stats?.assertions?.failed || 0) === 0,
          expected: 'All API assertions pass',
          actual: `${run.stats?.assertions?.total || 0} assertions: ${(run.stats?.assertions?.total || 0) - (run.stats?.assertions?.failed || 0)} passed, ${run.stats?.assertions?.failed || 0} failed`,
          explanation: (run.stats?.assertions?.failed || 0) === 0
            ? `All ${run.stats?.assertions?.total || 0} Newman assertions passed across ${run.stats?.requests?.total || 0} requests.`
            : `${run.stats?.assertions?.failed || 0} of ${run.stats?.assertions?.total || 0} assertions failed across ${run.stats?.requests?.total || 0} API requests.`,
          duration: run.timings?.completed && run.timings?.started ? run.timings.completed - run.timings.started : 0,
        });

        console.log(`[Newman] ✓ Completed ${results.length} API tests (${run.stats?.assertions?.failed || 0} failures)`);
        resolve(results);
      });
    } catch (err) {
      console.error('[Newman] Setup error:', err.message);
      resolve([{
        id: 'NWM-ERR', type: 'api', priority: 'high', category: 'newman',
        title: 'Newman — Setup Error',
        passed: false, expected: 'Newman initializes', actual: err.message,
        explanation: `Newman failed to initialize: ${err.message}`, duration: 0,
      }]);
    }
  });
}

module.exports = { runNewmanTests };
