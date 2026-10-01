/**
 * AI Agent Service
 *
 * Prompts for risk analysis, code fixes, site purpose, and code Q&A.
 * Model calls go through llmClient (Groq, OpenRouter, Gemini, OpenAI, Ollama,
 * or any OpenAI-compatible API). Each function has a rule-based fallback, so
 * everything works without an AI provider configured.
 */

const { askAI, aiAvailable } = require('./llmClient');
const { computeRisk } = require('./riskEngine');

// Total source code sent per prompt (~4 chars per token). Keeps prompts within
// free-tier token limits (e.g. Groq's 8,000 tokens/min) and responses fast.
const MAX_CONTEXT_CHARS = parseInt(process.env.AI_MAX_CONTEXT_CHARS || '20000', 10);

/**
 * Join files (already sorted most-relevant first) into prompt context,
 * truncating once the budget is used up.
 */
function buildFileContext(files) {
  const parts = [];
  let remaining = MAX_CONTEXT_CHARS;
  for (const f of files) {
    if (remaining < 500) break;
    const content = f.content.length > remaining
      ? f.content.slice(0, remaining) + '\n... [truncated]'
      : f.content;
    parts.push(`── ${f.path} ──\n${content}`);
    remaining -= content.length;
  }
  return parts.join('\n\n');
}

/**
 * Release risk: the score and decision come from the deterministic risk engine
 * (so every page agrees and re-runs are stable); the AI only writes the
 * explanation. Falls back to a rule-based explanation without AI.
 */
