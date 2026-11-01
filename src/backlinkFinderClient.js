export const BACKLINK_FINDER_BRIEF = "Target keyword:";

export function backlinkFinderBriefPrefill() {
  return BACKLINK_FINDER_BRIEF;
}

export function isEmptyBacklinkFinderBrief(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .toLowerCase();
  if (normalized === BACKLINK_FINDER_BRIEF.trim().toLowerCase()) return true;
  return /^target\s*keyword:\s*$/.test(normalized) || /^keyword:\s*$/.test(normalized);
}

export function parseBacklinkFinderBrief(text) {
  const raw = String(text || "").trim();
  let targetKeyword = "";
  let website = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const siteMatch = trimmed.match(/^website\s*url\s*:\s*(.*)$/i);
    if (siteMatch) {
      website = siteMatch[1].trim();
      continue;
    }
    const kwMatch =
      trimmed.match(/^target\s*keyword\s*:\s*(.+)$/i) || trimmed.match(/^keyword\s*:\s*(.+)$/i);
    if (kwMatch) targetKeyword = kwMatch[1].trim();
  }

  if (!targetKeyword && raw && !/^target\s*keyword\s*:/im.test(raw) && !/^keyword\s*:/im.test(raw)) {
    const first = raw.split("\n")[0]?.trim();
    if (first && first.length >= 3) targetKeyword = first;
  }

  return { targetKeyword: targetKeyword.slice(0, 120), website };
}

export function looksLikeBacklinkFinderBrief(text) {
  const t = String(text || "");
  if (isEmptyBacklinkFinderBrief(t)) return true;
  return /^target\s*keyword\s*:\s*\S+/im.test(t) || /^keyword\s*:\s*\S+/im.test(t);
}

export function shouldRunBacklinkFinder(text, { agentActive, inChat } = {}) {
  if (!agentActive) return false;
  const t = String(text || "").trim();
  if (t.length < 3) return false;
  if (isEmptyBacklinkFinderBrief(t)) return false;
  if (looksLikeBacklinkFinderBrief(t)) {
    return Boolean(parseBacklinkFinderBrief(t).targetKeyword);
  }
  return Boolean(inChat);
}

export async function runBacklinkFinderStream({ message, website, knowledge, onProgress } = {}) {
  const response = await fetch("/api/backlink-finder?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, website, knowledge }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Backlink finder failed.");
  }

  return consumeBacklinkFinderSse(response, onProgress);
}

async function consumeBacklinkFinderSse(response, onProgress) {
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
      if (event.type === "error") throw new Error(event.error || "Backlink finder failed.");
      if (event.type === "complete") {
        const content = String(event.content || "").trim();
        if (!content) throw new Error("Backlink finder returned empty content.");
        return content;
      }
    }
  }

  throw new Error("Backlink finder ended without a result.");
}
