import { genkit, type Genkit } from 'genkit';
import { googleAI } from '@genkit-ai/googleai';
import { APP_LLM_MODEL_CHAIN, PRIMARY_LLM_MODEL } from './llm-models';
import { CLAUDE_OPUS_GENKIT_MODEL, isClaudeConfigured, registerClaudeModel } from './anthropic-model';

export {
  LLM_MODEL_FALLBACK_CHAIN,
  PRIMARY_LLM_MODEL,
  APP_LLM_MODEL_CHAIN,
  STRATEGY_DEPLOY_LLM_CHAIN,
  GEMINI_36_FLASH_MODEL,
  GEMINI_35_FLASH_MODEL,
  GEMINI_PRIMARY_MODEL,
} from './llm-models';
export { withLlmModelFallback, isNonRetriableLlmError, isRetriableLlmError } from './llm-fallback';

/** Models not bundled in @genkit-ai/googleai yet. Built-in 2.5* models are registered by the plugin. */
const BUILTIN_GEMINI_IDS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
]);

const EXTRA_GOOGLE_AI_MODELS = [
  ...new Set(
    APP_LLM_MODEL_CHAIN.map((m) => m.replace(/^googleai\//, '')).filter((id) => !BUILTIN_GEMINI_IDS.has(id)),
  ),
];

const geminiApiKey =
  process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY;

function createGenkitInstance(): Genkit {
  return genkit({
    plugins: [
      googleAI({
        // v1beta: required for Gemini 3.x; use ONE version only (never ['v1','v1beta'] together).
        apiVersion: 'v1beta',
        models: EXTRA_GOOGLE_AI_MODELS,
        ...(geminiApiKey ? { apiKey: geminiApiKey } : {}),
      }),
    ],
    model: PRIMARY_LLM_MODEL,
  });
}

/** Reuse one Genkit instance across hot reloads in dev (avoids duplicate model registration). */
const globalForGenkit = globalThis as typeof globalThis & {
  __blazlyGenkitAi?: Genkit;
  __blazlyClaudeModel?: string;
};

export const ai = globalForGenkit.__blazlyGenkitAi ?? createGenkitInstance();

if (process.env.NODE_ENV !== 'production') {
  globalForGenkit.__blazlyGenkitAi = ai;
}

if (isClaudeConfigured() && globalForGenkit.__blazlyClaudeModel !== CLAUDE_OPUS_GENKIT_MODEL) {
  registerClaudeModel(ai);
  globalForGenkit.__blazlyClaudeModel = CLAUDE_OPUS_GENKIT_MODEL;
}
