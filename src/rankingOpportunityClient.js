export const RANKING_OPPORTUNITY_BRIEF = "Website URL:\nTarget keyword:";

export function rankingBriefPrefill(website) {
  const url = String(website || "").trim();
  if (url) return `Website URL: ${url}\nTarget keyword:`;
  return RANKING_OPPORTUNITY_BRIEF;
}

export function isEmptyRankingBrief(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .toLowerCase();
  const emptyTemplate = RANKING_OPPORTUNITY_BRIEF.trim().toLowerCase();
  if (normalized === emptyTemplate) return true;
  return /^website url:\s*\ntarget keyword:\s*$/.test(normalized);
}

/** Parsed fields from the ranking finder composer template. */
export function parseRankingOpportunityBrief(text) {
  const raw = String(text || "").trim();
  let website = "";
  let targetKeyword = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const urlMatch = trimmed.match(/^website\s*url\s*:\s*(.*)$/i);
    if (urlMatch) {
      website = urlMatch[1].trim();
      continue;
    }
    const kwMatch =
      trimmed.match(/^target\s*keyword\s*:\s*(.+)$/i) ||
      trimmed.match(/^keyword\s*:\s*(.+)$/i);
    if (kwMatch) targetKeyword = kwMatch[1].trim();
  }

  if (!website) {
    const urlInText = raw.match(/https?:\/\/[^\s<>"']+/i);
    if (urlInText) website = urlInText[0];
  }

  return { website, targetKeyword };
}

export function looksLikeRankingBrief(text) {
  const t = String(text || "");
  if (isEmptyRankingBrief(t)) return true;
  if (/^website\s*url\s*:\s*\S+/im.test(t)) return true;
  if (/^target\s*keyword\s*:\s*\S+/im.test(t)) return true;
  return false;
}

export function shouldRunRankingOpportunityFinder(text, { agentActive, inChat } = {}) {
  if (!agentActive) return false;
  const t = String(text || "").trim();
  if (t.length < 3) return false;
  if (isEmptyRankingBrief(t)) return false;

  if (looksLikeRankingBrief(t)) {
    const { website, targetKeyword } = parseRankingOpportunityBrief(t);
    return Boolean(website && targetKeyword);
  }

  return Boolean(inChat);
}

export async function runRankingOpportunityStream(
  { message, website, targetKeyword, knowledge, brandName, onProgress } = {},
) {
  const response = await fetch("/api/ranking-opportunities?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, website, targetKeyword, knowledge, brandName }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Ranking opportunity analysis failed.");
  }

  return consumeRankingSse(response, onProgress);
}

async function consumeRankingSse(response, onProgress) {
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
      if (event.type === "error") throw new Error(event.error || "Ranking opportunity analysis failed.");
      if (event.type === "complete") {
        const content = String(event.content || "").trim();
        if (!content) throw new Error("Ranking analysis returned empty content.");
        return content;
      }
    }
  }

  throw new Error("Ranking analysis ended without a result.");
}
