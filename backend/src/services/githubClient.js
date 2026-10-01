/**
 * GitHub Client — Token-Optional Repository Access
 *
 * Designed for hosted, multi-user deployments where the GitHub REST API's
 * unauthenticated limit (60 req/hour, shared by every visitor behind the
 * server's IP) would be exhausted almost immediately.
 *
 *  - Source code: downloaded once as a tarball from codeload.github.com.
 *    That endpoint needs no token and doesn't count against the API limit.
 *    The snapshot is cached in memory and shared across users.
 *  - Repo overview (info / commits / languages): REST API when it's available,
 *    falling back to the public commits Atom feed + languages computed from
 *    the snapshot when the API is rate-limited.
 *  - Tokens (both optional): the operator's `GITHUB_TOKEN` env var raises the
 *    API limit to 5,000/hour; a user's own token (sent per request via the
 *    `X-GitHub-Token` header) unlocks their private repos. User tokens are
 *    never stored, and cache entries fetched with one are keyed by a hash of
 *    it so private code is never served to other users.
 */

const crypto = require('crypto');
const zlib = require('zlib');
const { Readable } = require('stream');
const cheerio = require('cheerio');
const { getRequestGitHubToken } = require('./sessionStore');

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'RadarAI/2.0 (+https://github.com/rahul-1909/Radar-AI)';

const SNAPSHOT_TTL_MS = 15 * 60 * 1000;
const OVERVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_CACHED_SNAPSHOTS = parseInt(process.env.GITHUB_MAX_CACHED_REPOS || '6', 10);
const MAX_DOWNLOAD_BYTES = parseInt(process.env.GITHUB_MAX_ARCHIVE_MB || '100', 10) * 1024 * 1024;
const MAX_KEPT_BYTES = 15 * 1024 * 1024; // total source text kept in memory per repo
const MAX_KEPT_FILE_BYTES = 200 * 1024; // larger files are listed but not kept
const DOWNLOAD_TIMEOUT_MS = 60_000;

class RepoAccessError extends Error {
  constructor(message, status = 404) {
    super(message);
    this.status = status;
  }
}

// ─── Tokens & cache keys ────────────────────────────────────────────────────

let serverTokenRejected = false;

function getToken() {
  return getRequestGitHubToken() || (!serverTokenRejected && process.env.GITHUB_TOKEN) || null;
}

/**
 * Handle a 401. If the operator's GITHUB_TOKEN was rejected (expired/revoked),
 * stop using it for this process and return true so the caller retries
 * without it — a bad server token must not break GitHub for every user.
 * A user's own rejected token is reported back to that user instead.
 */
function handleUnauthorized() {
  if (!getRequestGitHubToken() && process.env.GITHUB_TOKEN && !serverTokenRejected) {
    serverTokenRejected = true;
    console.error('[GitHub] GITHUB_TOKEN was rejected (expired or revoked) — continuing without it. Update or remove it.');
    return true;
  }
  throw new RepoAccessError('Your GitHub token was rejected. Check that it is valid and not expired.', 401);
}

/**
 * Cache key for a repo. Data fetched with a user's own token is private to
 * holders of that token.
 */
function cacheKey(owner, repo) {
  const base = `${owner}/${repo}`.toLowerCase();
  const userToken = getRequestGitHubToken();
  if (!userToken) return base;
  const hash = crypto.createHash('sha256').update(userToken).digest('hex').slice(0, 16);
  return `${base}#${hash}`;
}

function apiHeaders(token = getToken()) {
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': USER_AGENT,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function isRateLimited(res) {
  return res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0');
}

// Small LRU with TTL. Stores promises so concurrent requests share one fetch.
function createCache(maxEntries, ttlMs) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return null;
      if (Date.now() - hit.at > ttlMs) {
        map.delete(key);
        return null;
      }
      map.delete(key);
      map.set(key, hit);
      return hit.value;
    },
    set(key, value) {
      map.delete(key);
      map.set(key, { value, at: Date.now() });
      while (map.size > maxEntries) map.delete(map.keys().next().value);
    },
    delete(key) {
      map.delete(key);
    },
  };
}

function cached(cache, key, loader) {
  const hit = cache.get(key);
  if (hit) return hit;
  const promise = loader().catch((err) => {
    cache.delete(key); // don't cache failures
    throw err;
  });
  cache.set(key, promise);
  return promise;
}

