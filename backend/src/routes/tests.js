/**
 * Test Generation Routes — REAL EXECUTION + SHARED CACHE
 * 
 * POST /api/generate-tests
 * Uses shared test results cache from Dashboard pipeline when available.
 * Only re-crawls/re-runs when explicitly refreshed or cache is expired.
 * Also supports AI-powered dynamic test generation via the configured AI model.
 */

const express = require('express');
const router = express.Router();
const { summarizeResults, getCachedTestResults } = require('../services/testRunner');
const { getProjectContext } = require('../services/projectContext');
const { getSession, getRequestSiteAuth } = require('../services/sessionStore');

/**
 * Use AI to generate site-specific test cases based on deep analysis.
 * These supplement the executed tests with AI insight.
 */
async function generateAITests(siteAnalysis, existingTests) {
  try {
    const { askAI, aiAvailable } = require('../services/aiAgent');
    if (!aiAvailable) return [];

    const existingTitles = existingTests.slice(0, 30).map(t => t.title).join('\n- ');
    const siteType = siteAnalysis.siteType || 'generic';

    const prompt = `You are an expert QA engineer specializing in ${siteType} websites. Based on this comprehensive site analysis, generate 15-25 UNIQUE test cases that test real-world user scenarios specific to this exact website.

WEBSITE: ${siteAnalysis.url}
SITE TYPE: ${siteType}
TITLE: "${siteAnalysis.title || 'None'}"
FORMS: ${siteAnalysis.forms?.length || 0} (${(siteAnalysis.forms || []).map(f => `${f.inputs?.length || 0} inputs`).join(', ')})
IMAGES: ${siteAnalysis.images?.total || 0} total, ${siteAnalysis.images?.withoutAlt || 0} missing alt
LINKS: ${siteAnalysis.links?.internal || 0} internal, ${siteAnalysis.links?.external || 0} external
SCRIPTS: ${siteAnalysis.scripts || 0}
HEADINGS: H1: ${siteAnalysis.headings?.h1?.length || 0}, H2: ${siteAnalysis.headings?.h2?.length || 0}
HAS COMPRESSION: ${siteAnalysis.hasCompression || false}
RESPONSE TIME: ${siteAnalysis.responseTime || 0}ms

DO NOT repeat any of these existing tests:
- ${existingTitles}

Focus on:
1. User journey tests specific to a ${siteType} website
2. Edge cases (what if user does X?)
3. Cross-browser/device scenarios
4. Performance under load
5. Data integrity checks
6. Error recovery scenarios
7. Concurrency scenarios

For each test, ASSESS if it would pass or fail based on the site data above.

Return ONLY a valid JSON array (no markdown, no code fences):
[{
  "title": "<descriptive test case title>",
  "type": "<functional|security|performance|accessibility|ui|edge>",
  "priority": "<critical|high|medium|low>",
  "expected": "<expected behavior>",
  "passed": <true|false based on your assessment>,
  "actual": "<what you observe from the site data>",
  "explanation": "<2-3 sentence explanation of why this matters and what you found>"
}]`;

    const fallback = () => [];
    const response = await askAI(prompt, fallback);

    if (!response || (typeof response !== 'string') || response.length < 10) return [];

    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const aiTests = JSON.parse(jsonMatch[0]);
    const startId = existingTests.length + 1;

    return aiTests.map((t, i) => ({
      id: `AI-${String(startId + i).padStart(3, '0')}`,
      title: t.title,
      type: t.type || 'functional',
      priority: t.priority || 'medium',
      passed: typeof t.passed === 'boolean' ? t.passed : null,
      expected: t.expected || '',
      actual: t.actual || 'AI-assessed',
      explanation: t.explanation || '',
      duration: 0,
      aiGenerated: true,
      source: 'ai',
      category: t.type || 'functional',
    }));
  } catch (err) {
    console.error('[TestGen] AI test generation failed:', err.message);
    return [];
  }
}



router.post('/generate-tests', async (req, res) => {
  try {
    const S = getSession();
    const ctx = getProjectContext();
    const websiteUrl = ctx.websiteUrl || 'https://example.com';
    const forceRefresh = req.body.refresh === true;

    const baseCache = getCachedTestResults();
    if (!forceRefresh && S.testStudioCache && S.testStudioCache.url === websiteUrl && (Date.now() - S.testStudioCache.time < 5 * 60 * 1000)) {
      if (!baseCache || S.testStudioCache.time >= baseCache.cachedAt) {
        console.log('[TestGen] Returning full cached response for Test Studio');
        return res.json(S.testStudioCache.data);
      }
    }

    let siteAnalysis, baseTests;

    if (!forceRefresh) {
      const cached = getCachedTestResults();
      if (cached && cached.url === websiteUrl) {
        console.log('[TestGen] Using cached crawl data from dashboard pipeline');
        siteAnalysis = cached.siteAnalysis;
        baseTests = cached.testResults;
      }
    }

    if (!siteAnalysis) {
      console.log('[TestGen] Running fresh agent pipeline for comprehensive tests...');
      const { runAgentPipeline } = require('../services/agentGraph');
      const finalState = await runAgentPipeline(websiteUrl, { auth: getRequestSiteAuth() });
      siteAnalysis = finalState.siteAnalysis;
      baseTests = finalState.allTestResults;
    }

    console.log('[TestGen] Requesting AI-generated tests...');
    const aiTests = await generateAITests(siteAnalysis, baseTests);
    console.log(`[TestGen] Generated ${aiTests.length} AI tests`);

    const allTests = [...baseTests, ...aiTests];

    console.log(`[TestGen] ✓ Total: ${allTests.length} tests (${baseTests.length} executed + ${aiTests.length} AI)`);

    const responsePayload = {
      success: true,
      generation: {
        projectContext: { name: ctx.name, url: websiteUrl, siteType: siteAnalysis.siteType },
        totalGenerated: allTests.length,
        tests: allTests,
        generatedAt: new Date().toISOString(),
      },
      summary: {
        ...summarizeResults(allTests),
        baseTests: baseTests.length,
        aiTestsGenerated: aiTests.length,
      },
    };

    // Save to Test Studio cache
    S.testStudioCache = { url: websiteUrl, time: Date.now(), data: responsePayload };

    res.json(responsePayload);
  } catch (error) {
    console.error('Test generation error:', error);
    res.status(500).json({ error: 'Generation failed', message: error.message });
  }
});

module.exports = router;
