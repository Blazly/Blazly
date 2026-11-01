import { readJson } from "./readJson.js";
import { identify } from "./credits/middleware.js";
import { assertPublicHost, assertPublicUrl, safeFetch } from "./safeUrl.js";
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36 Blazly/1.0 (+https://blazly.ai)";

export const FETCH_HEADERS = {
  "User-Agent": USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const SCHEMA = {
  type: "OBJECT",
  properties: {
    companyName: { type: "STRING" },
    website: { type: "STRING" },
    description: { type: "STRING" },
    industry: { type: "STRING" },
    location: { type: "STRING" },
    services: { type: "ARRAY", items: { type: "STRING" } },
    products: { type: "ARRAY", items: { type: "STRING" } },
    targetAudiences: { type: "ARRAY", items: { type: "STRING" } },
    competitors: { type: "ARRAY", items: { type: "STRING" } },
    socialProfiles: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          network: { type: "STRING" },
          url: { type: "STRING" },
        },
      },
    },
    keyPages: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          title: { type: "STRING" },
          url: { type: "STRING" },
        },
      },
    },
    marketAnalysis: { type: "STRING" },
  },
  required: [
    "companyName",
    "website",
    "description",
    "industry",
    "location",
    "services",
    "products",
    "targetAudiences",
    "competitors",
    "socialProfiles",
    "keyPages",
    "marketAnalysis",
  ],
};

export function attachAnalyze(server, apiKey) {
  server.middlewares.use(async (req, res, next) => {
    const [path, query = ""] = (req.url || "").split("?");
    if (path !== "/api/analyze") return next();
    if (req.method !== "POST") {
      send(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      if (!(await identify(req))) {
        send(res, 401, { error: "Sign in to analyze a website." });
        return;
      }
      const body = await readJson(req);
      const website = normalizeWebsite(body.website);
      const knowledge = await analyzeWebsite(apiKey, website);
      send(res, 200, { knowledge });
    } catch (error) {
      send(res, error.status || 500, { error: error.message || "Could not read that website." });
    }
  });
}

async function analyzeWebsite(apiKey, website) {
  if (!apiKey) {
    const error = new Error("Gemini is not configured.");
    error.status = 500;
    throw error;
  }

  const corpus = await collectCorpus(website);
  if (!corpus.text) fail(502, "The page loaded, but there was no text to read.");
  const prompt = [
    `Build a complete knowledge base for ${corpus.canonical}.`,
    "Read the scraped pages, script copy, and facts below. Fill every field. Do not leave lists empty.",
    "Use details the site actually states: company name, what it sells, who it is for, office location, phone country, compare pages, and social URLs.",
    "services are the capabilities they offer. products are named products, plans, or tools. targetAudiences are the buyers the copy speaks to.",
    "competitors are products the site compares itself with. If none are named, use the closest well-known products in the same category.",
    "location is the city and country when an office, address, or phone country is present.",
    "socialProfiles must use the profile URLs in the facts. keyPages are the important URLs listed below.",
    "description is two or three sentences. marketAnalysis is one paragraph on who they sell to and how they position the offer.",
    "",
    corpus.text,
  ].join("\n");

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: SCHEMA,
    },
  };

  let data = await generate(apiKey, payload);
  if (data.error) {
    const retry = await generate(apiKey, { contents: payload.contents });
    if (retry.error) {
      const error = new Error(cleanGeminiError(retry.error.message));
      error.status = retry.error.code || 502;
      throw error;
    }
    data = retry;
  }

  const text = (data.candidates?.[0]?.content?.parts || [])
    .filter((part) => part.text && !part.thought)
    .map((part) => part.text)
    .join("\n")
    .trim();
  if (!text) {
    const error = new Error("Gemini did not return brand details for that site.");
    error.status = 502;
    throw error;
  }

  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^```json\s*|```$/g, "").trim());
  } catch {
    const error = new Error("Gemini returned details that could not be read.");
    error.status = 502;
    throw error;
  }
  return shapeKnowledge(parsed, corpus.canonical);
}

async function generate(apiKey, payload) {
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120000),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok && !data.error) {
    return { error: { message: "Gemini could not read that website.", code: response.status } };
  }
  return data;
}