// ─── Streaming tar parser ───────────────────────────────────────────────────

function parsePax(buf) {
  const out = {};
  let i = 0;
  while (i < buf.length) {
    const space = buf.indexOf(0x20, i);
    if (space === -1) break;
    const len = parseInt(buf.toString('utf8', i, space), 10);
    if (!len) break;
    const record = buf.toString('utf8', space + 1, i + len - 1); // drop trailing \n
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    i += len;
  }
  return out;
}

function readString(h, start, len) {
  const end = h.indexOf(0, start);
  return h.toString('utf8', start, end === -1 || end > start + len ? start + len : end);
}

/**
 * Returns a `write(chunk)` function that parses a tar stream incrementally,
 * calling `onEntry({ path, size, type })` for every entry and
 * `shouldKeep(entry)` to decide whether to buffer its body for `onFile`.
 */
function createTarParser({ onEntry, shouldKeep, onFile }) {
  let buf = Buffer.alloc(0);
  let entry = null;
  let pax = null;
  let longName = null;

  function finish(e) {
    const body = e.chunks ? Buffer.concat(e.chunks) : null;
    if (e.type === 'x') pax = parsePax(body);
    else if (e.type === 'L') longName = body.toString('utf8').replace(/\0+$/, '');
    else if (e.type === 'g') { /* global header (commit id comment) — ignore */ }
    else if (body) onFile(e, body);
  }

  return function write(chunk) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (entry) {
        if (entry.remaining > 0) {
          if (!buf.length) return;
          const n = Math.min(entry.remaining, buf.length);
          if (entry.chunks) entry.chunks.push(buf.subarray(0, n));
          entry.remaining -= n;
          buf = buf.subarray(n);
          if (entry.remaining > 0) return;
        }
        if (buf.length < entry.pad) return;
        buf = buf.subarray(entry.pad);
        finish(entry);
        entry = null;
        continue;
      }

      if (buf.length < 512) return;
      const h = buf.subarray(0, 512);
      buf = buf.subarray(512);
      if (h[0] === 0) continue; // end-of-archive padding

      const typeChar = String.fromCharCode(h[156] || 0x30);
      let name = readString(h, 0, 100);
      if (h.toString('utf8', 257, 262) === 'ustar') {
        const prefix = readString(h, 345, 155);
        if (prefix) name = `${prefix}/${name}`;
      }
      if (pax?.path) name = pax.path;
      if (longName) name = longName;
      const size = pax?.size ? parseInt(pax.size, 10) : parseInt(readString(h, 124, 12).trim() || '0', 8);

      const isMeta = typeChar === 'x' || typeChar === 'g' || typeChar === 'L';
      if (!isMeta) {
        pax = null;
        longName = null;
      }

      // Strip the archive's top-level "<repo>-<ref>/" directory
      const path = name.replace(/^[^/]*\/?/, '');
      const type = isMeta ? typeChar : (typeChar === '0' || typeChar === '\0' ? 'blob' : typeChar === '5' ? 'tree' : 'other');
      const e = { path, size, type, remaining: size, pad: (512 - (size % 512)) % 512, chunks: null };

      if (isMeta) e.chunks = [];
      else if (path) {
        onEntry(e);
        if (type === 'blob' && shouldKeep(e)) e.chunks = [];
      }
      entry = e;
    }
  };
}

// ─── Repository snapshot (source code) ─────────────────────────────────────

const snapshotCache = createCache(MAX_CACHED_SNAPSHOTS, SNAPSHOT_TTL_MS);

async function openArchiveStream(owner, repo) {
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const headers = { 'User-Agent': USER_AGENT };

  // 1) Public repos: codeload needs no token and has no API rate limit
  const res = await fetch(`https://codeload.github.com/${owner}/${repo}/tar.gz/HEAD`, { headers, signal });
  if (res.ok) return res;

  // 2) Private repos (or codeload hiccup): authenticated API tarball endpoint
  const token = getToken();
  if (token) {
    const apiRes = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/tarball`, { headers: apiHeaders(token), signal });
    if (apiRes.ok) return apiRes;
    if (apiRes.status === 401) handleUnauthorized(); // throws for a user token; server token → fall through to 404
    if (isRateLimited(apiRes)) throw new RepoAccessError('GitHub API rate limit reached. Please try again in a few minutes.', 429);
  }

  if (res.status === 404) {
    throw new RepoAccessError(token && getRequestGitHubToken()
      ? `Repository ${owner}/${repo} was not found, or your GitHub token doesn't have access to it.`
      : `Repository ${owner}/${repo} was not found. If it's a private repository, add a GitHub access token in Project Settings.`);
  }
  throw new RepoAccessError(`GitHub returned HTTP ${res.status} while downloading ${owner}/${repo}.`, 502);
}

function looksBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

async function downloadSnapshot(owner, repo) {
  // Lazy require: codeAnalyzer depends on this module
  const { shouldIncludeFile } = require('./codeAnalyzer');
  const startedAt = Date.now();
  const res = await openArchiveStream(owner, repo);

  const tree = [];
  const files = new Map();
  let keptBytes = 0;
  let downloaded = 0;

  const write = createTarParser({
    onEntry: (e) => {
      if (e.type === 'blob' || e.type === 'tree') tree.push({ path: e.path, type: e.type, size: e.size });
    },
    shouldKeep: (e) => e.size <= MAX_KEPT_FILE_BYTES && keptBytes + e.size <= MAX_KEPT_BYTES && shouldIncludeFile(e.path),
    onFile: (e, body) => {
      if (looksBinary(body)) return;
      keptBytes += body.length;
      files.set(e.path, body.toString('utf8'));
    },
  });

  await new Promise((resolve, reject) => {
    const gunzip = zlib.createGunzip();
    const source = Readable.fromWeb(res.body);
    source.on('data', (chunk) => {
      downloaded += chunk.length;
      if (downloaded > MAX_DOWNLOAD_BYTES) {
        source.destroy(new RepoAccessError(`Repository archive is larger than ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB — too large to analyze.`, 413));
      }
    });
    source.on('error', reject);
    gunzip.on('error', reject);
    gunzip.on('data', (chunk) => {
      try { write(chunk); } catch (err) { gunzip.destroy(err); }
    });
    gunzip.on('end', resolve);
    source.pipe(gunzip);
  });

  console.log(`[GitHub] Snapshot ${owner}/${repo}: ${tree.length} entries, ${files.size} files kept (${Math.round(keptBytes / 1024)} KB) in ${Date.now() - startedAt}ms`);
  return { tree, files, fetchedAt: new Date().toISOString() };
}

/**
 * Get the (cached) source snapshot of a repo: `{ tree, files: Map<path, text> }`.
 */
function getRepoSnapshot(owner, repo) {
  return cached(snapshotCache, cacheKey(owner, repo), () => downloadSnapshot(owner, repo));
}

// ─── Repository overview (info, commits, languages) ────────────────────────

const overviewCache = createCache(200, OVERVIEW_TTL_MS);

const EXT_LANGUAGES = {
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  ts: 'TypeScript', tsx: 'TypeScript', py: 'Python', rb: 'Ruby', go: 'Go',
  java: 'Java', kt: 'Kotlin', swift: 'Swift', rs: 'Rust', php: 'PHP',
  c: 'C', h: 'C', cpp: 'C++', cc: 'C++', hpp: 'C++', cs: 'C#',
  html: 'HTML', htm: 'HTML', css: 'CSS', scss: 'SCSS', less: 'Less',
  vue: 'Vue', svelte: 'Svelte', astro: 'Astro', dart: 'Dart',
  sh: 'Shell', bash: 'Shell', sql: 'SQL', ipynb: 'Jupyter Notebook',
};

