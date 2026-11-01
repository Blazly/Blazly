export function firstUrlInText(text) {
  const source = String(text || "");
  const explicit = source.match(/\bhttps?:\/\/[^\s<>()[\]"']+/i);
  if (explicit) return cleanUrlToken(explicit[0]);
  const bare = source.match(/\b(?:www\.)?[a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)+\.[a-z]{2,}(?:\/[^\s<>()[\]"']*)?/i);
  if (bare) return cleanUrlToken(bare[0].startsWith("http") ? bare[0] : `https://${bare[0]}`);
  return null;
}

function cleanUrlToken(raw) {
  return raw.replace(/[.,;:!?)]+$/g, "");
}

export function messageLooksLikeSiteAuditUrl(text) {
  return Boolean(firstUrlInText(text));
}

export async function runSiteAuditStream(url, { onProgress } = {}) {
  const response = await fetch("/api/site-audit?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Site audit could not start.");
  }

  if (!response.body) {
    throw new Error("Site audit could not start.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");

      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const event = JSON.parse(payload);
          if (event.type === "error") throw new Error(event.error || "Site audit failed.");
          if (event.type === "progress") onProgress?.(event);
          if (event.type === "complete") content = event.content || "";
        } catch (error) {
          if (error.message) throw error;
        }
      }
    }
  }

  if (!content.trim()) throw new Error("Site audit returned no report.");
  return content.trim();
}
