import { readJson } from "./readJson.js";
import { dataforseoPost, normalizeDomain } from "./dataforseo.js";

const LABS_LOCALE = { location_code: 2840, language_code: "en" };
const SEARCHAPI_ROOT = "https://www.searchapi.io/api/v1/search";

export function attachSerpTracking(server, ctx) {
  server.middlewares.use(async (req, res, next) => {
    const [pathOnly, query = ""] = (req.url || "").split("?");
    if (pathOnly !== "/api/serp-tracking") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      const body = await readJson(req);
      if (!ctx?.searchApiKey) {
        throw new Error("SERP tracking is not available for this workspace yet.");
      }
      if (!ctx?.dataForSeo?.login || !ctx?.dataForSeo?.password) {
        throw new Error("Keyword discovery is not available for this workspace yet.");
      }
      if (stream) {
        await streamSerpTrackingJob(body, res, ctx);
        return;
      }
      const content = await runSerpTrackingJob(body, () => {}, ctx);
      sendJson(res, 200, { content });
    } catch (error) {
      if (stream) {
        writeSse(res, { type: "error", error: sanitizeError(error.message) });
        res.end();
        return;
      }
      sendJson(res, 500, { error: sanitizeError(error.message) });
    }
  });
}

async function streamSerpTrackingJob(body, res, ctx) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (payload) => writeSse(res, payload);
  try {
    const content = await runSerpTrackingJob(body, emit, ctx);
    emit({ type: "complete", content });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: sanitizeError(error.message) });
    res.end();
  }
}

export async function runSerpTrackingJob(body, onProgress, ctx) {
  const website = parseWebsiteInput(body.message, body.website);
  const domain = normalizeDomain(website);
  if (!domain) {
    throw new Error("Enter your website URL in the composer (Website URL:) to track Google rankings.");
  }

  onProgress?.({
    type: "progress",
    phase: "serp_tracking",
    stage: "keywords",
    message: `Finding keywords ${domain} ranks for`,
  });

  const seeds = await fetchDomainRankedKeywords(domain, ctx.dataForSeo);
  if (!seeds.length) {
    throw new Error(
      "No ranking keywords were found for this domain yet. Publish more indexable pages and try again later.",
    );
  }

  const candidates = pickTopRankingRows(seeds, 10);

  onProgress?.({
    type: "progress",
    phase: "serp_tracking",
    stage: "tracking",
    message: "Checking live Google positions",
  });

  const rows = [];
  for (const seed of candidates) {
    onProgress?.({
      type: "progress",
      phase: "serp_tracking",
      stage: "serp",
      message: `Live rank for “${seed.keyword.slice(0, 48)}”`,
    });
    let live = { position: seed.position, pageUrl: seed.pageUrl };
    try {
      live = await fetchLiveRankForKeyword({
        apiKey: ctx.searchApiKey,
        keyword: seed.keyword,
        domain,
        location: ctx.searchApiLocation,
      });
    } catch {
      // Keep indexed snapshot from keyword discovery.
    }
    rows.push({
      keyword: seed.keyword,
      pageUrl: live.pageUrl || seed.pageUrl || `https://${domain}`,
      position: live.position ?? seed.position,
      search_volume: seed.search_volume,
    });
  }

  rows.sort((a, b) => {
    const posA = Number(a.position) || 999;
    const posB = Number(b.position) || 999;
    if (posA !== posB) return posA - posB;
    return (Number(b.search_volume) || 0) - (Number(a.search_volume) || 0);
  });

  return formatSerpTrackingReply({ website: website || `https://${domain}`, domain, rows });
}

async function fetchDomainRankedKeywords(domain, config) {
  const raw = await dataforseoPost({
    login: config.login,
    password: config.password,
    path: "/v3/dataforseo_labs/google/ranked_keywords/live",
    tasks: [
      {
        target: domain,
        limit: 100,
        order_by: ["keyword_data.keyword_info.search_volume,desc"],
        ...LABS_LOCALE,
      },
    ],
  });

  const items = raw?.tasks?.[0]?.result?.[0]?.items || [];
  return items
    .map(parseRankedKeywordRow)
    .filter((row) => row.keyword && row.position != null && Number(row.position) <= 100);
}

