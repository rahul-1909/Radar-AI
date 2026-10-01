/**
 * Session Store — Per-User State Isolation
 *
 * Each browser sends an `X-Session-Id` header. All per-user state (project
 * config, pipeline caches, metrics, risk history) lives in that session's
 * object, so concurrent users never see or overwrite each other's data.
 *
 * Services call `getSession()` anywhere in the request's async call chain —
 * AsyncLocalStorage carries the active session through awaits, LangGraph
 * nodes, and parallel promises without threading it through every function.
 */

const { AsyncLocalStorage } = require('async_hooks');

const SESSION_TTL_MS = parseInt(process.env.SESSION_TTL_HOURS || '24', 10) * 60 * 60 * 1000;
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '500', 10);
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

const sessions = new Map();
const als = new AsyncLocalStorage();

// Used for requests without a session header (CLI, CI risk gate, curl)
const DEFAULT_SESSION_ID = 'default';

function createSession() {
  return { data: {}, lastSeen: Date.now() };
}

function evictStaleSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.lastSeen > SESSION_TTL_MS) sessions.delete(id);
  }
  // Still over the cap → drop least recently used (Map keeps insertion order)
  while (sessions.size > MAX_SESSIONS) {
    sessions.delete(sessions.keys().next().value);
  }
}

setInterval(evictStaleSessions, 10 * 60 * 1000).unref();

function getOrCreate(id) {
  let s = sessions.get(id);
  if (!s) {
    s = createSession();
  } else {
    sessions.delete(id); // re-insert to mark as most recently used
  }
  s.lastSeen = Date.now();
  sessions.set(id, s);
  if (sessions.size > MAX_SESSIONS) evictStaleSessions();
  return s;
}

/**
 * Express middleware: binds the request to its session for its whole lifetime.
 */
function sessionMiddleware(req, res, next) {
  const header = req.get('X-Session-Id');
  const id = header && SESSION_ID_PATTERN.test(header) ? header : DEFAULT_SESSION_ID;
  const session = getOrCreate(id);
  req.sessionId = id;
  // A user-supplied GitHub token (for private repos) is request-scoped only:
  // it is never stored in the session, on disk, or in logs.
  const token = req.get('X-GitHub-Token');
  const githubToken = token && /^[A-Za-z0-9_]{20,255}$/.test(token) ? token : null;
  // Test-account login for the user's site: same rules — request-scoped only
  const siteAuth = parseSiteAuth(req.get('X-Site-Auth'));
  als.run({ session, githubToken, siteAuth }, () => next());
}

/**
 * Decode the `X-Site-Auth` header: base64 of JSON { loginUrl?, username, password }.
 */
function parseSiteAuth(header) {
  if (!header || header.length > 4096) return null;
  try {
    const data = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    if (typeof data.username !== 'string' || typeof data.password !== 'string') return null;
    if (!data.username || !data.password) return null;
    return {
      loginUrl: typeof data.loginUrl === 'string' ? data.loginUrl.trim() : '',
      username: data.username,
      password: data.password,
    };
  } catch {
    return null;
  }
}

/**
 * Returns the current request's session data object (mutable).
 * Falls back to the default session outside a request (e.g. startup code).
 */
function getSession() {
  const store = als.getStore();
  return (store ? store.session : getOrCreate(DEFAULT_SESSION_ID)).data;
}

/**
 * The GitHub token the user supplied with this request, if any.
 */
function getRequestGitHubToken() {
  return als.getStore()?.githubToken || null;
}

/**
 * The site login (test account) the user supplied with this request, if any.
 */
function getRequestSiteAuth() {
  return als.getStore()?.siteAuth || null;
}

/**
 * Record what the current pipeline run is doing, for the progress endpoint.
 */
function setProgress(message) {
  getSession().progress = message ? { message, at: Date.now() } : null;
}

function getSessionCount() {
  return sessions.size;
}

module.exports = { sessionMiddleware, getSession, getRequestGitHubToken, getRequestSiteAuth, setProgress, getSessionCount };
