async function json(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

export async function fetchIntegrationStatus(uid, project) {
  const qs = new URLSearchParams({ uid, project });
  return json(await fetch(`/api/integrations/status?${qs}`), "Could not load integrations.");
}

export async function connectWordPress({ uid, project, siteUrl, username, appPassword }) {
  return json(
    await fetch("/api/integrations/wordpress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, project, siteUrl, username, appPassword }),
    }),
    "Could not connect WordPress.",
  );
}

export async function startWordPressApproval({ uid, project, siteUrl }) {
  const { url } = await json(
    await fetch("/api/integrations/wordpress/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, project, siteUrl }),
    }),
    "Could not reach your WordPress site.",
  );
  window.location.assign(url);
}

export async function renameProjectIntegrations({ uid, from, to }) {
  return json(
    await fetch("/api/integrations/project/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, from, to }),
    }),
    "Could not move this project's integrations.",
  );
}

export async function deleteProjectIntegrations({ uid, project }) {
  return json(
    await fetch("/api/integrations/project/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, project }),
    }),
    "Could not remove this project's integrations.",
  );
}

export async function startWebflowConnect(project) {
  const data = await json(
    await fetch("/api/integrations/webflow/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project }),
    }),
    "Could not start the Webflow connection.",
  );
  window.location.assign(data.url);
}

export async function fetchWebflowSites(uid, project) {
  const qs = new URLSearchParams({ uid, project });
  return json(await fetch(`/api/integrations/webflow/sites?${qs}`), "Could not load Webflow sites.");
}

export async function fetchWebflowCollections(uid, project, siteId) {
  const qs = new URLSearchParams({ uid, project, siteId });
  return json(await fetch(`/api/integrations/webflow/collections?${qs}`), "Could not load Webflow collections.");
}

export async function selectWebflowTarget({ uid, project, siteId, collectionId }) {
  return json(
    await fetch("/api/integrations/webflow/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, project, siteId, collectionId }),
    }),
    "Could not save the Webflow collection.",
  );
}

export async function saveWebhook({ uid, project, endpointUrl, siteUrl, rotateSecret }) {
  return json(
    await fetch("/api/integrations/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, project, endpointUrl, siteUrl, rotateSecret }),
    }),
    "Could not save the webhook.",
  );
}

export async function testWebhook({ uid, project }) {
  return json(
    await fetch("/api/integrations/webhook/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, project }),
    }),
    "Test delivery failed.",
  );
}

export async function disconnectIntegration({ uid, project, provider }) {
  return json(
    await fetch("/api/integrations/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, project, provider }),
    }),
    "Could not disconnect.",
  );
}

export async function startGoogleConnect(project) {
  const data = await json(
    await fetch("/api/integrations/google/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project }),
    }),
    "Could not start the Google connection.",
  );
  window.location.assign(data.url);
}

export async function fetchGoogleProperties(uid, project) {
  const qs = new URLSearchParams({ uid, project });
  return json(await fetch(`/api/integrations/google/properties?${qs}`), "Could not load Google properties.");
}

export async function selectGoogleProperties({ uid, project, gscSiteUrl, ga4PropertyId, ga4PropertyName }) {
  return json(
    await fetch("/api/integrations/google/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, project, gscSiteUrl, ga4PropertyId, ga4PropertyName }),
    }),
    "Could not save Google properties.",
  );
}

export async function runSiteIntegrationsStream({ uid, project, website, message, messages, article, onProgress }) {
  const response = await fetch("/api/integrations/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      uid,
      project,
      website,
      message,
      messages: (messages || []).map((m) => ({ role: m.role, content: m.content })),
      article,
    }),
  });
  if (!response.ok || !response.body) throw new Error("Website & analytics agent failed.");

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
      if (event.type === "error") throw new Error(event.error);
      if (event.type === "complete") return String(event.content || "").trim();
    }
  }
  throw new Error("Website & analytics agent ended without a result.");
}
