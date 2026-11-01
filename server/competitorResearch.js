import { readJson } from "./readJson.js";
import {
  dataforseoPost,
  executeDataForSeoTool,
  normalizeDomain,
} from "./dataforseo.js";
import {
  brandTokens,
  fetchClaudeNonBrandedMentions,
  fetchGeminiNonBrandedMentions,
  fetchGrokNonBrandedMentions,
  isNonBrandedPrompt,
} from "./aiVisibilityLlm.js";
import { modelForEffortTier } from "./modelRouter.js";

const LABS_LOCALE = { location_code: 2840, language_code: "en" };
const CLAUDE_MODEL = () => process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
const DATAFORSEO_PLATFORMS = [
  { id: "google", label: "Google AI Overview" },
  { id: "chat_gpt", label: "ChatGPT" },
];

export function attachCompetitorResearch(server, ctx) {
  server.middlewares.use(async (req, res, next) => {
    const [pathOnly, query = ""] = (req.url || "").split("?");
    if (pathOnly !== "/api/competitor-research") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      const body = await readJson(req);
      if (!ctx?.apiKey) throw new Error("The assistant is not configured.");
      if (!ctx?.dataForSeo?.login || !ctx?.dataForSeo?.password) {
        throw new Error("Competitor research is not available for this workspace yet.");
      }
      if (stream) {
        await streamCompetitorJob(body, res, ctx);
        return;
      }
      const content = await runCompetitorResearchJob(body, () => {}, ctx);
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

async function streamCompetitorJob(body, res, ctx) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (payload) => writeSse(res, payload);
  try {
    const content = await runCompetitorResearchJob(body, emit, ctx);
    emit({ type: "complete", content });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: sanitizeError(error.message) });
    res.end();
  }
}

export async function runCompetitorResearchJob(body, onProgress, ctx) {
  const parsed = parseCompetitorBrief(body.message, body.website, body.knowledge);
  const userDomain = normalizeDomain(parsed.website);
  if (!userDomain) {
    throw new Error(
      "Set your website in project settings or add Website URL: in the composer so we can compare you against competitors.",
    );
  }

  const competitorDomains = parsed.competitors.map(normalizeDomain).filter(Boolean);
  const uniqueCompetitors = [...new Set(competitorDomains.filter((d) => d !== userDomain))].slice(0, 5);
  if (!uniqueCompetitors.length) {
    throw new Error(
      "Add at least one competitor website URL (one per line or comma-separated after Competitor website URL:).",
    );
  }

  const knowledge = body.knowledge && typeof body.knowledge === "object" ? body.knowledge : null;
  const brandName =
    String(knowledge?.companyName || "").trim() ||
    userDomain.replace(/^www\./, "").split(".")[0] ||
    userDomain;

  const profiles = [];

  onProgress?.({
    type: "progress",
    phase: "competitor_research",
    stage: "your_site",
    message: `SEO and AI signals for ${userDomain}`,
  });
  profiles.push(
    await buildDomainProfile({
      domain: userDomain,
      role: "your_site",
      label: brandName,
      website: parsed.website,
      isUser: true,
      knowledge,
      ctx,
      onProgress,
    }),
  );

  for (const domain of uniqueCompetitors) {
    onProgress?.({
      type: "progress",
      phase: "competitor_research",
      stage: "competitor",
      message: `Analyzing ${domain}`,
    });
    profiles.push(
      await buildDomainProfile({
        domain,
        role: "competitor",
        label: domain,
        website: `https://${domain}`,
        isUser: false,
        knowledge: null,
        ctx,
        onProgress,
      }),
    );
  }

  onProgress?.({
    type: "progress",
    phase: "competitor_research",
    stage: "synthesis",
    message: "Building comparison and action plan",
  });

  const reply = await synthesizeCompetitorReport(
    {
      brandName,
      userDomain,
      userWebsite: parsed.website || `https://${userDomain}`,
      knowledge,
      userMessage: String(body.message || "").trim(),
      competitors: uniqueCompetitors,
      profiles,
    },
    ctx,
  );

  return reply;
}

