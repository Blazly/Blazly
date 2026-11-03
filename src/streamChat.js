export async function streamAssistantReply({ history, context, onDelta }) {
  const response = await fetch("/api/chat?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history, ...context }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Blazly could not reply.");
  }

  if (!response.body) {
    throw new Error("Blazly could not reply.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

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
        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        if (event.type === "error") {
          throw new Error(event.error?.message || event.error || "Blazly could not reply.");
        }
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          text += event.delta.text || "";
          onDelta?.(text);
        }
      }
    }
  }

  if (!text.trim()) throw new Error("Blazly returned an empty reply.");
  return text.trim();
}
