/**
 * Background agent jobs. The server keeps running an agent after the browser disconnects and
 * stores the result; the app picks finished results up here and drops them into the right chat.
 */

/** Tells the auth fetch wrapper which chat/agent/project an agent request belongs to. */
export function setJobContext(context) {
  if (typeof window === "undefined") return;
  window.__blazlyJobContext = context || null;
}

export async function fetchPendingJobs() {
  const response = await fetch("/api/jobs/pending");
  if (!response.ok) return [];
  const data = await response.json().catch(() => ({}));
  return Array.isArray(data.jobs) ? data.jobs : [];
}

export async function ackJobs(ids) {
  if (!ids.length) return;
  await fetch("/api/jobs/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  }).catch(() => {});
}

/** True when a fetch failed because the connection dropped rather than because the server said no. */
export function isConnectionError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    error instanceof TypeError ||
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("network") ||
    message.includes("connection") ||
    message.includes("ended without a result")
  );
}

export const CONNECTION_LOST_STATUS =
  "Connection lost — the task is still running on our servers and the result will appear in this chat when it's ready.";

/** Re-attaches to a running background job: replays progress so far, then follows it live. */
export async function attachJobStream(id, { onProgress, signal } = {}) {
  const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/stream`, { signal });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Could not reconnect to the task.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastComplete = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload.startsWith("{")) continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type === "progress") onProgress?.(event);
      if (event.type === "error") throw new Error(event.error || "The task failed.");
      if (event.type === "complete") lastComplete = String(event.content || "").trim();
    }
  }
  if (lastComplete === null) throw new Error("The task ended without a result.");
  return lastComplete;
}
