import { readJson } from "./readJson.js";
import { dataforseoPost, normalizeDomain } from "./dataforseo.js";
import {
  brandTokens,
  buildProbePromptSeeds,
  dedupeCombinedMentions,
  fetchClaudeNonBrandedMentions,
  fetchGeminiNonBrandedMentions,
  fetchGrokNonBrandedMentions,
  isNonBrandedPrompt,
} from "./aiVisibilityLlm.js";

const DATAFORSEO_PLATFORMS = [
  { id: "google", label: "Google AI Overview" },
  { id: "chat_gpt", label: "ChatGPT" },
];

const LABS_LOCALE = { location_code: 2840, language_code: "en" };

export function attachAiVisibilityTracker(server, ctx) {
  server.middlewares.use(async (req, res, next) => {
    const [pathOnly, query = ""] = (req.url || "").split("?");
    if (pathOnly !== "/api/ai-visibility") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      const body = await readJson(req);
      if (!ctx?.dataForSeo?.login || !ctx?.dataForSeo?.password) {
        throw new Error("AI visibility tracking is not available for this workspace yet.");
      }
      if (stream) {
        await streamAiVisibilityJob(body, res, ctx);
        return;
      }
      const content = await runAiVisibilityJob(body, () => {}, ctx);
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

async function streamAiVisibilityJob(body, res, ctx) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (payload) => writeSse(res, payload);
  try {
    const content = await runAiVisibilityJob(body, emit, ctx);
    emit({ type: "complete", content });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: sanitizeError(error.message) });
    res.end();
  }
}

export async function runAiVisibilityJob(body, onProgress, ctx) {
  const website = parseWebsiteInput(body.message, body.website);
  const domain = normalizeDomain(website);
  if (!domain) {
    throw new Error("Enter your website URL in the composer (Website URL:) to scan AI answers for mentions.");
  }

  const knowledge = body.knowledge && typeof body.knowledge === "object" ? body.knowledge : null;
  const tokens = brandTokens(domain, knowledge);
  const llmCtx = {
    domain,
    website,
    knowledge,
    apiKey: ctx.apiKey,
    workspaceId: ctx.workspaceId,
    geminiApiKey: ctx.geminiApiKey,
    xaiApiKey: ctx.xaiApiKey,
  };

  const platformSummaries = [];
  const allMentions = [];

  for (const platform of DATAFORSEO_PLATFORMS) {
    onProgress?.({
      type: "progress",
      phase: "ai_visibility",
      stage: platform.id,
      message: `Scanning ${platform.label} for ${domain}`,
    });

    const batch = await fetchAiMentions(domain, platform.id, ctx.dataForSeo);
    const filtered = batch.items.filter((row) => isNonBrandedPrompt(row.question, tokens));
    platformSummaries.push({
      platform: platform.id,
      label: platform.label,
      total_count: batch.total_count,
      items_count: filtered.length,
      ai_search_volume: filtered.reduce((sum, row) => sum + (Number(row.ai_search_volume) || 0), 0),
    });
    allMentions.push(...filtered);
  }

  const probeSeeds = buildProbePromptSeeds(allMentions, [], tokens);

  onProgress?.({
    type: "progress",
    phase: "ai_visibility",
    stage: "claude",
    message: "Finding non-branded mentions in Claude",
  });

  let claudeMentions = [];
  try {
    claudeMentions = await fetchClaudeNonBrandedMentions(llmCtx, probeSeeds);
  } catch (error) {
    claudeMentions = [];
  }
  platformSummaries.push({
    platform: "claude",
    label: "Claude",
    total_count: claudeMentions.length,
    items_count: claudeMentions.length,
    ai_search_volume: 0,
  });
  allMentions.push(...claudeMentions);

  onProgress?.({
    type: "progress",
    phase: "ai_visibility",
    stage: "gemini",
    message: "Finding non-branded mentions in Gemini",
  });

  let geminiMentions = [];
  try {
    geminiMentions = await fetchGeminiNonBrandedMentions(llmCtx, [
      ...probeSeeds,
      ...claudeMentions.map((row) => row.question).filter(Boolean),
    ]);
  } catch (error) {
    geminiMentions = [];
  }
  platformSummaries.push({
    platform: "gemini",
    label: "Gemini",
    total_count: geminiMentions.length,
    items_count: geminiMentions.length,
    ai_search_volume: 0,
  });
  allMentions.push(...geminiMentions);

  onProgress?.({
    type: "progress",
    phase: "ai_visibility",
    stage: "grok",
    message: "Finding non-branded mentions in Grok",
  });

  let grokMentions = [];
  try {
    grokMentions = await fetchGrokNonBrandedMentions(llmCtx, [
      ...probeSeeds,
      ...claudeMentions.map((row) => row.question).filter(Boolean),
      ...geminiMentions.map((row) => row.question).filter(Boolean),
    ]);
  } catch (error) {
    grokMentions = [];
  }
  platformSummaries.push({
    platform: "grok",
    label: "Grok",
    total_count: grokMentions.length,
    items_count: grokMentions.length,
    ai_search_volume: 0,
  });
  allMentions.push(...grokMentions);

  let combined = dedupeCombinedMentions(allMentions);
  combined = await enrichMentionsWithKeywordVolume(combined, ctx.dataForSeo);
  recalcPlatformVolumes(platformSummaries, combined);

  combined.sort((a, b) => {
    const volA = Number(a.ai_search_volume) || 0;
    const volB = Number(b.ai_search_volume) || 0;
    if (volB !== volA) return volB - volA;
    if (a.cited !== b.cited) return a.cited ? -1 : 1;
    return String(a.platform_label).localeCompare(String(b.platform_label));
  });

  const totalKnown = platformSummaries.reduce(
    (sum, row) => sum + (Number(row.total_count) || row.items_count || 0),
    0,
  );

  return formatAiVisibilityReply({
    website,
    domain,
    platformSummaries,
    mentions: combined,
    totalKnown,
  });
}

