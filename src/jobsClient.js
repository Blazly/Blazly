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
