/**
 * Website Crawler Service
 * 
 * Actually fetches the configured URL, parses HTML with Cheerio,
 * and extracts real page structure: links, forms, meta tags, images, etc.
 */

const cheerio = require('cheerio');
const { assertPublicUrl, normalizeUrl } = require('./urlGuard');

const CRAWL_TIMEOUT = 15000; // 15s
const USER_AGENT = 'RadarAI/2.0 (Autonomous Quality & Release Intelligence Platform; +https://github.com/rahul-1909/Radar-AI)';

/**
 * Crawl a website and return structured analysis
 * @param {string} url - The URL to crawl
 * @returns {Promise<SiteAnalysis>}
 */
async function crawlWebsite(url) {
  const startTime = Date.now();

  // Normalize URL
  url = normalizeUrl(url);

  let response, html, statusCode, responseTime, headers;
  let finalUrl = url;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CRAWL_TIMEOUT);

    // Follow redirects manually so every hop is checked against private
    // addresses (a public site must not be able to redirect us internally)
    let target = url;
    for (let hop = 0; ; hop++) {
      await assertPublicUrl(target);
      response = await fetch(target, {
        headers: { 'User-Agent': USER_AGENT, 'Accept': 'text/html,application/xhtml+xml' },
        signal: controller.signal,
        redirect: 'manual',
      });
      const location = response.headers.get('location');
      if (response.status < 300 || response.status >= 400 || !location) break;
      if (hop >= 5) throw new Error('Too many redirects');
      target = new URL(location, target).toString();
    }
    finalUrl = target;

    clearTimeout(timeout);
    responseTime = Date.now() - startTime;
    statusCode = response.status;
    headers = Object.fromEntries(response.headers.entries());
    html = await response.text();
  } catch (err) {
    return {
      url,
      success: false,
      error: err.name === 'AbortError' ? 'Request timed out after 15s' : err.message,
      statusCode: 0,
      responseTime: Date.now() - startTime,
      crawledAt: new Date().toISOString(),
    };
  }

  return analyzeHtml(url, html, { statusCode, responseTime, headers, finalUrl });
}

/**
 * Parse a page's HTML into the structured site analysis. Shared by the HTTP
 * crawler and the logged-in browser crawler (which supplies rendered HTML).
 */