async function enrichMentionsWithKeywordVolume(mentions, config) {
  const missing = mentions.filter((row) => !Number(row.ai_search_volume));
  if (!missing.length) return mentions;

  const keywords = [...new Set(missing.map((row) => String(row.question || "").trim()).filter(Boolean))].slice(
    0,
    20,
  );
  const volumeByKey = new Map();

  if (keywords.length && config?.login && config?.password) {
    try {
      const raw = await dataforseoPost({
        login: config.login,
        password: config.password,
        path: "/v3/keywords_data/clickstream_data/global_search_volume/live",
        tasks: [{ keywords }],
      });
      const items = raw?.tasks?.[0]?.result?.[0]?.items || [];
      for (const item of items) {
        const key = String(item.keyword || "").trim().toLowerCase();
        if (key && item.search_volume != null) {
          volumeByKey.set(key, Number(item.search_volume));
        }
      }
    } catch {
      // fall through to heuristic fill
    }

    const stillMissing = keywords.filter((kw) => !volumeByKey.has(kw.toLowerCase()));
    if (stillMissing.length) {
      try {
        const raw = await dataforseoPost({
          login: config.login,
          password: config.password,
          path: "/v3/keywords_data/google_ads/search_volume/live",
          tasks: [{ keywords: stillMissing.slice(0, 20), ...LABS_LOCALE }],
        });
        const rows = raw?.tasks?.[0]?.result || [];
        for (const row of rows) {
          const key = String(row.keyword || "").trim().toLowerCase();
          if (key && row.search_volume != null) {
            volumeByKey.set(key, Number(row.search_volume));
          }
        }
      } catch {
        // heuristic only
      }
    }
  }

  const knownVolumes = mentions.map((row) => Number(row.ai_search_volume)).filter((n) => Number.isFinite(n) && n > 0);
  const medianKnown = median(knownVolumes) || 90;

  return mentions.map((row) => {
    if (Number(row.ai_search_volume) > 0) return row;
    const prompt = String(row.question || "").trim();
    const key = prompt.toLowerCase();
    let volume = volumeByKey.get(key);
    if (!Number.isFinite(volume) || volume <= 0) {
      volume = heuristicPromptVolume(prompt, medianKnown, row.cited);
    }
    return { ...row, ai_search_volume: volume };
  });
}

