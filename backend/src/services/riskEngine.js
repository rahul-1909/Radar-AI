/**
 * Risk Engine — the single, deterministic release-risk formula.
 *
 * Used by the Dashboard and Insights so they always agree. The AI never sets
 * the score or the decision; it only explains them.
 *
 * 1. Each test is placed in a category by what it checks (not by the label
 *    the runner gave it), and checks repeated by several runners — e.g. CSP,
 *    HSTS, mixed content — are merged so they count once.
 * 2. Category risk = severity-weighted share of failed checks (0–100).
 * 3. Overall risk = weighted average of category risks:
 *      Functionality 35 · Security 30 · Performance 15 · Accessibility 10 · SEO 10
 * 4. Deployment is BLOCKED by release blockers (site down, broken pages,
 *    HTTPS problems, pages that 404…) or by high functionality/security risk
 *    — never by SEO or accessibility alone.
 */

const CATEGORIES = {
  functionality: { name: 'Functionality', weight: 35, blockAt: 50 },
  security: { name: 'Security', weight: 30, blockAt: 60 },
  performance: { name: 'Performance', weight: 15 },
  accessibility: { name: 'Accessibility', weight: 10 },
  seo: { name: 'SEO & Metadata', weight: 10 },
};

const SEVERITY = { critical: 5, high: 3, medium: 2, low: 1 };
const OVERALL_BLOCK_AT = 60;

// First match wins. Order matters: SEO/metadata checks are often labelled
// "functional" or "api" by the runners, so they're caught first.
const CATEGORY_RULES = [
  ['seo', /meta description|open graph|twitter card|canonical|structured data|json-ld|sitemap|robots|favicon|title tag|has a title|heading structure|h1 heading|\bh1\b/i],
  ['security', /security|https|ssl|tls|hsts|strict transport|csp|clickjacking|mime sniff|cors|mixed content|cookie|referrer|permissions.policy|server information|open redirect|x-powered/i],
  ['performance', /performance|response time|ttfb|first contentful|compression|gzip|load in under|slow|document size|resource count|inline scripts|third-party/i],
  ['accessibility', /accessib|aria|wcag|skip navigation|alt text|tab order|tabindex|language attribute|landmark|label/i],
];

// Checks that just summarise other checks — shown in results, not scored twice
const AGGREGATES = /overall api health|security headers score|^security headers$|newman — security headers/i;

// Same check reported by several runners → one topic
const TOPICS = [
  [/hsts|strict transport/i, 'hsts'],
  [/mixed content/i, 'mixed-content'],
  [/server information/i, 'server-info'],
  [/permissions.policy/i, 'permissions-policy'],
  [/content security policy|\bcsp\b/i, 'csp'],
  [/robots/i, 'robots'],
  [/favicon/i, 'favicon'],
  [/meta description/i, 'meta-description'],
  [/h1|heading structure/i, 'h1'],
  [/page title|title tag|has a title/i, 'title'],
  [/ssl certificate|https \/ ssl/i, 'ssl'],
];

// A failure of any of these blocks the release on its own
const BLOCKERS = [
  [/http status check/i, 'The site does not load (HTTP error on the start page)'],
  [/pages load without errors/i, 'Some pages fail to load'],
  [/open directly by url/i, 'Pages return 404 when opened directly (refresh, bookmarks and shared links break)'],
  [/page load & title/i, 'The page does not load in a real browser'],
  [/ssl certificate|https \/ ssl|https enforcement/i, 'HTTPS is missing or the certificate is invalid'],
  [/mixed content/i, 'Page loads insecure (http://) resources over HTTPS'],
];

function categoryOf(test) {
  const title = test.title || '';
  for (const [key, pattern] of CATEGORY_RULES) {
    if (pattern.test(title)) return key;
  }
  if (test.type === 'security') return 'security';
  if (test.type === 'performance') return 'performance';
  if (test.type === 'accessibility') return 'accessibility';
  return 'functionality';
}

function topicOf(title) {
  for (const [pattern, topic] of TOPICS) {
    if (pattern.test(title)) return topic;
  }
  return title.toLowerCase().replace(/^(newman|selenium) — /, '').replace(/\s*\(\d+ pages?\)$/, '').trim();
}

const maxSeverity = (a, b) => ((SEVERITY[a] || 2) >= (SEVERITY[b] || 2) ? a : b);