async function buildDomainProfile({ domain, role, label, website, isUser, knowledge, ctx, onProgress }) {
  const seo = await fetchSeoMetrics(domain, ctx.dataForSeo);
  const aiIndexed = await fetchIndexedAiVisibility(domain, ctx.dataForSeo, onProgress);

  let agentAi = { claude: 0, gemini: 0, grok: 0, sample_prompts: [] };
  if (isUser || role === "competitor") {
    onProgress?.({
      type: "progress",
      phase: "competitor_research",
      stage: isUser ? "agent_ai_user" : "agent_ai_competitor",
      message: `AI assistant visibility for ${domain}`,
    });
    agentAi = await fetchAgentAiVisibility({
      domain,
      website,
      knowledge: isUser ? knowledge : null,
      ctx,
      seedMentions: aiIndexed.mentions,
    });
  }

  const platformTotals = summarizePlatforms(aiIndexed.platformSummaries, agentAi);
  const totalAiMentions =
    platformTotals.google +
    platformTotals.chat_gpt +
    platformTotals.claude +
    platformTotals.gemini +
    platformTotals.grok;
  const citedCount = aiIndexed.citedCount + agentAi.citedCount;

  return {
    domain,
    role,
    label,
    website,
    seo,
    ai: {
      indexed: aiIndexed,
      agent: agentAi,
      platformTotals,
      totalMentions: totalAiMentions,
      citedMentions: citedCount,
      aiSearchVolume: aiIndexed.aiSearchVolume,
    },
    topKeywords: seo.topKeywords || [],
  };
}

async function fetchSeoMetrics(domain, config) {
  const profile = {
    domain,
    domainRank: null,
    referringDomains: null,
    backlinks: null,
    organicKeywords: null,
    organicTrafficEtv: null,
    topKeywords: [],
    notes: [],
  };

  try {
    const raw = await executeDataForSeoTool(
      "dataforseo_backlinks_summary_live",
      { target: domain },
      config,
    );
    const data = JSON.parse(raw);
    profile.domainRank = data.rank ?? null;
    profile.referringDomains = data.referring_domains ?? null;
    profile.backlinks = data.backlinks ?? null;
  } catch {
    profile.notes.push("Search authority summary unavailable.");
  }

  try {
    const raw = await dataforseoPost({
      login: config.login,
      password: config.password,
      path: "/v3/dataforseo_labs/google/domain_rank_overview/live",
      tasks: [{ target: domain, ...LABS_LOCALE }],
    });
    const item = raw?.tasks?.[0]?.result?.[0]?.items?.[0] || raw?.tasks?.[0]?.result?.[0];
    const organic = item?.metrics?.organic || item?.organic || {};
    profile.organicKeywords = organic.count ?? item?.organic?.count ?? null;
    profile.organicTrafficEtv = organic.etv ?? item?.organic?.etv ?? null;
  } catch {
    profile.notes.push("Organic keyword footprint unavailable.");
  }

  try {
    const raw = await dataforseoPost({
      login: config.login,
      password: config.password,
      path: "/v3/dataforseo_labs/google/ranked_keywords/live",
      tasks: [
        {
          target: domain,
          limit: 8,
          order_by: ["keyword_data.keyword_info.search_volume,desc"],
          ...LABS_LOCALE,
        },
      ],
    });
    const items = raw?.tasks?.[0]?.result?.[0]?.items || [];
    profile.topKeywords = items.slice(0, 6).map((row) => ({
      keyword: row.keyword_data?.keyword || row.keyword,
      position: row.ranked_serp_element?.serp_item?.rank_group ?? row.rank_group,
      search_volume: row.keyword_data?.keyword_info?.search_volume ?? row.search_volume,
    }));
  } catch {
    // optional
  }

  return profile;
}

