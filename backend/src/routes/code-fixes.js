/**
 * Code Fix Suggestions Route
 * 
 * POST /api/code-fixes
 * Fetches repo source code via GitHub API, analyzes it against test failures,
 * and returns specific line-level fix suggestions powered by the configured AI model.
 */

const express = require('express');
const router = express.Router();
const { parseGitHubUrl, fetchRepoTree, selectRelevantFiles, fetchFileContents } = require('../services/codeAnalyzer');
const { analyzeCodeFixes } = require('../services/aiAgent');
const { getProjectContext } = require('../services/projectContext');
const { crawlWebsite } = require('../services/websiteCrawler');
const { runTests, summarizeResults } = require('../services/testRunner');
const { getSession } = require('../services/sessionStore');
const { computeRisk } = require('../services/riskEngine');
const { RepoAccessError } = require('../services/githubClient');

// Cache code fixes per user session to avoid re-analyzing
const FIXES_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

router.post('/code-fixes', async (req, res) => {
  try {
    const S = getSession();
    const forceRefresh = req.body.refresh === true;
    const now = Date.now();

    // Return cached fixes if fresh
    if (!forceRefresh && S.fixesCache && (now - S.fixesCacheTime) < FIXES_CACHE_TTL) {
      console.log('[CodeFixes] Returning cached results');
      return res.json(S.fixesCache);
    }

    const ctx = getProjectContext();
    const repoUrl = req.body.repoUrl || ctx.repoUrl;

    if (!repoUrl) {
      return res.status(400).json({
        error: 'No repository URL configured. Set it in the project settings.',
        fixes: [],
      });
    }

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid GitHub URL format.' });
    }

    const pipelineStart = Date.now();
    const { owner, repo } = parsed;

    // Step 1: Crawl website and run tests (or reuse from body)
    console.log('[CodeFixes] Step 1: Running tests...');
    const websiteUrl = ctx.websiteUrl || 'https://example.com';
    const siteAnalysis = await crawlWebsite(websiteUrl);
    const testResults = await runTests(websiteUrl, siteAnalysis);
    const summary = summarizeResults(testResults);
    const failedTests = testResults.filter(t => !t.passed);

    // Step 2: Fetch repo file tree
    console.log('[CodeFixes] Step 2: Fetching repo tree...');
    const { tree, branch } = await fetchRepoTree(owner, repo);

    // Step 3: Select relevant files
    console.log('[CodeFixes] Step 3: Selecting relevant files...');
    const relevantFiles = selectRelevantFiles(tree, testResults, siteAnalysis);

    // Step 4: Fetch file contents
    console.log('[CodeFixes] Step 4: Fetching file contents...');
    const filePaths = relevantFiles.map(f => f.path);
    const fileContents = await fetchFileContents(owner, repo, filePaths);

    // Step 5: Analyze with AI
    console.log('[CodeFixes] Step 5: Analyzing with AI...');
    const { fixes, source } = await analyzeCodeFixes(fileContents, testResults, siteAnalysis);

    const pipelineMs = Date.now() - pipelineStart;

    // Same risk formula as the Dashboard and Insights
    const currentRiskScore = computeRisk(testResults).riskScore;

    // Distribute the ENTIRE current risk across all fixes proportionally
    // based on severity weight. Applying all fixes → 0% risk (fully scalable).
    const severityWeight = { critical: 4, high: 3, medium: 2, low: 1 };
    const fixList = fixes || [];
    const totalSeverityWeight = fixList.reduce((sum, fix) => sum + (severityWeight[fix.severity] || 2), 0);

    // Each fix gets: (its weight / total weight) * currentRiskScore
    // We use a running accumulator to avoid rounding drift — the last fix
    // absorbs any fractional remainder so the total always equals currentRiskScore.
    let assignedReduction = 0;
    const enrichedFixes = fixList.map((fix, idx) => {
      const weight = severityWeight[fix.severity] || 2;
      let reductionPercent;

      if (idx === fixList.length - 1) {
        // Last fix absorbs the remainder to guarantee total === currentRiskScore
        reductionPercent = currentRiskScore - assignedReduction;
      } else {
        // Proportional share, at least 1% per fix
        reductionPercent = Math.max(
          1,
          Math.round((weight / Math.max(totalSeverityWeight, 1)) * currentRiskScore)
        );
        // Don't let cumulative reduction exceed the total
        if (assignedReduction + reductionPercent > currentRiskScore) {
          reductionPercent = currentRiskScore - assignedReduction;
        }
      }

      reductionPercent = Math.max(reductionPercent, 0);
      assignedReduction += reductionPercent;

      return {
        ...fix,
        riskReduction: reductionPercent,
      };
    });

    const totalReduction = assignedReduction;
    const projectedRiskScore = Math.max(0, currentRiskScore - totalReduction);

    const responseData = {
      success: true,
      fixes: enrichedFixes,
      source,
      riskProjection: {
        currentRiskScore,
        projectedRiskScore,
        totalReduction,
        passRate: summary.passRate,
      },
      meta: {
        repo: `${owner}/${repo}`,
        branch,
        filesAnalyzed: fileContents.length,
        totalRepoFiles: tree.length,
        failedTests: failedTests.length,
        totalTests: testResults.length,
        passRate: summary.passRate,
        pipelineDurationMs: pipelineMs,
      },
      analyzedFiles: fileContents.map(f => ({ path: f.path, size: f.size })),
      testSummary: {
        total: summary.total,
        passed: summary.passed,
        failed: summary.failed,
        passRate: summary.passRate,
      },
      timestamp: new Date().toISOString(),
    };

    // Cache the results
    S.fixesCache = responseData;
    S.fixesCacheTime = Date.now();
    console.log(`[CodeFixes] Complete in ${pipelineMs}ms — ${fixes?.length || 0} fixes found (${source})`);

    res.json(responseData);
  } catch (error) {
    console.error('[CodeFixes] Error:', error.message);
    res.status(error instanceof RepoAccessError ? error.status : 500).json({
      error: 'Code analysis failed',
      message: error.message,
      fixes: [],
    });
  }
});

module.exports = router;