function shapeKnowledge(raw, website) {
  return {
    companyName: text(raw.companyName),
    website: text(raw.website) || website,
    description: text(raw.description),
    industry: text(raw.industry),
    location: text(raw.location),
    services: list(raw.services),
    products: list(raw.products),
    targetAudiences: list(raw.targetAudiences),
    competitors: list(raw.competitors),
    socialProfiles: profiles(raw.socialProfiles),
    keyPages: pages(raw.keyPages),
    marketAnalysis: text(raw.marketAnalysis),
  };
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function list(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean);
}

function profiles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({ network: text(item?.network), url: text(item?.url) }))
    .filter((item) => item.network || item.url);
}

function pages(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({ title: text(item?.title), url: text(item?.url) }))
    .filter((item) => item.title || item.url);
}



export async function loadPage(website) {
  let lastStatus = 0;
  const tried = new Set();
  for (const candidate of pageCandidates(website)) {
    if (tried.has(candidate)) continue;
    tried.add(candidate);
    try {
      assertPublicWebsite(candidate);
    } catch {
      continue;
    }
    const page = await followRedirects(candidate);
    lastStatus = page.status;
    if (page.status >= 200 && page.status < 300 && page.html.trim()) return page;
  }
  if (lastStatus === 404) fail(404, "That page returned 404. Check the URL and try again.");
  fail(502, "Could not load this page.");
}

function pageCandidates(website) {
  const url = new URL(website);
  const variants = [url];
  const toggled = new URL(url);
  toggled.hostname = url.hostname.startsWith("www.") ? url.hostname.slice(4) : `www.${url.hostname}`;
  variants.push(toggled);
  const candidates = [];
  for (const variant of variants) {
    candidates.push(variant.toString());
    const slashed = new URL(variant);
    if (slashed.pathname.endsWith("/") && slashed.pathname !== "/") slashed.pathname = slashed.pathname.replace(/\/+$/, "");
    else if (!slashed.pathname.endsWith("/")) slashed.pathname = `${slashed.pathname}/`;
    candidates.push(slashed.toString());
  }
  return candidates;
}

async function followRedirects(website) {
  let current = website;
  for (let hop = 0; hop < 5; hop += 1) {
    await assertPublicHost(current);
    const response = await fetch(current, {
      redirect: "manual",
      headers: FETCH_HEADERS,
      signal: AbortSignal.timeout(15000),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) return { status: response.status, url: current, html: "" };
      current = new URL(location, current).toString();
      continue;
    }
    const html = (await response.text()).slice(0, 1_500_000);
    return { status: response.status, url: current, html };
  }
  return { status: 0, url: current, html: "" };
}

export async function collectCorpus(website) {
  const page = await loadPage(website);
  const canonical = stripTrailingSlash(page.url);
  const origin = new URL(page.url).origin;
  const homepage = htmlToText(page.html);
  const parts = [];
  const meta = extractMeta(page.html);
  if (meta) parts.push(`Homepage meta:\n${meta}`);
  if (homepage.length > 80) parts.push(`Homepage text:\n${homepage}`);

  const bundleSources = homepage.length < 1500 ? scriptSources(page.html, page.url).slice(0, 3) : [];
  const bundles = await Promise.all(bundleSources.map((url) => fetchText(url)));
  const bundleText = bundles.filter(Boolean).join("\n");
  const readable = readableStrings(bundleText);
  if (readable) parts.push(`Copy found in the site scripts:\n${readable}`);

  const facts = collectFacts(`${page.html}\n${bundleText}`);
  if (facts) parts.push(`Facts pulled from the site:\n${facts}`);

  const links = extractLinks(page.html, page.url);
  const routes = routePaths(bundleText);
  const extras = await loadExtraPages(origin, links, routes, homepage);
  if (extras.length) parts.push(`Other pages:\n${extras.join("\n\n")}`);

  const pageList = uniqueUrls([canonical, ...links.map((link) => link.url), ...routes.map((route) => new URL(route, origin).toString())]).slice(0, 24);
  if (pageList.length) parts.push(`Important URLs:\n${pageList.join("\n")}`);

  return { canonical, text: parts.join("\n\n").slice(0, 70000) };
}

async function loadExtraPages(origin, links, routes, homepage) {
  const targets = pickTargets(origin, links, routes).slice(0, 8);
  const pages = await Promise.all(targets.map(async (url) => {
    try {
      const page = await loadPage(url);
      const text = htmlToText(page.html);
      if (text.length < 180 || text.slice(0, 280) === homepage.slice(0, 280)) return "";
      return `${stripTrailingSlash(page.url)}\n${text.slice(0, 6000)}`;
    } catch {
      return "";
    }
  }));
  return pages.filter(Boolean);
}

