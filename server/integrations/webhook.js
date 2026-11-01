import { assertPublicHost, assertPublicUrl } from "../safeUrl.js";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { getProjectIntegrations } from "./store.js";

export function normalizeEndpointUrl(endpointUrl) {
  const raw = String(endpointUrl || "").trim();
  if (!raw) throw new Error("Enter your webhook endpoint URL.");
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    throw new Error("That endpoint URL isn't valid.");
  }
  if (url.protocol !== "https:") throw new Error("The endpoint must use https://.");
  assertPublicUrl(url);
  return url.toString();
}

export function generateWebhookSecret() {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

export function signPayload(secret, timestamp, rawBody) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
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

export async function deliverWebhook(config, event, data) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const deliveryId = randomUUID();
  const rawBody = JSON.stringify({ id: deliveryId, event, created_at: new Date().toISOString(), data });
  await assertPublicHost(config.endpointUrl);
  const response = await fetch(config.endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "Blazly-Webhooks/1.0",
      "X-Blazly-Event": event,
      "X-Blazly-Delivery": deliveryId,
      "X-Blazly-Timestamp": timestamp,
      "X-Blazly-Signature": signPayload(config.secret, timestamp, rawBody),
    },
    body: rawBody,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  if (!response.ok) {
    throw new Error(body.error || body.message || `Your endpoint responded with HTTP ${response.status}.`);
  }
  return { deliveryId, status: response.status, body };
}

export async function testWebhook(config) {
  const result = await deliverWebhook(config, "ping", { message: "Blazly connection test" });
  return { status: result.status };
}

async function webhookConfig(uid, project) {
  const hook = (await getProjectIntegrations(uid, project)).webhook;
  if (!hook?.endpointUrl || !hook?.secret) {
    throw new Error("No custom website webhook is connected for this project. Set it up under Integrations.");
  }
  return hook;
}

function summarizeResult(input, result) {
  const b = result.body || {};
  return {
    delivered: true,
    delivery_id: result.deliveryId,
    id: b.id ?? input.id ?? null,
    title: input.title || b.title || "",
    slug: b.slug || input.slug || "",
    status: b.status || input.status || "publish",
    link: typeof b.url === "string" ? b.url : typeof b.link === "string" ? b.link : "",
  };
}

export async function webhookPublishPost(uid, project, input) {
  const config = await webhookConfig(uid, project);
  const post = {
    title: input.title,
    slug: input.slug || slugify(input.title),
    content_html: input.content,
    excerpt: input.excerpt || "",
    categories: input.categories || [],
    tags: input.tags || [],
    status: input.status || "publish",
    featured_image_url: input.featured_image_url || null,
    published_at: new Date().toISOString(),
  };
  return summarizeResult(post, await deliverWebhook(config, "post.publish", post));
}

export async function webhookUpdatePost(uid, project, input) {
  const config = await webhookConfig(uid, project);
  const post = { id: input.id ?? null };
  if (input.slug) post.slug = input.slug;
  if (input.title) post.title = input.title;
  if (input.content) post.content_html = input.content;
  if (input.excerpt) post.excerpt = input.excerpt;
  if (input.status) post.status = input.status;
  if (input.categories) post.categories = input.categories;
  if (input.tags) post.tags = input.tags;
  if (post.id == null && !post.slug) throw new Error("Pass the post id or slug to update.");
  post.updated_at = new Date().toISOString();
  return summarizeResult(post, await deliverWebhook(config, "post.update", post));
}
