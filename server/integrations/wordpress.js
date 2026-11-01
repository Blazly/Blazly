import { assertPublicUrl, safeFetch } from "../safeUrl.js";
import { getProjectIntegrations } from "./store.js";

export function normalizeSiteUrl(siteUrl) {
  const raw = String(siteUrl || "").trim();
  if (!raw) throw new Error("Enter your WordPress site URL.");
  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const url = assertPublicUrl(withProto);
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

const BLAZLY_WP_APP_ID = "6f2b8e4a-9c1d-4b7e-a3f5-0d8c2e9b1a74";

async function findAuthorizeEndpoint(siteUrl) {
  let index;
  try {
    const response = await safeFetch(`${siteUrl}/wp-json/`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    index = response.ok ? await response.json() : null;
  } catch {
    index = null;
  }
  if (!index) {
    throw new Error("We couldn't reach a WordPress site at that address. Check the URL and that the site is online.");
  }
  const endpoint = index.authentication?.["application-passwords"]?.endpoints?.authorization;
  if (!endpoint) {
    throw new Error(
      "This site has Application Passwords turned off (often by a security plugin) or runs WordPress older than 5.6. Use the manual setup below instead.",
    );
  }
  return { endpoint, siteUrl: normalizeSiteUrl(index.url || siteUrl) };
}

export async function buildWordPressAuthUrl({ siteUrl, callbackUrl, rejectUrl }) {
  const found = await findAuthorizeEndpoint(normalizeSiteUrl(siteUrl));
  const url = new URL(found.endpoint);
  url.searchParams.set("app_name", "Blazly");
  url.searchParams.set("app_id", BLAZLY_WP_APP_ID);
  url.searchParams.set("success_url", callbackUrl);
  url.searchParams.set("reject_url", rejectUrl);
  return { url: url.toString(), siteUrl: found.siteUrl };
}

function authHeader({ username, appPassword }) {
  const token = Buffer.from(`${username}:${String(appPassword).replace(/\s+/g, "")}`).toString("base64");
  return `Basic ${token}`;
}

async function wpRequest(creds, route, { method = "GET", body, query } = {}) {
  const qs = query ? `?${new URLSearchParams(query)}` : "";
  const response = await safeFetch(`${creds.siteUrl}/wp-json${route}${qs}`, {
    method,
    headers: {
      Authorization: authHeader(creds),
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`WordPress returned a non-JSON response (${response.status}). Check the site URL and that the REST API is enabled.`);
  }
  if (!response.ok) {
    throw new Error(data.message || `WordPress error (${response.status}).`);
  }
  return data;
}

export async function testWordPress(creds) {
  const me = await wpRequest(creds, "/wp/v2/users/me", { query: { context: "edit" } });
  const caps = me.capabilities || {};
  if (!caps.publish_posts && !caps.edit_posts) {
    throw new Error("This WordPress user can't publish posts. Use an Author, Editor, or Administrator account.");
  }
  return { userId: me.id, name: me.name, canPublish: Boolean(caps.publish_posts) };
}

async function wordpressCreds(uid, project) {
  const wp = (await getProjectIntegrations(uid, project)).wordpress;
  if (!wp?.siteUrl || !wp?.appPassword) {
    throw new Error("WordPress is not connected for this project. Connect it under Integrations.");
  }
  return wp;
}

async function resolveTermIds(creds, taxonomy, names) {
  const ids = [];
  for (const name of names || []) {
    const clean = String(name).trim();
    if (!clean) continue;
    const found = await wpRequest(creds, `/wp/v2/${taxonomy}`, { query: { search: clean, per_page: "5" } });
    const match = found.find((t) => t.name.toLowerCase() === clean.toLowerCase());
    if (match) {
      ids.push(match.id);
      continue;
    }
    const created = await wpRequest(creds, `/wp/v2/${taxonomy}`, { method: "POST", body: { name: clean } });
    ids.push(created.id);
  }
  return ids;
}

function summarizePost(post) {
  return {
    id: post.id,
    title: post.title?.rendered || post.title?.raw || "",
    status: post.status,
    link: post.link,
    slug: post.slug,
    date: post.date,
    modified: post.modified,
  };
}

export async function wpPublishPost(uid, project, input) {
  const creds = await wordpressCreds(uid, project);
  const [categories, tags] = await Promise.all([
    resolveTermIds(creds, "categories", input.categories),
    resolveTermIds(creds, "tags", input.tags),
  ]);
  const post = await wpRequest(creds, "/wp/v2/posts", {
    method: "POST",
    body: {
      title: input.title,
      content: input.content,
      status: input.status || "publish",
      ...(input.slug ? { slug: input.slug } : {}),
      ...(input.excerpt ? { excerpt: input.excerpt } : {}),
      ...(categories.length ? { categories } : {}),
      ...(tags.length ? { tags } : {}),
    },
  });
  return summarizePost(post);
}

export async function wpUpdatePost(uid, project, postId, input) {
  const creds = await wordpressCreds(uid, project);
  const body = {};
  for (const key of ["title", "content", "status", "slug", "excerpt"]) {
    if (input[key] != null && input[key] !== "") body[key] = input[key];
  }
  const post = await wpRequest(creds, `/wp/v2/posts/${postId}`, { method: "POST", body });
  return summarizePost(post);
}

export async function wpListPosts(uid, project, { search, status, perPage } = {}) {
  const creds = await wordpressCreds(uid, project);
  const posts = await wpRequest(creds, "/wp/v2/posts", {
    query: {
      per_page: String(Math.min(Number(perPage) || 10, 50)),
      context: "edit",
      ...(search ? { search } : {}),
      ...(status ? { status } : { status: "publish,draft,future,pending,private" }),
    },
  });
  return posts.map(summarizePost);
}

export async function wpGetPost(uid, project, postId) {
  const creds = await wordpressCreds(uid, project);
  const post = await wpRequest(creds, `/wp/v2/posts/${postId}`, { query: { context: "edit" } });
  return {
    ...summarizePost(post),
    content: String(post.content?.raw || post.content?.rendered || "").slice(0, 20000),
  };
}
