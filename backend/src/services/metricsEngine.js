/**
 * Metrics Engine — Sprint Velocity & Risk Score Accuracy
 * 
 * Calculates and tracks:
 * 1. Sprint Velocity Improvement — time saved vs manual testing
 * 2. Risk Score Accuracy — prediction correctness over time
 * 
 * Data is kept per user session (in memory), so each user of a hosted
 * instance sees only their own runs and predictions.
 */

const { getSession } = require('./sessionStore');


// Realistic manual QA estimates (minutes per test to manually execute + verify).
// These reflect the time a QA engineer spends *running* each check, not writing the test.
// Ref: industry benchmarks for manual exploratory / checklist testing.
const MANUAL_MINUTES = {
  functional: 5,   // Open page, verify element, check behavior
  security:   8,   // Inspect headers, check SSL, review cookies manually
  api:        3,   // Craft request in Postman, verify response
  ui:         6,   // Visually inspect layout, responsiveness, interactions
  other:      4,   // General checks (SEO meta, alt tags, etc.)
};


function loadSprintMetrics() {
  const S = getSession();
  if (!S.sprintMetrics) S.sprintMetrics = { runs: [] };
  return S.sprintMetrics;
}

function saveSprintMetrics(data) {
  getSession().sprintMetrics = data;
}/**
 * Calculate sprint velocity improvement for a pipeline run
 * @param {object} params
 * @param {number} params.totalTests - Total tests executed
 * @param {number} params.pipelineDurationMs - Actual AI pipeline time in ms
 * @param {object} params.testBreakdown - { functional, security, api, ui, selenium, newman, zap }
 * @returns {object} Sprint velocity metrics
 */
function calculateSprintVelocity({ totalTests, pipelineDurationMs, testBreakdown = {} }) {
  // Calculate estimated manual time based on test type breakdown
  const functional = testBreakdown.functional || 0;
  const security = (testBreakdown.security || 0) + (testBreakdown.zap || 0);
  const api = (testBreakdown.api || 0) + (testBreakdown.newman || 0);
  const ui = (testBreakdown.ui || 0) + (testBreakdown.selenium || 0);
  const other = totalTests - functional - security - api - ui;

  const manualMinutes =
    (functional * MANUAL_MINUTES.functional) +
    (security * MANUAL_MINUTES.security) +
    (api * MANUAL_MINUTES.api) +
    (ui * MANUAL_MINUTES.ui) +
    (Math.max(0, other) * MANUAL_MINUTES.other);

  const manualMs = manualMinutes * 60 * 1000;
  const aiMs = pipelineDurationMs || 1;

  const velocityImprovement = Math.round(((manualMs - aiMs) / manualMs) * 100 * 10) / 10;
  const hoursSaved = Math.round((manualMs - aiMs) / 3600000 * 10) / 10;
  const speedMultiplier = Math.round(manualMs / aiMs);

  const result = {
    totalTests,
    pipelineDurationMs: aiMs,
    pipelineDurationFormatted: formatDuration(aiMs),
    manualEstimateMs: manualMs,
    manualEstimateFormatted: formatDuration(manualMs),
    velocityImprovement: Math.min(99.9, Math.max(0, velocityImprovement)),
    hoursSaved,
    speedMultiplier,
    testBreakdown: {
      functional, security, api, ui, other: Math.max(0, other),
    },
    timestamp: new Date().toISOString(),
  };

  // Persist to history
  const metrics = loadSprintMetrics();
  metrics.runs.push(result);
  if (metrics.runs.length > 50) metrics.runs = metrics.runs.slice(-50);
  saveSprintMetrics(metrics);

  return result;
}

/**
 * Get sprint velocity history and averages
 */
function getSprintVelocityHistory() {
  const metrics = loadSprintMetrics();
  const runs = metrics.runs || [];

  if (runs.length === 0) {
    return {
      runs: [],
      averageImprovement: 0,
      averageHoursSaved: 0,
      totalTestsRun: 0,
      totalHoursSaved: 0,
    };
  }

  const avgImprovement = Math.round(runs.reduce((s, r) => s + r.velocityImprovement, 0) / runs.length * 10) / 10;
  const avgHoursSaved = Math.round(runs.reduce((s, r) => s + r.hoursSaved, 0) / runs.length * 10) / 10;
  const totalTests = runs.reduce((s, r) => s + r.totalTests, 0);
  const totalHours = Math.round(runs.reduce((s, r) => s + r.hoursSaved, 0) * 10) / 10;

  return {
    runs: runs.slice(-10), // Last 10 runs
    averageImprovement: avgImprovement,
    averageHoursSaved: avgHoursSaved,
    totalTestsRun: totalTests,
    totalHoursSaved: totalHours,
    totalRuns: runs.length,
  };
}


function loadPredictionHistory() {
  const S = getSession();
  // Seed with demo data so the accuracy panel isn't empty on first visit
  if (!S.predictionHistory) return seedPredictionHistory();
  return S.predictionHistory;
}

function savePredictionHistory(data) {
  getSession().predictionHistory = data;
}

/**
 * Seed initial prediction history for demo purposes
 */
