import { readJson } from "./readJson.js";
import {
  fetchGoogleMapsLocalSearch,
  fetchGoogleMapsPlace,
  parseGoogleMapsUrl,
  resolveGoogleMapsUrl,
} from "./searchApi.js";
import { modelForEffortTier } from "./modelRouter.js";

const CLAUDE_MODEL = () => process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
const MAX_COMPETITORS = 10;

export function attachLocalSeo(server, ctx) {
  server.middlewares.use(async (req, res, next) => {
    const [pathOnly, query = ""] = (req.url || "").split("?");
    if (pathOnly !== "/api/local-seo") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      if (!ctx?.searchApiKey) throw new Error("Local SEO is not available for this workspace yet.");
      if (!ctx?.apiKey) throw new Error("Local SEO analysis is not available for this workspace yet.");
      if (stream) {
        await streamLocalSeoJob(readJson(req), res, ctx);
        return;
      }
      const body = await readJson(req);
      const content = await runLocalSeoJob(body, () => {}, ctx);
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

async function streamLocalSeoJob(bodyPromise, res, ctx) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (payload) => writeSse(res, payload);
  try {
    const body = await bodyPromise;
    const content = await runLocalSeoJob(body, emit, ctx);
    emit({ type: "complete", content });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: sanitizeError(error.message) });
    res.end();
  }
}

export async function runLocalSeoJob(body, onProgress, ctx) {
  const parsed = parseLocalSeoBrief(body.message);
  if (!parsed.businessName) {
    throw new Error("Enter your business name after Business name: in the composer.");
  }
  if (!parsed.mapsUrl) {
    throw new Error("Paste your public Google Maps listing URL after Google Maps URL:.");
  }

  onProgress?.({
    type: "progress",
    phase: "local_seo",
    stage: "resolve",
    message: "Reading Maps link",
  });

  const resolvedUrl = await resolveGoogleMapsUrl(parsed.mapsUrl);
  const ids = parseGoogleMapsUrl(resolvedUrl);

  onProgress?.({
    type: "progress",
    phase: "local_seo",
    stage: "profile",
    message: "Fetching Business Profile",
  });

  let place = await loadPlaceProfile({
    apiKey: ctx.searchApiKey,
    ids,
    businessName: parsed.businessName,
    mapsUrl: resolvedUrl,
  });

  if (!place) {
    throw new Error(
      "We could not load this Google Maps listing. Check the URL opens the correct business, or try a link copied from “Share” on Google Maps.",
    );
  }

  const profile = summarizePlaceProfile(place, parsed.businessName, resolvedUrl);

  onProgress?.({
    type: "progress",
    phase: "local_seo",
    stage: "competitors",
    message: "Scanning nearby competitors",
  });

  const competitors = await findMapCompetitors({
    apiKey: ctx.searchApiKey,
    place,
    profile,
  });

  onProgress?.({
    type: "progress",
    phase: "local_seo",
    stage: "analysis",
    message: "Building audit and action plan",
  });

  const payload = {
    business_name_input: parsed.businessName,
    maps_url: resolvedUrl,
    profile,
    competitors,
    profile_gaps: computeProfileGaps(profile),
  };

  return synthesizeLocalSeoReport(payload, ctx);
}

async function loadPlaceProfile({ apiKey, ids, businessName, mapsUrl, location }) {
  if (ids.place_id || ids.data_id) {
    try {
      const place = await fetchGoogleMapsPlace({
        apiKey,
        place_id: ids.place_id,
        data_id: ids.data_id,
      });
      if (place) return place;
    } catch {
      // fall through to search
    }
  }

  const ll =
    ids.ll ||
    (ids.lat != null && ids.lng != null ? `@${ids.lat},${ids.lng},14z` : null);
  const queries = [
    businessName,
    businessName.split(/\s+/).slice(0, 4).join(" "),
  ].filter(Boolean);

  for (const q of queries) {
    try {
      const rows = await fetchGoogleMapsLocalSearch({
        apiKey,
        q,
        ll: ll || undefined,
      });
      const match = pickPlaceByName(rows, businessName);
      if (match?.place_id || match?.data_id) {
        return fetchGoogleMapsPlace({
          apiKey,
          place_id: match.place_id,
          data_id: match.data_id,
        });
      }
      if (match) return match;
    } catch {
      // try next query
    }
  }

  if (/google\.com\/maps/i.test(mapsUrl)) {
    const titleFromUrl = decodeURIComponent(mapsUrl.split("/place/")[1]?.split("/@")[0] || "")
      .replace(/\+/g, " ")
      .trim();
    if (titleFromUrl && titleFromUrl.length > 2) {
      const rows = await fetchGoogleMapsLocalSearch({
        apiKey,
        q: titleFromUrl,
        ll: ll || undefined,
      });
      const match = pickPlaceByName(rows, businessName) || rows[0];
      if (match?.place_id || match?.data_id) {
        return fetchGoogleMapsPlace({
          apiKey,
          place_id: match.place_id,
          data_id: match.data_id,
        });
      }
      if (match) return match;
    }
  }

  return null;
}