async function analyzeRisk(siteAnalysis, testResults, summary) {
  const engine = computeRisk(testResults);
  const recommendations = buildRiskRecommendations(engine, siteAnalysis);
  const base = {
    riskScore: engine.riskScore,
    riskLevel: engine.riskLevel,
    deployment: engine.deployment,
    reasons: engine.reasons,
    blockers: engine.blockers,
    categories: engine.categories,
    formula: engine.formula,
    topIssues: engine.categories.flatMap(c => c.failures.slice(0, 3).map(f => `${c.name}: ${f.title}`)).slice(0, 8),
    recommendations,
  };
  const fallback = () => ({ ...base, summary: ruleBasedRiskSummary(engine, summary), source: 'rule-based' });

  const prompt = `You are a senior QA engineer writing the release-readiness summary for ${siteAnalysis.url}.
The decision is already made by a fixed formula — do NOT change or re-score it.

Decision: ${engine.deployment.toUpperCase()} · Risk ${engine.riskScore}/100 (${engine.riskLevel})
${engine.reasons.length ? `Why blocked:\n${engine.reasons.map(r => `- ${r}`).join('\n')}` : 'No release blockers.'}

Category risk (weight in score):
${engine.categories.filter(c => c.measured).map(c => `- ${c.name} (${c.weight}%): risk ${c.risk}/100, ${c.failed}/${c.checks} checks failing${c.failures.length ? ` — ${c.failures.slice(0, 5).map(f => f.title).join('; ')}` : ''}`).join('\n')}

Write 2-3 sentences for a developer: state the decision and the reason, the most important functional and security problems, and treat SEO/metadata issues as minor. Plain text, no markdown, no JSON.`;

  const response = await askAI(prompt, () => null);
  if (typeof response === 'string' && response.trim()) {
    return { ...base, summary: response.trim().replace(/^["']|["']$/g, ''), source: 'ai' };
  }
  return fallback();
}

function ruleBasedRiskSummary(engine, summary) {
  const parts = [`Deployment ${engine.deployment === 'blocked' ? 'BLOCKED' : 'APPROVED'} — risk ${engine.riskScore}/100.`];
  if (engine.reasons.length) parts.push(`Blocked because: ${engine.reasons.join('; ')}.`);
  const worst = engine.categories.filter(c => c.measured && c.failed && c.key !== 'seo').sort((a, b) => b.risk * b.weight - a.risk * a.weight)[0];
  if (worst) parts.push(`Biggest concern: ${worst.name} (${worst.failed} failing — ${worst.failures.slice(0, 2).map(f => f.title).join(', ')}).`);
  parts.push(`${summary.passed} of ${summary.total} checks passed.`);
  return parts.join(' ');
}

// Most important first: blockers, then by category weight
const RECOMMENDATION_RULES = [
  [/open directly by url/i, 'Configure the host to serve index.html for every route (Vercel: vercel.json rewrite "/(.*)" → "/index.html") so refreshes and shared links work'],
  [/pages load without errors|http status/i, 'Fix pages that fail to load or return HTTP errors'],
  [/javascript error/i, 'Fix the JavaScript errors reported in the browser console'],
  [/ssl|https/i, 'Serve the site over HTTPS with a valid certificate and redirect HTTP traffic'],
  [/mixed content/i, 'Load every resource over https:// to remove mixed content'],
  [/content security policy|csp/i, 'Add a Content-Security-Policy header to limit where scripts can load from (XSS protection)'],
  [/clickjacking/i, 'Add X-Frame-Options: DENY (or CSP frame-ancestors) to prevent clickjacking'],
  [/mime/i, 'Add X-Content-Type-Options: nosniff'],
  [/cookie/i, 'Set HttpOnly, Secure and SameSite flags on cookies'],
  [/cors/i, 'Restrict CORS to your own origins'],
  [/compression|gzip/i, 'Enable gzip/brotli compression'],
  [/load in under|response time|ttfb|first contentful|slow/i, 'Speed up slow pages (server response time, image sizes, script size)'],
  [/alt text/i, 'Add alt text to images'],
  [/landmark|aria/i, 'Use semantic landmarks (<main>, <nav>, <header>) for screen readers'],
  [/label/i, 'Associate a <label> with every form input'],
  [/skip navigation/i, 'Add a "skip to content" link for keyboard users'],
  [/referrer|permissions/i, 'Add Referrer-Policy and Permissions-Policy headers'],
  [/meta description/i, 'Add meta descriptions (SEO — low priority)'],
  [/open graph|twitter|structured|canonical|sitemap|robots|favicon|h1/i, 'Fill in SEO extras: sitemap, robots.txt, favicon, Open Graph, canonical (low priority)'],
];

function buildRiskRecommendations(engine) {
  const failing = [
    ...engine.blockers.map(b => b.title),
    ...[...engine.categories].sort((a, b) => b.weight - a.weight).flatMap(c => c.failures.map(f => f.title)),
  ];
  const recs = [];
  for (const title of failing) {
    const rule = RECOMMENDATION_RULES.find(([pattern]) => pattern.test(title));
    if (rule && !recs.includes(rule[1])) recs.push(rule[1]);
  }
  return recs.length ? recs.slice(0, 8) : ['No failing checks — keep monitoring after release'];
}

/**
 * AI Site Purpose Analysis
 */
async function analyzeSitePurpose(siteAnalysis) {
  if (!aiAvailable) {
    return { purpose: siteAnalysis.siteType, confidence: 0.7, source: 'rule-based' };
  }

  const prompt = `Analyze this website and identify its purpose in 1-2 sentences.
URL: ${siteAnalysis.url}
Title: "${siteAnalysis.title}"
Headings: ${(siteAnalysis.headings?.h1 || []).join(', ')}
Type detected: ${siteAnalysis.siteType || 'unknown'}
Forms: ${siteAnalysis.forms?.length || 0}
Links: ${siteAnalysis.links?.total || 0}

Reply with just the purpose description, nothing else.`;

  const result = await askAI(prompt, () => `${siteAnalysis.siteType} website`);
  return { purpose: typeof result === 'string' ? result.trim() : result, source: aiAvailable ? 'ai' : 'rule-based' };
}

/**
 * AI Code Fix Analysis — reads source code files + test failures, returns fix suggestions
 */
async function analyzeCodeFixes(files, testResults, siteAnalysis) {
  const failedTests = testResults.filter(t => !t.passed);

  const fileContext = buildFileContext(files);

  const failedContext = failedTests.map(t =>
    `- [${t.priority?.toUpperCase()}] ${t.title}: ${t.explanation}`
  ).join('\n');

  const prompt = `You are a senior software engineer performing a code review. You have access to a project's source code and its automated test results.

PROJECT: ${siteAnalysis?.url || 'Unknown'}
SITE TYPE: ${siteAnalysis?.siteType || 'website'}

FAILED TESTS:
${failedContext || 'No test failures.'}

SOURCE CODE FILES:
${fileContext}

Analyze the source code and identify specific fixes for the test failures. For each issue, provide a concrete fix.

Return ONLY a valid JSON array (no markdown, no code fences), where each item has:
{
  "file": "<file path>",
  "line": <approximate line number or null>,
  "problem": "<what's wrong — 1 sentence>",
  "fix": "<exact code to add or change>",
  "consequence": "<what happens if not fixed — 1 sentence>",
  "severity": "<critical|high|medium|low>"
}

IMPORTANT: Return exactly one fix for EVERY failed test listed above (${failedTests.length} fixes total). Each test failure must have a corresponding fix suggestion.
If a test failure cannot be traced to a specific file, suggest where to add the fix (e.g., "Create a middleware file") and provide the code.
Return ONLY the JSON array, nothing else.`;

  const fallback = () => generateRuleBasedFixes(failedTests, files);
  const response = await askAI(prompt, fallback);

  if (typeof response === 'string') {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const fixes = JSON.parse(jsonMatch[0]);
        return { fixes, source: 'ai' };
      }
    } catch (e) {
      console.error('[AI] Code fix JSON parse error:', e.message);
    }
    return { fixes: generateRuleBasedFixes(failedTests, files), source: 'fallback' };
  }

  return { fixes: response, source: 'fallback' };
}

/**
 * Rule-based fix generation (fallback)
 * Scans actual file contents to find specific line numbers for each issue.
 */
function generateRuleBasedFixes(failedTests, files) {
  const fixes = [];

  function findLineNumber(fileContent, patterns, insertAfterPatterns) {
    if (!fileContent) return null;
    const lines = fileContent.split('\n');
    if (patterns && patterns.length > 0) {
      for (const pattern of patterns) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(pattern.toLowerCase())) return i + 1;
        }
      }
    }
    if (insertAfterPatterns && insertAfterPatterns.length > 0) {
      for (const pattern of insertAfterPatterns) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(pattern.toLowerCase())) return i + 2;
        }
      }
    }
    return null;
  }

  const htmlFile = files.find(f => f.path.endsWith('.html') || f.path.includes('index.html')) || files.find(f => f.path.includes('layout') || f.path.includes('_document'));
  const serverFile = files.find(f => f.path.includes('server') || f.path.includes('app.') || f.path.includes('index.js'));

  for (const test of failedTests) {
    const fix = { file: null, line: null, problem: '', fix: '', consequence: '', severity: test.priority || 'medium' };
    const t = (test.title || '').toLowerCase();

    if (t.includes('meta description')) {
      fix.problem = 'The page is missing a meta description tag, which search engines use to generate snippets.';
      fix.fix = '<meta name="description" content="Your site description — keep under 160 characters.">';
      fix.consequence = 'Search engines auto-generate a snippet that may not represent your page well.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['<meta name="description"'], ['<head', '<title']);
    } else if (t.includes('title tag')) {
      fix.problem = 'Page title is missing or outside the ideal 10-70 character range.';
      fix.fix = '<title>Your Page Title — Under 70 Characters</title>';
      fix.consequence = 'Browser tabs show a generic title; search rankings are impacted.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['<title'], ['<head']);
    } else if (t.includes('viewport')) {
      fix.problem = 'Missing viewport meta tag — page will not render correctly on mobile.';
      fix.fix = '<meta name="viewport" content="width=device-width, initial-scale=1.0">';
      fix.consequence = 'Page appears zoomed out on phones and tablets.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['viewport'], ['<head', '<title']);
    } else if (t.includes('heading') || t.includes('h1 tag')) {
      fix.problem = 'Page does not have exactly one H1 heading, hurting SEO.';
      fix.fix = '<h1>Your Main Page Heading</h1>';
      fix.consequence = 'Search engines cannot determine the primary topic of the page.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['<h1'], ['<body', '<main']);
    } else if (t.includes('open graph')) {
      fix.problem = 'No Open Graph tags — social media sharing will lack rich previews.';
      fix.fix = '<meta property="og:title" content="Title">\n<meta property="og:description" content="Description">\n<meta property="og:image" content="https://yoursite.com/og.jpg">';
      fix.consequence = 'Social media links appear as plain text with no preview.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['og:title'], ['</title', '<meta name="description']);
    } else if (t.includes('charset') || t.includes('character encoding')) {
      fix.problem = 'Missing character encoding declaration.';
      fix.fix = '<meta charset="utf-8">';
      fix.consequence = 'Special characters may display incorrectly.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['<meta charset'], ['<head']);
    } else if (t.includes('html size') || t.includes('document size')) {
      fix.problem = 'HTML document exceeds 500KB, slowing rendering.';
      fix.fix = '<!-- Reduce HTML: move inline styles to CSS, lazy-load content, remove comments -->';
      fix.consequence = 'Slow page rendering on mobile and slower networks.';
      fix.file = htmlFile?.path || 'index.html'; fix.line = 1;
    } else if (t.includes('security header')) {
      fix.problem = 'Security headers are not configured, leaving the site vulnerable to common web attacks like clickjacking and XSS.';
      fix.fix = 'const helmet = require("helmet");\napp.use(helmet());';
      fix.consequence = 'Vulnerable to XSS, clickjacking, and MIME sniffing attacks.';
      fix.file = serverFile?.path || 'server.js';
      if (serverFile?.content) fix.line = findLineNumber(serverFile.content, ['helmet'], ['app.use(cors', 'const app']);
    } else if (t.includes('content security policy') || t.includes('csp')) {
      fix.problem = 'No Content Security Policy (CSP) defined — primary XSS defense missing.';
      fix.fix = 'app.use((req, res, next) => {\n  res.setHeader("Content-Security-Policy", "default-src \'self\'; script-src \'self\'");\n  next();\n});';
      fix.consequence = 'No defense against injected malicious scripts.';
      fix.file = serverFile?.path || 'server.js';
      if (serverFile?.content) fix.line = findLineNumber(serverFile.content, ['content-security-policy'], ['app.listen', 'const app']);
    } else if (t.includes('hsts') || t.includes('strict transport')) {
      fix.problem = 'No HSTS header — HTTP connections are vulnerable to downgrade attacks.';
      fix.fix = 'res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");';
      fix.consequence = 'Users connecting via HTTP are vulnerable to man-in-the-middle attacks.';
      fix.file = serverFile?.path || 'server.js';
      if (serverFile?.content) fix.line = findLineNumber(serverFile.content, ['strict-transport'], ['app.listen']);
    } else if (t.includes('cookie security')) {
      fix.problem = 'Cookies missing HttpOnly, Secure, SameSite flags.';
      fix.fix = 'cookie: { httpOnly: true, secure: true, sameSite: "strict" }';
      fix.consequence = 'Cookies vulnerable to XSS theft and CSRF attacks.';
      fix.file = serverFile?.path || 'server.js';
      if (serverFile?.content) fix.line = findLineNumber(serverFile.content, ['cookie', 'session'], ['app.use']);
    } else if (t.includes('mixed content')) {
      fix.problem = 'HTTP resources loaded on HTTPS page.';
      fix.fix = '<!-- Replace all http:// URLs with https:// -->';
      fix.consequence = 'Browsers block resources or show security warnings.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['http://'], null);
    } else if (t.includes('server information') || t.includes('x-powered-by')) {
      fix.problem = 'Server leaking technology information through headers.';
      fix.fix = 'app.disable("x-powered-by");';
      fix.consequence = 'Attackers can target known vulnerabilities for your server version.';
      fix.file = serverFile?.path || 'server.js';
      if (serverFile?.content) fix.line = findLineNumber(serverFile.content, ['x-powered-by'], ['const app']);
    } else if (t.includes('permissions policy')) {
      fix.problem = 'No Permissions-Policy header to restrict browser APIs.';
      fix.fix = 'res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");';
      fix.consequence = 'Iframes can access camera, microphone, and geolocation without restriction.';
      fix.file = serverFile?.path || 'server.js';
      if (serverFile?.content) fix.line = findLineNumber(serverFile.content, ['permissions-policy'], ['app.listen']);
    } else if (t.includes('compression') || t.includes('gzip')) {
      fix.problem = 'No response compression — pages sent uncompressed.';
      fix.fix = 'const compression = require("compression");\napp.use(compression());';
      fix.consequence = 'Pages load 60-80% slower than necessary.';
      fix.file = serverFile?.path || 'server.js';
      if (serverFile?.content) fix.line = findLineNumber(serverFile.content, ['compression'], ['const app']);
    } else if (t.includes('resource count')) {
      fix.problem = 'Too many external scripts/stylesheets causing excessive HTTP requests.';
      fix.fix = '<!-- Bundle JS/CSS files with webpack/vite. Add defer to scripts:\n<script src="app.js" defer></script> -->';
      fix.consequence = 'Each resource blocks rendering, causing slow page loads.';
      fix.file = htmlFile?.path || 'index.html'; fix.line = 1;
    } else if (t.includes('third-party')) {
      fix.problem = 'Too many third-party script dependencies.';
      fix.fix = '<!-- Self-host critical libraries. Add SRI:\n<script src="https://cdn.example.com/lib.js" integrity="sha384-..." crossorigin="anonymous"></script> -->';
      fix.consequence = 'Each dependency is a supply-chain attack vector and performance liability.';
      fix.file = htmlFile?.path || 'index.html'; fix.line = 1;
    } else if (t.includes('inline script') || t.includes('inline style')) {
      fix.problem = 'Excessive inline scripts/styles prevent caching.';
      fix.fix = '<!-- Move to external files:\n<link rel="stylesheet" href="styles.css">\n<script src="app.js" defer></script> -->';
      fix.consequence = 'Inline code cannot be cached, increasing page size on every load.';
      fix.file = htmlFile?.path || 'index.html'; fix.line = 1;
    } else if (t.includes('language attribute') || t.includes('wcag 3.1.1')) {
      fix.problem = 'Missing lang attribute on <html> element (WCAG 3.1.1).';
      fix.fix = '<html lang="en">';
      fix.consequence = 'Screen readers cannot determine correct pronunciation rules.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['<html'], null);
    } else if (t.includes('form input label') || t.includes('wcag 1.3.1')) {
      fix.problem = 'Form inputs lack associated labels, hindering accessibility for screen reader users.';
      fix.fix = '<label for="name">Full Name</label>\n<input type="text" id="name" name="name">';
      fix.consequence = 'Screen reader users cannot tell what information to enter.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['<input', '<form'], null);
    } else if (t.includes('aria landmark') || t.includes('semantic region')) {
      fix.problem = 'Missing semantic landmarks (<main>, <nav>).';
      fix.fix = '<header>...</header>\n<nav>...</nav>\n<main id="main">...</main>\n<footer>...</footer>';
      fix.consequence = 'Screen reader users cannot quickly jump between page regions.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['<main', '<nav', '<body'], null);
    } else if (t.includes('skip navigation') || t.includes('wcag 2.4.1')) {
      fix.problem = 'No skip navigation link for keyboard-only users.';
      fix.fix = '<a href="#main" class="skip-link" style="position:absolute;left:-9999px">Skip to content</a>';
      fix.consequence = 'Keyboard users must tab through entire navigation on every page.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['skip-link'], ['<body']);
    } else if (t.includes('alt tag') || t.includes('image alt')) {
      fix.problem = 'Images missing alt attributes (WCAG accessibility).';
      fix.fix = '<img src="photo.jpg" alt="Descriptive text about the image">';
      fix.consequence = 'Screen readers cannot describe images to visually impaired users.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) {
        const lines = htmlFile.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes('<img') && !lines[i].toLowerCase().includes('alt=')) { fix.line = i + 1; break; }
        }
        if (!fix.line) fix.line = findLineNumber(htmlFile.content, ['<img'], null);
      }
    } else if (t.includes('tabindex') || t.includes('tab order')) {
      fix.problem = 'Positive tabindex values override natural tab order.';
      fix.fix = '<!-- Replace tabindex="5" with tabindex="0" -->';
      fix.consequence = 'Confusing keyboard navigation for users.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['tabindex'], null);
    } else if (t.includes('sitemap')) {
      fix.problem = 'No sitemap.xml — search engines cannot discover all pages efficiently.';
      fix.fix = '<?xml version="1.0"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>https://yoursite.com/</loc><priority>1.0</priority></url>\n</urlset>';
      fix.consequence = 'Search engines may miss pages, reducing organic traffic.';
      fix.file = 'public/sitemap.xml'; fix.line = 1;
    } else if (t.includes('canonical')) {
      fix.problem = 'No canonical URL tag — duplicate URL variants may be indexed.';
      fix.fix = '<link rel="canonical" href="https://yoursite.com/">';
      fix.consequence = 'SEO ranking diluted across URL variants.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['rel="canonical"'], ['</title']);
    } else if (t.includes('twitter card')) {
      fix.problem = 'No Twitter Card meta tags for rich link previews.';
      fix.fix = '<meta name="twitter:card" content="summary_large_image">\n<meta name="twitter:title" content="Your Title">';
      fix.consequence = 'Twitter links appear as plain text with no preview.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['twitter:card'], ['og:image', '</title']);
    } else if (t.includes('structured data') || t.includes('json-ld')) {
      fix.problem = 'No structured data — no rich results in search engines.';
      fix.fix = '<script type="application/ld+json">\n{"@context":"https://schema.org","@type":"WebSite","name":"Your Site","url":"https://yoursite.com"}\n</script>';
      fix.consequence = 'No rich results (ratings, FAQs) in Google Search.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['ld+json'], ['</head']);
    } else if (t.includes('favicon')) {
      fix.problem = 'The site is missing a favicon, which can negatively impact brand recognition and user experience in browser tabs.';
      fix.fix = '<link rel="icon" type="image/x-icon" href="/favicon.ico">';
      fix.consequence = 'Browser tabs show a generic icon.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['favicon'], ['<head', '<title']);
    } else if (t.includes('robots.txt')) {
      fix.problem = 'A robots.txt file is missing, which can help search engines understand crawl directives.';
      fix.fix = 'User-agent: *\nAllow: /\nSitemap: https://yoursite.com/sitemap.xml';
      fix.consequence = 'Search engines have no crawl directives.';
      fix.file = 'public/robots.txt'; fix.line = 1;
    } else if (t.includes('custom 404') || t.includes('error page')) {
      fix.problem = 'No custom 404 page — users see a generic error.';
      fix.fix = '<!-- Create 404.html with navigation back to homepage -->\n<h1>Page Not Found</h1>\n<a href="/">Go Home</a>';
      fix.consequence = 'Lost users see a confusing error page with no navigation.';
      fix.file = 'public/404.html'; fix.line = 1;
    } else if (t.includes('noscript')) {
      fix.problem = 'No <noscript> fallback for JS-disabled users.';
      fix.fix = '<noscript><p>This site requires JavaScript. Please enable it.</p></noscript>';
      fix.consequence = 'Users with JS disabled see a blank page.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['<noscript'], ['<body']);
    } else if (t.includes('deprecated')) {
      fix.problem = 'Deprecated HTML tags used (obsolete in HTML5).';
      fix.fix = '<!-- Replace: <center> → <div style="text-align:center">, <font> → <span> -->';
      fix.consequence = 'May not render correctly in modern browsers.';
      fix.file = htmlFile?.path || 'index.html'; fix.line = 1;
    } else if (t.includes('duplicate meta')) {
      fix.problem = 'Multiple title/meta description tags cause conflicting signals.';
      fix.fix = '<!-- Keep only ONE <title> and ONE <meta name="description"> in <head> -->';
      fix.consequence = 'Search engines may penalize for conflicting metadata.';
      fix.file = htmlFile?.path || 'index.html'; fix.line = 1;
    } else if (t.includes('https') || t.includes('ssl')) {
      fix.problem = 'Site served over HTTP without encryption.';
      fix.fix = '// Redirect HTTP to HTTPS:\nif (req.header("x-forwarded-proto") !== "https")\n  res.redirect("https://" + req.header("host") + req.url);';
      fix.consequence = 'All data transmitted in plaintext, vulnerable to interception.';
      fix.file = serverFile?.path || 'server.js';
      if (serverFile?.content) fix.line = findLineNumber(serverFile.content, ['https', 'redirect'], ['const app']);
    } else if (t.includes('form security')) {
      fix.problem = 'Forms submit data over insecure HTTP.';
      fix.fix = '<form action="https://yoursite.com/submit" method="POST">';
      fix.consequence = 'User input may be intercepted by attackers.';
      fix.file = htmlFile?.path || 'index.html';
      if (htmlFile?.content) fix.line = findLineNumber(htmlFile.content, ['<form'], null);
    } else if (t.includes('broken link')) {
      fix.problem = 'Broken internal links return 404 errors.';
      fix.fix = '<!-- Update or remove broken href links -->';
      fix.consequence = 'Users and search engines encounter dead ends.';
      fix.file = htmlFile?.path || 'index.html'; fix.line = 1;
    } else if (t.includes('response time') || t.includes('ttfb')) {
      fix.problem = 'Server response time exceeds 3 seconds.';
      fix.fix = 'const compression = require("compression");\napp.use(compression()); // + optimize DB queries, use CDN';
      fix.consequence = 'High bounce rates and poor search engine rankings.';
      fix.file = serverFile?.path || 'server.js'; fix.line = 1;
    } else {
      fix.problem = test.explanation?.substring(0, 120) || test.title;
      fix.fix = `// Fix: ${test.title}\n// Expected: ${test.expected || 'See test details'}`;
      fix.consequence = 'Test continues to fail, blocking risk-free deployment.';
      const kws = (test.title || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
      for (const file of files) {
        if (!file.content) continue;
        for (const kw of kws) {
          const ln = findLineNumber(file.content, [kw], null);
          if (ln) { fix.file = file.path; fix.line = ln; break; }
        }
        if (fix.line) break;
      }
      if (!fix.file) fix.file = htmlFile?.path || serverFile?.path || 'index.html';
    }

    fixes.push(fix);
  }

  return fixes;
}

