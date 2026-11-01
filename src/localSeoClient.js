export const LOCAL_SEO_BRIEF = `Business name:
Google Maps URL:`;

export function localSeoBriefPrefill(businessName = "", mapsUrl = "") {
  const name = String(businessName || "").trim();
  const url = String(mapsUrl || "").trim();
  if (name && url) return `Business name: ${name}\nGoogle Maps URL: ${url}`;
  if (name) return `Business name: ${name}\nGoogle Maps URL:`;
  return LOCAL_SEO_BRIEF;
}

export function isEmptyLocalSeoBrief(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .toLowerCase();
  if (normalized === LOCAL_SEO_BRIEF.trim().toLowerCase()) return true;
  const fields = parseLocalSeoBrief(text);
  return !fields.businessName && !fields.mapsUrl;
}

export function parseLocalSeoBrief(text) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  let businessName = "";
  let mapsUrl = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const nameMatch = trimmed.match(/^business\s*name\s*:\s*(.+)$/i);
    if (nameMatch) {
      businessName = nameMatch[1].trim();
      continue;
    }
    const urlMatch =
      trimmed.match(/^google\s*maps\s*url\s*:\s*(.+)$/i) ||
      trimmed.match(/^maps\s*url\s*:\s*(.+)$/i);
    if (urlMatch) mapsUrl = urlMatch[1].trim();
  }

  if (!mapsUrl) {
    const urlInText = raw.match(/https?:\/\/[^\s<>"']*(google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)[^\s<>"']*/i);
    if (urlInText) mapsUrl = urlInText[0];
  }

  return { businessName, mapsUrl };
}

export function looksLikeLocalSeoBrief(text) {
  const t = String(text || "");
  if (isEmptyLocalSeoBrief(t)) return true;
  return /^business\s*name\s*:/im.test(t) || /^google\s*maps\s*url\s*:/im.test(t);
}

export function shouldRunLocalSeo(text, { agentActive, inChat } = {}) {
  if (!agentActive) return false;
  const fields = parseLocalSeoBrief(text);
  if (fields.businessName && fields.mapsUrl) return true;
  if (inChat && fields.businessName && /google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps/i.test(fields.mapsUrl || text)) {
    return true;
  }
  return false;
}

export async function runLocalSeoStream({ message, onProgress } = {}) {
  const response = await fetch("/api/local-seo?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Local SEO analysis failed.");
  }

  return consumeLocalSeoSse(response, onProgress);
}

async function consumeLocalSeoSse(response, onProgress) {
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
      if (event.type === "error") throw new Error(event.error || "Local SEO analysis failed.");
      if (event.type === "complete") {
        const content = String(event.content || "").trim();
        if (!content) throw new Error("Local SEO analysis returned empty content.");
        return content;
      }
    }
  }

  throw new Error("Local SEO analysis ended without a result.");
}