function seedPredictionHistory() {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;

  const seeded = {
    predictions: [
      {
        id: 'pred-001',
        timestamp: new Date(now - 7 * day).toISOString(),
        riskScore: 72, riskLevel: 'high', decision: 'BLOCKED',
        outcome: 'major', // Correct — blocked and had issues
        correct: true,
      },
      {
        id: 'pred-002',
        timestamp: new Date(now - 5 * day).toISOString(),
        riskScore: 35, riskLevel: 'low', decision: 'APPROVED',
        outcome: 'smooth', // Correct — approved and was fine
        correct: true,
      },
      {
        id: 'pred-003',
        timestamp: new Date(now - 3 * day).toISOString(),
        riskScore: 58, riskLevel: 'medium', decision: 'APPROVED',
        outcome: 'minor', // Partially correct — had minor issues
        correct: true,
      },
      {
        id: 'pred-004',
        timestamp: new Date(now - 2 * day).toISOString(),
        riskScore: 45, riskLevel: 'medium', decision: 'APPROVED',
        outcome: 'smooth', // Correct
        correct: true,
      },
      {
        id: 'pred-005',
        timestamp: new Date(now - 1 * day).toISOString(),
        riskScore: 28, riskLevel: 'low', decision: 'APPROVED',
        outcome: 'minor', // Slightly off — minor issues on low risk
        correct: false,
      },
    ],
  };

  savePredictionHistory(seeded);
  return seeded;
}

/**
 * Record a new prediction (called after each risk analysis)
 */
function recordPrediction(riskScore, riskLevel, decision) {
  const history = loadPredictionHistory();
  const prediction = {
    id: `pred-${String(history.predictions.length + 1).padStart(3, '0')}`,
    timestamp: new Date().toISOString(),
    riskScore,
    riskLevel,
    decision: decision.toUpperCase(),
    outcome: null, // Awaiting feedback
    correct: null,
  };

  history.predictions.push(prediction);
  if (history.predictions.length > 100) history.predictions = history.predictions.slice(-100);
  savePredictionHistory(history);

  return prediction.id;
}

/**
 * Submit deployment feedback for a prediction
 * @param {string} predictionId - ID of the prediction (or 'latest')
 * @param {string} outcome - 'smooth' | 'minor' | 'major'
 */
function submitFeedback(predictionId, outcome) {
  const history = loadPredictionHistory();
  let prediction;

  if (predictionId === 'latest') {
    // Find the latest prediction without feedback
    prediction = [...history.predictions].reverse().find(p => p.outcome === null);
  } else {
    prediction = history.predictions.find(p => p.id === predictionId);
  }

  if (!prediction) {
    return { success: false, error: 'Prediction not found' };
  }

  prediction.outcome = outcome;

  // Determine correctness
  const wasBlocked = prediction.decision === 'BLOCKED';
  const hadIssues = outcome === 'major' || outcome === 'minor';
  const hadMajorIssues = outcome === 'major';

  if (wasBlocked) {
    // Blocked + had issues = correct. Blocked + smooth = overly cautious (still "correct" for safety)
    prediction.correct = hadIssues;
  } else {
    // Approved + smooth = correct. Approved + major issues = incorrect
    prediction.correct = !hadMajorIssues;
  }

  savePredictionHistory(history);

  return {
    success: true,
    predictionId: prediction.id,
    riskScore: prediction.riskScore,
    decision: prediction.decision,
    outcome,
    correct: prediction.correct,
    accuracy: calculateAccuracy(),
  };
}

/**
 * Calculate overall prediction accuracy
 */
function calculateAccuracy() {
  const history = loadPredictionHistory();
  const withFeedback = history.predictions.filter(p => p.outcome !== null);

  if (withFeedback.length === 0) {
    return { accuracy: 0, total: 0, correct: 0, pending: history.predictions.filter(p => p.outcome === null).length };
  }

  const correct = withFeedback.filter(p => p.correct).length;
  const accuracy = Math.round((correct / withFeedback.length) * 100);

  // Calibration data: group by risk level and check accuracy per bucket
  const calibration = {};
  withFeedback.forEach(p => {
    const bucket = p.riskLevel || 'unknown';
    if (!calibration[bucket]) calibration[bucket] = { total: 0, correct: 0, incidents: 0 };
    calibration[bucket].total++;
    if (p.correct) calibration[bucket].correct++;
    if (p.outcome === 'major' || p.outcome === 'minor') calibration[bucket].incidents++;
  });

  Object.keys(calibration).forEach(key => {
    calibration[key].accuracy = Math.round((calibration[key].correct / calibration[key].total) * 100);
    calibration[key].incidentRate = Math.round((calibration[key].incidents / calibration[key].total) * 100);
  });

  return {
    accuracy,
    total: withFeedback.length,
    correct,
    pending: history.predictions.filter(p => p.outcome === null).length,
    calibration,
    recentPredictions: history.predictions.slice(-10).reverse(),
  };
}

/**
 * Get combined metrics
 */
function getMetrics() {
  return {
    sprintVelocity: getSprintVelocityHistory(),
    riskAccuracy: calculateAccuracy(),
  };
}


function formatDuration(ms) {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remSec = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remSec}s`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return `${hours}h ${remMin}m`;
}

module.exports = {
  calculateSprintVelocity,
  recordPrediction,
  submitFeedback,
  getMetrics,
};