/**
 * Rule-based codebase Q&A — analyzes the fetched source files locally
 * when no AI provider is available. Provides meaningful answers from file structure
 * and content analysis.
 */
function ruleBasedCodeQA(question, files, projectContext = {}) {
  const questionLower = question.toLowerCase();
  const fileList = files.map(f => f.path);
  const references = [];

  // Build a basic file summary
  const fileSummary = files.map(f => {
    const lines = f.content ? f.content.split('\n').length : 0;
    return `• **${f.path}** (${lines} lines)`;
  }).join('\n');

  // Detect question categories and generate targeted answers
  let answer = '';

  // ── Architecture / structure questions ──
  if (questionLower.match(/architect|structure|overview|how.*(work|built|organized)|explain.*(project|codebase|system)/)) {
    const dirs = [...new Set(files.map(f => f.path.split('/')[0]))];
    const extensions = [...new Set(files.map(f => {
      const ext = f.path.split('.').pop();
      return ext ? `.${ext}` : '';
    }).filter(Boolean))];

    answer = `Based on the ${files.length} source files I analyzed, here is the project architecture:\n\n`;
    answer += `**File structure:**\n${fileSummary}\n\n`;
    answer += `**Top-level directories:** ${dirs.join(', ')}\n`;
    answer += `**Languages/file types:** ${extensions.join(', ')}\n\n`;

    // Check for common patterns
    const hasPackageJson = files.find(f => f.path.endsWith('package.json'));
    if (hasPackageJson?.content) {
      try {
        const pkg = JSON.parse(hasPackageJson.content);
        answer += `**Project name:** ${pkg.name || 'N/A'}\n`;
        answer += `**Dependencies:** ${Object.keys(pkg.dependencies || {}).join(', ') || 'None listed'}\n`;
      } catch { }
    }

    files.slice(0, 5).forEach(f => {
      references.push({ file: f.path, lines: 'throughout', relevance: 'Core project file' });
    });
  }
  // ── Security questions ──
  else if (questionLower.match(/security|vulnerab|xss|csrf|injection|auth|helmet|cors|middleware/)) {
    const securityFiles = files.filter(f =>
      f.path.toLowerCase().match(/auth|security|middleware|server|app\.|cors|helmet/) ||
      (f.content && (f.content.includes('helmet') || f.content.includes('cors') || f.content.includes('csrf') || f.content.includes('auth')))
    );

    if (securityFiles.length > 0) {
      answer = `I found ${securityFiles.length} file(s) related to security in this codebase:\n\n`;
      securityFiles.forEach(f => {
        const hasHelmet = f.content?.includes('helmet');
        const hasCors = f.content?.includes('cors');
        const hasAuth = f.content?.toLowerCase().includes('auth');
        const details = [hasHelmet && 'Helmet (security headers)', hasCors && 'CORS', hasAuth && 'Authentication'].filter(Boolean);
        answer += `• **${f.path}**: ${details.length > 0 ? details.join(', ') : 'Security-related code'}\n`;
        references.push({ file: f.path, lines: 'throughout', relevance: details.join(', ') || 'Security-related' });
      });

      // Check for common vulnerabilities
      const issues = [];
      const anyFile = files.map(f => f.content || '').join('\n');
      if (!anyFile.includes('helmet')) issues.push('No `helmet` middleware detected — missing security headers');
      if (!anyFile.match(/rate.?limit/i)) issues.push('No rate limiting detected — potential DoS vector');
      if (anyFile.includes('eval(')) issues.push('Usage of `eval()` detected — potential code injection risk');
      if (anyFile.match(/innerHTML\s*=/)) issues.push('Direct `innerHTML` assignment — potential XSS vector');

      if (issues.length > 0) {
        answer += `\n**Potential concerns:**\n`;
        issues.forEach(i => answer += `⚠️ ${i}\n`);
      } else {
        answer += `\nNo obvious vulnerabilities were detected in a surface-level scan.`;
      }
    } else {
      answer = `I didn't find dedicated security files in the analyzed codebase. This could mean security is handled at the infrastructure level, or it may need to be added.\n\n**Files analyzed:**\n${fileSummary}`;
    }
  }
  // ── File listing / what files questions ──
  else if (questionLower.match(/what files|list.*(file|code)|files.*(project|repo)|show.*(file|code)/)) {
    answer = `Here are the ${files.length} source files I analyzed from this repository:\n\n${fileSummary}`;
    files.forEach(f => {
      references.push({ file: f.path, lines: 'throughout', relevance: 'Repository file' });
    });
  }
  // ── Specific file/component search ──
  else if (questionLower.match(/where|which file|find|locate|handle|manage/)) {
    const keywords = questionLower.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w =>
      w.length > 3 && !['where', 'which', 'file', 'files', 'does', 'handle', 'what', 'find', 'locate', 'that', 'this', 'have', 'manage'].includes(w)
    );

    const matchedFiles = files.filter(f => {
      const combined = (f.path + ' ' + (f.content || '')).toLowerCase();
      return keywords.some(kw => combined.includes(kw));
    });

    if (matchedFiles.length > 0) {
      answer = `I found ${matchedFiles.length} file(s) related to your query:\n\n`;
      matchedFiles.forEach(f => {
        const matchedKeywords = keywords.filter(kw => (f.path + ' ' + (f.content || '')).toLowerCase().includes(kw));
        answer += `• **${f.path}** — matches: ${matchedKeywords.join(', ')}\n`;

        // Find specific line numbers where keywords appear
        if (f.content) {
          const lines = f.content.split('\n');
          const matchLines = [];
          for (let i = 0; i < lines.length && matchLines.length < 3; i++) {
            if (keywords.some(kw => lines[i].toLowerCase().includes(kw))) {
              matchLines.push(i + 1);
            }
          }
          if (matchLines.length > 0) {
            references.push({ file: f.path, lines: `L${matchLines.join(', L')}`, relevance: `Contains: ${matchedKeywords.join(', ')}` });
          } else {
            references.push({ file: f.path, lines: 'throughout', relevance: `Contains: ${matchedKeywords.join(', ')}` });
          }
        }
      });
    } else {
      answer = `I couldn't find files directly matching your query in the ${files.length} files I analyzed. Try rephrasing or asking about specific components.\n\n**Files analyzed:**\n${fileSummary}`;
    }
  }
  // ── Generic / catch-all ──
  else {
    // Do a keyword search across all file contents
    const keywords = questionLower.replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w =>
      w.length > 3 && !['what', 'does', 'this', 'that', 'have', 'will', 'about', 'there', 'with', 'from', 'your', 'code'].includes(w)
    );

    const matchedFiles = files.filter(f => {
      const combined = (f.path + ' ' + (f.content || '')).toLowerCase();
      return keywords.some(kw => combined.includes(kw));
    });

    if (matchedFiles.length > 0) {
      answer = `Based on my analysis of ${files.length} repository files, here's what I found related to your question:\n\n`;
      matchedFiles.slice(0, 5).forEach(f => {
        const matchedKw = keywords.filter(kw => (f.path + ' ' + (f.content || '')).toLowerCase().includes(kw));
        answer += `• **${f.path}** — relevant to: ${matchedKw.join(', ')}\n`;
        references.push({ file: f.path, lines: 'throughout', relevance: `Contains: ${matchedKw.join(', ')}` });
      });
      answer += `\nFor a more detailed analysis, try asking about specific files or components.`;
    } else {
      answer = `I analyzed ${files.length} files from the repository but couldn't find content directly related to your question. Here are the files I have access to:\n\n${fileSummary}\n\nTry asking about specific files, components, or technical aspects of the codebase.`;
      files.slice(0, 3).forEach(f => {
        references.push({ file: f.path, lines: 'throughout', relevance: 'Analyzed file' });
      });
    }
  }

  return {
    answer,
    references,
    confidence: references.length > 0 ? 0.75 : 0.4,
    followUpQuestions: [
      'What is the overall architecture of this project?',
      'Are there any security vulnerabilities?',
      'Which files handle the main business logic?',
    ],
  };
}

