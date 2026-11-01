export const KEYWORD_FINDER_BRIEF = "Keyword:";

export function keywordFinderPrefill() {
  return KEYWORD_FINDER_BRIEF;
}

export function isEmptyKeywordFinderBrief(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .toLowerCase();
  if (normalized === KEYWORD_FINDER_BRIEF.trim().toLowerCase()) return true;
  return /^keyword:\s*$/.test(normalized);
}

export function parseKeywordFinderBrief(text) {
  const raw = String(text || "").trim();
  for (const line of raw.split("\n")) {
    const match = line.trim().match(/^keyword\s*:\s*(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim().slice(0, 120);
  }
  if (raw && !/^keyword\s*:/im.test(raw)) {
    const first = raw.split("\n")[0]?.trim();
    if (first && first.length >= 2) return first.slice(0, 120);
  }
  return "";
}

export function looksLikeKeywordFinderBrief(text) {
  const t = String(text || "");
  if (isEmptyKeywordFinderBrief(t)) return true;
  return /^keyword\s*:\s*\S+/im.test(t);
}

export function shouldRunKeywordFinder(text, { agentActive, inChat } = {}) {
  if (!agentActive) return false;
  const t = String(text || "").trim();
  if (t.length < 2) return false;
  if (isEmptyKeywordFinderBrief(t)) return false;
  if (looksLikeKeywordFinderBrief(t)) {
    return Boolean(parseKeywordFinderBrief(t));
  }
  return Boolean(inChat);
}

export async function runKeywordFinderStream({ message, keyword, onProgress } = {}) {
  const response = await fetch("/api/keyword-finder?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, keyword }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Keyword analysis failed.");
  }

  return consumeKeywordFinderSse(response, onProgress);
}

async function consumeKeywordFinderSse(response, onProgress) {
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
      if (event.type === "error") throw new Error(event.error || "Keyword analysis failed.");
      if (event.type === "complete") {
        const content = String(event.content || "").trim();
        if (!content) throw new Error("Keyword analysis returned empty content.");
        return content;
      }
    }
  }

  throw new Error("Keyword analysis ended without a result.");
}
