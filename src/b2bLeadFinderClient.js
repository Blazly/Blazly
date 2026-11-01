export const B2B_LEAD_FINDER_BRIEF = `Ideal customer profile (ICP):

Describe who you want to reach in detail—the richer the ICP, the better the leads.

Include:
• Industry / niche
• Geography (countries or regions)
• Company size (employees or revenue band)
• Target roles (job titles, department, seniority)
• Optional signals (tech stack, funding stage, hiring, etc.)

Example:
US & UK B2B SaaS, 51–200 employees, selling to mid-market marketing teams. Target VP Marketing, Head of Growth, or CMO at companies using HubSpot, actively hiring content marketers.`;

export function b2bLeadFinderBriefPrefill() {
  return B2B_LEAD_FINDER_BRIEF;
}

export function isEmptyB2bLeadFinderBrief(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (normalized === B2B_LEAD_FINDER_BRIEF.trim()) return true;
  const icp = parseB2bLeadFinderBrief(normalized);
  return !icp || icp.length < 10;
}

export function parseB2bLeadFinderBrief(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (!raw) return "";

  const singleLine = raw.match(/^ideal customer profile\s*\(\s*icp\s*\)\s*:\s*(.+)$/is);
  if (singleLine?.[1]?.trim()) return singleLine[1].trim();

  const shortLine = raw.match(/^icp\s*:\s*(.+)$/is);
  if (shortLine?.[1]?.trim()) return shortLine[1].trim();

  if (/^ideal customer profile\s*\(\s*icp\s*\)\s*:/im.test(raw) || /^icp\s*:/im.test(raw)) {
    const lines = raw.split("\n");
    const body = [];
    let started = false;
    for (const line of lines) {
      if (!started) {
        if (/^ideal customer profile\s*\(\s*icp\s*\)\s*:/i.test(line.trim()) || /^icp\s*:/i.test(line.trim())) {
          started = true;
          const rest = line
            .trim()
            .replace(/^ideal customer profile\s*\(\s*icp\s*\)\s*:/i, "")
            .replace(/^icp\s*:/i, "")
            .trim();
          if (rest) body.push(rest);
        }
        continue;
      }
      if (/^include:/i.test(line.trim()) && body.length === 0) continue;
      if (/^example:/i.test(line.trim()) && body.every((l) => !l.trim())) continue;
      body.push(line);
    }
    const joined = body.join("\n").trim();
    if (joined) return joined.replace(/^example:\s*/im, "").trim();
  }

  if (!/^ideal customer profile/im.test(raw) && raw.length >= 55) return raw;
  return "";
}

export function looksLikeB2bLeadFinderBrief(text) {
  const t = String(text || "");
  if (isEmptyB2bLeadFinderBrief(t)) return true;
  return /^ideal customer profile\s*\(\s*icp\s*\)\s*:/im.test(t) || /^icp\s*:/im.test(t);
}

export function shouldRunB2bLeadFinder(text, { agentActive, inChat } = {}) {
  if (!agentActive) return false;
  const icp = parseB2bLeadFinderBrief(text);
  if (icp && icp.length >= 55) return true;
  if (inChat && icp && icp.length >= 40) return true;
  return false;
}

export async function runB2bLeadFinderStream({ message, onProgress } = {}) {
  const response = await fetch("/api/b2b-lead-finder?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "B2B lead finder failed.");
  }

  return consumeB2bLeadFinderSse(response, onProgress);
}

async function consumeB2bLeadFinderSse(response, onProgress) {
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
      if (event.type === "error") throw new Error(event.error || "B2B lead finder failed.");
      if (event.type === "complete") {
        const content = String(event.content || "").trim();
        if (!content) throw new Error("B2B lead finder returned empty content.");
        return content;
      }
    }
  }

  throw new Error("B2B lead finder ended without a result.");
}