async function fetchIndexedAiVisibility(domain, config, onProgress) {
  const platformSummaries = [];
  const mentions = [];
  let citedCount = 0;
  let aiSearchVolume = 0;
  const tokens = brandTokens(domain, null);

  for (const platform of DATAFORSEO_PLATFORMS) {
    onProgress?.({
      type: "progress",
      phase: "competitor_research",
      stage: platform.id,
      message: `${platform.label} mentions for ${domain}`,
    });
    try {
      const batch = await fetchAiMentions(domain, platform.id, config);
      const filtered = batch.items.filter((row) => isNonBrandedPrompt(row.question, tokens));
      platformSummaries.push({
        platform: platform.id,
        label: platform.label,
        total_count: batch.total_count,
        items_count: filtered.length,
        ai_search_volume: filtered.reduce((sum, row) => sum + (Number(row.ai_search_volume) || 0), 0),
      });
      for (const row of filtered) {
        mentions.push(row);
        if (row.cited) citedCount += 1;
        aiSearchVolume += Number(row.ai_search_volume) || 0;
      }
    } catch {
      platformSummaries.push({
        platform: platform.id,
        label: platform.label,
        total_count: 0,
        items_count: 0,
        ai_search_volume: 0,
      });
    }
  }

  return {
    platformSummaries,
    mentions: mentions.slice(0, 20),
    citedCount,
    aiSearchVolume,
  };
}

async function fetchAgentAiVisibility({ domain, website, knowledge, ctx, seedMentions }) {
  const llmCtx = {
    domain,
    website,
    knowledge,
    apiKey: ctx.apiKey,
    workspaceId: ctx.workspaceId,
    geminiApiKey: ctx.geminiApiKey,
    xaiApiKey: ctx.xaiApiKey,
  };
  const seeds = seedMentions.map((row) => row.question).filter(Boolean).slice(0, 8);

  const counts = { claude: 0, gemini: 0, grok: 0, citedCount: 0, sample_prompts: [] };

  const tasks = [];
  if (ctx.apiKey) {
    tasks.push(
      fetchClaudeNonBrandedMentions(llmCtx, seeds)
        .then((rows) => {
          counts.claude = rows.length;
          appendSamples(counts, rows);
        })
        .catch(() => {}),
    );
  }
  if (ctx.geminiApiKey) {
    tasks.push(
      fetchGeminiNonBrandedMentions(llmCtx, seeds)
        .then((rows) => {
          counts.gemini = rows.length;
          appendSamples(counts, rows);
        })
        .catch(() => {}),
    );
  }
  if (ctx.xaiApiKey) {
    tasks.push(
      fetchGrokNonBrandedMentions(llmCtx, seeds)
        .then((rows) => {
          counts.grok = rows.length;
          appendSamples(counts, rows);
        })
        .catch(() => {}),
    );
  }

  await Promise.all(tasks);
  return counts;
}

function appendSamples(counts, rows) {
  for (const row of rows.slice(0, 4)) {
    if (counts.sample_prompts.length >= 6) break;
    counts.sample_prompts.push({
      platform: row.platform_label,
      prompt: row.question,
      cited: row.cited,
      excerpt: row.answer_excerpt,
    });
    if (row.cited) counts.citedCount += 1;
  }
}

function summarizePlatforms(indexedSummaries, agentAi) {
  const totals = {
    google: 0,
    chat_gpt: 0,
    claude: agentAi.claude || 0,
    gemini: agentAi.gemini || 0,
    grok: agentAi.grok || 0,
  };
  for (const row of indexedSummaries) {
    if (row.platform === "google") totals.google = row.items_count || 0;
    if (row.platform === "chat_gpt") totals.chat_gpt = row.items_count || 0;
  }
  return totals;
}

