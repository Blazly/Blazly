import { getProjectIntegrations, setProvider } from "./store.js";
import { signState } from "./google.js";

const AUTH_URL = "https://webflow.com/oauth/authorize";
const TOKEN_URL = "https://api.webflow.com/oauth/access_token";
const API = "https://api.webflow.com/v2";

export const WEBFLOW_SCOPES = ["sites:read", "sites:write", "cms:read", "cms:write", "authorized_user:read"];

function clientConfig() {
  const clientId = process.env.WEBFLOW_CLIENT_ID?.trim();
  const clientSecret = process.env.WEBFLOW_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error("Webflow OAuth is not configured. Add WEBFLOW_CLIENT_ID and WEBFLOW_CLIENT_SECRET to .env.");
  }
  return { clientId, clientSecret };
}

export function webflowConfigured() {
  return Boolean(process.env.WEBFLOW_CLIENT_ID?.trim() && process.env.WEBFLOW_CLIENT_SECRET?.trim());
}

function redirectUri(origin) {
  return process.env.WEBFLOW_REDIRECT_URI?.trim() || `${origin}/api/integrations/webflow/callback`;
}

export function buildWebflowAuthUrl({ origin, uid, project }) {
  const { clientId } = clientConfig();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri(origin),
    scope: WEBFLOW_SCOPES.join(" "),
    state: signState({ uid, project, provider: "webflow" }),
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeWebflowCode({ code, origin }) {
  const { clientId, clientSecret } = clientConfig();
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(origin),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.message || data.error || "Webflow sign-in failed.");
  }
  return data.access_token;
}

