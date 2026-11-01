import {
  AI_VISIBILITY_TRACKER_BRIEF,
  aiVisibilityBriefPrefill,
  isEmptyAiVisibilityBrief,
  looksLikeAiVisibilityBrief,
  parseAiVisibilityBrief,
} from "./aiVisibilityTrackerClient.js";

export const BRAND_SENTIMENT_BRIEF = AI_VISIBILITY_TRACKER_BRIEF;
export const brandSentimentBriefPrefill = aiVisibilityBriefPrefill;
export const isEmptyBrandSentimentBrief = isEmptyAiVisibilityBrief;
export const looksLikeBrandSentimentBrief = looksLikeAiVisibilityBrief;
export const parseBrandSentimentBrief = parseAiVisibilityBrief;

export function shouldRunBrandSentimentAnalysis(text, { agentActive, inChat } = {}) {
  if (!agentActive) return false;
  const t = String(text || "").trim();
  if (t.length < 3) return false;
  if (isEmptyBrandSentimentBrief(t)) return false;
  if (looksLikeBrandSentimentBrief(t)) {
    return Boolean(parseBrandSentimentBrief(t));
  }
  return Boolean(inChat);
}

export async function runBrandSentimentStream({ message, website, knowledge, onProgress } = {}) {
  const response = await fetch("/api/brand-sentiment?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, website, knowledge }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Brand sentiment analysis failed.");
  }

  return consumeBrandSentimentSse(response, onProgress);
}

async function consumeBrandSentimentSse(response, onProgress) {
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
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type === "progress") onProgress?.(event);
      if (event.type === "error") throw new Error(event.error || "Brand sentiment analysis failed.");
      if (event.type === "complete") {
        const content = String(event.content || "").trim();
        if (!content) throw new Error("Brand sentiment analysis returned empty content.");
        return content;
      }
    }
  }

  throw new Error("Brand sentiment analysis ended without a result.");
}

export function parseSentimentBlock(raw) {
  try {
    const parsed = JSON.parse(String(raw || "").trim());
    if (!parsed || !Array.isArray(parsed.platforms)) return null;
    return parsed;
  } catch {
    return null;
  }
}