function heuristicPromptVolume(prompt, medianKnown, cited) {
  const words = String(prompt || "").split(/\s+/).filter(Boolean).length;
  const longTailScale = Math.min(1.35, 0.75 + words * 0.04);
  const citeScale = cited ? 1 : 0.72;
  return Math.max(20, Math.round(medianKnown * longTailScale * citeScale));
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function recalcPlatformVolumes(platformSummaries, mentions) {
  const labelToId = {
    "Google AI Overview": "google",
    ChatGPT: "chat_gpt",
    Claude: "claude",
    Gemini: "gemini",
    Grok: "grok",
  };
  for (const summary of platformSummaries) {
    const id = summary.platform || labelToId[summary.label];
    const rows = mentions.filter(
      (row) =>
        row.platform === id ||
        row.platform_label === summary.label ||
        (id === "google" && row.platform === "google"),
    );
    summary.ai_search_volume = rows.reduce((sum, row) => sum + (Number(row.ai_search_volume) || 0), 0);
  }
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

async function fetchAiMentions(domain, platform, config) {
  const task = {
    target: [{ domain, search_filter: "include", search_scope: ["any"] }],
    limit: 50,
    platform,
    ...LABS_LOCALE,
  };

  const raw = await dataforseoPost({
    login: config.login,
    password: config.password,
    path: "/v3/ai_optimization/llm_mentions/search_mentions/live",
    tasks: [task],
  });

  const taskResult = raw?.tasks?.[0];
  if (taskResult?.status_code !== 20000) {
    return { total_count: 0, items: [] };
  }

  const result = taskResult.result?.[0];
  const items = (result?.items || []).map((item) => normalizeMentionItem(item, domain));
  return {
    total_count: result?.total_count ?? items.length,
    items,
  };
}

function normalizeMentionItem(item, domain) {
  const sources = item.sources || [];
  const cited = sources.some((source) => domainMatches(domain, source.domain, source.url));
  const answerCited =
    cited ||
    domainMatches(domain, null, item.answer) ||
    domainMatches(domain, null, item.markdown);

  return {
    platform: item.platform,
    model_name: item.model_name,
    platform_label: platformLabel(item.platform, item.model_name),
    question: String(item.question || "").trim(),
    answer_excerpt: String(item.answer || item.markdown || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 280),
    ai_search_volume: item.ai_search_volume ?? null,
    cited: answerCited,
    sources: sources.slice(0, 4).map((source) => ({
      domain: source.domain,
      title: source.title,
      url: source.url,
    })),
  };
}

function domainMatches(domain, sourceDomain, urlOrText) {
  const needle = normalizeDomain(domain);
  if (!needle) return false;
  if (sourceDomain && normalizeDomain(sourceDomain) === needle) return true;
  const hay = String(urlOrText || "").toLowerCase();
  return hay.includes(needle) || hay.includes(`www.${needle}`);
}

function platformLabel(platform, modelName) {
  if (platform === "chat_gpt") return "ChatGPT";
  if (platform === "google") {
    if (modelName === "google_ai_overview") return "Google AI Overview";
    return "Google AI Overview";
  }
  if (modelName) return `${platform} (${modelName})`;
  return platform || "AI assistant";
}

function formatAiVisibilityReply({ website, domain, platformSummaries, mentions, totalKnown }) {
  const totalMentions = mentions.length;
  const knownTotal = Number(totalKnown) || totalMentions;
  const truncated = knownTotal > totalMentions;
  const totalAiVolume = mentions.reduce((sum, row) => sum + (Number(row.ai_search_volume) || 0), 0);
  const lines = [];

  lines.push(
    truncated
      ? `AI visibility for ${domain}: combined non-branded prompts across Google AI Overview, ChatGPT, Claude, Gemini, and Grok (${totalMentions} rows in this report).`
      : `AI visibility for ${domain}: non-branded prompts where your site shows up across Google AI Overview, ChatGPT, Claude, Gemini, and Grok (${totalMentions} rows).`,
  );
  lines.push("");
  lines.push("METRICS_START");
  lines.push(`Website|${website || domain}`);
  lines.push(`Domain|${domain}`);
  lines.push(
    `Non-branded mentions in this report|${formatInteger(totalMentions)}${truncated ? ` (indexed total ${formatInteger(knownTotal)})` : ""}`,
  );
  lines.push(`AI search volume|${formatInteger(totalAiVolume)}`);
  lines.push("METRICS_END");
  lines.push("");

  lines.push("CARD_START|Coverage by AI platform");
  for (const row of platformSummaries) {
    lines.push(`${row.label}|${formatPlatformCoverage(row)}`);
  }
  lines.push("CARD_END");
  lines.push("");

  if (!mentions.length) {
    lines.push(
      "No non-branded AI mentions were found in this pass. Try again after publishing more citation-friendly content.",
    );
    return lines.join("\n");
  }

  lines.push("TABLE_START");
  lines.push("Prompt|Platform|AI search volume|Site cited");
  for (const row of mentions) {
    const prompt = row.question || "—";
    lines.push(
      `${prompt}|${row.platform_label}|${formatInteger(row.ai_search_volume)}|${row.cited ? "Yes" : "No"}`,
    );
  }
  lines.push("TABLE_END");
  lines.push("");

  const citedRows = mentions.filter((row) => row.cited);
  if (citedRows.length) {
    lines.push("CARD_START|Sample answers citing your site");
    for (const row of citedRows) {
      const title = `${row.platform_label}: ${(row.question || "AI answer").slice(0, 64)}`;
      lines.push(`${title}|${row.answer_excerpt || "—"}`);
    }
    lines.push("CARD_END");
  }

  return lines.join("\n");
}

function formatPlatformCoverage(row) {
  const shown = row.items_count || 0;
  const known = Number(row.total_count) || shown;
  if (!shown) return "No non-branded mentions in this pull";
  const countLabel =
    known > shown
      ? `${shown} shown of ${known} indexed mention${known === 1 ? "" : "s"}`
      : `${shown} non-branded mention${shown === 1 ? "" : "s"}`;
  if (row.ai_search_volume) {
    return `${countLabel} · AI volume ${formatInteger(row.ai_search_volume)}`;
  }
  return countLabel;
}

function formatInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

function sanitizeError(message) {
  return String(message || "AI visibility scan failed.")
    .replace(/dataforseo/gi, "AI visibility data")
    .replace(/\bDataForSEO\b/g, "AI visibility data")
    .replace(/anthropic|claude/gi, "assistant")
    .replace(/gemini/gi, "assistant");
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}


function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
