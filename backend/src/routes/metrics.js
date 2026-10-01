/**
 * Metrics Routes
 * 
 * GET  /api/metrics             — Sprint velocity + risk accuracy data
 * POST /api/deployment-feedback — User reports deployment outcome
 */

const express = require('express');
const router = express.Router();
const { getMetrics, submitFeedback } = require('../services/metricsEngine');


router.get('/metrics', (req, res) => {
  try {
    const metrics = getMetrics();
    res.json({
      success: true,
      ...metrics,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Metrics] Error:', error);
    res.status(500).json({ error: 'Failed to load metrics', message: error.message });
  }
});


router.post('/deployment-feedback', (req, res) => {
  try {
    const { predictionId, outcome } = req.body;

    if (!outcome || !['smooth', 'minor', 'major'].includes(outcome)) {
      return res.status(400).json({
        error: 'Invalid outcome',
        message: 'Outcome must be one of: smooth, minor, major',
      });
    }

    const result = submitFeedback(predictionId || 'latest', outcome);

    if (!result.success) {
      return res.status(404).json(result);
    }

    res.json({
      success: true,
      ...result,
      message: `Feedback recorded: deployment was "${outcome}". ${result.correct ? 'Prediction was correct ✓' : 'Prediction was incorrect ✗'}`,
    });
  } catch (error) {
    console.error('[Metrics] Feedback error:', error);
    res.status(500).json({ error: 'Failed to record feedback', message: error.message });
  }
});

module.exports = router;