function pickPlaceByName(rows, businessName) {
  if (!rows?.length) return null;
  const needle = normalizeName(businessName);
  let best = null;
  let bestScore = 0;
  for (const row of rows) {
    const title = normalizeName(row.title || "");
    if (!title) continue;
    let score = 0;
    if (title === needle) score = 100;
    else if (title.includes(needle) || needle.includes(title)) score = 80;
    else {
      const tokens = needle.split(" ").filter((t) => t.length > 2);
      const hits = tokens.filter((t) => title.includes(t)).length;
      score = tokens.length ? Math.round((hits / tokens.length) * 70) : 0;
    }
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }
  return bestScore >= 40 ? best : rows[0];
}

async function findMapCompetitors({ apiKey, place, profile }) {
  const lat = place.gps_coordinates?.latitude ?? profile.gps?.lat;
  const lng = place.gps_coordinates?.longitude ?? profile.gps?.lng;
  if (lat == null || lng == null) return [];

  const ll = `@${lat},${lng},13z`;
  const category = profile.primary_category || "local business";
  const city = profile.city || "";
  const queries = [
    city ? `${category} ${city}` : category,
    category,
    profile.types?.[0] || category,
  ].filter(Boolean);

  const selfId = profile.place_id;
  const seen = new Set();
  const competitors = [];

  for (const q of [...new Set(queries)]) {
    try {
      const rows = await fetchGoogleMapsLocalSearch({ apiKey, q, ll });
      for (const row of rows) {
        const pid = row.place_id || row.data_id;
        if (!pid || pid === selfId || seen.has(pid)) continue;
        if (normalizeName(row.title) === normalizeName(profile.title)) continue;
        seen.add(pid);
        competitors.push(summarizeCompetitorRow(row));
        if (competitors.length >= MAX_COMPETITORS) break;
      }
    } catch {
      // continue
    }
    if (competitors.length >= MAX_COMPETITORS) break;
  }

  competitors.sort((a, b) => (b.reviews || 0) - (a.reviews || 0));
  return competitors.slice(0, MAX_COMPETITORS);
}

function summarizePlaceProfile(place, businessNameInput, mapsUrl) {
  const extensions = flattenExtensions(place.extensions);
  const reviewSamples = extractReviewList(place)
    .slice(0, 8)
    .map((row) => ({
      rating: row.rating ?? null,
      text: String(row.snippet || row.text || row.description || "").slice(0, 280),
      date: row.date || row.iso_date || "",
    }));

  const address = String(place.address || "").trim();
  return {
    title: String(place.title || businessNameInput).trim(),
    place_id: place.place_id || null,
    address,
    city: extractCityFromAddress(address),
    phone: place.phone || null,
    website: place.website || null,
    domain: place.domain || null,
    rating: place.rating ?? null,
    reviews: place.reviews ?? null,
    reviews_histogram: place.reviews_histogram || null,
    primary_category: place.type || place.types?.[0] || null,
    types: (place.types || []).slice(0, 6),
    open_state: place.open_state || null,
    hours: place.hours || null,
    open_hours: place.open_hours || null,
    price: place.price || place.price_description || null,
    description: String(place.description || "").slice(0, 500),
    gps: place.gps_coordinates || null,
    thumbnail: Boolean(place.thumbnail),
    image_count: Array.isArray(place.images) ? place.images.length : 0,
    has_posts: Boolean(place.posts?.length),
    post_count: place.posts?.length || 0,
    has_questions: Boolean(place.questions_and_answers),
    service_options: extensions.service || [],
    highlights: extensions.highlights || [],
    accessibility: extensions.accessibility || [],
    maps_url: mapsUrl,
    review_samples: reviewSamples,
  };
}

function summarizeCompetitorRow(row) {
  return {
    title: row.title || "—",
    place_id: row.place_id || null,
    address: row.address || "—",
    rating: row.rating ?? null,
    reviews: row.reviews ?? null,
    type: row.type || row.types?.[0] || "—",
    website: row.website || null,
    domain: row.domain || null,
    open_state: row.open_state || null,
    position: row.position ?? null,
  };
}

function computeProfileGaps(profile) {
  const gaps = [];
  if (!profile.website) gaps.push("missing_website");
  if (!profile.phone) gaps.push("missing_phone");
  if (!profile.description || profile.description.length < 80) gaps.push("thin_description");
  if (!profile.thumbnail && profile.image_count < 3) gaps.push("few_photos");
  if (!profile.has_posts) gaps.push("no_google_posts");
  if (!profile.open_hours) gaps.push("missing_hours");
  if (profile.reviews != null && profile.reviews < 25) gaps.push("low_review_count");
  if (profile.rating != null && profile.rating < 4.2) gaps.push("rating_below_4_2");
  if (!profile.service_options?.length) gaps.push("sparse_service_attributes");
  return gaps;
}

