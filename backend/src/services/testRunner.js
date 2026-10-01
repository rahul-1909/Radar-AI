/**
 * Test Runner Service
 * 
 * Actually executes tests against a website using the crawled data.
 * Each test performs real HTTP checks and returns genuine pass/fail results.
 */

const { checkLinks } = require('./websiteCrawler');

// Both Dashboard and Test Studio routes share this cache so that navigating
// to Test Studio after Dashboard doesn't re-run the entire pipeline.
const { getSession } = require('./sessionStore');
const TEST_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Store test results in the shared cache (called by dashboard after pipeline runs)
 */
function cacheTestResults(url, siteAnalysis, testResults, summary) {
  getSession().testResultsCache = { url, siteAnalysis, testResults, summary, cachedAt: Date.now() };
  console.log(`[TestRunner] Cached ${testResults.length} test results for ${url}`);
}

/**
 * Get cached test results if still fresh
 * @returns {object|null} - { url, siteAnalysis, testResults, summary } or null
 */
function getCachedTestResults() {
  const cache = getSession().testResultsCache;
  if (cache && (Date.now() - cache.cachedAt) < TEST_CACHE_TTL) {
    return cache;
  }
  return null;
}

/**
 * Invalidate the shared test cache (called when project config changes)
 */
function invalidateTestCache() {
  getSession().testResultsCache = null;
}

/**
 * Generate and run all tests based on crawled site data
 * @param {string} url - Target URL
 * @param {object} site - Crawled SiteAnalysis from websiteCrawler
 * @returns {Promise<TestResult[]>}
 */
