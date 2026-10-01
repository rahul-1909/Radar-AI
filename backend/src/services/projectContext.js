/**
 * Project Context — the user's configured project (name, website, repo)
 * and cached GitHub data. Stored per user on the session.
 */

const { getSession } = require('./sessionStore');

function sessionProject() {
  const s = getSession();
  if (!s.projectContext) {
    s.projectContext = { name: '', repoUrl: '', websiteUrl: '', description: '' };
  }
  return s.projectContext;
}

function setProjectContext(ctx) {
  const projectContext = sessionProject();
  // `undefined` leaves a field unchanged; an empty string clears it
  for (const key of ['name', 'repoUrl', 'websiteUrl', 'description']) {
    if (typeof ctx[key] === 'string') projectContext[key] = ctx[key].trim();
  }
  // Clear cached GitHub data when project changes
  getSession().cachedGitHubData = null;
}

function getProjectContext() {
  return { ...sessionProject() };
}

function setCachedGitHubData(data) {
  getSession().cachedGitHubData = data;
}

function getCachedGitHubData() {
  return getSession().cachedGitHubData || null;
}

module.exports = { setProjectContext, getProjectContext, setCachedGitHubData, getCachedGitHubData };
