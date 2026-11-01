import { identify } from "./credits/middleware.js";
import { safeFetch } from "./safeUrl.js";
const cache = new Map();
const CACHE_MS = 24 * 60 * 60 * 1000;

function normalizeSite(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return m ? (m[2] ?? m[3] ?? m[4] ?? "").trim() : "";
}

/** Rank icon candidates declared in the page head; bigger, square brand icons first. */
function iconCandidates(html, base) {
  const out = [];
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    const rel = attr(tag, "rel").toLowerCase();
    const href = attr(tag, "href");
    if (!href || !/icon/.test(rel)) continue;
    const sizes = attr(tag, "sizes");
    const size = Number(sizes.split(/x/i)[0]) || 0;
    let score = size;
    if (rel.includes("apple-touch-icon")) score += 180;
    if (/\.svg(\?|$)/i.test(href) || attr(tag, "type").includes("svg")) score += 150;
    if (rel.includes("mask-icon")) score -= 500;
    try {
      out.push({ url: new URL(href, base).toString(), score });
    } catch {
      /* bad href */
    }
  }
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const key = (attr(tag, "property") || attr(tag, "name") || attr(tag, "itemprop")).toLowerCase();
    if (key === "og:logo" || key === "logo") {
      const content = attr(tag, "content");
      try {
        if (content) out.push({ url: new URL(content, base).toString(), score: 400 });
      } catch {
        /* bad content */
      }
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

async function reachableImage(url) {
  try {
    const res = await safeFetch(url, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0 BlazlyLogoFetcher/1.0", Accept: "image/*" },
      signal: AbortSignal.timeout(6000),
    });
    const type = res.headers.get("content-type") || "";
    await res.body?.cancel().catch(() => {});
    return res.ok && /^image\//i.test(type);
  } catch {
    return false;
  }
}

export async function findSiteLogo(rawSite) {
  const site = normalizeSite(rawSite);
  if (!site) throw new Error("Enter a valid website URL.");
  const key = site.hostname.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

  const fallback = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(key)}&sz=128`;
  let logo = "";
  try {
    const res = await safeFetch(site.origin, {
      headers: { "User-Agent": "Mozilla/5.0 BlazlyLogoFetcher/1.0", Accept: "text/html" },
      signal: AbortSignal.timeout(8000),
    });
    const html = (await res.text()).slice(0, 400_000);
    const base = res.url || site.origin;
    for (const candidate of iconCandidates(html, base).slice(0, 4)) {
      if (await reachableImage(candidate.url)) {
        logo = candidate.url;
        break;
      }
    }
    if (!logo) {
      const ico = new URL("/favicon.ico", base).toString();
      if (await reachableImage(ico)) logo = ico;
    }
  } catch {
    /* site unreachable; use fallback */
  }

  const value = { logo: logo || fallback, source: logo ? "site" : "google" };
  cache.set(key, { at: Date.now(), value });
  return value;
}

export function attachSiteLogo(server) {
  server.middlewares.use(async (req, res, next) => {
    const [path, query = ""] = (req.url || "").split("?");
    if (path !== "/api/site-logo" || req.method !== "GET") return next();
    res.setHeader("Content-Type", "application/json");
    try {
      if (!(await identify(req))) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: "Sign in first." }));
        return;
      }
      const result = await findSiteLogo(new URLSearchParams(query).get("url"));
      res.statusCode = 200;
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: error.message || "Could not find a logo." }));
    }
  });
}
