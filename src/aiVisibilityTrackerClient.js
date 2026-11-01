export const AI_VISIBILITY_TRACKER_BRIEF = "Website URL:";

export function aiVisibilityBriefPrefill(website) {
  const url = String(website || "").trim();
  if (url) return `Website URL: ${url}`;
  return AI_VISIBILITY_TRACKER_BRIEF;
}

export function isEmptyAiVisibilityBrief(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .toLowerCase();
  if (normalized === AI_VISIBILITY_TRACKER_BRIEF.trim().toLowerCase()) return true;
  return /^website url:\s*$/.test(normalized);
}

export function parseAiVisibilityBrief(text) {
  const raw = String(text || "").trim();
  for (const line of raw.split("\n")) {
    const match = line.trim().match(/^website\s*url\s*:\s*(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  const urlMatch = raw.match(/https?:\/\/[^\s<>"']+/i);
  if (urlMatch) return urlMatch[0];
  if (raw && !/^website\s*url\s*:/im.test(raw)) {
    const first = raw.split("\n")[0]?.trim();
    if (first && /[a-z0-9.-]+\.[a-z]{2,}/i.test(first)) return first;
  }
  return "";
}

export function looksLikeAiVisibilityBrief(text) {
  const t = String(text || "");
  if (isEmptyAiVisibilityBrief(t)) return true;
  return /^website\s*url\s*:\s*\S+/im.test(t);
}

export function shouldRunAiVisibilityTracker(text, { agentActive, inChat } = {}) {
  if (!agentActive) return false;
  const t = String(text || "").trim();
  if (t.length < 3) return false;
  if (isEmptyAiVisibilityBrief(t)) return false;
  if (looksLikeAiVisibilityBrief(t)) {
    return Boolean(parseAiVisibilityBrief(t));
  }
  return Boolean(inChat);
}

export async function runAiVisibilityStream({ message, website, knowledge, onProgress } = {}) {
  const response = await fetch("/api/ai-visibility?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, website, knowledge }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "AI visibility scan failed.");
  }

  return consumeAiVisibilitySse(response, onProgress);
}

async function consumeAiVisibilitySse(response, onProgress) {
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
      if (event.type === "error") throw new Error(event.error || "AI visibility scan failed.");
      if (event.type === "complete") {
        const content = String(event.content || "").trim();
        if (!content) throw new Error("AI visibility scan returned empty content.");
        return content;
      }
    }
  }

  throw new Error("AI visibility scan ended without a result.");
}
