/**
 * RadarAI - Autonomous Quality & Release Intelligence Platform
 *
 * High-performance backend API powering deep multi-agent quality inspection,
 * real browser simulation, API probing, and deterministic risk gating.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { sessionMiddleware, getSessionCount } = require('./services/sessionStore');
const { getAIInfo } = require('./services/llmClient');

// Import route modules
const testsRoutes = require('./routes/tests');
const riskRoutes = require('./routes/risk');
const dashboardRoutes = require('./routes/dashboard');
const projectRoutes = require('./routes/project');
const codeFixesRoutes = require('./routes/code-fixes');
const askRoutes = require('./routes/ask');
const metricsRoutes = require('./routes/metrics');

const app = express();
const PORT = process.env.PORT || 5000;

// Behind a hosting proxy (Render, Railway, Fly…) — needed for correct client
// IPs in rate limiting
app.set('trust proxy', parseInt(process.env.TRUST_PROXY || '1', 10));

app.use(helmet());

// FRONTEND_URL may be a comma-separated list, e.g.
// "https://my-app.vercel.app,http://localhost:3000"
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map(o => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);

// In development, any localhost port is allowed (Next.js moves to 3001, 3002…
// when 3000 is busy). Production only allows FRONTEND_URL.
const isDev = process.env.NODE_ENV !== 'production';
const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

app.use(cors({
  origin(origin, callback) {
    // Allow non-browser clients (curl, CI) which send no Origin header
    if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)
      || (isDev && LOCALHOST_ORIGIN.test(origin))) {
      return callback(null, true);
    }
    console.warn(`[CORS] Blocked request from ${origin} — add it to FRONTEND_URL`);
    callback(null, false);
  },
  allowedHeaders: ['Content-Type', 'X-Session-Id', 'X-GitHub-Token', 'X-Site-Auth'],
}));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path}`);
  next();
});

// Per-user state isolation (see services/sessionStore.js)
app.use('/api', sessionMiddleware);

// ─── Rate limiting ───────────────────────────────────────────────────────────
// General limit for all API calls, plus a stricter one for endpoints that
// crawl sites, launch browsers, or call the AI model.
const rateLimitMessage = (what) => ({ error: 'Too many requests', message: `Too many ${what}. Please wait a few minutes and try again.` });

app.use('/api', rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: parseInt(process.env.RATE_LIMIT_GENERAL || '600', 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitMessage('requests'),
}));

const heavyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: parseInt(process.env.RATE_LIMIT_HEAVY || '40', 10),
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: rateLimitMessage('analysis runs'),
});
app.use(['/api/dashboard-data', '/api/generate-tests', '/api/code-fixes', '/api/ask', '/api/predict-risk', '/api/github-repo', '/api/detect-login'], heavyLimiter);


app.use('/api', testsRoutes);
app.use('/api', riskRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', projectRoutes);
app.use('/api', codeFixesRoutes);
app.use('/api', askRoutes);
app.use('/api', metricsRoutes);


app.get('/api/health', (req, res) => {
  const ai = getAIInfo();
  res.json({
    status: 'healthy',
    service: 'RadarAI Platform API',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    mode: ai.mode === 'live' ? 'live' : 'simulation',
    ai,
    githubToken: !!process.env.GITHUB_TOKEN,
    activeSessions: getSessionCount(),
  });
});

app.get('/', (req, res) => {
  res.json({ service: 'RadarAI Platform API', health: '/api/health' });
});


app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found', path: req.path });
});


app.use((err, req, res, next) => {
  console.error('Server Error:', err.message);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : err.message,
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});


app.listen(PORT, () => {
  const ai = getAIInfo();
  console.log(`\n📡 RadarAI Platform API running on port ${PORT}`);
  console.log(`📊 Health check: /api/health`);
  console.log(`🌐 Allowed origins: ${allowedOrigins.join(', ')}${isDev ? ' + any localhost port (development)' : ''}`);
  console.log(`🤖 AI: ${ai.mode === 'live' ? [ai.label, ...ai.fallbacks].join(' → ') : 'Rule-based (no AI provider configured)'}\n`);
});

module.exports = app;
