/**
 * Agent Graph — LangGraph Multi-Agent Orchestration
 * 
 * Implements a StateGraph that orchestrates all RadarAI intelligence agents
 * using LangGraph's node/edge model with shared state.
 * 
 * Graph flow:
 *   START → crawler → testRunner → securityScanner → pageExplorer → riskAnalyzer → gatekeeper → metricsCollector → END
 */

const { StateGraph, END, START } = require('@langchain/langgraph');

// Import agent services
const { crawlWebsite } = require('./websiteCrawler');
const { runTests, summarizeResults, cacheTestResults, getCachedTestResults } = require('./testRunner');
const { analyzeRisk, analyzeSitePurpose } = require('./aiAgent');
const { runSeleniumTests } = require('./seleniumRunner');
const { runNewmanTests } = require('./newmanRunner');
const { runSecurityScan } = require('./securityScanner');
const { calculateSprintVelocity, recordPrediction } = require('./metricsEngine');
const { exploreSite } = require('./siteExplorer');
const { setProgress, getSession } = require('./sessionStore');


/**
 * Shared state that flows through all agent nodes.
 * Each node reads what it needs and writes its outputs.
 */
function createInitialState(url, options = {}) {
  return {
    // Input
    url,
    options,

    // Crawler output
    siteAnalysis: null,
    sitePurpose: null,

    // Test runner output
    baseTestResults: [],
    seleniumResults: [],
    newmanResults: [],
    zapResults: [],
    siteExploration: null,
    allTestResults: [],
    testSummary: null,

    // Risk analysis output
    riskAnalysis: null,

    // Gatekeeper output
    gatekeeperDecision: null,

    // Metrics output
    sprintVelocity: null,
    predictionId: null,

    // Pipeline metadata
    agentTimeline: [],
    errors: [],
    pipelineStartMs: Date.now(),
  };
}


/**
 * Node 1: Website Crawler Agent
 * Crawls the target URL and analyzes site structure
 */
async function crawlerAgent(state) {
  const startMs = Date.now();
  setProgress('Crawling the start page…');
  try {
    const siteAnalysis = await crawlWebsite(state.url);
    const sitePurpose = await analyzeSitePurpose(siteAnalysis);
    const durationMs = Date.now() - startMs;

    return {
      ...state,
      siteAnalysis,
      sitePurpose,
      agentTimeline: [...state.agentTimeline, {
        id: 'agent-crawler',
        agent: 'Website Crawler Agent',
        status: 'completed',
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date(startMs + durationMs).toISOString(),
        durationMs,
        duration: formatDuration(durationMs),
        summary: siteAnalysis.success
          ? `Crawled ${state.url} — ${siteAnalysis.links?.total || 0} links, ${siteAnalysis.images?.total || 0} images, ${siteAnalysis.forms?.length || 0} forms, type: ${siteAnalysis.siteType}`
          : `Failed to crawl ${state.url}: ${siteAnalysis.error}`,
      }],
    };
  } catch (err) {
    return {
      ...state,
      errors: [...state.errors, { agent: 'crawler', error: err.message }],
      agentTimeline: [...state.agentTimeline, {
        id: 'agent-crawler', agent: 'Website Crawler Agent', status: 'failed',
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        duration: formatDuration(Date.now() - startMs),
        summary: `Error: ${err.message}`,
      }],
    };
  }
}

/**
 * Node 2: Test Execution Agent
 * Runs base tests + Selenium UI tests + Newman API tests
 */
