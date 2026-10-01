/**
 * Codebase Q&A Route
 * 
 * POST /api/ask
 * Natural language questions about the codebase.
 * Fetches relevant source files and sends them to the AI model for analysis.
 */

const express = require('express');
const router = express.Router();
const { parseGitHubUrl, fetchRepoTree, selectFilesForQuestion, fetchFileContents } = require('../services/codeAnalyzer');
const { askAboutCode } = require('../services/aiAgent');
const { getProjectContext } = require('../services/projectContext');

router.post('/ask', async (req, res) => {
  try {
    const { question } = req.body;

    if (!question || question.trim().length === 0) {
      return res.status(400).json({ error: 'Please provide a question.' });
    }

    const ctx = getProjectContext();
    const repoUrl = req.body.repoUrl || ctx.repoUrl;

    if (!repoUrl) {
      return res.status(400).json({
        error: 'No repository URL configured. Set it in the project settings.',
        answer: 'I need a GitHub repository URL to analyze the codebase. Please configure one in the project settings.',
        references: [],
        confidence: 0,
      });
    }

    const parsed = parseGitHubUrl(repoUrl);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid GitHub URL format.' });
    }

    const startTime = Date.now();
    const { owner, repo } = parsed;

    // Step 1: Get repo tree (cached)
    console.log(`[Ask] Question: "${question.substring(0, 60)}..."`);
    let tree, branch;
    try {
      const result = await fetchRepoTree(owner, repo); // cached snapshot
      tree = result.tree;
      branch = result.branch;
    } catch (err) {
      console.error('[Ask] Failed to fetch repo tree:', err.message);
      return res.json({
        success: true,
        answer: `I couldn't fetch the repository at **${owner}/${repo}**.\n\n${err.message}`,
        references: [],
        confidence: 0.1,
        source: 'system',
        filesAnalyzed: 0,
        durationMs: Date.now() - startTime,
      });
    }

    // Step 2: Select files relevant to the question
    const relevantFiles = selectFilesForQuestion(tree, question);

    if (relevantFiles.length === 0) {
      return res.json({
        success: true,
        answer: `I couldn't find files in the repository that seem directly related to your question. Try rephrasing or asking about specific components, files, or features.`,
        references: [],
        confidence: 0.2,
        source: 'system',
        filesAnalyzed: 0,
        durationMs: Date.now() - startTime,
      });
    }

    // Step 3: Fetch file contents
    const filePaths = relevantFiles.map(f => f.path);
    const fileContents = await fetchFileContents(owner, repo, filePaths);

    // Step 4: Ask the AI model
    const result = await askAboutCode(question, fileContents, ctx);
    const durationMs = Date.now() - startTime;

    console.log(`[Ask] Answered in ${durationMs}ms (${result.source}, ${fileContents.length} files)`);

    res.json({
      success: true,
      answer: result.answer,
      references: result.references || [],
      confidence: result.confidence || 0.7,
      followUpQuestions: result.followUpQuestions || [],
      source: result.source,
      filesAnalyzed: fileContents.length,
      repo: `${owner}/${repo}`,
      branch,
      durationMs,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Ask] Error:', error);
    res.status(500).json({
      error: 'Failed to analyze codebase',
      message: error.message,
      answer: `An error occurred while analyzing the codebase: ${error.message}`,
      references: [],
      confidence: 0,
    });
  }
});

module.exports = router;