function languagesFromTree(tree) {
  const bytes = {};
  for (const item of tree) {
    if (item.type !== 'blob' || /(^|\/)(node_modules|vendor|dist|build)\//.test(item.path)) continue;
    const lang = EXT_LANGUAGES[item.path.split('.').pop().toLowerCase()];
    if (lang) bytes[lang] = (bytes[lang] || 0) + item.size;
  }
  return bytes;
}

function formatLanguages(bytesByLang) {
  const total = Object.values(bytesByLang).reduce((s, v) => s + (v || 0), 0);
  return Object.entries(bytesByLang)
    .sort((a, b) => b[1] - a[1])
    .map(([name, b]) => ({ name, percentage: total > 0 ? Math.round((b / total) * 100) : 0 }));
}

/**
 * Parse the public commits Atom feed (no API quota needed).
 */
async function fetchCommitsFeed(owner, repo) {
  const res = await fetch(`https://github.com/${owner}/${repo}/commits.atom`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return null;
  const $ = cheerio.load(await res.text(), { xmlMode: true });
  const feedId = $('feed > id').first().text();
  const branch = feedId.match(/\/commits\/(.+)$/)?.[1] || null;
  const commits = $('entry').slice(0, 10).map((_, el) => {
    const $e = $(el);
    const sha = $e.find('id').text().split('/').pop() || '';
    return {
      sha: sha.substring(0, 7),
      message: $e.find('title').text().trim().split('\n')[0],
      author: $e.find('author > name').text() || 'Unknown',
      date: $e.find('updated').text(),
      url: $e.find('link').attr('href'),
    };
  }).get();
  return { branch, commits };
}

async function fetchOverviewFromApi(owner, repo) {
  const base = `${GITHUB_API}/repos/${owner}/${repo}`;
  const headers = apiHeaders();
  const infoRes = await fetch(base, { headers, signal: AbortSignal.timeout(15_000) });

  if (infoRes.status === 404) return { notFound: true };
  if (infoRes.status === 401 && handleUnauthorized()) return fetchOverviewFromApi(owner, repo); // retry without the bad server token
  if (!infoRes.ok) return { unavailable: true, rateLimited: isRateLimited(infoRes) };

  const info = await infoRes.json();
  const [commitsData, languagesData] = await Promise.all([
    fetch(`${base}/commits?per_page=10`, { headers }).then(r => (r.ok ? r.json() : [])).catch(() => []),
    fetch(`${base}/languages`, { headers }).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
  ]);

  return {
    info,
    commits: Array.isArray(commitsData) ? commitsData.map(c => ({
      sha: c.sha?.substring(0, 7),
      message: c.commit?.message?.split('\n')[0] || '',
      author: c.commit?.author?.name || 'Unknown',
      date: c.commit?.author?.date,
      url: c.html_url,
    })) : [],
    languages: languagesData || {},
  };
}

async function loadOverview(owner, repo) {
  const api = await fetchOverviewFromApi(owner, repo);

  if (api.info) {
    const { info } = api;
    return {
      success: true,
      source: 'github-api',
      repository: {
        name: info.full_name || `${owner}/${repo}`,
        description: info.description || '',
        url: info.html_url || `https://github.com/${owner}/${repo}`,
        stars: info.stargazers_count || 0,
        forks: info.forks_count || 0,
        openIssues: info.open_issues_count || 0,
        defaultBranch: info.default_branch || 'main',
        language: info.language || 'Unknown',
        updatedAt: info.updated_at,
        visibility: info.private ? 'private' : 'public',
      },
      recentCommits: api.commits,
      languages: formatLanguages(api.languages),
    };
  }

  // API unavailable (rate-limited, or 404 because the repo is private and the
  // API had no token). Fall back to token-free public endpoints.
  let snapshot;
  try {
    snapshot = await getRepoSnapshot(owner, repo);
  } catch (err) {
    if (api.rateLimited && !(err instanceof RepoAccessError)) {
      throw new RepoAccessError('GitHub API rate limit reached. Please try again in a few minutes.', 429);
    }
    throw err;
  }
  const feed = await fetchCommitsFeed(owner, repo).catch(() => null);
  const languages = formatLanguages(languagesFromTree(snapshot.tree));

  return {
    success: true,
    source: 'public-archive',
    repository: {
      name: `${owner}/${repo}`,
      description: '',
      url: `https://github.com/${owner}/${repo}`,
      stars: null,
      forks: null,
      openIssues: null,
      defaultBranch: feed?.branch || 'main',
      language: languages[0]?.name || 'Unknown',
      updatedAt: feed?.commits?.[0]?.date || null,
      visibility: 'public',
    },
    recentCommits: feed?.commits || [],
    languages,
  };
}

/**
 * Repo metadata for the dashboard. Cached and shared between users.
 */
function getRepoOverview(owner, repo) {
  return cached(overviewCache, cacheKey(owner, repo), () => loadOverview(owner, repo));
}

module.exports = {
  RepoAccessError,
  getRepoSnapshot,
  getRepoOverview,
};