async function testRunnerAgent(state) {
  const startMs = Date.now();
  setProgress('Running tests (browser, API, SEO, accessibility)…');
  if (!state.siteAnalysis?.success) {
    return {
      ...state,
      agentTimeline: [...state.agentTimeline, {
        id: 'agent-tester', agent: 'Test Execution Agent', status: 'skipped',
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: 0, duration: '0ms',
        summary: 'Skipped — no valid site analysis available',
      }],
    };
  }

  try {
    // Run all test types in parallel
    const [baseResults, seleniumResults, newmanResults] = await Promise.all([
      runTests(state.url, state.siteAnalysis),
      runSeleniumTests(state.url, state.siteAnalysis).catch(err => {
        console.error('[AgentGraph] Selenium error:', err.message);
        return [];
      }),
      runNewmanTests(state.url, state.siteAnalysis).catch(err => {
        console.error('[AgentGraph] Newman error:', err.message);
        return [];
      }),
    ]);

    const allResults = [...baseResults, ...seleniumResults, ...newmanResults];
    const summary = summarizeResults(allResults);
    const durationMs = Date.now() - startMs;

    // Cache for Test Studio reuse
    cacheTestResults(state.url, state.siteAnalysis, allResults, summary);

    return {
      ...state,
      baseTestResults: baseResults,
      seleniumResults,
      newmanResults,
      allTestResults: allResults,
      testSummary: summary,
      agentTimeline: [...state.agentTimeline, {
        id: 'agent-tester', agent: 'Test Execution Agent', status: 'completed',
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date(startMs + durationMs).toISOString(),
        durationMs, duration: formatDuration(durationMs),
        summary: `Executed ${allResults.length} tests (${baseResults.length} base, ${seleniumResults.length} Selenium, ${newmanResults.length} Newman) — ${summary.passed} passed, ${summary.failed} failed (${summary.passRate}%)`,
      }],
    };
  } catch (err) {
    return {
      ...state,
      errors: [...state.errors, { agent: 'tester', error: err.message }],
      agentTimeline: [...state.agentTimeline, {
        id: 'agent-tester', agent: 'Test Execution Agent', status: 'failed',
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs, duration: formatDuration(Date.now() - startMs),
        summary: `Error: ${err.message}`,
      }],
    };
  }
}

/**
 * Node 3: Security Scanner Agent (Lightweight)
 * Runs real HTTP-based security checks, merges into test results
 */
async function securityScannerAgent(state) {
  const startMs = Date.now();
  setProgress('Running security checks…');
  try {
    const secResults = await runSecurityScan(state.url, state.siteAnalysis);
    const durationMs = Date.now() - startMs;

    // Merge security results into the combined test results
    const allResults = [...state.allTestResults, ...secResults];
    const summary = summarizeResults(allResults);

    // Cache updated results with security scan included
    cacheTestResults(state.url, state.siteAnalysis, allResults, summary);

    return {
      ...state,
      zapResults: secResults,
      allTestResults: allResults,
      testSummary: summary,
      agentTimeline: [...state.agentTimeline, {
        id: 'agent-security', agent: 'Security Scanner Agent', status: 'completed',
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date(startMs + durationMs).toISOString(),
        durationMs, duration: formatDuration(durationMs),
        summary: `Security scan found ${secResults.filter(r => !r.passed).length} issues across ${secResults.length} checks (SSL, CSP, HSTS, cookies, CORS, etc.)`,
      }],
    };
  } catch (err) {
    return {
      ...state,
      errors: [...state.errors, { agent: 'security', error: err.message }],
      agentTimeline: [...state.agentTimeline, {
        id: 'agent-security', agent: 'Security Scanner Agent', status: 'skipped',
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs, duration: formatDuration(Date.now() - startMs),
        summary: `Skipped: ${err.message}`,
      }],
    };
  }
}

/**
 * Node 3b: Page Explorer Agent
 * Crawls more pages of the site and, with a test account, pages behind the login
 */
async function pageExplorerAgent(state) {
  const startMs = Date.now();
  const timelineEntry = (status, summary) => ({
    id: 'agent-explorer', agent: 'Page Explorer Agent', status,
    startedAt: new Date(startMs).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startMs, duration: formatDuration(Date.now() - startMs),
    summary,
  });

  if (!state.siteAnalysis?.success) {
    return { ...state, agentTimeline: [...state.agentTimeline, timelineEntry('skipped', 'Skipped — the start page could not be loaded')] };
  }

  try {
    const exploration = await exploreSite(state.siteAnalysis, state.options?.auth || null);
    const allResults = [...state.allTestResults, ...exploration.tests];
    const summary = summarizeResults(allResults);
    cacheTestResults(state.url, state.siteAnalysis, allResults, summary);

    const { counts, login } = exploration;
    const loginNote = {
      success: ` + ${counts.private} logged-in`,
      'not-provided': ' — login page found, no test account given',
    }[login.status] || (login.status === 'none' ? '' : ` — login: ${login.status}`);

    return {
      ...state,
      siteExploration: exploration,
      allTestResults: allResults,
      testSummary: summary,
      agentTimeline: [...state.agentTimeline, timelineEntry('completed',
        `Explored ${counts.public} public page(s)${loginNote}; ${exploration.tests.filter(t => !t.passed).length} site-wide issue(s)`)],
    };
  } catch (err) {
    return {
      ...state,
      errors: [...state.errors, { agent: 'explorer', error: err.message }],
      agentTimeline: [...state.agentTimeline, timelineEntry('failed', `Error: ${err.message}`)],
    };
  }
}

