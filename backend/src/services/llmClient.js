/**
 * LLM Client — Provider-Agnostic AI Access with Fallback Chain
 *
 * Talks to any OpenAI-compatible Chat Completions API. Configure with
 * environment variables alone:
 *
 *   GROQ_API_KEY, OPENROUTER_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY
 *       Every provider with a key joins a fallback chain, in that order.
 *       If Groq is rate-limited or down, OpenRouter answers, then Gemini, …
 *
 *   AI_PROVIDER   (optional) use ONLY this provider:
 *                 groq | openrouter | gemini | openai | ollama | custom | none
 *   AI_API_KEY    key for AI_PROVIDER (defaults to its provider-specific key)
 *   AI_MODELS     comma-separated models for AI_PROVIDER (optional)
 *   AI_BASE_URL   API base URL (required for `custom`)
 *
 * With no provider configured, `askAI` returns the caller's rule-based
 * fallback, so the app still works fully without any AI key.
 */

const PROVIDERS = {
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: 'GROQ_API_KEY',
    models: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'],
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: 'OPENROUTER_API_KEY',
    // `openrouter/free` routes to whichever free model is currently available
    models: ['openrouter/free', 'google/gemma-4-31b-it:free', 'qwen/qwen3.8-27b:free'],
    headers: { 'HTTP-Referer': process.env.FRONTEND_URL?.split(',')[0] || 'https://github.com/rahul-1909/Radar-AI', 'X-Title': 'RadarAI Release Intelligence' },
  },
  gemini: {
    label: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: 'GEMINI_API_KEY',
    models: ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'],
  },
  openai: {
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: 'OPENAI_API_KEY',
    models: ['gpt-4o-mini'],
  },
  ollama: {
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    keyEnv: null,
    models: ['llama3.1'],
  },
  custom: {
    label: 'Custom',
    baseUrl: null,
    keyEnv: null,
    models: [],
  },
};

// Order of the automatic fallback chain
const CHAIN_ORDER = ['groq', 'openrouter', 'gemini', 'openai'];

const RATE_LIMIT_COOLDOWN_MS = 60_000; // model rate-limited → retry after 1 min
const ERROR_COOLDOWN_MS = 5 * 60_000; // model erroring/timing out → retry after 5 min
const UNAVAILABLE_COOLDOWN_MS = 60 * 60_000; // key rejected / model not on this account → 1 h
// Kept short so a hanging provider doesn't stall the whole fallback chain
const REQUEST_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || '30000', 10);

/**
 * Build one provider config, or null (with a warning) if it's incomplete.
 */
function buildProvider(name, { apiKey, baseUrl, models } = {}) {
  const preset = PROVIDERS[name];
  const key = apiKey || (preset.keyEnv && process.env[preset.keyEnv]) || '';
  const url = (baseUrl || preset.baseUrl || '').replace(/\/+$/, '');
  const modelList = models?.length ? models : preset.models;

  if (!url) {
    console.warn(`[AI] Provider "${name}" needs AI_BASE_URL — skipping`);
    return null;
  }
  if (!key && name !== 'ollama' && name !== 'custom') {
    console.warn(`[AI] Provider "${name}" needs an API key (${preset.keyEnv} or AI_API_KEY) — skipping`);
    return null;
  }
  if (!modelList.length) {
    console.warn(`[AI] Provider "${name}" needs AI_MODELS — skipping`);
    return null;
  }
  return { name, label: preset.label, apiKey: key, baseUrl: url, headers: preset.headers || {}, models: modelList };
}

function initProviders() {
  const explicit = (process.env.AI_PROVIDER || '').toLowerCase().trim();

  if (explicit === 'none' || explicit === 'off') return [];

  if (explicit) {
    if (!PROVIDERS[explicit]) {
      console.warn(`[AI] Unknown AI_PROVIDER "${explicit}" — using automatic provider chain`);
    } else {
      const provider = buildProvider(explicit, {
        apiKey: process.env.AI_API_KEY,
        baseUrl: process.env.AI_BASE_URL,
        models: (process.env.AI_MODELS || '').split(',').map(m => m.trim()).filter(Boolean),
      });
      return provider ? [provider] : [];
    }
  }

  return CHAIN_ORDER
    .filter(name => process.env[PROVIDERS[name].keyEnv])
    .map(name => buildProvider(name))
    .filter(Boolean);
}

const providers = initProviders();

// Flat, ordered list of (provider, model) pairs to try
const pool = providers.flatMap(provider =>
  provider.models.map(model => ({ provider, model, cooldownUntil: 0 })),
);

if (pool.length) {
  console.log(`[AI] Provider chain: ${providers.map(p => `${p.label} (${p.models.join(', ')})`).join(' → ')}`);
} else {
  console.log('[AI] No AI provider configured — using rule-based analysis');
}

const aiAvailable = pool.length > 0;

class AIRequestError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function callModel({ provider, model }, prompt) {
  const headers = { 'Content-Type': 'application/json', ...provider.headers };
  if (provider.apiKey) headers['Authorization'] = `Bearer ${provider.apiKey}`;

  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new AIRequestError(`HTTP ${res.status}: ${body.slice(0, 200)}`, res.status);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new AIRequestError('Empty response', 502);
  return text;
}

/**
 * Ask the AI. Tries models in chain order (primary provider first), skipping
 * any on cooldown, then falls back to `fallbackFn()` if none can answer.
 */
async function askAI(prompt, fallbackFn) {
  for (const entry of pool) {
    if (entry.cooldownUntil > Date.now()) continue;

    try {
      const text = await callModel(entry, prompt);
      console.log(`[AI] ✓ ${entry.provider.label} response from ${entry.model}`);
      return text;
    } catch (err) {
      const status = err.status || 0;
      const name = `${entry.provider.label}/${entry.model}`;
      if (status === 401 || status === 403) {
        // Bad key — sideline every model of this provider
        console.error(`[AI] ✗ ${entry.provider.label} rejected the API key — skipping it for 1 hour`);
        for (const e of pool) {
          if (e.provider === entry.provider) e.cooldownUntil = Date.now() + UNAVAILABLE_COOLDOWN_MS;
        }
      } else if (status === 404) {
        entry.cooldownUntil = Date.now() + UNAVAILABLE_COOLDOWN_MS;
        console.warn(`[AI] ⚠ ${name} — model not available on this account (set AI_MODELS to change), trying next...`);
      } else if (status === 413) {
        // This prompt exceeds the model's per-request/free-tier token limit —
        // not the model's fault, so no cooldown; later, smaller prompts may fit
        console.warn(`[AI] ⚠ ${name} — prompt too large for this model's limit, trying next...`);
      } else if (status === 429) {
        entry.cooldownUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
        console.warn(`[AI] ⚠ ${name} — rate limited, trying next...`);
      } else {
        entry.cooldownUntil = Date.now() + ERROR_COOLDOWN_MS;
        console.warn(`[AI] ⚠ ${name} — ${err.name === 'TimeoutError' ? 'timed out' : err.message}, trying next...`);
      }
    }
  }

  if (pool.length) console.warn('[AI] All models unavailable — falling back to rule-based');
  return fallbackFn();
}

/**
 * Public description of the AI mode, for /api/health and the UI.
 */
function getAIInfo() {
  if (!pool.length) return { mode: 'rule-based', provider: null, label: 'Rule-based' };
  return {
    mode: 'live',
    provider: providers[0].name,
    label: providers[0].label,
    fallbacks: providers.slice(1).map(p => p.label),
    models: pool.map(e => `${e.provider.label}: ${e.model}`),
  };
}

module.exports = { askAI, aiAvailable, getAIInfo };
