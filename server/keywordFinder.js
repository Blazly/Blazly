import { readJson } from "./readJson.js";
import { dataforseoPost } from "./dataforseo.js";

const LABS_LOCALE = { location_code: 2840, language_code: "en" };

export function attachKeywordFinder(server, { dataForSeo }) {
  server.middlewares.use(async (req, res, next) => {
    const [pathOnly, query = ""] = (req.url || "").split("?");
    if (pathOnly !== "/api/keyword-finder") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      const body = await readJson(req);
      if (!dataForSeo?.login || !dataForSeo?.password) {
        throw new Error("Keyword research is not available for this workspace yet.");
      }
      if (stream) {
        await streamKeywordFinderJob(body, res, dataForSeo);
        return;
      }
      const content = await runKeywordFinderJob(body, () => {}, dataForSeo);
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

async function streamKeywordFinderJob(body, res, config) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (payload) => writeSse(res, payload);
  try {
    const content = await runKeywordFinderJob(body, emit, config);
    emit({ type: "complete", content });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: sanitizeError(error.message) });
    res.end();
  }
}

export async function runKeywordFinderJob(body, onProgress, config) {
  const keyword = parseKeywordInput(body.message, body.keyword);
  if (!keyword) {
    throw new Error("Enter a keyword in the composer (Keyword:) to analyze search demand.");
  }

  onProgress?.({
    type: "progress",
    phase: "keyword",
    stage: "global",
    message: `Checking worldwide volume for “${keyword.slice(0, 48)}”`,
  });

  const globalVolume = await fetchGlobalSearchVolume(keyword, config);

  onProgress?.({
    type: "progress",
    phase: "keyword",
    stage: "overview",
    message: "Pulling difficulty and search trend",
  });

  const overview = await fetchKeywordOverview(keyword, config);
  const primaryDifficulty = await fetchBulkKeywordDifficulty([keyword], config);

  onProgress?.({
    type: "progress",
    phase: "keyword",
    stage: "related",
    message: "Finding related keywords",
  });

  const suggestions = await fetchKeywordSuggestions(keyword, config);
  const relatedKeywords = suggestions
    .filter((row) => row.keyword.toLowerCase() !== keyword.toLowerCase())
    .slice(0, 28);

  const difficultyMap = await fetchBulkKeywordDifficulty(
    [keyword, ...relatedKeywords.map((row) => row.keyword)].slice(0, 40),
    config,
  );

  const monthlyTrend = normalizeMonthlyTrend(overview?.keyword_info?.monthly_searches);
  const competition = overview?.keyword_info?.competition_level || overview?.keyword_info?.competition || "—";
  const difficultyScore = difficultyMap.get(keyword.toLowerCase()) ?? primaryDifficulty.get(keyword.toLowerCase());

  const relatedRows = relatedKeywords
    .map((row) => ({
      keyword: row.keyword,
      search_volume: row.search_volume,
      difficulty: difficultyMap.get(row.keyword.toLowerCase()) ?? row.keyword_difficulty,
    }))
    .sort((a, b) => (b.search_volume || 0) - (a.search_volume || 0));

  return formatKeywordFinderReply({
    keyword,
    globalVolume: globalVolume?.search_volume,
    difficultyScore,
    competition,
    monthlyTrend,
    relatedRows,
  });
}

