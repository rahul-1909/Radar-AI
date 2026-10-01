/**
 * Risk Prediction Routes — REAL EXECUTION (Dynamic)
 * 
 * POST /api/predict-risk
 * Detailed view of the same risk analysis the Dashboard shows (the score and
 * decision come from services/riskEngine.js), plus trend and recommendations.
 */

const express = require('express');
const router = express.Router();
const { crawlWebsite } = require('../services/websiteCrawler');
const { runTests, summarizeResults, getCachedTestResults } = require('../services/testRunner');
const { analyzeRisk } = require('../services/aiAgent');
const { getProjectContext } = require('../services/projectContext');

const { getSession } = require('../services/sessionStore');

// Per-user risk history map: { url: [ {timestamp, score, level}, ... ] }
function getRiskHistoryMap() {
  const S = getSession();
  if (!S.riskHistory) S.riskHistory = {};
  return S.riskHistory;
}

/**
 * Build risk trend data from REAL history for a specific URL only.
 */
function buildRiskTrend(currentScore, currentLevel, url) {
  const now = new Date();
  const key = url || 'default';
  const riskHistoryMap = getRiskHistoryMap();

  // Get or create history for this URL
  if (!riskHistoryMap[key]) riskHistoryMap[key] = [];
  let urlHistory = riskHistoryMap[key];

  // Add current run
  urlHistory.push({
    timestamp: now.toISOString(),
    score: currentScore,
    level: currentLevel,
  });

  // Keep last 20 runs max per URL
  if (urlHistory.length > 20) urlHistory = urlHistory.slice(-20);
  riskHistoryMap[key] = urlHistory;

  // Build trend entries from this URL's data only
  const entries = urlHistory.map((entry, index) => {
    const date = new Date(entry.timestamp);
    const isLast = index === urlHistory.length - 1;
    return {
      label: isLast
        ? 'Current'
        : `Run ${index + 1} (${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })})`,
      score: entry.score,
      level: entry.level,
      timestamp: entry.timestamp,
    };
  });

  // Compute trend direction from actual data
  const scores = entries.map(t => t.score);
  let direction = 'stable';

  if (scores.length >= 2) {
    const firstHalf = scores.slice(0, Math.ceil(scores.length / 2));
    const secondHalf = scores.slice(Math.ceil(scores.length / 2));
    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    if (avgSecond - avgFirst > 5) direction = 'worsening';
    else if (avgFirst - avgSecond > 5) direction = 'improving';
  }

  return {
    entries,
    direction,
    avgScore: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length),
    minScore: Math.min(...scores),
    maxScore: Math.max(...scores),
    totalRuns: urlHistory.length,
  };
}

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];

function severityFor(category, blockerTitles) {
  if (!category.failed) return 'low';
  if (category.failures.some(f => blockerTitles.has(f.title))) return 'critical'; // holds a release blocker
  if (category.risk >= 60) return 'critical';
  if (category.risk >= 40) return 'high';
  if (category.risk >= 20) return 'medium';
  return 'low';
}

/** Engine categories → the factor cards Insights shows. */
function buildFactors(analysis) {
  const blockerTitles = new Set((analysis.blockers || []).map(b => b.title));
  return analysis.categories.filter(c => c.measured).map(c => ({
    name: c.name,
    score: c.risk,
    weight: c.weight / 100,
    description: c.failed
      ? `${c.failed} of ${c.checks} checks failing — ${c.failures.slice(0, 3).map(f => f.title).join('; ')}`
      : `All ${c.checks} checks pass`,
    failCount: c.failed,
    totalTests: c.checks,
    severity: severityFor(c, blockerTitles),
    issues: c.failures.map(f => `[${(f.priority || 'medium').toUpperCase()}] ${f.title}`),
  }));
}

const CATEGORY_OF_REC = [
  [/index\.html|load|javascript/i, 'Functionality'],
  [/https|mixed|content-security|clickjacking|nosniff|cookie|cors|referrer/i, 'Security'],
  [/compression|slow/i, 'Performance'],
  [/alt text|landmark|label|skip/i, 'Accessibility'],
  [/seo/i, 'SEO'],
];

