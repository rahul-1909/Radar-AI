/**
 * Project Configuration + GitHub Integration Routes
 * 
 * POST /api/configure-project — Set website URL and GitHub repo
 * GET  /api/project-info — Get current project configuration
 * GET  /api/github-repo — Fetch real data from a GitHub repo
 */

const express = require('express');
const router = express.Router();
const { setProjectContext, getProjectContext, setCachedGitHubData } = require('../services/projectContext');
const { invalidateDashboardCache } = require('./dashboard');
const { invalidateTestCache } = require('../services/testRunner');
const { getSession } = require('../services/sessionStore');
const { assertPublicUrl } = require('../services/urlGuard');
const { parseGitHubUrl } = require('../services/codeAnalyzer');
const { getRepoOverview, RepoAccessError } = require('../services/githubClient');
const { detectLogin } = require('../services/siteExplorer');


router.post('/configure-project', async (req, res) => {
  try {
    const { name, websiteUrl, repoUrl, description } = req.body;

    if (!name && !websiteUrl && !repoUrl) {
      return res.status(400).json({
        error: 'Please provide at least one field: name, websiteUrl, or repoUrl',
      });
    }

    const update = { name, description };
    if (typeof websiteUrl === 'string') {
      update.websiteUrl = websiteUrl.trim() ? await assertPublicUrl(websiteUrl) : '';
    }
    if (typeof repoUrl === 'string') {
      if (repoUrl.trim()) {
        const parsed = parseGitHubUrl(repoUrl);
        if (!parsed) {
          return res.status(400).json({ error: 'Invalid GitHub URL', message: 'Expected a URL like https://github.com/owner/repo' });
        }
        update.repoUrl = `https://github.com/${parsed.owner}/${parsed.repo}`;
      } else {
        update.repoUrl = '';
      }
    }

    setProjectContext(update);
    invalidateDashboardCache(); // Clear cached dashboard so next load re-runs pipeline
    invalidateTestCache(); // Clear cached test results so Test Studio re-runs with new project
    const S = getSession();
    S.testStudioCache = null;
    S.fixesCache = null;

    res.json({
      success: true,
      message: 'Project configured successfully',
      project: getProjectContext(),
    });
  } catch (error) {
    const status = error.status || 500;
    res.status(status).json({ error: status === 400 ? 'Invalid project settings' : 'Configuration failed', message: error.message });
  }
});


router.get('/project-info', (req, res) => {
  res.json({
    success: true,
    project: getProjectContext(),
  });
});

// Checks whether the configured website has a login page, so the UI can ask
// for a test account before running the pipeline.
router.post('/detect-login', async (req, res) => {
  try {
    const { websiteUrl } = getProjectContext();
    if (!websiteUrl) return res.status(400).json({ error: 'No website URL configured.' });
    const detection = await detectLogin(websiteUrl);
    res.json({ success: true, ...detection });
  } catch (error) {
    res.status(error.status || 500).json({ error: 'Login detection failed', message: error.message });
  }
});

// Fetches repo info, recent commits, and languages. Works without any token
// for public repos (see services/githubClient.js).

router.get('/github-repo', async (req, res) => {
  try {
    const { url } = req.query;
    const context = getProjectContext();
    const repoUrl = url || context.repoUrl;

    if (!repoUrl) {
      return res.status(400).json({
        error: 'No repository URL configured. Set it via POST /api/configure-project',
      });
    }

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid GitHub URL format. Expected: https://github.com/owner/repo' });
    }

    const responseData = await getRepoOverview(parsed.owner, parsed.repo);

    // Cache GitHub data so all agents use it for dynamic analysis
    setCachedGitHubData(responseData);

    res.json(responseData);
  } catch (error) {
    if (error instanceof RepoAccessError) {
      return res.status(error.status).json({ error: error.message, message: error.message });
    }
    console.error('GitHub fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch repository data', message: error.message });
  }
});

module.exports = router;