function parseKeywordInput(message, explicit) {
  const fromBody = String(explicit || "").trim();
  if (fromBody) return fromBody.slice(0, 120);

  const raw = String(message || "").trim();
  for (const line of raw.split("\n")) {
    const match = line.trim().match(/^keyword\s*:\s*(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim().slice(0, 120);
  }

  if (raw && !/^keyword\s*:/im.test(raw)) {
    const first = raw.split("\n")[0]?.trim();
    if (first && first.length >= 2) return first.slice(0, 120);
  }
  return "";
}

async function fetchGlobalSearchVolume(keyword, config) {
  const raw = await dataforseoPost({
    login: config.login,
    password: config.password,
    path: "/v3/keywords_data/clickstream_data/global_search_volume/live",
    tasks: [{ keywords: [keyword] }],
  });
  const task = raw?.tasks?.[0];
  if (task?.status_code !== 20000) {
    throw new Error(task?.status_message || "Could not load worldwide search volume.");
  }
  return task.result?.[0]?.items?.[0] || null;
}

async function fetchKeywordOverview(keyword, config) {
  const raw = await dataforseoPost({
    login: config.login,
    password: config.password,
    path: "/v3/dataforseo_labs/google/keyword_overview/live",
    tasks: [{ keywords: [keyword], ...LABS_LOCALE }],
  });
  const task = raw?.tasks?.[0];
  if (task?.status_code !== 20000) return null;
  return task.result?.[0]?.items?.[0] || null;
}

async function fetchKeywordSuggestions(keyword, config) {
  const raw = await dataforseoPost({
    login: config.login,
    password: config.password,
    path: "/v3/dataforseo_labs/google/keyword_suggestions/live",
    tasks: [{ keyword, limit: 35, ...LABS_LOCALE }],
  });
  const task = raw?.tasks?.[0];
  if (task?.status_code !== 20000) return [];
  const items = task.result?.[0]?.items || [];
  return items.map((item) => ({
    keyword: item.keyword,
    search_volume: item.keyword_info?.search_volume ?? null,
    keyword_difficulty: item.keyword_properties?.keyword_difficulty ?? null,
    competition: item.keyword_info?.competition_level ?? item.keyword_info?.competition,
  }));
}

async function fetchBulkKeywordDifficulty(keywords, config) {
  const list = [...new Set(keywords.map((k) => String(k || "").trim()).filter(Boolean))].slice(0, 40);
  if (!list.length) return new Map();

  const raw = await dataforseoPost({
    login: config.login,
    password: config.password,
    path: "/v3/dataforseo_labs/google/bulk_keyword_difficulty/live",
    tasks: [{ keywords: list, ...LABS_LOCALE }],
  });
  const task = raw?.tasks?.[0];
  const map = new Map();
  if (task?.status_code !== 20000) return map;
  for (const item of task.result?.[0]?.items || []) {
    if (item.keyword != null && item.keyword_difficulty != null) {
      map.set(String(item.keyword).toLowerCase(), Number(item.keyword_difficulty));
    }
  }
  return map;
}

function normalizeMonthlyTrend(monthly) {
  if (!Array.isArray(monthly) || !monthly.length) return [];
  const sorted = [...monthly].sort((a, b) => {
    const ay = Number(a.year) || 0;
    const by = Number(b.year) || 0;
    if (ay !== by) return ay - by;
    return (Number(a.month) || 0) - (Number(b.month) || 0);
  });
  return sorted.slice(-6).map((entry) => ({
    label: monthLabel(entry.year, entry.month),
    value: Number(entry.search_volume) || 0,
  }));
}

function monthLabel(year, month) {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const m = Number(month);
  const y = Number(year);
  if (m >= 1 && m <= 12) return `${names[m - 1]} ${y}`;
  return `${year}-${month}`;
}

function formatKeywordFinderReply({
  keyword,
  globalVolume,
  difficultyScore,
  competition,
  monthlyTrend,
  relatedRows,
}) {
  const lines = [];
  lines.push(
    `Here’s search demand for “${keyword}”: worldwide volume, keyword difficulty, a six-month trend, and related terms with volume and difficulty.`,
  );
  lines.push("");
  lines.push("METRICS_START");
  lines.push(`Keyword|${keyword}`);
  lines.push(`Worldwide monthly searches|${formatInteger(globalVolume)}`);
  lines.push(`Keyword difficulty|${formatDifficulty(difficultyScore)}`);
  lines.push(`Competition|${formatCompetition(competition)}`);
  lines.push("METRICS_END");
  lines.push("");

  if (monthlyTrend.length) {
    lines.push("CHART_START|Search trend — last 6 months");
    for (const point of monthlyTrend) {
      lines.push(`${point.label}|${point.value}`);
    }
    lines.push("CHART_END");
    lines.push("");
  }

  lines.push("TABLE_START");
  lines.push("Related keyword|Monthly searches|Difficulty");
  for (const row of relatedRows) {
    lines.push(
      `${row.keyword}|${formatInteger(row.search_volume)}|${formatDifficulty(row.difficulty)}`,
    );
  }
  lines.push("TABLE_END");

  return lines.join("\n");
}

function formatInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

function formatDifficulty(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)} / 100`;
}

function formatCompetition(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "number") {
    if (value <= 0.33) return "LOW";
    if (value <= 0.66) return "MEDIUM";
    return "HIGH";
  }
  return String(value).toUpperCase();
}

function sanitizeError(message) {
  return String(message || "Keyword analysis failed.")
    .replace(/dataforseo/gi, "keyword data")
    .replace(/\bDataForSEO\b/g, "keyword data");
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}


function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