/**
 * AI Codebase Q&A — answer questions about the codebase
 */
async function askAboutCode(question, files, projectContext = {}) {
  const fileContext = buildFileContext(files);

  const prompt = `You are a senior software engineer who deeply understands this codebase. A developer is asking you a question about it.

PROJECT: ${projectContext.name || 'Unknown Project'}
REPO: ${projectContext.repoUrl || 'Unknown'}
WEBSITE: ${projectContext.websiteUrl || 'Unknown'}

SOURCE CODE FILES:
${fileContext}

DEVELOPER'S QUESTION: "${question}"

Instructions:
1. Answer the question thoroughly based on the actual source code provided
2. Reference specific files and line numbers when relevant
3. If the question is about failure scenarios, trace the code path and explain what would happen
4. If the question is about architecture, explain the structure you see in the code
5. Be specific — never say "I don't have access to the code", because you DO
6. Keep your answer concise but comprehensive (2-4 paragraphs max)

Return your response as JSON (no markdown, no code fences):
{
  "answer": "<your detailed answer>",
  "references": [
    { "file": "<file path>", "lines": "<relevant line range or 'throughout'>", "relevance": "<why this file matters>" }
  ],
  "confidence": <0.0 to 1.0>,
  "followUpQuestions": ["<suggested follow-up 1>", "<suggested follow-up 2>"]
}`;

  // Fallback: use rule-based analysis of the actual source code files
  const fallback = () => ruleBasedCodeQA(question, files, projectContext);

  const response = await askAI(prompt, fallback);

  if (typeof response === 'string') {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return { ...JSON.parse(jsonMatch[0]), source: 'ai' };
      }
    } catch (e) {
      console.error('[AI] Q&A JSON parse error:', e.message);
    }
    // If can't parse JSON, return the raw text as the answer
    return { answer: response.trim(), references: [], confidence: 0.7, source: 'ai', followUpQuestions: [] };
  }

  return { ...response, source: response.source || 'fallback' };
}

module.exports = { analyzeRisk, analyzeSitePurpose, analyzeCodeFixes, askAboutCode, askAI, aiAvailable };

