/**
 * API Client
 * 
 * Centralized fetch wrappers for all backend API endpoints.
 */

const rawBaseUrl = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api').trim().replace(/\/+$/, '');
const API_BASE = rawBaseUrl.endsWith('/api') ? rawBaseUrl : `${rawBaseUrl}/api`;

// ─── Browser-local storage ─────────────────────────────────────────────────
// Each browser gets its own session so users of a shared deployment never see
// each other's projects. The optional GitHub token (for private repos) lives
// only here and is sent per request — the server never stores it.

const SESSION_KEY = 'radar.sessionId';
const GITHUB_TOKEN_KEY = 'radar.githubToken';
const PROJECT_KEY = 'radar.project';
const SITE_LOGIN_KEY = 'radar.siteLogin';
const LOGIN_SKIPPED_KEY = 'radar.loginSkipped';

function storageGet(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null) {
  try {
    if (typeof window === 'undefined') return;
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // storage unavailable (private mode, blocked) — fall back to in-memory only
  }
}

let memorySessionId: string | null = null;

function getSessionId(): string {
  let id = storageGet(SESSION_KEY) || memorySessionId;
  if (!id) {
    id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    storageSet(SESSION_KEY, id);
    memorySessionId = id;
  }
  return id;
}

export function getGitHubToken(): string {
  return storageGet(GITHUB_TOKEN_KEY) || '';
}

export function setGitHubToken(token: string) {
  storageSet(GITHUB_TOKEN_KEY, token.trim() || null);
}

type SavedProject = { name?: string; websiteUrl?: string; repoUrl?: string };

export function getSavedProject(): SavedProject | null {
  const raw = storageGet(PROJECT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveProjectLocally(project: SavedProject) {
  storageSet(PROJECT_KEY, JSON.stringify(project));
}

// ─── Test-account login for the user's site ────────────────────────────────
// Remembered in this browser (per site) so customers enter it once. Sent only
// with requests that run the test pipeline; the server never stores it.

export type SiteLogin = { loginUrl?: string; username: string; password: string };

function originOf(url?: string): string {
  try {
    return url ? new URL(url).origin : '';
  } catch {
    return '';
  }
}

export function getSiteLogin(websiteUrl?: string): SiteLogin | null {
  const raw = storageGet(SITE_LOGIN_KEY);
  if (!raw) return null;
  try {
    const { origin, ...login } = JSON.parse(raw);
    return origin && origin === originOf(websiteUrl) ? login : null;
  } catch {
    return null;
  }
}

export function setSiteLogin(websiteUrl: string, login: SiteLogin | null) {
  storageSet(SITE_LOGIN_KEY, login ? JSON.stringify({ origin: originOf(websiteUrl), ...login }) : null);
}

/** The user chose "test public pages only" for this site — don't ask again. */
export function isLoginSkipped(websiteUrl?: string): boolean {
  return !!websiteUrl && storageGet(LOGIN_SKIPPED_KEY) === originOf(websiteUrl);
}

export function setLoginSkipped(websiteUrl: string, skipped: boolean) {
  storageSet(LOGIN_SKIPPED_KEY, skipped ? originOf(websiteUrl) : null);
}

function encodeSiteLogin(login: SiteLogin): string {
  const bytes = new TextEncoder().encode(JSON.stringify(login));
  return btoa(String.fromCharCode(...bytes));
}

// Only these requests run the pipeline and need the login
const LOGIN_PATHS = ['/dashboard-data', '/generate-tests'];

const SERVER_UNREACHABLE =
  'Cannot reach the server. If it was idle it may be waking up (this can take up to a minute on free hosting) — please try again shortly.';

// The server keeps sessions in memory, so after a restart/redeploy it forgets
// this user's project. Before the first data request of a page load, re-send
// the project saved in this browser if the server no longer has it.
let restorePromise: Promise<void> | null = null;

function ensureProjectRestored(): Promise<void> {
  if (!restorePromise) {
    restorePromise = (async () => {
      const saved = getSavedProject();
      if (!saved || (!saved.websiteUrl && !saved.repoUrl)) return;
      const info = await rawFetch<{ project?: SavedProject }>('/project-info');
      if (info.project?.websiteUrl || info.project?.repoUrl) return;
      await rawFetch('/configure-project', { method: 'POST', body: JSON.stringify(saved) });
    })().catch(() => {
      restorePromise = null; // server unreachable — retry on the next request
    });
  }
  return restorePromise;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  if (path !== '/health' && path !== '/configure-project') await ensureProjectRestored();
  return rawFetch<T>(path, options);
}

async function rawFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Session-Id': getSessionId(),
  };
  const token = getGitHubToken();
  if (token) headers['X-GitHub-Token'] = token;
  if (LOGIN_PATHS.some(p => path.startsWith(p))) {
    const login = getSiteLogin(getSavedProject()?.websiteUrl);
    if (login) headers['X-Site-Auth'] = encodeSiteLogin(login);
  }

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new Error(SERVER_UNREACHABLE);
  }
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.message || error.error || `API error: ${res.status}`);
  }
  return res.json();
}


export async function fetchHealth() {
  return apiFetch('/health');
}


export async function configureProject(data: { name?: string; websiteUrl?: string; repoUrl?: string }) {
  const result = await apiFetch<{ project: SavedProject }>('/configure-project', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  const { name, websiteUrl, repoUrl } = result.project || {};
  saveProjectLocally({ name, websiteUrl, repoUrl });
  return result;
}

export async function fetchProjectInfo() {
  return apiFetch('/project-info');
}

export async function fetchGitHubRepo(url?: string) {
  const query = url ? `?url=${encodeURIComponent(url)}` : '';
  return apiFetch(`/github-repo${query}`);
}


export async function fetchDashboardData(refresh = false) {
  return apiFetch(`/dashboard-data${refresh ? '?refresh=true' : ''}`);
}


export async function generateTests(refresh = false) {
  return apiFetch('/generate-tests', {
    method: 'POST',
    body: JSON.stringify({ refresh }),
  });
}


export async function predictRisk() {
  return apiFetch('/predict-risk', { method: 'POST', body: '{}' });
}


export async function fetchCodeFixes(repoUrl?: string, refresh = false) {
  return apiFetch('/code-fixes', {
    method: 'POST',
    body: JSON.stringify({ repoUrl, refresh }),
  });
}

export async function askCodeQuestion(question: string, repoUrl?: string) {
  return apiFetch('/ask', {
    method: 'POST',
    body: JSON.stringify({ question, repoUrl }),
  });
}


export async function fetchMetrics() {
  return apiFetch('/metrics');
}

export async function submitDeploymentFeedback(predictionId: string, outcome: 'smooth' | 'minor' | 'major') {
  return apiFetch('/deployment-feedback', {
    method: 'POST',
    body: JSON.stringify({ predictionId, outcome }),
  });
}


export async function detectLogin() {
  return apiFetch<{ detected: boolean; loginUrl?: string; how?: string }>('/detect-login', { method: 'POST', body: '{}' });
}

export async function fetchProgress() {
  return apiFetch<{ progress: { message: string } | null }>('/progress');
}