async function wfRequest(token, route, { method = "GET", body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const response = await fetch(`${API}${route}${qs}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    /* empty or non-JSON body */
  }
  if (!response.ok) {
    const detail = Array.isArray(data.details) && data.details.length ? ` (${JSON.stringify(data.details).slice(0, 300)})` : "";
    if (response.status === 401) throw new Error("Webflow access was revoked. Reconnect Webflow under Integrations.");
    throw new Error(`${data.message || `Webflow API error (${response.status})`}${detail}`);
  }
  return data;
}

export async function saveWebflowToken(uid, project, accessToken) {
  let name = "";
  try {
    const me = await wfRequest(accessToken, "/token/authorized_by");
    name = [me.firstName, me.lastName].filter(Boolean).join(" ") || me.email || "";
  } catch {
    /* scope may be missing on older apps */
  }
  await setProvider(uid, project, "webflow", { accessToken, userName: name });
}

async function webflowState(uid, project) {
  const wf = (await getProjectIntegrations(uid, project)).webflow;
  if (!wf?.accessToken) throw new Error("Webflow is not connected for this project. Connect it under Integrations.");
  return wf;
}

async function webflowTarget(uid, project, collectionId) {
  const wf = await webflowState(uid, project);
  const id = collectionId || wf.collectionId;
  if (!id) throw new Error("No Webflow blog collection selected. Pick one under Integrations.");
  return { wf, collectionId: id };
}

export async function listWebflowSites(uid, project) {
  const { accessToken } = await webflowState(uid, project);
  const data = await wfRequest(accessToken, "/sites");
  return (data.sites || []).map((s) => ({
    id: s.id,
    name: s.displayName || s.shortName,
    previewUrl: s.previewUrl || "",
    domains: (s.customDomains || []).map((d) => d.url),
    shortName: s.shortName,
    lastPublished: s.lastPublished || null,
  }));
}

export async function listWebflowCollections(uid, project, siteId) {
  const wf = await webflowState(uid, project);
  const id = siteId || wf.siteId;
  if (!id) throw new Error("Pick a Webflow site first.");
  const data = await wfRequest(wf.accessToken, `/sites/${id}/collections`);
  return (data.collections || []).map((c) => ({ id: c.id, name: c.displayName, slug: c.slug, singularName: c.singularName }));
}

async function getCollection(token, collectionId) {
  return wfRequest(token, `/collections/${collectionId}`);
}

function pick(fields, type, hints, { fallback = true } = {}) {
  const typed = fields.filter((f) => f.type === type);
  for (const hint of hints) {
    const hit = typed.find((f) => `${f.slug} ${f.displayName || ""}`.toLowerCase().includes(hint));
    if (hit) return hit.slug;
  }
  return fallback ? typed[0]?.slug || null : null;
}

/** Guess which collection fields hold the article body, summary, and image. */
export function mapCollectionFields(collection) {
  const fields = (collection.fields || []).filter((f) => !["name", "slug"].includes(f.slug));
  const body = pick(fields, "RichText", ["post-body", "body", "content", "article", "post"]);
  const summary = pick(fields, "PlainText", ["summary", "excerpt", "description", "meta", "intro"], { fallback: false });
  const image = pick(fields, "Image", ["main-image", "featured", "thumbnail", "cover", "hero", "image"]);
  const required = (collection.fields || [])
    .filter((f) => f.isRequired && !["name", "slug", body, summary, image].includes(f.slug))
    .map((f) => ({ slug: f.slug, type: f.type, name: f.displayName }));
  return { body, summary, image, unmappedRequired: required };
}

export async function describeWebflowCollection(uid, project, collectionId) {
  const { wf, collectionId: id } = await webflowTarget(uid, project, collectionId);
  const collection = await getCollection(wf.accessToken, id);
  return {
    id: collection.id,
    name: collection.displayName,
    slug: collection.slug,
    mapping: mapCollectionFields(collection),
    fields: (collection.fields || []).map((f) => ({ slug: f.slug, name: f.displayName, type: f.type, required: f.isRequired })),
  };
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function liveUrl(wf, collectionSlug, itemSlug) {
  const base = (wf.siteDomain || "").replace(/\/+$/, "");
  return base && collectionSlug && itemSlug ? `${base}/${collectionSlug}/${itemSlug}` : "";
}

function summarizeItem(wf, collectionSlug, item) {
  const f = item.fieldData || {};
  return {
    id: item.id,
    title: f.name || "",
    slug: f.slug || "",
    draft: Boolean(item.isDraft),
    archived: Boolean(item.isArchived),
    last_published: item.lastPublished || null,
    last_updated: item.lastUpdated || null,
    link: liveUrl(wf, collectionSlug, f.slug),
  };
}

function buildFieldData(mapping, input, { partial = false } = {}) {
  const fieldData = {};
  if (input.title) fieldData.name = input.title;
  if (input.slug || (!partial && input.title)) fieldData.slug = slugify(input.slug || input.title);
  if (input.content) {
    if (!mapping.body) throw new Error("This collection has no Rich Text field for the article body.");
    fieldData[mapping.body] = input.content;
  }
  if (input.excerpt && mapping.summary) fieldData[mapping.summary] = String(input.excerpt).slice(0, 256);
  if (input.featured_image_url && mapping.image) fieldData[mapping.image] = { url: input.featured_image_url };
  Object.assign(fieldData, input.extra_fields || {});
  return fieldData;
}

export async function webflowPublishPost(uid, project, input) {
  const { wf, collectionId } = await webflowTarget(uid, project, input.collection_id);
  const collection = await getCollection(wf.accessToken, collectionId);
  const mapping = mapCollectionFields(collection);
  const draft = input.status === "draft";
  const item = await wfRequest(wf.accessToken, `/collections/${collectionId}/items${draft ? "" : "/live"}`, {
    method: "POST",
    body: { isArchived: false, isDraft: draft, fieldData: buildFieldData(mapping, input) },
  });
  return summarizeItem(wf, collection.slug, item);
}

export async function webflowUpdatePost(uid, project, itemId, input) {
  const { wf, collectionId } = await webflowTarget(uid, project, input.collection_id);
  const collection = await getCollection(wf.accessToken, collectionId);
  const mapping = mapCollectionFields(collection);
  const draft = input.status === "draft";
  const item = await wfRequest(wf.accessToken, `/collections/${collectionId}/items/${itemId}${draft ? "" : "/live"}`, {
    method: "PATCH",
    body: { ...(input.status ? { isDraft: draft } : {}), fieldData: buildFieldData(mapping, input, { partial: true }) },
  });
  return summarizeItem(wf, collection.slug, item);
}

export async function webflowListPosts(uid, project, { collectionId, limit } = {}) {
  const { wf, collectionId: id } = await webflowTarget(uid, project, collectionId);
  const collection = await getCollection(wf.accessToken, id);
  const data = await wfRequest(wf.accessToken, `/collections/${id}/items`, {
    query: { limit: String(Math.min(Number(limit) || 20, 100)), sortBy: "lastPublished", sortOrder: "desc" },
  });
  return (data.items || []).map((item) => summarizeItem(wf, collection.slug, item));
}

export async function webflowGetPost(uid, project, itemId, collectionId) {
  const { wf, collectionId: id } = await webflowTarget(uid, project, collectionId);
  const collection = await getCollection(wf.accessToken, id);
  const mapping = mapCollectionFields(collection);
  const item = await wfRequest(wf.accessToken, `/collections/${id}/items/${itemId}`);
  return {
    ...summarizeItem(wf, collection.slug, item),
    summary: mapping.summary ? item.fieldData?.[mapping.summary] || "" : "",
    content: String((mapping.body && item.fieldData?.[mapping.body]) || "").slice(0, 20000),
  };
}

export async function webflowPublishSite(uid, project) {
  const wf = await webflowState(uid, project);
  if (!wf.siteId) throw new Error("No Webflow site selected.");
  return wfRequest(wf.accessToken, `/sites/${wf.siteId}/publish`, { method: "POST", body: { publishToWebflowSubdomain: true } });
}
