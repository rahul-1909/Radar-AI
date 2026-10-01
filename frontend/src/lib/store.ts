/**
 * Zustand Store
 * 
 * Global state management for the RadarAI Release Intelligence platform.
 */

import { create } from 'zustand';
import {
  fetchDashboardData,
  generateTests,
  predictRisk,
  configureProject,
  fetchProjectInfo,
  fetchGitHubRepo,
  fetchCodeFixes,
  askCodeQuestion,
  fetchMetrics,
  submitDeploymentFeedback,
  fetchHealth,
  getSavedProject,
  fetchProgress,
} from './api';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyData = any;

interface AppState {
  // Server status (free hosting may sleep when idle)
  serverStatus: 'checking' | 'waking' | 'online' | 'offline';
  aiInfo: { mode: string; label: string; provider: string | null; fallbacks?: string[]; models?: string[] } | null;
  checkServer: () => Promise<void>;

  // Project config
  projectConfig: AnyData | null;
  projectError: string | null;
  configureProject: (data: { name?: string; websiteUrl?: string; repoUrl?: string }) => Promise<boolean>;
  loadProjectInfo: () => Promise<void>;

  // GitHub repo
  githubRepo: AnyData | null;
  githubLoading: boolean;
  githubError: string | null;
  fetchGitHubRepo: (url?: string) => Promise<void>;

  // Login detection flow: while held, nothing starts the test pipeline
  holdPipeline: boolean;
  setHoldPipeline: (hold: boolean) => void;
  loginPrompt: { loginUrl: string; how?: string } | null;
  setLoginPrompt: (prompt: { loginUrl: string; how?: string } | null) => void;
  // What the running pipeline is doing ("Crawling public pages (7/20)…")
  progress: string | null;

  // Dashboard data
  dashboard: AnyData | null;
  dashboardLoading: boolean;
  dashboardError: string | null;
  loadDashboard: () => Promise<void>;
  refreshDashboard: () => Promise<void>;

  // Code Fixes
  codeFixes: AnyData | null;
  codeFixesLoading: boolean;
  runCodeAnalysis: (repoUrl?: string, refresh?: boolean) => Promise<void>;

  // Ask AI
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string; references?: AnyData[]; confidence?: number }>;
  chatLoading: boolean;
  askQuestion: (question: string, repoUrl?: string) => Promise<void>;

  // Test generation
  generatedTests: AnyData | null;
  testsLoading: boolean;
  testsError: string | null;
  runTestGeneration: (refresh?: boolean) => Promise<void>;

  // Risk prediction
  riskReport: AnyData | null;
  riskLoading: boolean;
  riskError: string | null;
  runRiskPrediction: () => Promise<void>;

  // Metrics
  metrics: AnyData | null;
  loadMetrics: () => Promise<void>;
  submitFeedback: (predictionId: string, outcome: 'smooth' | 'minor' | 'major') => Promise<AnyData | null>;
}

let serverCheck: Promise<void> | null = null;

type SetState = (partial: Partial<AppState>) => void;