function analyzeHtml(url, html, { statusCode = 200, responseTime = 0, headers = {}, finalUrl = url } = {}) {
  const $ = cheerio.load(html);

  // ── Login signals (used by the login detector) ──────────────────────────
  const passwordFields = $('input[type="password"]').length;
  const loginLinks = [];
  $('a[href]').each((_, el) => {
    const text = $(el).text().trim();
    const href = $(el).attr('href') || '';
    if (/^(log\s?in|sign\s?in|member login|my account)$/i.test(text) || /(^|\/)(log-?in|sign-?in|signin)(\/|$|\?)/i.test(href)) {
      try { loginLinks.push(new URL(href, finalUrl).href); } catch { /* ignore bad href */ }
    }
  });

  // ── Extract Title ──────────────────────────────────────────────────────
  const title = $('title').text().trim();

  // ── Extract Meta Tags ──────────────────────────────────────────────────
  const metaDescription = $('meta[name="description"]').attr('content') || '';
  const metaViewport = $('meta[name="viewport"]').attr('content') || '';
  const metaKeywords = $('meta[name="keywords"]').attr('content') || '';
  const ogTitle = $('meta[property="og:title"]').attr('content') || '';
  const ogDescription = $('meta[property="og:description"]').attr('content') || '';
  const ogImage = $('meta[property="og:image"]').attr('content') || '';
  const twitterCard = $('meta[name="twitter:card"]').attr('content') || '';
  const canonical = $('link[rel="canonical"]').attr('href') || '';
  const charset = $('meta[charset]').attr('charset') || $('meta[http-equiv="Content-Type"]').attr('content') || '';

  // ── Extract Headings ───────────────────────────────────────────────────
  const headings = { h1: [], h2: [], h3: [] };
  $('h1').each((_, el) => { const t = $(el).text().trim(); if (t) headings.h1.push(t); });
  $('h2').each((_, el) => { const t = $(el).text().trim(); if (t) headings.h2.push(t.substring(0, 100)); });
  $('h3').each((_, el) => { const t = $(el).text().trim(); if (t) headings.h3.push(t.substring(0, 80)); });

  // ── Extract Links ──────────────────────────────────────────────────────
  const links = [];
  const linkSet = new Set();
  $('a[href]').each((_, el) => {
    let href = $(el).attr('href') || '';
    const text = $(el).text().trim().substring(0, 80);
    if (!href || href === '#' || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

    // Resolve relative URLs
    try {
      href = new URL(href, url).href;
    } catch { return; }

    if (!linkSet.has(href)) {
      linkSet.add(href);
      const isExternal = !href.startsWith(new URL(url).origin);
      links.push({ href, text, isExternal });
    }
  });

  // ── Extract Images ─────────────────────────────────────────────────────
  const images = [];
  $('img').each((_, el) => {
    const src = $(el).attr('src') || '';
    const alt = $(el).attr('alt') || '';
    const hasAlt = !!$(el).attr('alt');
    if (src) images.push({ src: src.substring(0, 200), alt: alt.substring(0, 100), hasAlt });
  });

  // ── Extract Forms ──────────────────────────────────────────────────────
  const forms = [];
  $('form').each((_, el) => {
    const action = $(el).attr('action') || '';
    const method = ($(el).attr('method') || 'GET').toUpperCase();
    const inputs = [];
    $(el).find('input, textarea, select').each((_, inp) => {
      inputs.push({
        type: $(inp).attr('type') || $(inp).prop('tagName').toLowerCase(),
        name: $(inp).attr('name') || '',
        required: $(inp).attr('required') !== undefined,
      });
    });
    forms.push({ action, method, inputs });
  });

  // ── Extract Scripts & Styles ───────────────────────────────────────────
  const scripts = [];
  $('script[src]').each((_, el) => scripts.push($(el).attr('src')));
  const stylesheets = [];
  $('link[rel="stylesheet"]').each((_, el) => stylesheets.push($(el).attr('href')));

  // ── Security Headers ───────────────────────────────────────────────────
  const securityHeaders = {
    xFrameOptions: headers['x-frame-options'] || null,
    contentSecurityPolicy: headers['content-security-policy'] || null,
    strictTransportSecurity: headers['strict-transport-security'] || null,
    xContentTypeOptions: headers['x-content-type-options'] || null,
    xXssProtection: headers['x-xss-protection'] || null,
    referrerPolicy: headers['referrer-policy'] || null,
  };

  // ── Detect Site Type ───────────────────────────────────────────────────
  const htmlLower = html.toLowerCase();
  let siteType = 'website';
  if (htmlLower.includes('add to cart') || htmlLower.includes('price') || htmlLower.includes('checkout') || htmlLower.includes('product')) {
    siteType = 'e-commerce';
  } else if (htmlLower.includes('sign up') || htmlLower.includes('pricing') || htmlLower.includes('features') || htmlLower.includes('get started')) {
    siteType = 'saas';
  } else if (htmlLower.includes('blog') || htmlLower.includes('article') || htmlLower.includes('published')) {
    siteType = 'blog';
  } else if (htmlLower.includes('portfolio') || htmlLower.includes('projects') || htmlLower.includes('about me')) {
    siteType = 'portfolio';
  } else if (htmlLower.includes('documentation') || htmlLower.includes('api reference') || htmlLower.includes('getting started')) {
    siteType = 'documentation';
  }

  // ── Extended Analysis (for comprehensive test suite) ────────────────────

  // Language attribute
  const langAttr = $('html').attr('lang') || '';

  // Inline scripts and styles (security/CSP concerns)
  const inlineScripts = [];
  $('script:not([src])').each((_, el) => {
    const content = $(el).html() || '';
    if (content.trim().length > 0) inlineScripts.push(content.substring(0, 200));
  });
  const inlineStyles = [];
  $('style').each((_, el) => {
    const content = $(el).html() || '';
    if (content.trim().length > 0) inlineStyles.push(content.length);
  });

  // Form accessibility (labels for inputs)
  const formAccessibility = [];
  $('form').each((_, form) => {
    const inputs = [];
    $(form).find('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select').each((_, inp) => {
      const inputId = $(inp).attr('id') || '';
      const inputName = $(inp).attr('name') || '';
      const hasLabel = inputId ? $(`label[for="${inputId}"]`).length > 0 : false;
      const hasAriaLabel = !!$(inp).attr('aria-label') || !!$(inp).attr('aria-labelledby');
      const hasPlaceholder = !!$(inp).attr('placeholder');
      inputs.push({ id: inputId, name: inputName, hasLabel, hasAriaLabel, hasPlaceholder, type: $(inp).attr('type') || 'text' });
    });
    formAccessibility.push({ inputs });
  });

  // ARIA landmarks and roles
  const ariaLandmarks = {
    main: $('[role="main"], main').length,
    nav: $('[role="navigation"], nav').length,
    banner: $('[role="banner"], header').length,
    contentinfo: $('[role="contentinfo"], footer').length,
    search: $('[role="search"]').length,
  };

  // Skip navigation link
  const hasSkipLink = $('a[href="#main"], a[href="#content"], a[href="#main-content"], .skip-link, .skip-nav, a.skip-to-content').length > 0;

  // Cookie analysis from headers
  const cookies = [];
  const rawCookies = headers['set-cookie'];
  if (rawCookies) {
    const cookieArr = Array.isArray(rawCookies) ? rawCookies : [rawCookies];
    for (const c of cookieArr) {
      const lower = c.toLowerCase();
      cookies.push({
        raw: c.substring(0, 200),
        httpOnly: lower.includes('httponly'),
        secure: lower.includes('secure'),
        sameSite: lower.includes('samesite'),
      });
    }
  }

  // Compression
  const contentEncoding = headers['content-encoding'] || '';
  const hasCompression = !!contentEncoding && (contentEncoding.includes('gzip') || contentEncoding.includes('br') || contentEncoding.includes('deflate'));

  // Server info disclosure
  const serverHeader = headers['server'] || '';
  const xPoweredBy = headers['x-powered-by'] || '';

  // Structured data (JSON-LD)
  const jsonLdScripts = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const content = $(el).html() || '';
      if (content.trim()) jsonLdScripts.push(JSON.parse(content));
    } catch {}
  });

  // Mixed content detection (HTTP resources on HTTPS page)
  const mixedContent = [];
  if (url.startsWith('https://')) {
    $('script[src^="http://"], link[href^="http://"], img[src^="http://"], iframe[src^="http://"]').each((_, el) => {
      const src = $(el).attr('src') || $(el).attr('href') || '';
      if (src.startsWith('http://')) mixedContent.push(src.substring(0, 200));
    });
  }

  // Noscript fallback
  const hasNoscript = $('noscript').length > 0;

  // Deprecated HTML tags
  const deprecatedTags = [];
  const deprecated = ['center', 'font', 'marquee', 'blink', 'frame', 'frameset', 'bgsound'];
  for (const tag of deprecated) {
    const count = $(tag).length;
    if (count > 0) deprecatedTags.push({ tag, count });
  }

  // Duplicate meta tags
  const metaDescCount = $('meta[name="description"]').length;
  const metaTitleCount = $('title').length;

  // External script domains (third-party dependency analysis)
  const externalScriptDomains = new Set();
  const origin = new URL(url).origin;
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src') || '';
    try {
      const scriptUrl = new URL(src, url);
      if (scriptUrl.origin !== origin) externalScriptDomains.add(scriptUrl.hostname);
    } catch {}
  });

  // Tab index misuse
  const positiveTabindex = $('[tabindex]').filter((_, el) => {
    const val = parseInt($(el).attr('tabindex') || '0', 10);
    return val > 0;
  }).length;

  // Detect favicon
  const favicon = $('link[rel="icon"]').attr('href') || $('link[rel="shortcut icon"]').attr('href') || '';

  return {
    url,
    finalUrl,
    passwordFields,
    loginLinks: [...new Set(loginLinks)].slice(0, 5),
    success: true,
    statusCode,
    responseTime,
    headers,
    title,
    meta: { description: metaDescription, viewport: metaViewport, keywords: metaKeywords, charset },
    metaDescription,
    viewport: metaViewport,
    openGraph: { title: ogTitle, description: ogDescription, image: ogImage },
    ogTags: { 'og:title': ogTitle, 'og:description': ogDescription, 'og:image': ogImage, 'og:url': $('meta[property="og:url"]').attr('content') || '' },
    twitterCard,
    canonical,
    headings,
    links: {
      total: links.length,
      internal: links.filter(l => !l.isExternal).length,
      external: links.filter(l => l.isExternal).length,
      items: links.slice(0, 50),
      internalUrls: links.filter(l => !l.isExternal).map(l => l.href),
      externalUrls: links.filter(l => l.isExternal).map(l => l.href),
    },
    images: { total: images.length, withoutAlt: images.filter(i => !i.hasAlt).length, items: images.slice(0, 30) },
    imageDetails: images.slice(0, 30),
    forms,
    scripts: scripts.length,
    stylesheets: stylesheets.length,
    securityHeaders: {
      ...securityHeaders,
      // Also use lowercase header names for direct lookup in dynamic tests
      'x-frame-options': securityHeaders.xFrameOptions,
      'x-content-type-options': securityHeaders.xContentTypeOptions,
      'x-xss-protection': securityHeaders.xXssProtection,
      'strict-transport-security': securityHeaders.strictTransportSecurity,
      'content-security-policy': securityHeaders.contentSecurityPolicy,
      'referrer-policy': securityHeaders.referrerPolicy,
      'permissions-policy': headers['permissions-policy'] || null,
      'x-dns-prefetch-control': headers['x-dns-prefetch-control'] || null,
    },
    siteType,
    htmlSize: html.length,
    favicon,
    lang: langAttr,
    html: html.substring(0, 50000), // Truncated for site-type content checks
    crawledAt: new Date().toISOString(),
    // Extended data for comprehensive testing
    langAttr,
    inlineScripts: inlineScripts.length,
    inlineStyles: inlineStyles.length,
    formAccessibility,
    ariaLandmarks,
    hasSkipLink,
    cookies,
    contentEncoding,
    hasCompression,
    serverHeader,
    xPoweredBy,
    jsonLdScripts: jsonLdScripts.length,
    mixedContent,
    hasNoscript,
    deprecatedTags,
    metaDescCount,
    metaTitleCount,
    externalScriptDomains: [...externalScriptDomains],
    positiveTabindex,
  };
}

/**
 * Check a single link for broken status
 * @param {string} linkUrl
 * @returns {Promise<{url: string, status: number, ok: boolean}>}
 */
async function checkLink(linkUrl) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(linkUrl, {
      method: 'HEAD',
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    return { url: linkUrl, status: res.status, ok: res.status < 400 };
  } catch (err) {
    return { url: linkUrl, status: 0, ok: false, error: err.message };
  }
}

/**
 * Check multiple links in parallel (with concurrency limit)
 */
async function checkLinks(links, concurrency = 5) {
  const results = [];
  for (let i = 0; i < links.length; i += concurrency) {
    const batch = links.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(l => checkLink(l.href)));
    results.push(...batchResults);
  }
  return results;
}

module.exports = { crawlWebsite, analyzeHtml, checkLinks };