function parseRankedKeywordRow(row) {
  const serp = row.ranked_serp_element?.serp_item;
  return {
    keyword: String(row.keyword_data?.keyword || row.keyword || "").trim(),
    position: serp?.rank_group ?? serp?.rank_absolute ?? row.rank_group ?? null,
    pageUrl: String(serp?.url || serp?.link || "").trim(),
    search_volume:
      row.keyword_data?.keyword_info?.search_volume ??
      row.search_volume ??
      row.keyword_data?.search_volume ??
      null,
  };
}

function pickTopRankingRows(seeds, limit) {
  const sorted = [...seeds].sort((a, b) => {
    const posA = Number(a.position) || 999;
    const posB = Number(b.position) || 999;
    if (posA !== posB) return posA - posB;
    return (Number(b.search_volume) || 0) - (Number(a.search_volume) || 0);
  });

  const seen = new Set();
  const out = [];
  for (const row of sorted) {
    const key = row.keyword.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

async function fetchLiveRankForKeyword({ apiKey, keyword, domain, location }) {
  const params = new URLSearchParams({
    engine: "google_rank_tracking",
    q: keyword,
    api_key: apiKey,
    num: "100",
    gl: "us",
    hl: "en",
  });
  if (location) params.set("location", location);

  const response = await fetch(`${SEARCHAPI_ROOT}?${params.toString()}`, {
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || data?.message || `Rank check failed (${response.status})`;
    throw new Error(typeof message === "string" ? message : "Rank check failed.");
  }

  const organic = data.organic_results || [];
  const match = organic.find((row) => domainMatches(domain, row.domain, row.link));
  if (!match) {
    return { position: null, pageUrl: null };
  }
  return {
    position: match.position ?? null,
    pageUrl: match.link || null,
  };
}

function domainMatches(domain, sourceDomain, url) {
  const needle = normalizeDomain(domain);
  if (!needle) return false;
  if (sourceDomain && normalizeDomain(sourceDomain) === needle) return true;
  const hay = String(url || "").toLowerCase();
  return hay.includes(needle) || hay.includes(`www.${needle}`);
}

function formatSerpTrackingReply({ website, domain, rows }) {
  const lines = [];
  lines.push(
    `Live Google rankings for ${domain}: your top ${rows.length} ranking URLs with keyword and monthly search volume (positions refreshed from live SERP data).`,
  );
  lines.push("");
  lines.push("METRICS_START");
  lines.push(`Website|${website}`);
  lines.push(`Domain|${domain}`);
  lines.push(`Ranking rows|${rows.length}`);
  lines.push(
    `Keywords in top 10|${rows.filter((row) => Number(row.position) <= 10).length}`,
  );
  lines.push("METRICS_END");
  lines.push("");
  lines.push("TABLE_START");
  lines.push("Keyword|Ranking page URL|Google position|Monthly searches");
  for (const row of rows) {
    lines.push(
      `${row.keyword}|${row.pageUrl || "—"}|${formatPosition(row.position)}|${formatInteger(row.search_volume)}`,
    );
  }
  lines.push("TABLE_END");
  return lines.join("\n");
}

function parseWebsiteInput(message, explicit) {
  const fromBody = String(explicit || "").trim();
  if (fromBody) return fromBody;

  const raw = String(message || "").trim();
  for (const line of raw.split("\n")) {
    const match = line.trim().match(/^website\s*url\s*:\s*(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim();
  }

  const urlMatch = raw.match(/https?:\/\/[^\s<>"']+/i);
  if (urlMatch) return urlMatch[0];

  if (raw && !/^website\s*url\s*:/im.test(raw)) {
    const first = raw.split("\n")[0]?.trim();
    if (first && /[a-z0-9.-]+\.[a-z]{2,}/i.test(first)) return first;
  }
  return "";
}

function formatPosition(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "Not in top 100";
  return `#${Math.round(n)}`;
}

function formatInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

function sanitizeError(message) {
  return String(message || "SERP tracking failed.")
    .replace(/searchapi/gi, "rank data")
    .replace(/dataforseo/gi, "keyword data");
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}


function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
