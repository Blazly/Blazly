function messagePlainText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b?.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n");
}

function toGeminiParts(content) {
  if (typeof content === "string") {
    return [{ text: content || " " }];
  }
  if (!Array.isArray(content)) {
    return [{ text: " " }];
  }
  const parts = [];
  for (const block of content) {
    if (block?.type === "text" && block.text) parts.push({ text: block.text });
    if (block?.type === "image" && block.source?.data) {
      parts.push({
        inlineData: {
          mimeType: block.source.media_type || "image/png",
          data: block.source.data,
        },
      });
    }
  }
  return parts.length ? parts : [{ text: messagePlainText(content) || " " }];
}

function toGeminiContents(history) {
  return history.map((item) => ({
    role: item.role === "assistant" ? "model" : "user",
    parts: toGeminiParts(item.content),
  }));
}

function geminiUrl(model, stream) {
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream ? "streamGenerateContent" : "generateContent"}`;
  return stream ? `${base}?alt=sse` : base;
}

export async function geminiCompleteChat({ apiKey, model, system, messages }) {
  if (!apiKey) {
    const error = new Error("Gemini is not configured.");
    error.status = 500;
    throw error;
  }

  const response = await fetch(geminiUrl(model, false), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: toGeminiContents(messages),
    }),
    signal: AbortSignal.timeout(300_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || "Gemini could not reply.";
    const error = new Error(message);
    error.status = response.status >= 400 && response.status < 600 ? response.status : 502;
    throw error;
  }

  const reply = (data.candidates || [])
    .flatMap((c) => c.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();

  if (!reply) {
    const error = new Error("Gemini returned an empty reply.");
    error.status = 502;
    throw error;
  }
  return reply;
}

/** Stream Gemini SSE as Anthropic-shaped events for the existing client. */
export async function geminiStreamChat({ apiKey, model, system, messages }, res) {
  if (!apiKey) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Gemini is not configured." }));
    return;
  }

  const response = await fetch(geminiUrl(model, true), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: toGeminiContents(messages),
    }),
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    res.writeHead(response.status >= 400 && response.status < 600 ? response.status : 502, {
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify({ error: data?.error?.message || "Gemini could not reply." }));
    return;
  }

  if (!response.body) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Gemini could not reply." }));
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let wrote = false;
  let lastText = "";

  const emitDelta = (chunk) => {
    if (!chunk) return;
    wrote = true;
    res.write(
      `data: ${JSON.stringify({
        type: "content_block_delta",
        delta: { type: "text_delta", text: chunk },
      })}\n\n`,
    );
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      const text = (event.candidates || [])
        .flatMap((c) => c.content?.parts || [])
        .map((p) => p.text || "")
        .join("");
      if (!text || text === lastText) continue;
      const delta = text.startsWith(lastText) ? text.slice(lastText.length) : text;
      lastText = text;
      emitDelta(delta);
    }
  }

  if (!wrote) {
    res.write(`data: ${JSON.stringify({ type: "error", error: "Gemini returned an empty reply." })}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}
