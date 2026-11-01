/** Shared model-chain state for SEO blog writer (plain JS — safe from blogWriterPipeline + jiti). */

function defaultGeminiModel() {
  const id = process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
  return id.startsWith("googleai/") ? id : `googleai/${id}`;
}

const DEFAULT_CHAIN = [defaultGeminiModel()];

/** Used by flows that call getBlogWriterModelChain(). */
let blogWriterChain = [...DEFAULT_CHAIN];

/** Used by withLlmModelFallback when models option is omitted. */
let blogPipelineModelChain = null;

export function setBlogLlmChainOverride(chain) {
  blogPipelineModelChain = chain && chain.length ? [...chain] : null;
}

export function getBlogLlmChainOverride() {
  return blogPipelineModelChain;
}

export function setBlogWriterModelChain(chain) {
  blogWriterChain = chain?.length ? [...chain] : [...DEFAULT_CHAIN];
  setBlogLlmChainOverride(blogWriterChain);
}

export function resetBlogWriterModelChain() {
  blogWriterChain = [...DEFAULT_CHAIN];
  setBlogLlmChainOverride(null);
}

export function getBlogWriterModelChain() {
  return blogWriterChain;
}