/** Polls the backend for pipeline progress until the returned stop() is called. */
function pollProgress(set: SetState) {
  const id = setInterval(async () => {
    try {
      const { progress } = await fetchProgress();
      set({ progress: progress?.message || null });
    } catch {
      // ignore — progress is best-effort
    }
  }, 2000);
  return () => {
    clearInterval(id);
    set({ progress: null });
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  serverStatus: 'checking',
  aiInfo: null,
  checkServer: () => {
    // Share one check across all components that call this on mount
    if (serverCheck) return serverCheck;
    serverCheck = (async () => {
      const started = Date.now();
      // Free instances can take ~30-60s to wake; retry for up to 90s
      while (Date.now() - started < 90_000) {
        try {
          const health: AnyData = await fetchHealth();
          set({ serverStatus: 'online', aiInfo: health.ai || null });
          return;
        } catch {
          set({ serverStatus: 'waking' });
          await new Promise((r) => setTimeout(r, 4000));
        }
      }
      set({ serverStatus: 'offline' });
      serverCheck = null; // allow a manual retry
    })();
    return serverCheck;
  },

  projectConfig: null,
  projectError: null,
  configureProject: async (data) => {
    set({ projectError: null });
    try {
      const result: AnyData = await configureProject(data);
      // Clear ALL cached page data so pages re-fetch with new project context
      set({
        projectConfig: result.project,
        generatedTests: null,
        riskReport: null,
        testsError: null,
        riskError: null,
        dashboardError: null,
        dashboard: null,
        codeFixes: null,
        chatHistory: [],
        githubRepo: null,
        githubError: null,
      });
      return true;
    } catch (error) {
      set({ projectError: error instanceof Error ? error.message : 'Failed to save project settings' });
      return false;
    }
  },
  loadProjectInfo: async () => {
    try {
      // (api.ts restores the browser-saved project first if the server lost it)
      const result: AnyData = await fetchProjectInfo();
      set({ projectConfig: result.project });
      if (result.project?.repoUrl && !get().githubRepo && !get().githubLoading && !get().githubError) {
        get().fetchGitHubRepo(result.project.repoUrl);
      }
    } catch {
      // Server unreachable — show saved settings so the form isn't empty
      const saved = getSavedProject();
      if (saved) set({ projectConfig: saved });
    }
  },

  githubRepo: null,
  githubLoading: false,
  githubError: null,
  fetchGitHubRepo: async (url) => {
    set({ githubLoading: true, githubError: null });
    try {
      const data = await fetchGitHubRepo(url);
      set({ githubRepo: data, githubLoading: false });
    } catch (error) {
      set({
        githubRepo: null,
        githubLoading: false,
        githubError: error instanceof Error ? error.message : 'Failed to load repository',
      });
    }
  },

  holdPipeline: false,
  setHoldPipeline: (hold) => set({ holdPipeline: hold }),
  loginPrompt: null,
  setLoginPrompt: (prompt) => set({ loginPrompt: prompt }),
  progress: null,

  dashboard: null,
  dashboardLoading: false,
  dashboardError: null,
  loadDashboard: async () => {
    if (get().holdPipeline || get().loginPrompt) return; // waiting on the login question
    set({ dashboardLoading: true, dashboardError: null });
    const stop = pollProgress(set);
    try {
      const data = await fetchDashboardData();
      set({ dashboard: data, dashboardLoading: false });
    } catch (error) {
      set({
        dashboardError: error instanceof Error ? error.message : 'Failed to load dashboard',
        dashboardLoading: false,
      });
    } finally {
      stop();
    }
  },
  refreshDashboard: async () => {
    set({ dashboardLoading: true, dashboardError: null });
    const stop = pollProgress(set);
    try {
      const data = await fetchDashboardData(true); // pass refresh=true
      set({ dashboard: data, dashboardLoading: false });
    } catch (error) {
      set({
        dashboardError: error instanceof Error ? error.message : 'Failed to refresh dashboard',
        dashboardLoading: false,
      });
    } finally {
      stop();
    }
  },

  generatedTests: null,
  testsLoading: false,
  testsError: null,
  runTestGeneration: async (refresh = false) => {
    if (get().holdPipeline || get().loginPrompt) return;
    set({ testsLoading: true, testsError: null });
    const stop = pollProgress(set);
    try {
      const data = await generateTests(refresh);
      set({ generatedTests: data, testsLoading: false });
    } catch (error) {
      set({ testsLoading: false, testsError: error instanceof Error ? error.message : 'Failed to run tests' });
    } finally {
      stop();
    }
  },

  riskReport: null,
  riskLoading: false,
  riskError: null,
  runRiskPrediction: async () => {
    set({ riskLoading: true, riskError: null });
    try {
      const data = await predictRisk();
      set({ riskReport: data, riskLoading: false });
    } catch (error) {
      set({ riskLoading: false, riskError: error instanceof Error ? error.message : 'Risk analysis failed' });
    }
  },

  codeFixes: null,
  codeFixesLoading: false,
  runCodeAnalysis: async (repoUrl, refresh = false) => {
    set({ codeFixesLoading: true });
    try {
      const data = await fetchCodeFixes(repoUrl, refresh);
      set({ codeFixes: data, codeFixesLoading: false });
    } catch (error) {
      // Set error sentinel so the page doesn't re-trigger in a loop
      set({
        codeFixes: { error: true, message: error instanceof Error ? error.message : 'Code analysis failed', fixes: [] },
        codeFixesLoading: false,
      });
    }
  },

  chatHistory: [],
  chatLoading: false,
  askQuestion: async (question, repoUrl) => {
    // Add user message immediately
    set((state) => ({
      chatHistory: [...state.chatHistory, { role: 'user', content: question }],
      chatLoading: true,
    }));
    try {
      const data: AnyData = await askCodeQuestion(question, repoUrl);
      set((state) => ({
        chatHistory: [
          ...state.chatHistory,
          { role: 'assistant', content: data.answer, references: data.references, confidence: data.confidence },
        ],
        chatLoading: false,
      }));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An error occurred while communicating with the AI. Please try again.';
      set((state) => ({
        chatHistory: [
          ...state.chatHistory,
          { role: 'assistant', content: errorMessage },
        ],
        chatLoading: false,
      }));
    }
  },

  metrics: null,
  loadMetrics: async () => {
    try {
      const data = await fetchMetrics();
      set({ metrics: data });
    } catch {
      // metrics panel simply stays hidden
    }
  },
  submitFeedback: async (predictionId: string, outcome: 'smooth' | 'minor' | 'major') => {
    try {
      const data: AnyData = await submitDeploymentFeedback(predictionId, outcome);
      const metrics = await fetchMetrics();
      set({ metrics });
      return data;
    } catch {
      return null;
    }
  },
}));
