/** Primary blog illustration model (Gemini native image generation). */
export const BLOG_IMAGE_MODEL = 'googleai/gemini-2.5-flash-image';

/** Fallback if the primary image model is unavailable for this API key. */
export const BLOG_IMAGE_MODEL_FALLBACK = 'googleai/imagen-4.0-fast-generate-001';

export const BLOG_IMAGE_PROMPT_PREFIX =
  'Always create modern, stunning excellent images that relate well with the blog title';
