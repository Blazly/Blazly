export const SEO_BLOG_WRITER_BRIEF = "Keyword:\nWord Count:\nIntent:\nTarget URL:";
export const GEO_BLOG_WRITER_BRIEF = "Target Prompt:\nWord Count:\nIntent:\nTarget URL:";

export function isEmptyGeoBlogBrief(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .toLowerCase();
  const emptyTemplate = GEO_BLOG_WRITER_BRIEF.trim().toLowerCase();
  if (normalized === emptyTemplate) return true;
  return /^target prompt:\s*\nword count:\s*\nintent:\s*\ntarget url:\s*$/.test(normalized);
}

export function isEmptySeoBlogBrief(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .toLowerCase();
  const emptyTemplate = SEO_BLOG_WRITER_BRIEF.trim().toLowerCase();
  if (normalized === emptyTemplate) return true;
  return /^keyword:\s*\nword count:\s*\nintent:\s*\ntarget url:\s*$/.test(normalized);
}

/** User is submitting a structured new-article brief (not a free-form follow-up). */
export function looksLikeSeoBlogBrief(text) {
  const t = String(text || "");
  if (isEmptySeoBlogBrief(t)) return true;
  if (/^keyword\s*:\s*\S+/im.test(t)) return true;
  if (/^target prompt\s*:\s*\S+/im.test(t)) return true;
  if (/^word count\s*:\s*\d+/im.test(t)) return true;
  if (/^target url\s*:\s*\S+/im.test(t)) return true;
  if (/^intent\s*:\s*\S+/im.test(t)) return true;
  return false;
}

export function shouldRunBlogWriterPipeline(text, { hasPriorArticle } = {}) {
  const t = String(text || "").trim();
  if (t.length < 3) return false;
  if (hasPriorArticle && !looksLikeSeoBlogBrief(t)) return false;
  return true;
}

export function shouldRunBlogWriterRewrite(text, priorArticle) {
  const t = String(text || "").trim();
  if (t.length < 3) return false;
  if (!priorArticle?.html) return false;
  if (looksLikeSeoBlogBrief(t)) return false;
  return true;
}

/** @deprecated use shouldRunBlogWriterPipeline */
export function messageLooksLikeBlogWriterRequest(text, agentActive) {
  return agentActive && shouldRunBlogWriterPipeline(text, { hasPriorArticle: false });
}

export async function runBlogWriterStream(
  message,
  { knowledge, website, brandName, effortAuto, effortTier, writerMode, onProgress } = {},
) {
  const response = await fetch("/api/blog-writer?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      knowledge,
      website,
      brandName,
      effortAuto,
      effortTier,
      writerMode,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Blog generation failed.");
  }

  return consumeBlogWriterSse(response, onProgress);
}

export async function runBlogWriterRewriteStream(
  {
    rewritePrompt,
    previousArticle,
    knowledge,
    website,
    brandName,
    effortAuto,
    effortTier,
    writerMode,
    onProgress,
  } = {},
) {
  const response = await fetch("/api/blog-writer?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      rewritePrompt,
      previousArticle,
      knowledge,
      website,
      brandName,
      effortAuto,
      effortTier,
      writerMode,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Blog rewrite failed.");
  }

  return consumeBlogWriterSse(response, onProgress);
}

async function consumeBlogWriterSse(response, onProgress) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const payload = line.slice(6).trim();
      if (payload === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type === "progress") onProgress?.(event);
      if (event.type === "error") throw new Error(event.error || "Blog generation failed.");
      if (event.type === "complete") return event.content;
    }
  }
  throw new Error("Blog generation ended without a result.");
}
