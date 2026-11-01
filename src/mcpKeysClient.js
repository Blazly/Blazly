async function json(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

export async function listMcpKeys(uid, project) {
  const qs = new URLSearchParams({ uid, ...(project ? { project } : {}) });
  const data = await json(await fetch(`/api/mcp-keys?${qs}`), "Could not load API keys.");
  return data.keys || [];
}

export async function createMcpKey(payload) {
  return json(
    await fetch("/api/mcp-keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    "Could not create an API key.",
  );
}

export async function revokeMcpKey(uid, id) {
  return json(
    await fetch("/api/mcp-keys/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, id }),
    }),
    "Could not revoke the key.",
  );
}
