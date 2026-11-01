export function shouldRunHumanizeAgent(text, { agentActive, hasPriorArticle } = {}) {
  if (!agentActive) return false;
  const t = String(text || "").trim();
  if (t.length < 3) return false;
  if (hasPriorArticle && looksLikeHumanizeMetaOnly(t)) return true;
  const body = stripHumanizeMeta(t) || t;
  return body.length >= 20 || Boolean(hasPriorArticle);
}

function looksLikeHumanizeMetaOnly(text) {
  const body = stripHumanizeMeta(text);
  return body.length < 120;
}

function stripHumanizeMeta(text) {
  const split = String(text || "").match(/^[\s\S]*?\n---+\n([\s\S]+)$/);
  if (split) return split[1].trim();
  return String(text || "")
    .split("\n")
    .filter((line) => !/^(content type|tone|language|keyword|format|level)\s*:/i.test(line.trim()))
    .filter((line) => !/^paste the content to humanize below\s*:?\s*$/i.test(line.trim()))
    .join("\n")
    .trim();
}

export async function runHumanizeStream(
  { message, previousHtml, previousTitle, previousKeyword, knowledge, effortAuto, effortTier, onProgress } = {},
) {
  const response = await fetch("/api/humanize?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      previousHtml,
      previousTitle,
      previousKeyword,
      knowledge,
      effortAuto,
      effortTier,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Humanization failed.");
  }

  return consumeHumanizeSse(response, onProgress);
}

async function consumeHumanizeSse(response, onProgress) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";

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
      try {
        const event = JSON.parse(payload);
        if (event.type === "error") throw new Error(event.error || "Humanization failed.");
        if (event.type === "progress") onProgress?.(event);
        if (event.type === "complete") content = event.content || content;
      } catch (err) {
        if (err.message?.includes("Humanization failed")) throw err;
      }
    }
  }

  if (!content.trim()) throw new Error("Humanization returned empty content.");
  return content;
}
