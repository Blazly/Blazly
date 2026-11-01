export const COMPETITOR_RESEARCH_BRIEF = "Competitor website URL:";

function normalizeHost(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0];
}

function pushUrlTargets(line, competitors) {
  for (const part of String(line || "").split(/[,;]+/)) {
    const value = part.trim();
    if (value && /[a-z0-9.-]+\.[a-z]{2,}/i.test(value)) competitors.push(value);
  }
}

export function competitorResearchBriefPrefill() {
  return COMPETITOR_RESEARCH_BRIEF;
}

export function isEmptyCompetitorResearchBrief(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .toLowerCase();
  if (normalized === COMPETITOR_RESEARCH_BRIEF.trim().toLowerCase()) return true;
  return /^competitor\s*(?:website\s*)?urls?\s*:?\s*$/.test(normalized);
}

export function parseCompetitorResearchBrief(text, { projectWebsite } = {}) {
  const raw = String(text || "").trim();
  let website = "";
  const competitors = [];
  let inCompetitors = false;
  const projectHost = normalizeHost(projectWebsite);

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const siteMatch = trimmed.match(/^website\s*url\s*:\s*(.*)$/i);
    if (siteMatch) {
      website = siteMatch[1].trim();
      inCompetitors = false;
      continue;
    }
    const compHeader = /^competitor\s*(?:website\s*)?urls?\s*:?\s*(.*)$/i.exec(trimmed);
    if (compHeader) {
      inCompetitors = true;
      const inline = compHeader[1]?.trim();
      if (inline) pushUrlTargets(inline, competitors);
      continue;
    }
    if (inCompetitors && trimmed) {
      pushUrlTargets(trimmed, competitors);
    }
  }

  if (!competitors.length) {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || /^competitor\s*(?:website\s*)?urls?\s*:/i.test(trimmed)) continue;
      if (/^website\s*url\s*:/i.test(trimmed)) continue;
      pushUrlTargets(trimmed, competitors);
    }
  }

  let unique = [...new Set(competitors.map((c) => c.trim()).filter(Boolean))];
  if (projectHost) {
    unique = unique.filter((c) => normalizeHost(c) !== projectHost);
  }
  if (!website && projectWebsite) {
    website = String(projectWebsite).trim();
  }

  return {
    website,
    competitors: unique.slice(0, 6),
  };
}

export function looksLikeCompetitorResearchBrief(text) {
  const t = String(text || "");
  if (isEmptyCompetitorResearchBrief(t)) return true;
  return (
    /^website\s*url\s*:/im.test(t) ||
    /^competitor\s*(?:website\s*)?urls?\s*:/im.test(t)
  );
}

export function shouldRunCompetitorResearch(text, { agentActive, inChat, projectWebsite } = {}) {
  if (!agentActive) return false;
  const t = String(text || "").trim();
  if (t.length < 3) return false;
  if (isEmptyCompetitorResearchBrief(t)) return false;

  const parsed = parseCompetitorResearchBrief(t, { projectWebsite });
  const hasSite = Boolean(parsed.website || projectWebsite);
  const hasCompetitors = parsed.competitors.length > 0;

  if (looksLikeCompetitorResearchBrief(t)) {
    return hasSite && hasCompetitors;
  }
  return Boolean(inChat && hasSite && hasCompetitors);
}

export async function runCompetitorResearchStream({ message, website, knowledge, onProgress } = {}) {
  const response = await fetch("/api/competitor-research?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, website, knowledge }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Competitor research failed.");
  }

  return consumeCompetitorResearchSse(response, onProgress);
}

async function consumeCompetitorResearchSse(response, onProgress) {
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
      if (event.type === "error") throw new Error(event.error || "Competitor research failed.");
      if (event.type === "complete") {
        const content = String(event.content || "").trim();
        if (!content) throw new Error("Competitor research returned empty content.");
        return content;
      }
    }
  }

  throw new Error("Competitor research ended without a result.");
}