function detailRecommendations(analysis) {
  return analysis.recommendations.map((text, i) => {
    const category = (CATEGORY_OF_REC.find(([p]) => p.test(text)) || [null, 'General'])[1];
    const priority = category === 'SEO' ? 'low'
      : i < analysis.blockers.length ? 'critical'
      : category === 'Functionality' || category === 'Security' ? 'high' : 'medium';
    return { text, priority, category, effort: /rewrite|header|compression|alt|meta/i.test(text) ? 'low' : 'medium' };
  }).sort((a, b) => SEVERITY_ORDER.indexOf(a.priority) - SEVERITY_ORDER.indexOf(b.priority));
}

function buildGatekeeperConditions(analysis, summary) {
  if (analysis.deployment === 'blocked') {
    return [
      ...analysis.reasons.map(r => `Fix: ${r}`),
      'Re-run the tests and confirm no release blockers remain',
    ];
  }
  const conditions = [`Monitor error rates for 24 hours after release (baseline: ${summary.passRate}% of checks passing)`];
  for (const w of analysis.categories.filter(c => c.failed && (c.key === 'functionality' || c.key === 'security'))) {
    conditions.push(`Schedule the ${w.failed} failing ${w.name.toLowerCase()} check(s) for the next sprint`);
  }
  conditions.push('Keep a rollback plan ready for 48 hours');
  return conditions;
}


router.post('/predict-risk', async (req, res) => {
  try {
    const ctx = getProjectContext();
    const websiteUrl = ctx.websiteUrl || 'https://example.com';
    const S = getSession();

    let siteAnalysis, testResults, summary, analysis;

    // Reuse the dashboard pipeline's results AND its risk analysis, so
    // Insights and the Dashboard always show the same score and decision.
    const cached = getCachedTestResults();
    if (cached && cached.testResults && cached.testResults.length > 0) {
      siteAnalysis = cached.siteAnalysis;
      testResults = cached.testResults;
      summary = cached.summary || summarizeResults(testResults);
      if (S.lastRiskAnalysis?.cachedAt === cached.cachedAt) analysis = S.lastRiskAnalysis.analysis;
    } else {
      console.log('[Risk] No cached results — running fresh crawl and tests');
      siteAnalysis = await crawlWebsite(websiteUrl);
      testResults = await runTests(websiteUrl, siteAnalysis);
      summary = summarizeResults(testResults);
    }
    if (!analysis) analysis = await analyzeRisk(siteAnalysis, testResults, summary);

    const { riskScore, riskLevel, deployment } = analysis;
    const factors = buildFactors(analysis);
    const detailedRecommendations = detailRecommendations(analysis);
    const trend = buildRiskTrend(riskScore, riskLevel, websiteUrl);

    res.json({
      success: true,
      agents: ['Website Crawler Agent', 'Test Execution Agent', 'Page Explorer Agent', 'Risk Analysis Agent', 'CI/CD Gatekeeper Agent'],
      risk: {
        riskScore,
        riskLevel,
        factors,
        explanation: analysis.summary,
        formula: analysis.formula,
        recommendations: detailedRecommendations.map(r => r.text),
        detailedRecommendations,
        deployment,
        source: analysis.source,
        categoryBreakdown: factors.map(f => ({
          name: f.name,
          passed: f.totalTests - f.failCount,
          failed: f.failCount,
          total: f.totalTests,
          passRate: f.totalTests ? Math.round(((f.totalTests - f.failCount) / f.totalTests) * 100) : 100,
        })),
      },
      gatekeeper: {
        decision: deployment.toUpperCase(),
        riskScore,
        riskLevel,
        reasoning: analysis.summary,
        blockers: analysis.reasons,
        conditions: buildGatekeeperConditions(analysis, summary),
      },
      trend,
      testSummary: summary,
    });
  } catch (error) {
    console.error('Risk prediction error:', error);
    res.status(500).json({ error: 'Prediction failed', message: error.message });
  }
});

module.exports = router;