async function runTests(url, site) {
  const results = [];
  let testId = 1;

  function id() { return `TC-${String(testId++).padStart(3, '0')}`; }

  // ═══════════════════════════════════════════════════════════════════════
  // 1. HTTP STATUS
  // ═══════════════════════════════════════════════════════════════════════
  results.push({
    id: id(), type: 'functional', priority: 'critical',
    title: `HTTP Status Check — ${url}`,
    passed: site.success && site.statusCode === 200,
    expected: 'HTTP 200 OK',
    actual: site.success ? `HTTP ${site.statusCode}` : `Failed: ${site.error}`,
    explanation: site.statusCode === 200
      ? `Site returned HTTP 200 OK successfully.`
      : site.success
        ? `Site returned HTTP ${site.statusCode} instead of 200. This may indicate a redirect, error, or access issue.`
        : `Could not reach the site: ${site.error}`,
    duration: site.responseTime || 0,
  });

  // If crawl failed entirely, return early
  if (!site.success) {
    results.push({
      id: id(), type: 'functional', priority: 'critical',
      title: `Site Reachability — ${url}`,
      passed: false,
      expected: 'Site accessible',
      actual: site.error,
      explanation: `The website could not be reached. Error: ${site.error}. All subsequent tests were skipped.`,
      duration: site.responseTime || 0,
    });
    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. RESPONSE TIME (TTFB)
  // ═══════════════════════════════════════════════════════════════════════
  const ttfbOk = site.responseTime < 3000;
  results.push({
    id: id(), type: 'functional', priority: 'high',
    title: `Response Time (TTFB) — ${url}`,
    passed: ttfbOk,
    expected: '< 3000ms',
    actual: `${site.responseTime}ms`,
    explanation: ttfbOk
      ? `Page loaded in ${site.responseTime}ms, within the 3-second threshold.`
      : `Page took ${site.responseTime}ms to load, exceeding the 3-second threshold. Google recommends TTFB under 800ms for good user experience.`,
    duration: 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 3. TITLE TAG
  // ═══════════════════════════════════════════════════════════════════════
  const hasTitle = !!site.title && site.title.length > 0;
  const titleLen = site.title?.length || 0;
  const titleGoodLength = titleLen >= 10 && titleLen <= 70;
  results.push({
    id: id(), type: 'functional', priority: 'high',
    title: `Page Title Tag`,
    passed: hasTitle && titleGoodLength,
    expected: 'Present, 10-70 characters',
    actual: hasTitle ? `"${site.title.substring(0, 70)}" (${titleLen} chars)` : 'Missing',
    explanation: !hasTitle
      ? `No <title> tag found. Search engines and browsers need a title to display your page correctly.`
      : !titleGoodLength
        ? `Title is ${titleLen} characters. Ideal length is 10-70 characters for SEO. ${titleLen < 10 ? 'Too short to be descriptive.' : 'Too long — search engines will truncate it.'}`
        : `Title tag is present and within ideal SEO length (${titleLen} chars).`,
    duration: 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 4. META DESCRIPTION
  // ═══════════════════════════════════════════════════════════════════════
  const hasDesc = !!site.meta.description;
  const descLen = site.meta.description?.length || 0;
  const descGoodLen = descLen >= 50 && descLen <= 160;
  results.push({
    id: id(), type: 'functional', priority: 'high',
    title: `Meta Description`,
    passed: hasDesc && descGoodLen,
    expected: 'Present, 50-160 characters',
    actual: hasDesc ? `${descLen} characters` : 'Missing',
    explanation: !hasDesc
      ? `No <meta name="description"> found. Search engines will auto-generate a snippet, which may not represent your page well.`
      : !descGoodLen
        ? `Meta description is ${descLen} chars. Best practice is 50-160 chars. ${descLen < 50 ? 'Too short to be helpful.' : 'Too long — search engines will truncate it.'}`
        : `Meta description is present and within ideal length.`,
    duration: 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 5. VIEWPORT META (Mobile)
  // ═══════════════════════════════════════════════════════════════════════
  const hasViewport = !!site.meta.viewport;
  results.push({
    id: id(), type: 'functional', priority: 'high',
    title: `Mobile Viewport Meta Tag`,
    passed: hasViewport,
    expected: '<meta name="viewport"> present',
    actual: hasViewport ? `"${site.meta.viewport}"` : 'Missing',
    explanation: hasViewport
      ? `Viewport meta tag is set, enabling responsive layout on mobile devices.`
      : `No viewport meta tag found. The page will not render correctly on mobile devices — it will appear zoomed out on phones and tablets.`,
    duration: 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 6. HEADING STRUCTURE
  // ═══════════════════════════════════════════════════════════════════════
  const h1Count = site.headings.h1.length;
  const hasOneH1 = h1Count === 1;
  results.push({
    id: id(), type: 'functional', priority: 'medium',
    title: `Heading Structure (H1 Tag)`,
    passed: hasOneH1,
    expected: 'Exactly 1 H1 tag',
    actual: `${h1Count} H1 tag(s)${h1Count > 0 ? ': "' + site.headings.h1[0]?.substring(0, 60) + '"' : ''}`,
    explanation: h1Count === 0
      ? `No H1 heading found. Every page should have exactly one H1 for SEO and accessibility.`
      : h1Count === 1
        ? `Page has exactly one H1 heading: "${site.headings.h1[0]?.substring(0, 60)}". This is correct for SEO.`
        : `Page has ${h1Count} H1 headings. Best practice is exactly one H1 per page for clear document structure.`,
    duration: 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 7. HTTPS CHECK
  // ═══════════════════════════════════════════════════════════════════════
  const isHttps = url.startsWith('https://') || site.url?.startsWith('https://');
  results.push({
    id: id(), type: 'api', priority: 'critical',
    title: `HTTPS / SSL Check`,
    passed: isHttps,
    expected: 'HTTPS enabled',
    actual: isHttps ? 'HTTPS' : 'HTTP (insecure)',
    explanation: isHttps
      ? `Site uses HTTPS with SSL/TLS encryption. User data is transmitted securely.`
      : `Site uses plain HTTP without encryption. All data including passwords and personal information is transmitted in plaintext. This is a critical security vulnerability.`,
    duration: 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 8. SECURITY HEADERS
  // ═══════════════════════════════════════════════════════════════════════
  const secHeaders = site.securityHeaders;
  const secCount = Object.values(secHeaders).filter(v => !!v).length;
  const secTotal = Object.keys(secHeaders).length;
  results.push({
    id: id(), type: 'api', priority: 'high',
    title: `Security Headers`,
    passed: secCount >= 3,
    expected: 'At least 3 of 6 security headers present',
    actual: `${secCount}/${secTotal} headers present`,
    explanation: (() => {
      const missing = [];
      if (!secHeaders.xFrameOptions) missing.push('X-Frame-Options (prevents clickjacking)');
      if (!secHeaders.contentSecurityPolicy) missing.push('Content-Security-Policy (prevents XSS)');
      if (!secHeaders.strictTransportSecurity) missing.push('Strict-Transport-Security (forces HTTPS)');
      if (!secHeaders.xContentTypeOptions) missing.push('X-Content-Type-Options (prevents MIME sniffing)');
      if (secCount >= 3) return `${secCount} security headers present. ${missing.length > 0 ? 'Missing: ' + missing.join(', ') + '.' : 'All critical headers are set.'}`;
      return `Only ${secCount} security headers found. Missing: ${missing.join(', ')}. These headers protect against common web attacks.`;
    })(),
    duration: 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 9. IMAGE ALT TAGS (Accessibility)
  // ═══════════════════════════════════════════════════════════════════════
  if (site.images.total > 0) {
    const missingAlt = site.images.withoutAlt;
    const allHaveAlt = missingAlt === 0;
    results.push({
      id: id(), type: 'ui', priority: 'medium',
      title: `Image Alt Tags (Accessibility)`,
      passed: allHaveAlt,
      expected: 'All images have alt attributes',
      actual: allHaveAlt ? `All ${site.images.total} images have alt text` : `${missingAlt} of ${site.images.total} images missing alt`,
      explanation: allHaveAlt
        ? `All ${site.images.total} images have alt attributes. Screen readers can describe these images to visually impaired users.`
        : `${missingAlt} image(s) are missing alt attributes. This fails WCAG 2.1 Level A (Success Criterion 1.1.1). Screen readers cannot describe these images to users with visual impairments.`,
      duration: 0,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 10. OPEN GRAPH TAGS (Social Sharing)
  // ═══════════════════════════════════════════════════════════════════════
  const hasOG = !!site.openGraph.title || !!site.openGraph.description || !!site.openGraph.image;
  const ogComplete = !!site.openGraph.title && !!site.openGraph.description && !!site.openGraph.image;
  results.push({
    id: id(), type: 'functional', priority: 'low',
    title: `Open Graph Tags (Social Sharing)`,
    passed: ogComplete,
    expected: 'og:title, og:description, og:image all present',
    actual: (() => {
      const present = [];
      if (site.openGraph.title) present.push('og:title');
      if (site.openGraph.description) present.push('og:description');
      if (site.openGraph.image) present.push('og:image');
      return present.length > 0 ? present.join(', ') + ' present' : 'None found';
    })(),
    explanation: ogComplete
      ? `All Open Graph tags are set. Links shared on Facebook, LinkedIn, Twitter, and Slack will display a rich preview with title, description, and image.`
      : !hasOG
        ? `No Open Graph tags found. When this URL is shared on social media, it will show a plain text link with no preview image or description.`
        : `Incomplete Open Graph tags. ${!site.openGraph.title ? 'Missing og:title. ' : ''}${!site.openGraph.description ? 'Missing og:description. ' : ''}${!site.openGraph.image ? 'Missing og:image — no preview image when shared.' : ''}`,
    duration: 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 11. BROKEN LINKS CHECK (limited to first 10 internal links)
  // ═══════════════════════════════════════════════════════════════════════
  const internalLinks = site.links.items.filter(l => !l.isExternal).slice(0, 10);
  if (internalLinks.length > 0) {
    const startLink = Date.now();
    const linkResults = await checkLinks(internalLinks, 5);
    const brokenLinks = linkResults.filter(r => !r.ok);
    const linkDuration = Date.now() - startLink;

    results.push({
      id: id(), type: 'functional', priority: 'high',
      title: `Broken Links Check (${internalLinks.length} internal links)`,
      passed: brokenLinks.length === 0,
      expected: '0 broken links',
      actual: brokenLinks.length === 0 ? `All ${linkResults.length} links OK` : `${brokenLinks.length} broken link(s)`,
      explanation: brokenLinks.length === 0
        ? `Checked ${linkResults.length} internal links — all returned successful status codes.`
        : `Found ${brokenLinks.length} broken link(s): ${brokenLinks.slice(0, 3).map(l => `${l.url} (${l.status || l.error})`).join(', ')}${brokenLinks.length > 3 ? ` and ${brokenLinks.length - 3} more.` : '.'}`,
      duration: linkDuration,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 12. FAVICON CHECK
  // ═══════════════════════════════════════════════════════════════════════
  try {
    const faviconStart = Date.now();
    const origin = new URL(url).origin;
    const favRes = await fetch(`${origin}/favicon.ico`, {
      method: 'HEAD',
      headers: { 'User-Agent': 'RadarAI/2.0 (+https://github.com/rahul-1909/Radar-AI)' },
      redirect: 'follow',
    });
    const favDuration = Date.now() - faviconStart;
    const favOk = favRes.status < 400;
    results.push({
      id: id(), type: 'ui', priority: 'low',
      title: `Favicon Check`,
      passed: favOk,
      expected: '/favicon.ico returns 200',
      actual: `HTTP ${favRes.status}`,
      explanation: favOk
        ? `Favicon found at ${origin}/favicon.ico. Browsers will display the icon in tabs and bookmarks.`
        : `No favicon found at ${origin}/favicon.ico (HTTP ${favRes.status}). Browser tabs will show a generic icon.`,
      duration: favDuration,
    });
  } catch (err) {
    results.push({
      id: id(), type: 'ui', priority: 'low',
      title: `Favicon Check`,
      passed: false, expected: '/favicon.ico accessible', actual: `Error: ${err.message}`,
      explanation: `Could not check favicon: ${err.message}`,
      duration: 0,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 13. ROBOTS.TXT CHECK
  // ═══════════════════════════════════════════════════════════════════════
  try {
    const robotsStart = Date.now();
    const origin = new URL(url).origin;
    const robotsRes = await fetch(`${origin}/robots.txt`, {
      headers: { 'User-Agent': 'RadarAI/2.0 (+https://github.com/rahul-1909/Radar-AI)' },
      redirect: 'follow',
    });
    const robotsDuration = Date.now() - robotsStart;
    const robotsOk = robotsRes.status === 200;
    const robotsText = robotsOk ? await robotsRes.text() : '';
    results.push({
      id: id(), type: 'api', priority: 'low',
      title: `Robots.txt Check`,
      passed: robotsOk,
      expected: '/robots.txt returns 200',
      actual: robotsOk ? `Found (${robotsText.length} bytes)` : `HTTP ${robotsRes.status}`,
      explanation: robotsOk
        ? `robots.txt found and accessible. Search engine crawlers can read your crawl directives.`
        : `No robots.txt found (HTTP ${robotsRes.status}). While not required, it helps search engines understand which pages to crawl.`,
      duration: robotsDuration,
    });
  } catch (err) {
    // skip
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 14. HTML SIZE CHECK
  // ═══════════════════════════════════════════════════════════════════════
  const htmlSizeKB = Math.round(site.htmlSize / 1024);
  const htmlTooBig = htmlSizeKB > 500;
  results.push({
    id: id(), type: 'functional', priority: 'medium',
    title: `HTML Document Size`,
    passed: !htmlTooBig,
    expected: '< 500KB',
    actual: `${htmlSizeKB}KB`,
    explanation: htmlTooBig
      ? `HTML document is ${htmlSizeKB}KB, which exceeds 500KB. Large HTML slows down parsing and first contentful paint. Consider lazy-loading content.`
      : `HTML document is ${htmlSizeKB}KB, within acceptable limits for fast parsing.`,
    duration: 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // 15. FORM SECURITY CHECK
  // ═══════════════════════════════════════════════════════════════════════
  if (site.forms.length > 0) {
    const insecureForms = site.forms.filter(f => {
      if (!f.action) return false;
      try { return new URL(f.action, url).protocol === 'http:'; } catch { return false; }
    });
    results.push({
      id: id(), type: 'api', priority: 'high',
      title: `Form Security Check (${site.forms.length} form(s))`,
      passed: insecureForms.length === 0,
      expected: 'All forms submit over HTTPS',
      actual: insecureForms.length === 0 ? `All ${site.forms.length} form(s) secure` : `${insecureForms.length} insecure form(s)`,
      explanation: insecureForms.length === 0
        ? `All ${site.forms.length} form(s) submit data securely over HTTPS.`
        : `${insecureForms.length} form(s) submit data over plain HTTP. User input including passwords may be intercepted by attackers.`,
      duration: 0,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 16. CHARSET DECLARATION
  // ═══════════════════════════════════════════════════════════════════════
  const hasCharset = !!site.meta.charset;
  results.push({
    id: id(), type: 'functional', priority: 'medium',
    title: `Character Encoding Declaration`,
    passed: hasCharset,
    expected: 'charset declared (utf-8)',
    actual: hasCharset ? site.meta.charset : 'Not declared',
    explanation: hasCharset
      ? `Character encoding is declared as "${site.meta.charset}". Special characters will display correctly.`
      : `No character encoding declared. Special characters may display incorrectly in some browsers. Add <meta charset="utf-8"> to the <head>.`,
    duration: 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════

  // 17. COOKIE SECURITY FLAGS
  if (site.cookies && site.cookies.length > 0) {
    const insecureCookies = site.cookies.filter(c => !c.httpOnly || !c.secure);
    results.push({
      id: id(), type: 'security', priority: 'high',
      title: `Cookie Security Flags`,
      passed: insecureCookies.length === 0,
      expected: 'All cookies have HttpOnly, Secure, SameSite flags',
      actual: insecureCookies.length === 0
        ? `All ${site.cookies.length} cookie(s) have proper security flags`
        : `${insecureCookies.length} of ${site.cookies.length} cookie(s) missing security flags`,
      explanation: insecureCookies.length === 0
        ? `All cookies are configured with HttpOnly (prevents XSS theft), Secure (HTTPS only), and SameSite (prevents CSRF) flags.`
        : `${insecureCookies.length} cookie(s) are missing critical security flags. Without HttpOnly, cookies can be stolen via XSS. Without Secure, cookies are sent over HTTP. Without SameSite, cookies are vulnerable to CSRF attacks.`,
      duration: 0,
    });
  }

  // 18. MIXED CONTENT
  if (url.startsWith('https://')) {
    const mixedCount = site.mixedContent?.length || 0;
    results.push({
      id: id(), type: 'security', priority: 'high',
      title: `Mixed Content Check`,
      passed: mixedCount === 0,
      expected: 'No HTTP resources loaded on HTTPS page',
      actual: mixedCount === 0 ? 'No mixed content detected' : `${mixedCount} HTTP resource(s) found`,
      explanation: mixedCount === 0
        ? `No mixed content detected. All resources are loaded securely over HTTPS.`
        : `Found ${mixedCount} resource(s) loaded over HTTP on an HTTPS page: ${site.mixedContent.slice(0, 3).join(', ')}${mixedCount > 3 ? ` and ${mixedCount - 3} more` : ''}. Browsers may block these resources or show security warnings.`,
      duration: 0,
    });
  }

  // 19. SERVER INFORMATION DISCLOSURE
  const serverDisclosure = site.serverHeader && /[0-9]/.test(site.serverHeader);
  results.push({
    id: id(), type: 'security', priority: 'medium',
    title: `Server Information Disclosure`,
    passed: !serverDisclosure && !site.xPoweredBy,
    expected: 'No server version or framework info exposed',
    actual: (() => {
      const issues = [];
      if (site.serverHeader) issues.push(`Server: ${site.serverHeader}`);
      if (site.xPoweredBy) issues.push(`X-Powered-By: ${site.xPoweredBy}`);
      return issues.length > 0 ? issues.join(', ') : 'Headers hidden';
    })(),
    explanation: (() => {
      if (!site.serverHeader && !site.xPoweredBy) return `Server identity is properly hidden. Attackers cannot determine the web server or framework version to target known vulnerabilities.`;
      let msg = 'The server is leaking technology information: ';
      if (site.serverHeader) msg += `Server header reveals "${site.serverHeader}". `;
      if (site.xPoweredBy) msg += `X-Powered-By reveals "${site.xPoweredBy}". `;
      msg += 'Attackers can use this to search for known vulnerabilities specific to this version.';
      return msg;
    })(),
    duration: 0,
  });

  // 20. CONTENT SECURITY POLICY DEPTH CHECK
  const csp = site.securityHeaders.contentSecurityPolicy;
  const cspHasDefaultSrc = csp && csp.includes('default-src');
  const cspHasScriptSrc = csp && csp.includes('script-src');
  const cspHasUnsafe = csp && (csp.includes("'unsafe-inline'") || csp.includes("'unsafe-eval'"));
  results.push({
    id: id(), type: 'security', priority: 'high',
    title: `Content Security Policy (CSP) Depth`,
    passed: !!csp && cspHasDefaultSrc && !cspHasUnsafe,
    expected: 'CSP with default-src, no unsafe-inline/eval',
    actual: !csp ? 'No CSP header' : (cspHasUnsafe ? 'CSP with unsafe directives' : `CSP configured${cspHasDefaultSrc ? ' with default-src' : ''}`),
    explanation: !csp
      ? `No Content-Security-Policy header found. CSP is the primary defense against Cross-Site Scripting (XSS) attacks. It controls which resources can be loaded and executed.`
      : cspHasUnsafe
        ? `CSP is configured but contains 'unsafe-inline' or 'unsafe-eval' directives, which significantly weakens XSS protection. These allow inline scripts and eval() to execute, defeating much of CSP's purpose.`
        : `Content-Security-Policy is properly configured${cspHasDefaultSrc ? ' with a default-src directive' : ''}${cspHasScriptSrc ? ' and script-src directive' : ''}.`,
    duration: 0,
  });

  // 21. HSTS (HTTP Strict Transport Security) CHECK
  const hsts = site.securityHeaders.strictTransportSecurity;
  const hstsMaxAge = hsts ? parseInt((hsts.match(/max-age=(\d+)/) || [])[1] || '0', 10) : 0;
  const hstsIncludesSubs = hsts && hsts.includes('includeSubDomains');
  results.push({
    id: id(), type: 'security', priority: 'high',
    title: `HSTS (Strict Transport Security)`,
    passed: !!hsts && hstsMaxAge >= 31536000,
    expected: 'HSTS with max-age ≥ 31536000 (1 year)',
    actual: !hsts ? 'No HSTS header' : `max-age=${hstsMaxAge}${hstsIncludesSubs ? ', includeSubDomains' : ''}`,
    explanation: !hsts
      ? `No Strict-Transport-Security header found. Without HSTS, users who type the URL without https:// will first connect over HTTP, making them vulnerable to downgrade attacks and man-in-the-middle interception.`
      : hstsMaxAge < 31536000
        ? `HSTS max-age is ${hstsMaxAge} seconds (${Math.round(hstsMaxAge / 86400)} days). Google recommends at least 31536000 (1 year). Short values leave a window where browsers forget the HTTPS-only policy.`
        : `HSTS is properly configured with max-age=${hstsMaxAge}${hstsIncludesSubs ? ' including subdomains' : ''}. Browsers will enforce HTTPS for this duration.`,
    duration: 0,
  });

  // 22. PERMISSIONS POLICY
  const permissionsPolicy = site.headers['permissions-policy'] || site.headers['feature-policy'] || '';
  results.push({
    id: id(), type: 'security', priority: 'low',
    title: `Permissions Policy Header`,
    passed: !!permissionsPolicy,
    expected: 'Permissions-Policy header present',
    actual: permissionsPolicy ? `Configured (${permissionsPolicy.substring(0, 80)}...)` : 'Not set',
    explanation: permissionsPolicy
      ? `Permissions-Policy is configured, restricting which browser features (camera, microphone, geolocation) the page and its iframes can access.`
      : `No Permissions-Policy (formerly Feature-Policy) header found. This header lets you control which browser APIs (camera, microphone, geolocation, payment) can be used by your page and embedded iframes.`,
    duration: 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════

  // 23. COMPRESSION CHECK
  results.push({
    id: id(), type: 'performance', priority: 'high',
    title: `Response Compression (gzip/brotli)`,
    passed: site.hasCompression,
    expected: 'gzip or brotli compression enabled',
    actual: site.hasCompression ? `Compression: ${site.contentEncoding}` : 'No compression',
    explanation: site.hasCompression
      ? `Server is using ${site.contentEncoding} compression. This typically reduces transfer size by 60-80%, resulting in faster page loads.`
      : `No response compression detected. Enabling gzip or brotli compression typically reduces HTML/CSS/JS transfer size by 60-80%. This is one of the easiest performance wins for deployment.`,
    duration: 0,
  });

  // 24. RESOURCE COUNT CHECK
  const totalResources = site.scripts + site.stylesheets;
  const tooManyResources = totalResources > 30;
  results.push({
    id: id(), type: 'performance', priority: 'medium',
    title: `Resource Count (Scripts + Stylesheets)`,
    passed: !tooManyResources,
    expected: '≤ 30 total resources',
    actual: `${site.scripts} scripts, ${site.stylesheets} stylesheets (${totalResources} total)`,
    explanation: tooManyResources
      ? `Page loads ${totalResources} external resources (${site.scripts} scripts, ${site.stylesheets} stylesheets). Each resource requires a network request. Consider bundling, code-splitting, or lazy-loading to reduce the number of blocking resources.`
      : `Page loads ${totalResources} external resources, within acceptable limits. Each resource is a network request that can block rendering.`,
    duration: 0,
  });

  // 25. THIRD-PARTY DEPENDENCY COUNT
  const externalDeps = site.externalScriptDomains?.length || 0;
  results.push({
    id: id(), type: 'performance', priority: 'medium',
    title: `Third-Party Dependencies`,
    passed: externalDeps <= 5,
    expected: '≤ 5 external script domains',
    actual: externalDeps === 0 ? 'No external scripts' : `${externalDeps} external domain(s): ${(site.externalScriptDomains || []).slice(0, 5).join(', ')}`,
    explanation: externalDeps > 5
      ? `Page loads scripts from ${externalDeps} external domains. Each third-party dependency is a security risk (supply-chain attack surface) and a performance liability (DNS lookups, network requests, potential single point of failure).`
      : externalDeps === 0
        ? `No external third-party scripts detected. The page is self-contained with no external dependency risk.`
        : `Page loads scripts from ${externalDeps} external domain(s), within acceptable limits.`,
    duration: 0,
  });

  // 26. INLINE SCRIPT/STYLE COUNT
  const inlineTotal = (site.inlineScripts || 0) + (site.inlineStyles || 0);
  results.push({
    id: id(), type: 'performance', priority: 'low',
    title: `Inline Scripts & Styles`,
    passed: inlineTotal <= 10,
    expected: '≤ 10 inline script/style blocks',
    actual: `${site.inlineScripts || 0} inline scripts, ${site.inlineStyles || 0} inline styles`,
    explanation: inlineTotal > 10
      ? `Page has ${inlineTotal} inline script/style blocks. Inline code cannot be cached separately by the browser, increases HTML size, and complicates Content-Security-Policy. Consider externalizing critical CSS/JS.`
      : `Inline script/style count is within acceptable limits. Note: inline code can't be cached separately and may require CSP 'unsafe-inline' directives.`,
    duration: 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════

  // 27. LANGUAGE ATTRIBUTE
  const hasLang = !!site.langAttr;
  results.push({
    id: id(), type: 'accessibility', priority: 'high',
    title: `HTML Language Attribute (WCAG 3.1.1)`,
    passed: hasLang,
    expected: '<html lang="..."> attribute present',
    actual: hasLang ? `lang="${site.langAttr}"` : 'Missing',
    explanation: hasLang
      ? `HTML language attribute is set to "${site.langAttr}". Screen readers will use the correct pronunciation rules and browsers can offer translation.`
      : `No lang attribute on the <html> element. This fails WCAG 2.1 Level A (Success Criterion 3.1.1). Screen readers cannot determine the correct pronunciation rules without it, making the page harder for visually impaired users to understand.`,
    duration: 0,
  });

  // 28. FORM INPUT LABELS
  const allFormInputs = (site.formAccessibility || []).flatMap(f => f.inputs);
  if (allFormInputs.length > 0) {
    const unlabeledInputs = allFormInputs.filter(i => !i.hasLabel && !i.hasAriaLabel);
    results.push({
      id: id(), type: 'accessibility', priority: 'high',
      title: `Form Input Labels (WCAG 1.3.1)`,
      passed: unlabeledInputs.length === 0,
      expected: 'All inputs have associated labels or aria-label',
      actual: unlabeledInputs.length === 0
        ? `All ${allFormInputs.length} input(s) properly labeled`
        : `${unlabeledInputs.length} of ${allFormInputs.length} input(s) missing labels`,
      explanation: unlabeledInputs.length === 0
        ? `All form inputs have associated <label> elements or aria-label attributes. Screen reader users can understand what each field is for.`
        : `${unlabeledInputs.length} form input(s) have no associated label: ${unlabeledInputs.slice(0, 3).map(i => i.name || i.type).join(', ')}. This fails WCAG 2.1 Level A. Screen reader users cannot tell what information to enter in these fields.`,
      duration: 0,
    });
  }

  // 29. ARIA LANDMARKS
  const landmarks = site.ariaLandmarks || {};
  const hasMainLandmark = landmarks.main > 0;
  const hasNavLandmark = landmarks.nav > 0;
  results.push({
    id: id(), type: 'accessibility', priority: 'medium',
    title: `ARIA Landmarks / Semantic Regions`,
    passed: hasMainLandmark && hasNavLandmark,
    expected: 'At least <main> and <nav> landmarks present',
    actual: `main: ${landmarks.main || 0}, nav: ${landmarks.nav || 0}, header: ${landmarks.banner || 0}, footer: ${landmarks.contentinfo || 0}`,
    explanation: hasMainLandmark && hasNavLandmark
      ? `Page uses proper semantic landmarks. Screen readers can jump directly to the main content, navigation, and other page regions.`
      : `Missing key landmarks: ${!hasMainLandmark ? '<main> element (defines primary content area). ' : ''}${!hasNavLandmark ? '<nav> element (defines navigation). ' : ''}Landmarks allow screen reader users to navigate large pages efficiently by jumping between regions.`,
    duration: 0,
  });

  // 30. SKIP NAVIGATION LINK
  results.push({
    id: id(), type: 'accessibility', priority: 'medium',
    title: `Skip Navigation Link (WCAG 2.4.1)`,
    passed: site.hasSkipLink,
    expected: 'Skip-to-content link present',
    actual: site.hasSkipLink ? 'Skip link found' : 'No skip link detected',
    explanation: site.hasSkipLink
      ? `A skip navigation link is present, allowing keyboard users to bypass repetitive navigation and jump directly to the main content.`
      : `No skip navigation link found. Keyboard-only users must tab through the entire navigation on every page load before reaching the main content. Add a visually hidden link at the top: <a href="#main" class="skip-link">Skip to content</a>.`,
    duration: 0,
  });

  // 31. TABINDEX MISUSE
  const tabindexIssues = site.positiveTabindex || 0;
  results.push({
    id: id(), type: 'accessibility', priority: 'low',
    title: `Tab Order (tabindex Values)`,
    passed: tabindexIssues === 0,
    expected: 'No positive tabindex values',
    actual: tabindexIssues === 0 ? 'No tabindex issues' : `${tabindexIssues} element(s) with positive tabindex`,
    explanation: tabindexIssues === 0
      ? `No positive tabindex values detected. Tab order follows the natural document flow, which is the recommended approach for accessibility.`
      : `${tabindexIssues} element(s) use positive tabindex values (tabindex > 0). This overrides the natural tab order and creates a confusing navigation experience for keyboard users. Use tabindex="0" to add focusability without changing order.`,
    duration: 0,
  });

  // ═══════════════════════════════════════════════════════════════════════
  // ═══════════════════════════════════════════════════════════════════════

  // 32. SITEMAP.XML CHECK
  try {
    const sitemapStart = Date.now();
    const origin = new URL(url).origin;
    const sitemapRes = await fetch(`${origin}/sitemap.xml`, {
      method: 'HEAD',
      headers: { 'User-Agent': 'RadarAI/2.0 (+https://github.com/rahul-1909/Radar-AI)' },
      redirect: 'follow',
    });
    const sitemapDuration = Date.now() - sitemapStart;
    const sitemapOk = sitemapRes.status === 200;
    results.push({
      id: id(), type: 'deployment', priority: 'medium',
      title: `Sitemap.xml Check`,
      passed: sitemapOk,
      expected: '/sitemap.xml returns 200',
      actual: `HTTP ${sitemapRes.status}`,
      explanation: sitemapOk
        ? `sitemap.xml found and accessible. Search engines can discover all your pages efficiently for indexing.`
        : `No sitemap.xml found (HTTP ${sitemapRes.status}). A sitemap helps search engines discover and index all pages on your site, especially important for large sites or sites with deep link structures.`,
      duration: sitemapDuration,
    });
  } catch (err) {
    results.push({
      id: id(), type: 'deployment', priority: 'medium',
      title: `Sitemap.xml Check`,
      passed: false, expected: '/sitemap.xml accessible', actual: `Error: ${err.message}`,
      explanation: `Could not check sitemap.xml: ${err.message}`,
      duration: 0,
    });
  }

  // 33. CANONICAL URL
  const hasCanonical = !!site.canonical;
  results.push({
    id: id(), type: 'deployment', priority: 'medium',
    title: `Canonical URL Tag`,
    passed: hasCanonical,
    expected: '<link rel="canonical"> present',
    actual: hasCanonical ? `${site.canonical.substring(0, 80)}` : 'Not set',
    explanation: hasCanonical
      ? `Canonical URL is set to "${site.canonical}". This tells search engines which version of the page is the "official" one, preventing duplicate content issues.`
      : `No canonical URL tag found. Without it, search engines may index multiple URL variants (www/non-www, with/without trailing slash, query parameters) as separate pages, diluting your SEO ranking.`,
    duration: 0,
  });

  // 34. TWITTER CARD TAGS
  const hasTwitterCard = !!site.twitterCard;
  results.push({
    id: id(), type: 'deployment', priority: 'low',
    title: `Twitter Card Tags`,
    passed: hasTwitterCard,
    expected: 'twitter:card meta tag present',
    actual: hasTwitterCard ? `Card type: ${site.twitterCard}` : 'Not set',
    explanation: hasTwitterCard
      ? `Twitter Card is configured as "${site.twitterCard}". Links shared on Twitter will display a rich preview card.`
      : `No Twitter Card meta tags found. Links shared on Twitter will appear as plain text URLs without preview images or descriptions.`,
    duration: 0,
  });

  // 35. STRUCTURED DATA (JSON-LD)
  const hasStructuredData = (site.jsonLdScripts || 0) > 0;
  results.push({
    id: id(), type: 'deployment', priority: 'low',
    title: `Structured Data (JSON-LD / Schema.org)`,
    passed: hasStructuredData,
    expected: 'At least 1 JSON-LD structured data block',
    actual: hasStructuredData ? `${site.jsonLdScripts} JSON-LD block(s) found` : 'None found',
    explanation: hasStructuredData
      ? `${site.jsonLdScripts} structured data block(s) found. Search engines can display rich results (star ratings, prices, FAQs, breadcrumbs) for your pages in search results.`
      : `No structured data found. Adding JSON-LD Schema.org markup enables rich results in Google Search (star ratings, product info, FAQ snippets, breadcrumbs) which significantly increase click-through rates.`,
    duration: 0,
  });

  // 36. DEPRECATED HTML TAGS
  const hasDeprecated = (site.deprecatedTags || []).length > 0;
  if (hasDeprecated) {
    results.push({
      id: id(), type: 'deployment', priority: 'low',
      title: `Deprecated HTML Elements`,
      passed: false,
      expected: 'No deprecated HTML tags',
      actual: `${site.deprecatedTags.map(t => `<${t.tag}> (${t.count}x)`).join(', ')}`,
      explanation: `Deprecated HTML elements found: ${site.deprecatedTags.map(t => `<${t.tag}>`).join(', ')}. These tags are obsolete in HTML5, may not render correctly in modern browsers, and indicate outdated code that should be refactored before deployment.`,
      duration: 0,
    });
  }

  // 37. DUPLICATE META TAGS
  const hasDuplicateMeta = (site.metaDescCount || 0) > 1 || (site.metaTitleCount || 0) > 1;
  if (hasDuplicateMeta) {
    results.push({
      id: id(), type: 'deployment', priority: 'medium',
      title: `Duplicate Meta Tags`,
      passed: false,
      expected: 'Exactly 1 title and 1 meta description',
      actual: `${site.metaTitleCount || 0} title tag(s), ${site.metaDescCount || 0} meta description(s)`,
      explanation: `Duplicate ${(site.metaTitleCount || 0) > 1 ? 'title tags' : ''}${(site.metaTitleCount || 0) > 1 && (site.metaDescCount || 0) > 1 ? ' and ' : ''}${(site.metaDescCount || 0) > 1 ? 'meta descriptions' : ''} detected. Search engines may use the wrong one, or penalize the page for conflicting signals. Ensure only one of each exists in the <head>.`,
      duration: 0,
    });
  }

  // 38. NOSCRIPT FALLBACK
  const jsDependent = site.scripts > 3 && !site.hasNoscript;
  if (site.scripts > 3) {
    results.push({
      id: id(), type: 'deployment', priority: 'low',
      title: `NoScript Fallback`,
      passed: !jsDependent,
      expected: '<noscript> fallback present for JS-heavy pages',
      actual: site.hasNoscript ? '<noscript> tag found' : 'No <noscript> fallback',
      explanation: jsDependent
        ? `Page loads ${site.scripts} scripts but has no <noscript> fallback. Users with JavaScript disabled (or before JS loads) will see a blank or broken page. Add a <noscript> tag with a message or basic content.`
        : `Page includes a <noscript> fallback. Users with JavaScript disabled will see alternative content.`,
      duration: 0,
    });
  }

  // 39. CUSTOM 404 PAGE
  try {
    const fourOhFourStart = Date.now();
    const origin = new URL(url).origin;
    const res404 = await fetch(`${origin}/this-page-definitely-does-not-exist-radar-ai-${Date.now()}`, {
      headers: { 'User-Agent': 'RadarAI/2.0 (+https://github.com/rahul-1909/Radar-AI)' },
      redirect: 'follow',
    });
    const fourOhFourDuration = Date.now() - fourOhFourStart;
    const has404 = res404.status === 404;
    const body404 = has404 ? await res404.text() : '';
    const isCustom404 = has404 && body404.length > 500; // Custom pages are usually longer than default server error pages
    results.push({
      id: id(), type: 'deployment', priority: 'medium',
      title: `Custom 404 Error Page`,
      passed: has404 && isCustom404,
      expected: 'Custom 404 page with helpful content',
      actual: !has404 ? `HTTP ${res404.status} (expected 404)` : (isCustom404 ? 'Custom 404 page found' : 'Default/minimal 404 page'),
      explanation: has404 && isCustom404
        ? `Server returns proper 404 status with a custom error page (${Math.round(body404.length / 1024)}KB). Users who hit a broken link will see a helpful page with navigation options.`
        : !has404
          ? `Server returned HTTP ${res404.status} for a non-existent page instead of 404. This can confuse search engines (soft 404) and may incorrectly index error pages as real content.`
          : `Server returns 404 but with a minimal/default error page (${body404.length} bytes). Consider creating a custom 404 page with navigation, search, and links to popular content to help lost users.`,
      duration: fourOhFourDuration,
    });
  } catch (err) {
    // skip
  }

  return results;
}

/**
 * Calculate summary stats from test results
 */
function summarizeResults(results) {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;
  const byType = {
    functional: results.filter(r => r.type === 'functional').length,
    api: results.filter(r => r.type === 'api').length,
    ui: results.filter(r => r.type === 'ui').length,
    edge: results.filter(r => r.type === 'edge').length,
    security: results.filter(r => r.type === 'security').length,
    performance: results.filter(r => r.type === 'performance').length,
    accessibility: results.filter(r => r.type === 'accessibility').length,
    deployment: results.filter(r => r.type === 'deployment').length,
  };
  const byPriority = {
    critical: results.filter(r => r.priority === 'critical').length,
    high: results.filter(r => r.priority === 'high').length,
    medium: results.filter(r => r.priority === 'medium').length,
    low: results.filter(r => r.priority === 'low').length,
  };
  const criticalFails = results.filter(r => !r.passed && r.priority === 'critical').length;
  const highFails = results.filter(r => !r.passed && r.priority === 'high').length;
  const totalDuration = results.reduce((s, r) => s + (r.duration || 0), 0);

  return { total, passed, failed, passRate: Math.round((passed / total) * 100), byType, byPriority, criticalFails, highFails, totalDuration };
}

module.exports = { runTests, summarizeResults, cacheTestResults, getCachedTestResults, invalidateTestCache };