async function fetchAiMentions(domain, platform, config) {
  const task = {
    target: [{ domain, search_filter: "include", search_scope: ["any"] }],
    limit: 40,
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
  const cited =
    sources.some((source) => domainMatches(domain, source.domain, source.url)) ||
    domainMatches(domain, null, item.answer) ||
    domainMatches(domain, null, item.markdown);

  return {
    platform: item.platform,
    platform_label: platformLabel(item.platform, item.model_name),
    question: String(item.question || "").trim(),
    answer_excerpt: String(item.answer || item.markdown || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220),
    ai_search_volume: item.ai_search_volume ?? null,
    cited,
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
  if (platform === "google") return "Google AI Overview";
  if (modelName) return `${platform} (${modelName})`;
  return platform || "AI assistant";
}

async function synthesizeCompetitorReport(payload, ctx) {
  const route = modelForEffortTier("max");
  const model = route.model || CLAUDE_MODEL();

  const system = `You are Blazly's Competitor Research analyst. You compare the user's website against competitors using live SEO and AI search visibility data.

Never mention DataForSEO, Claude, Anthropic, Gemini, Grok, xAI, or other vendors in user-facing text. Say "search authority", "AI search visibility", "indexed AI answers", etc.

Rules:
- Be direct about where each competitor is stronger and where the user can realistically surpass them.
- Ground every claim in the provided JSON dataset; do not invent traffic or keyword counts.
- Use "Search authority score" for domain rank (0–1000 scale from data).
- Compare AI visibility across Google AI Overview, ChatGPT, Claude, Gemini, and Grok using the platform counts provided.
- Prioritize actionable recommendations tied to gaps in the data (content, citations, backlinks, AI-friendly pages).
- Include 10–16 checklist items ordered by impact (highest first).

Output format (exactly, in this order):
1) Short intro (2–3 sentences) naming the user's site and competitors analyzed.
2) METRICS_START block with rows:
Your site|domain
Competitors analyzed|count
Your search authority|value or unknown
Your organic keywords|value or unknown
Your AI mention rows (all platforms)|total from data
METRICS_END
3) TABLE_START with header:
Site|Search authority|Referring domains|Organic keywords|AI mentions (5 platforms)|AI search volume
One row per site (user first, then each competitor). Use em dash for unknown. TABLE_END
4) CARD_START|Where competitors win
One row per competitor: Competitor domain|2–4 sentences on SEO + AI strengths from data CARD_END
5) CARD_START|Your clearest paths to surpass them
3–6 rows: Opportunity|Specific tactic grounded in the gap CARD_END
6) CHECKLIST_START
pending|Actionable step (verb-first, specific)
…10–16 items…
CHECKLIST_END
7) One closing paragraph (2 sentences) on what to execute in the next 30 days.

No markdown tables. Use TABLE_START/TABLE_END pipe format only.`;

  const userContent = JSON.stringify(payload, null, 2).slice(0, 52000);

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
      messages: [{ role: "user", content: userContent }],
    }),
    signal: AbortSignal.timeout(300_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || "Could not complete competitor research.");
  }

  const text = (data.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (!text) throw new Error("Competitor research returned empty results.");
  return text;
}

function parseCompetitorBrief(message, explicitWebsite, knowledge) {
  const raw = String(message || "").trim();
  let website = String(explicitWebsite || "").trim();
  const competitors = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const siteMatch = trimmed.match(/^website\s*url\s*:\s*(.*)$/i);
    if (siteMatch) {
      website = siteMatch[1].trim() || website;
      continue;
    }
    const compMatch = trimmed.match(/^competitor\s*(?:website\s*)?urls?\s*:?\s*(.*)$/i);
    if (compMatch) {
      const inline = compMatch[1]?.trim();
      if (inline) {
        for (const part of inline.split(/[,;]+/)) {
          if (part.trim()) competitors.push(part.trim());
        }
      }
      continue;
    }
    if (/^competitor\s*urls?\s*:/i.test(trimmed)) continue;
    if (/^website\s*url\s*:/i.test(trimmed)) continue;
    if (/^(https?:\/\/|\w+\.\w+)/.test(trimmed) && !website && !/^competitor/i.test(trimmed)) {
      website = trimmed;
    } else if (/[a-z0-9.-]+\.[a-z]{2,}/i.test(trimmed)) {
      competitors.push(trimmed);
    }
  }

  if (!website) {
    const urlMatch = raw.match(/https?:\/\/[^\s<>"']+/i);
    if (urlMatch) website = urlMatch[0];
  }

  const parsedCompetitors = [...new Set(competitors.map((c) => c.trim()).filter(Boolean))];
  return { website, competitors: parsedCompetitors };
}

function sanitizeError(message) {
  return String(message || "Competitor research failed.")
    .replace(/dataforseo/gi, "search data")
    .replace(/\bDataForSEO\b/g, "search data")
    .replace(/anthropic|claude/gi, "assistant")
    .replace(/gemini|grok|xai/gi, "assistant");
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}


function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