function levelFor(score) {
  if (score >= 80) return 'critical';
  if (score >= 60) return 'high';
  if (score >= 30) return 'medium';
  return 'low';
}

/**
 * Score a set of test results. Returns the score, decision, per-category
 * breakdown, blockers, and the plain-English reasons behind the decision.
 */
function computeRisk(testResults = []) {
  // 1) Group into unique checks per category
  const checks = new Map(); // `${category}:${topic}` → check
  for (const test of testResults) {
    if (test.aiGenerated || test.passed === null || test.passed === undefined) continue; // suggestions, not executed
    if (AGGREGATES.test(test.title || '')) continue;
    const category = categoryOf(test);
    const key = `${category}:${topicOf(test.title || '')}`;
    const existing = checks.get(key);
    if (!existing) {
      checks.set(key, { category, title: test.title, priority: test.priority || 'medium', passed: !!test.passed, tests: [test] });
    } else {
      existing.priority = maxSeverity(existing.priority, test.priority);
      existing.tests.push(test);
      if (!test.passed) {
        existing.passed = false;
        existing.title = test.title; // show the failing variant
      }
    }
  }

  // 2) Category risk
  const categories = Object.entries(CATEGORIES).map(([key, def]) => {
    const inCat = [...checks.values()].filter(c => c.category === key);
    const total = inCat.reduce((s, c) => s + (SEVERITY[c.priority] || 2), 0);
    const failedChecks = inCat.filter(c => !c.passed);
    const failed = failedChecks.reduce((s, c) => s + (SEVERITY[c.priority] || 2), 0);
    return {
      key,
      name: def.name,
      weight: def.weight,
      risk: total ? Math.round((failed / total) * 100) : 0,
      checks: inCat.length,
      passed: inCat.length - failedChecks.length,
      failed: failedChecks.length,
      failures: failedChecks
        .sort((a, b) => (SEVERITY[b.priority] || 2) - (SEVERITY[a.priority] || 2))
        .map(c => ({ title: c.title, priority: c.priority })),
      measured: inCat.length > 0,
    };
  });

  // 3) Overall = weighted average over measured categories
  const measured = categories.filter(c => c.measured);
  const weightSum = measured.reduce((s, c) => s + c.weight, 0) || 1;
  const riskScore = Math.round(measured.reduce((s, c) => s + c.risk * c.weight, 0) / weightSum);

  // 4) Decision
  const blockers = [];
  for (const check of checks.values()) {
    if (check.passed) continue;
    const blocker = BLOCKERS.find(([pattern]) => pattern.test(check.title));
    if (blocker) blockers.push({ title: check.title, reason: blocker[1] });
    else if (check.priority === 'critical' && (check.category === 'functionality' || check.category === 'security')) {
      blockers.push({ title: check.title, reason: `Critical ${CATEGORIES[check.category].name.toLowerCase()} check failed: ${check.title}` });
    }
  }

  const reasons = blockers.map(b => b.reason);
  for (const c of categories) {
    const limit = CATEGORIES[c.key].blockAt;
    if (limit && c.measured && c.risk >= limit) reasons.push(`${c.name} risk is ${c.risk}/100 (blocks at ${limit})`);
  }
  if (riskScore >= OVERALL_BLOCK_AT) reasons.push(`Overall risk is ${riskScore}/100 (blocks at ${OVERALL_BLOCK_AT})`);

  const deployment = reasons.length ? 'blocked' : 'approved';

  // Non-blocking but worth fixing
  const warnings = categories
    .filter(c => c.failed > 0 && !(CATEGORIES[c.key].blockAt && c.risk >= CATEGORIES[c.key].blockAt))
    .map(c => `${c.name}: ${c.failed} check(s) failing (risk ${c.risk}/100)`);

  return {
    riskScore,
    riskLevel: levelFor(Math.max(riskScore, blockers.length ? 60 : 0)),
    deployment,
    reasons,
    blockers,
    warnings,
    categories,
    formula: 'Weighted average of category risk — Functionality 35%, Security 30%, Performance 15%, Accessibility 10%, SEO 10%. Blocked by release blockers, Functionality ≥ 50, Security ≥ 60, or overall ≥ 60.',
  };
}

module.exports = { computeRisk };
