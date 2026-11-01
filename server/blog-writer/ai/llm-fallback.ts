import { getBlogLlmChainOverride } from '../../blogLlmChain.js';
import { LLM_MODEL_FALLBACK_CHAIN, type LlmModelId } from './llm-models';

export type LlmModelChain = readonly LlmModelId[] | readonly string[];

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Do not retry other models when the API key or auth is wrong. */
export function isNonRetriableLlmError(error: unknown): boolean {
  const msg = errorMessage(error);
  return /API_KEY_INVALID|API key not valid|Please pass a valid API key|401|403|PERMISSION_DENIED|API keys are not supported/i.test(
    msg,
  );
}

export function isRetriableLlmError(error: unknown): boolean {
  if (isNonRetriableLlmError(error)) return false;
  const msg = errorMessage(error);
  return (
    /404|not found|model.*(not|un)available|unsupported|does not exist|not available for this api key/i.test(msg) ||
    /429|rate limit|quota|resource exhausted/i.test(msg) ||
    /500|502|503|504|unavailable|timeout|deadline|ECONNRESET|ETIMEDOUT/i.test(msg) ||
    /FAILED_PRECONDITION|INVALID_ARGUMENT.*model/i.test(msg)
  );
}

export type LlmFallbackResult<T> = {
  result: T;
  modelUsed: string;
};

/** A fallback model needs at least this long to produce a full article. */
const MIN_FALLBACK_BUDGET_MS = 100_000;

/**
 * Runs `fn` with each model in the fallback chain until one succeeds.
 * With `deadlineAt` (epoch ms), a fallback is skipped when too little time is left, so the caller
 * can retry in a fresh invocation instead of being killed by the platform time limit mid-call.
 */
export async function withLlmModelFallback<T>(
  fn: (model: string) => Promise<T>,
  options?: { label?: string; models?: LlmModelChain; deadlineAt?: number },
): Promise<LlmFallbackResult<T>> {
  const label = options?.label ?? 'LLM';
  const chain = options?.models ?? getBlogLlmChainOverride() ?? LLM_MODEL_FALLBACK_CHAIN;
  let lastError: unknown;

  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    try {
      const result = await fn(model);
      if (i > 0) {
        console.info(`[${label}] succeeded with fallback model ${model}`);
      }
      return { result, modelUsed: model };
    } catch (error) {
      lastError = error;
      const hasMore = i < chain.length - 1;
      // Claude uses a separate provider and key, so even its auth errors must fall back to Gemini.
      const isOtherProvider = model.startsWith('anthropic/');
      if (!hasMore || (!isOtherProvider && !isRetriableLlmError(error))) {
        console.error(`[${label}] ${model} failed (non-retriable or last model):`, errorMessage(error));
        throw error;
      }
      if (options?.deadlineAt && options.deadlineAt - Date.now() < MIN_FALLBACK_BUDGET_MS) {
        console.warn(`[${label}] ${model} failed with too little time left for a fallback; retrying later.`);
        throw error;
      }
      console.warn(
        `[${label}] ${model} failed (${errorMessage(error).slice(0, 120)}), trying next model…`,
      );
    }
  }

  throw lastError ?? new Error(`${label}: all models failed (${chain.join(' → ')})`);
}
