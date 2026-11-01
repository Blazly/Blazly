/**
 * Text models tried in order when the primary model fails (404, quota, timeout, etc.).
 * Auth/key errors do not trigger fallback — all models would fail the same way.
 *
 * Primary: Gemini 3.6 Flash — override with GEMINI_MODEL (no `googleai/` prefix).
 */
export const GEMINI_36_FLASH_MODEL = 'googleai/gemini-3.6-flash' as const;
export const GEMINI_35_FLASH_MODEL = 'googleai/gemini-3.5-flash' as const;

function geminiModelRef(id: string): string {
  const trimmed = id.trim();
  if (!trimmed) return GEMINI_36_FLASH_MODEL;
  return trimmed.startsWith('googleai/') ? trimmed : `googleai/${trimmed}`;
}

const envPrimary = process.env.GEMINI_MODEL?.trim();
export const GEMINI_PRIMARY_MODEL = geminiModelRef(envPrimary || 'gemini-3.6-flash');

/** Blog + strategy default: Gemini 3.6 Flash only (no deprecated 2.5 models). */
export const APP_LLM_MODEL_CHAIN = [GEMINI_PRIMARY_MODEL] as const;

/** @deprecated Use {@link APP_LLM_MODEL_CHAIN} */
export const STRATEGY_DEPLOY_LLM_CHAIN = APP_LLM_MODEL_CHAIN;

export const LLM_MODEL_FALLBACK_CHAIN = APP_LLM_MODEL_CHAIN;

export type LlmModelId = (typeof LLM_MODEL_FALLBACK_CHAIN)[number] | string;

export const PRIMARY_LLM_MODEL: LlmModelId = LLM_MODEL_FALLBACK_CHAIN[0];