/**
 * Node 4: Risk Analyzer Agent
 * AI-powered risk analysis
 */
async function riskAnalyzerAgent(state) {
  const startMs = Date.now();
  setProgress('Analyzing release risk…');
  try {
    const riskAnalysis = await analyzeRisk(
      state.siteAnalysis,
      state.allTestResults,
      state.testSummary
    );
    const durationMs = Date.now() - startMs;
    // Insights reuses this exact analysis (same score, decision and summary)
    getSession().lastRiskAnalysis = { cachedAt: getCachedTestResults()?.cachedAt, analysis: riskAnalysis };

    return {
      ...state,
      riskAnalysis,
      agentTimeline: [...state.agentTimeline, {
        id: 'agent-risk', agent: 'Risk Analysis Agent', status: 'completed',
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date(startMs + durationMs).toISOString(),
        durationMs, duration: formatDuration(durationMs),
        summary: `Risk ${riskAnalysis.riskScore}/100 (${riskAnalysis.riskLevel?.toUpperCase()}) — ${riskAnalysis.deployment === 'blocked' ? `blocked: ${riskAnalysis.reasons[0]}` : 'no release blockers'}`,
      }],
    };
  } catch (err) {
    return {
      ...state,
      errors: [...state.errors, { agent: 'risk', error: err.message }],
      agentTimeline: [...state.agentTimeline, {
        id: 'agent-risk', agent: 'Risk Analysis Agent', status: 'failed',
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs, duration: formatDuration(Date.now() - startMs),
        summary: `Error: ${err.message}`,
      }],
    };
  }
}

/**
 * Node 5: CI/CD Gatekeeper Agent
 * Makes deployment APPROVE/BLOCK decision
 */
async function gatekeeperAgent(state) {
  const startMs = Date.now();
  const riskScore = state.riskAnalysis?.riskScore || 50;
  const riskLevel = state.riskAnalysis?.riskLevel || 'medium';
  const deployment = state.riskAnalysis?.deployment || (riskScore >= 60 ? 'blocked' : 'approved');
  const durationMs = Date.now() - startMs;

  return {
    ...state,
    gatekeeperDecision: {
      decision: deployment.toUpperCase(),
      riskScore,
      riskLevel,
    },
    agentTimeline: [...state.agentTimeline, {
      id: 'agent-gatekeeper', agent: 'CI/CD Gatekeeper Agent', status: 'completed',
      startedAt: new Date(startMs).toISOString(),
      completedAt: new Date(startMs + durationMs).toISOString(),
      durationMs, duration: formatDuration(durationMs),
      summary: `Decision: ${deployment.toUpperCase()} — ${deployment === 'approved' ? 'Release can proceed' : (state.riskAnalysis?.reasons || []).join('; ') || 'Release blocked due to risk'}`,
    }],
  };
}

/**
 * Node 6: Metrics Collector Agent
 * Calculates sprint velocity and records prediction for accuracy tracking
 */
async function metricsCollectorAgent(state) {
  const startMs = Date.now();
  const pipelineDurationMs = Date.now() - state.pipelineStartMs;

  try {
    // Build test breakdown by category
    const testBreakdown = {};
    state.allTestResults.forEach(t => {
      const cat = t.category || t.type || 'functional';
      testBreakdown[cat] = (testBreakdown[cat] || 0) + 1;
    });

    // Calculate sprint velocity
    const sprintVelocity = calculateSprintVelocity({
      totalTests: state.allTestResults.length,
      pipelineDurationMs,
      testBreakdown,
    });

    // Record prediction for accuracy tracking
    const predictionId = recordPrediction(
      state.riskAnalysis?.riskScore || 0,
      state.riskAnalysis?.riskLevel || 'unknown',
      state.gatekeeperDecision?.decision || 'UNKNOWN'
    );

    const durationMs = Date.now() - startMs;

    return {
      ...state,
      sprintVelocity,
      predictionId,
      agentTimeline: [...state.agentTimeline, {
        id: 'agent-metrics', agent: 'Metrics & Analytics Agent', status: 'completed',
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date(startMs + durationMs).toISOString(),
        durationMs, duration: formatDuration(durationMs),
        summary: `${sprintVelocity.velocityImprovement}% faster than manual testing — ${sprintVelocity.hoursSaved}h saved, ${sprintVelocity.speedMultiplier}x speed`,
      }],
    };
  } catch (err) {
    return {
      ...state,
      errors: [...state.errors, { agent: 'metrics', error: err.message }],
      agentTimeline: [...state.agentTimeline, {
        id: 'agent-metrics', agent: 'Metrics & Analytics Agent', status: 'failed',
        startedAt: new Date(startMs).toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs, duration: formatDuration(Date.now() - startMs),
        summary: `Error: ${err.message}`,
      }],
    };
  }
}


