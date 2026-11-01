import { getBlogWriterModelChain as getActiveBlogChain } from '../../blogLlmChain.js';

export { CLAUDE_OPUS_GENKIT_MODEL } from './anthropic-model';
export { GEMINI_PRIMARY_MODEL } from './llm-models';

/** Single-model chain for the current blog pipeline (Gemini 3.6 Flash or Claude Opus). */
export async function getBlogWriterModelChain(_userId?: string | null): Promise<readonly string[]> {
  return getActiveBlogChain();
}
