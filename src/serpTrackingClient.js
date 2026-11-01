export const SERP_TRACKING_BRIEF = "Website URL:";

export function serpTrackingBriefPrefill(website) {
  const url = String(website || "").trim();
  return url ? `Website URL: ${url}` : SERP_TRACKING_BRIEF;
}

export function isEmptySerpTrackingBrief(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .toLowerCase();
  if (normalized === SERP_TRACKING_BRIEF.trim().toLowerCase()) return true;
  return /^website url:\s*$/.test(normalized);
}

export function parseSerpTrackingBrief(text) {
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

export function looksLikeSerpTrackingBrief(text) {
  const t = String(text || "");
  if (isEmptySerpTrackingBrief(t)) return true;
  return /^website\s*url\s*:\s*\S+/im.test(t);
}

export function shouldRunSerpTracking(text, { agentActive, inChat } = {}) {
  if (!agentActive) return false;
  const t = String(text || "").trim();
  if (t.length < 3) return false;
  if (isEmptySerpTrackingBrief(t)) return false;
  if (looksLikeSerpTrackingBrief(t)) {
    return Boolean(parseSerpTrackingBrief(t));
  }
  return Boolean(inChat);
}

export async function runSerpTrackingStream({ message, website, onProgress } = {}) {
  const response = await fetch("/api/serp-tracking?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, website }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "SERP tracking failed.");
  }

  return consumeSerpTrackingSse(response, onProgress);
}

async function consumeSerpTrackingSse(response, onProgress) {
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
      if (event.type === "error") throw new Error(event.error || "SERP tracking failed.");
      if (event.type === "complete") {
        const content = String(event.content || "").trim();
        if (!content) throw new Error("SERP tracking returned empty content.");
        return content;
      }
    }
  }

  throw new Error("SERP tracking ended without a result.");
}