/**
 * Build and compile the LangGraph StateGraph
 */
function buildAgentGraph() {
  // Define channels — each key in state needs a reducer
  const channels = {
    url: { value: (a, b) => b ?? a, default: () => '' },
    options: { value: (a, b) => b ?? a, default: () => ({}) },
    siteAnalysis: { value: (a, b) => b ?? a, default: () => null },
    sitePurpose: { value: (a, b) => b ?? a, default: () => null },
    baseTestResults: { value: (a, b) => b ?? a, default: () => [] },
    seleniumResults: { value: (a, b) => b ?? a, default: () => [] },
    newmanResults: { value: (a, b) => b ?? a, default: () => [] },
    zapResults: { value: (a, b) => b ?? a, default: () => [] },
    siteExploration: { value: (a, b) => b ?? a, default: () => null },
    allTestResults: { value: (a, b) => b ?? a, default: () => [] },
    testSummary: { value: (a, b) => b ?? a, default: () => null },
    riskAnalysis: { value: (a, b) => b ?? a, default: () => null },
    gatekeeperDecision: { value: (a, b) => b ?? a, default: () => null },
    sprintVelocity: { value: (a, b) => b ?? a, default: () => null },
    predictionId: { value: (a, b) => b ?? a, default: () => null },
    agentTimeline: { value: (a, b) => b ?? a, default: () => [] },
    errors: { value: (a, b) => b ?? a, default: () => [] },
    pipelineStartMs: { value: (a, b) => b ?? a, default: () => Date.now() },
  };

  const graph = new StateGraph({ channels });

  // Add nodes
  graph.addNode('crawler', crawlerAgent);
  graph.addNode('testRunner', testRunnerAgent);
  graph.addNode('securityScanner', securityScannerAgent);
  graph.addNode('pageExplorer', pageExplorerAgent);
  graph.addNode('riskAnalyzer', riskAnalyzerAgent);
  graph.addNode('gatekeeper', gatekeeperAgent);
  graph.addNode('metricsCollector', metricsCollectorAgent);

  // Define edges: linear pipeline
  graph.addEdge(START, 'crawler');
  graph.addEdge('crawler', 'testRunner');
  graph.addEdge('testRunner', 'securityScanner');
  graph.addEdge('securityScanner', 'pageExplorer');
  graph.addEdge('pageExplorer', 'riskAnalyzer');
  graph.addEdge('riskAnalyzer', 'gatekeeper');
  graph.addEdge('gatekeeper', 'metricsCollector');
  graph.addEdge('metricsCollector', END);

  return graph.compile();
}

// Compile once at module load
let compiledGraph = null;

function getGraph() {
  if (!compiledGraph) {
    compiledGraph = buildAgentGraph();
    console.log('[LangGraph] Agent pipeline compiled — 7 nodes, 8 edges');
  }
  return compiledGraph;
}


/**
 * Run the full agent pipeline through LangGraph
 * @param {string} url - Target website URL
 * @param {object} options - Pipeline options
 * @returns {Promise<object>} Final state with all agent outputs
 */
async function runAgentPipeline(url, options = {}) {
  const graph = getGraph();
  const initialState = createInitialState(url, options);

  console.log(`[LangGraph] ═══ Pipeline starting for ${url} ═══`);
  const startMs = Date.now();

  let finalState;
  try {
    finalState = await graph.invoke(initialState);
  } finally {
    setProgress(null);
  }

  const totalMs = Date.now() - startMs;
  console.log(`[LangGraph] ═══ Pipeline complete in ${formatDuration(totalMs)} — ${finalState.agentTimeline.length} agents executed ═══`);

  return finalState;
}


function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  const remainMs = Math.round(ms % 1000);
  if (seconds < 60) return `${seconds}.${String(remainMs).padStart(3, '0').slice(0, 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSec = seconds % 60;
  return `${minutes}m ${remainSec}s`;
}

module.exports = { runAgentPipeline };