function extractReviewList(place) {
  const raw = place?.review_results ?? place?.reviews_data ?? place?.reviews_list;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && Array.isArray(raw.reviews)) return raw.reviews;
  return [];
}

function flattenExtensions(extensions) {
  const out = { service: [], highlights: [], accessibility: [] };
  for (const group of extensions || []) {
    const title = String(group.title || "").toLowerCase();
    const items = (group.items || []).map((item) => item.title || item.value).filter(Boolean);
    if (title.includes("service")) out.service.push(...items.slice(0, 12));
    else if (title.includes("highlight")) out.highlights.push(...items.slice(0, 8));
    else if (title.includes("access")) out.accessibility.push(...items.slice(0, 8));
  }
  return out;
}

function extractCityFromAddress(address) {
  const parts = String(address || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || "";
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function synthesizeLocalSeoReport(payload, ctx) {
  const route = modelForEffortTier("max");
  const model = route.model || CLAUDE_MODEL();

  const system = `You are Blazly's Local SEO (Google Maps) analyst. You audit a Google Business Profile using live Maps data and nearby competitor listings.

Never mention SearchAPI, Claude, Anthropic, or other vendors. Say "Google Maps", "Business Profile", "local pack", etc.

Rules:
- Ground every claim in the JSON dataset.
- Compare rating, review count, website, photos/posts, hours, categories, and attributes vs competitors.
- Call out quick wins (reviews, photos, posts, Q&A, categories, services) and structural gaps.
- Include 12–18 checklist items ordered by impact (highest first).

Output format (exactly, in this order):
1) Short intro (2–3 sentences) naming the business and market.
2) METRICS_START
Business|name
Maps listing|title from data
Rating|value or —
Review count|value or —
Primary category|value
Website|domain or Missing
Competitors analyzed|count
Your rank vs competitors (reviews)|sentence comparing review volume
METRICS_END
3) CARD_START|Profile strengths
3–6 rows: Strength|Why it helps local SEO CARD_END
4) CARD_START|Profile gaps & risks
3–8 rows: Gap|Impact and fix CARD_END
5) TABLE_START
Competitor|Rating|Reviews|Category|Website|Notes
One row per competitor; Notes = 1 short sentence on why they outrank or match the user TABLE_END
6) CARD_START|Competitor patterns to borrow
3–5 rows: Pattern|Tactic grounded in competitor data CARD_END
7) CHECKLIST_START
pending|Verb-first actionable step for Google Maps / local SEO
…12–18 items…
CHECKLIST_END
8) One closing paragraph (2 sentences) on priorities for the next 30 days.

No markdown tables. Use TABLE_START/TABLE_END pipe format only.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ctx.apiKey,
      "anthropic-version": "2023-06-01",
      ...(ctx.workspaceId ? { "anthropic-workspace-id": ctx.workspaceId } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system,
      messages: [{ role: "user", content: JSON.stringify(payload, null, 2).slice(0, 52000) }],
    }),
    signal: AbortSignal.timeout(300_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "Could not complete local SEO analysis.");
  }

  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Local SEO analysis returned empty content.");
  return text;
}

function parseLocalSeoBrief(message) {
  const raw = String(message || "").replace(/\r\n/g, "\n").trim();
  let businessName = "";
  let mapsUrl = "";

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const nameMatch = trimmed.match(/^business\s*name\s*:\s*(.+)$/i);
    if (nameMatch) {
      businessName = nameMatch[1].trim();
      continue;
    }
    const urlMatch =
      trimmed.match(/^google\s*maps\s*url\s*:\s*(.+)$/i) ||
      trimmed.match(/^maps\s*url\s*:\s*(.+)$/i);
    if (urlMatch) {
      mapsUrl = urlMatch[1].trim();
    }
  }

  if (!mapsUrl) {
    const urlInText = raw.match(/https?:\/\/[^\s<>"']*(google\.com\/maps|maps\.app\.goo\.gl|goo\.gl\/maps)[^\s<>"']*/i);
    if (urlInText) mapsUrl = urlInText[0];
  }

  if (!businessName && raw && !/^business\s*name\s*:/im.test(raw)) {
    const first = raw.split("\n")[0]?.trim();
    if (first && !/^https?:\/\//i.test(first)) businessName = first;
  }

  return {
    businessName: businessName.slice(0, 120),
    mapsUrl: mapsUrl.slice(0, 2000),
  };
}

function sanitizeError(message) {
  return String(message || "Local SEO failed.")
    .replace(/searchapi/gi, "search provider")
    .replace(/anthropic|claude/gi, "assistant");
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}


function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