function pickTargets(origin, links, routes) {
  const scored = [];
  const seen = new Set();
  const add = (value) => {
    try {
      const url = new URL(value, origin);
      if (url.origin !== new URL(origin).origin) return;
      url.hash = "";
      const href = stripTrailingSlash(url.toString());
      const path = url.pathname;
      if (seen.has(href) || path === "/" || !PAGE_HINT.test(path)) return;
      seen.add(href);
      scored.push({ href, score: scorePath(path) });
    } catch {
      // Skip malformed targets.
    }
  };
  for (const link of links) add(link.url);
  for (const route of routes) add(route);
  return scored.sort((a, b) => a.score - b.score).map((item) => item.href);
}

function scorePath(pathname) {
  if (/contact|about|company|team|office/i.test(pathname)) return 0;
  if (/pricing|plan/i.test(pathname)) return 1;
  if (/feature|service|product|solution/i.test(pathname)) return 2;
  if (/compare|integration|customer/i.test(pathname)) return 3;
  return 4;
}

const PAGE_HINT = /about|contact|pricing|plan|feature|service|product|company|team|solution|customer|compare|integration|office/i;

function scriptSources(html, pageUrl) {
  const sources = [];
  const pattern = /<script\b[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let match = pattern.exec(html);
  while (match) {
    try {
      const url = new URL(match[1], pageUrl);
      if (url.origin === new URL(pageUrl).origin && /\.js(?:$|\?)/.test(url.pathname + url.search)) sources.push(url.toString());
    } catch {
      // Skip malformed script URLs.
    }
    match = pattern.exec(html);
  }
  return sources;
}

function routePaths(source) {
  return [...source.matchAll(/path:\s*["'](\/[a-z0-9/_-]*)["']/gi)].map((match) => match[1]);
}

async function fetchText(url) {
  try {
    const response = await safeFetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(15000) });
    if (!response.ok) return "";
    const length = Number(response.headers.get("content-length") || 0);
    if (length > 2_500_000) return "";
    return (await response.text()).slice(0, 2_500_000);
  } catch {
    return "";
  }
}

function readableStrings(source) {
  if (!source) return "";
  const found = [];
  const seen = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const quote = source[index];
    if (quote !== '"' && quote !== "'") continue;
    let value = "";
    let cursor = index + 1;
    let closed = false;
    for (; cursor < source.length && cursor < index + 500; cursor += 1) {
      const char = source[cursor];
      if (char === "\\") {
        const next = source[cursor + 1] || "";
        value += next === "n" || next === "t" ? " " : next;
        cursor += 1;
        continue;
      }
      if (char === quote) {
        closed = true;
        break;
      }
      if (char === "\n" || char === "\r") break;
      value += char;
    }
    if (!closed) continue;
    index = cursor;
    value = value.replace(/\s+/g, " ").trim();
    if (!value || seen.has(value) || !keepString(value)) continue;
    seen.add(value);
    found.push(value);
  }
  const important = found.filter((value) => /office|headquarter|address|located|based in|india|linkedin|contact|pricing|@|\+\d|compare|competitor/i.test(value));
  const rest = found.filter((value) => !important.includes(value));
  return [...important, ...rest].join("\n").slice(0, 48000);
}

function keepString(value) {
  if (value.length < 8 || value.length > 360) return false;
  if (/[{}<>]|=>|function |typeof |void 0|className|undefined|document\.|window\.|querySelector/.test(value)) return false;
  if (/^(https?:)?\/\//.test(value)) return /linkedin|twitter\.com|x\.com|facebook|instagram|youtube|github|tiktok/i.test(value);
  const words = value.split(/\s+/);
  if (words.length < 2) return false;
  const letters = (value.match(/[A-Za-z]/g) || []).length;
  if (letters / value.length < 0.55) return false;
  if ((value.match(/-/g) || []).length > 4 && !/[.!?]/.test(value)) return false;
  if (/^(mousedown|mouseup|click|keydown|focus|drag|touch|pointer|abort|canplay)/i.test(value)) return false;
  return true;
}

function collectFacts(source) {
  const social = unique(source.match(/https?:\/\/(?:www\.)?(?:linkedin\.com|twitter\.com|x\.com|facebook\.com|instagram\.com|youtube\.com|github\.com|tiktok\.com)\/[^\s"'<>\\)]+/gi) || [])
    .filter((url) => !/youtube\.com\/embed/i.test(url));
  const emails = unique(source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).filter((email) => !/example|sentry|wixpress|schema\.org|company\.com|email\.com|domain\.com/i.test(email));
  const phones = unique(source.match(/\+\d[\d\s().-]{7,18}\d/g) || []);
  const places = unique(source.match(/\b[A-Z][a-zA-Z.'-]+(?: [A-Z][a-zA-Z.'-]+)?, (?:India|USA|United States|UK|United Kingdom|Canada|Australia|Singapore|Germany|France|UAE|United Arab Emirates)\b/g) || []);
  return [
    social.length ? `Social: ${social.join(", ")}` : "",
    emails.length ? `Email: ${emails.slice(0, 6).join(", ")}` : "",
    phones.length ? `Phone: ${phones.slice(0, 4).join(", ")}` : "",
    places.length ? `Places: ${places.slice(0, 6).join(", ")}` : "",
  ].filter(Boolean).join("\n");
}

function extractMeta(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const description = metaContent(html, "description") || metaContent(html, "og:description");
  const jsonLd = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 2)
    .join("\n");
  return [title && `Title: ${title}`, description && `Description: ${description}`, jsonLd && `Structured data: ${jsonLd.slice(0, 4000)}`].filter(Boolean).join("\n");
}

function metaContent(html, name) {
  const pattern = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`, "i");
  const match = html.match(pattern);
  return (match?.[1] || match?.[2] || "").replace(/\s+/g, " ").trim();
}

function unique(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueUrls(values) {
  const seen = new Set();
  const urls = [];
  for (const value of values) {
    try {
      const href = stripTrailingSlash(new URL(value).toString());
      if (seen.has(href)) continue;
      seen.add(href);
      urls.push(href);
    } catch {
      // Skip malformed URLs.
    }
  }
  return urls;
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60000);
}

function extractLinks(html, pageUrl) {
  const origin = new URL(pageUrl).origin;
  const links = [];
  const seen = new Set();
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match = pattern.exec(html);
  while (match && links.length < 40) {
    try {
      const url = new URL(match[1], pageUrl);
      if (url.origin === origin && (url.protocol === "http:" || url.protocol === "https:")) {
        url.hash = "";
        const href = url.toString();
        if (!seen.has(href)) {
          seen.add(href);
          const title = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
          links.push({ title, url: href });
        }
      }
    } catch {
      // Skip malformed hrefs.
    }
    match = pattern.exec(html);
  }
  return links;
}




function assertPublicWebsite(website) {
  try {
    assertPublicUrl(website);
  } catch (error) {
    fail(400, "That website can't be analyzed.");
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

export function urlsFromText(value) {
  const text = String(value || "");
  const found = new Set();
  const push = (raw) => {
    const cleaned = raw.replace(/[.,;:!?)]+$/g, "");
    try {
      found.add(normalizeWebsite(cleaned));
    } catch {
      // Skip strings that are not public website URLs.
    }
  };
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>()[\]"']+/gi)) push(match[0]);
  for (const match of text.matchAll(/\b(?:www\.)?[a-z0-9][-a-z0-9]*(?:\.[a-z0-9][-a-z0-9]*)+\.[a-z]{2,}(?:\/[^\s<>()[\]"']*)?/gi)) {
    if (!/^https?:\/\//i.test(match[0])) push(match[0]);
  }
  return [...found].slice(0, 2);
}

export async function scrapeWebsiteContext(website) {
  const corpus = await collectCorpus(website);
  return { url: corpus.canonical, text: corpus.text.slice(0, 45000) };
}

export function normalizeWebsite(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) fail(400, "Enter a website URL.");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url;
  try {
    url = new URL(withProtocol);
  } catch {
    fail(400, "That website URL does not look right.");
  }
  if (!url.hostname.includes(".")) fail(400, "That website URL does not look right.");
  return stripTrailingSlash(url.toString());
}

function stripTrailingSlash(value) {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}${url.search}${url.hash}`;
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function cleanGeminiError(message) {
  if (!message) return "Gemini could not read that website.";
  if (/api key|unauthenticated|permission/i.test(message)) return "Gemini rejected the API key.";
  if (/not found|model/i.test(message) && /model/i.test(message)) return "That Gemini model is not available for this key.";
  return message.length > 180 ? "Gemini could not read that website." : message;
}


function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
