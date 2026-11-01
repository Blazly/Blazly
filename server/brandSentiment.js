import { readJson } from "./readJson.js";
import { dataforseoPost, normalizeDomain } from "./dataforseo.js";
import { brandTokens } from "./aiVisibilityLlm.js";
import { geminiCompleteChat } from "./geminiChat.js";
import { grokCompleteChat } from "./grokChat.js";
import { modelForEffortTier } from "./modelRouter.js";

const LABS_LOCALE = { location_code: 2840, language_code: "en" };
const CLAUDE_MODEL = () => process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
const GEMINI_MODEL = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
const XAI_MODEL = () => process.env.XAI_MODEL?.trim() || "grok-3-mini";

const DIMENSIONS = {
  visibility: ["High", "Medium", "Low"],
  sentiment: ["Positive", "Neutral", "Negative"],
  trust: ["High", "Medium", "Low", "Unknown"],
  authority: ["Strong", "Medium", "Weak"],
  recommendation: ["Strong", "Soft", "None"],
};

const SENTIMENT_SYSTEM = `You analyze how a specific AI assistant represents a brand to users today.
Reply with JSON only — no markdown fences.

{
  "visibility": "High|Medium|Low",
  "sentiment": "Positive|Neutral|Negative",
  "trust": "High|Medium|Low|Unknown",
  "authority": "Strong|Medium|Weak",
  "recommendation": "Strong|Soft|None",
  "summary": "2-3 sentences in plain language",
  "references": [
    {
      "title": "short label",
      "url": "https://... or empty string",
      "source_type": "training|web|product_page|review|news|indexed_answer|forum|unknown",
      "excerpt": "what this source contributes to your view",
      "context": "optional prompt or question this relates to"
    }
  ]
}

Rules:
- Be honest when knowledge is thin; use Unknown/Low/None where appropriate.
- List every concrete reference you rely on (URLs when known).
- Do not name third-party data vendors or scraping tools.`;

export function attachBrandSentimentAnalysis(server, ctx) {
  server.middlewares.use(async (req, res, next) => {
    const [pathOnly, query = ""] = (req.url || "").split("?");
    if (pathOnly !== "/api/brand-sentiment") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      const body = await readJson(req);
      if (stream) {
        await streamBrandSentimentJob(body, res, ctx);
        return;
      }
      const content = await runBrandSentimentJob(body, () => {}, ctx);
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

async function streamBrandSentimentJob(body, res, ctx) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (payload) => writeSse(res, payload);
  try {
    const content = await runBrandSentimentJob(body, emit, ctx);
    emit({ type: "complete", content });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: sanitizeError(error.message) });
    res.end();
  }
}

export async function runBrandSentimentJob(body, onProgress, ctx) {
  const website = parseWebsiteInput(body.message, body.website);
  const domain = normalizeDomain(website);
  if (!domain) {
    throw new Error("Enter your website URL in the composer (Website URL:) to analyze brand sentiment.");
  }

  const knowledge = body.knowledge && typeof body.knowledge === "object" ? body.knowledge : null;
  const brandName =
    String(knowledge?.companyName || "").trim() ||
    domain.replace(/^www\./, "").split(".")[0] ||
    domain;

  const analysisCtx = {
    website: website || `https://${domain}`,
    domain,
    brandName,
    knowledge,
    apiKey: ctx.apiKey,
    workspaceId: ctx.workspaceId,
    geminiApiKey: ctx.geminiApiKey,
    xaiApiKey: ctx.xaiApiKey,
    dataForSeo: ctx.dataForSeo,
  };

  if (!ctx.apiKey && !ctx.geminiApiKey && !ctx.xaiApiKey) {
    throw new Error("Brand sentiment analysis is not available for this workspace yet.");
  }

  const platforms = [];

  onProgress?.({
    type: "progress",
    phase: "brand_sentiment",
    stage: "chatgpt",
    message: `ChatGPT signals for ${brandName}`,
  });
  platforms.push(await analyzeChatGptSentiment(analysisCtx));

  onProgress?.({
    type: "progress",
    phase: "brand_sentiment",
    stage: "gemini",
    message: `Gemini view of ${brandName}`,
  });
  platforms.push(await analyzeGeminiSentiment(analysisCtx));

  onProgress?.({
    type: "progress",
    phase: "brand_sentiment",
    stage: "claude",
    message: `Claude view of ${brandName}`,
  });
  platforms.push(await analyzeClaudeSentiment(analysisCtx));

  onProgress?.({
    type: "progress",
    phase: "brand_sentiment",
    stage: "grok",
    message: `Grok view of ${brandName}`,
  });
  platforms.push(await analyzeGrokSentiment(analysisCtx));

  const payload = {
    website: analysisCtx.website,
    brandName,
    domain,
    analyzedAt: new Date().toISOString(),
    platforms,
  };

  return formatBrandSentimentReply(payload);
}

async function analyzeChatGptSentiment(ctx) {
  const label = "ChatGPT";
  const id = "chatgpt";
  let mentions = [];
  if (ctx.dataForSeo?.login && ctx.dataForSeo?.password) {
    try {
      mentions = (await fetchChatGptMentions(ctx.domain, ctx.dataForSeo)).items;
    } catch {
      mentions = [];
    }
  }

  const referenceSeed = collectMentionReferences(mentions, ctx.domain);
  const userPayload = buildBrandUserPayload(ctx, label, {
    extra:
      mentions.length > 0
        ? `Indexed ChatGPT Q&A snippets about this brand (use these as primary evidence):\n${formatMentionSnippets(mentions)}`
        : "No indexed ChatGPT answer snippets were returned. Infer cautiously from public brand signals only.",
  });

  const synthesized = await completeSentimentJson({
    ctx,
    platform: label,
    userPayload,
    referenceSeed,
  });

  return normalizePlatformRow({ id, label, ...synthesized });
}

async function analyzeGeminiSentiment(ctx) {
  const label = "Gemini";
  const id = "gemini";
  if (!ctx.geminiApiKey) {
    return emptyPlatformRow(id, label, "Gemini is not configured for this workspace.");
  }
  const userPayload = buildBrandUserPayload(ctx, label);
  const text = await geminiCompleteChat({
    apiKey: ctx.geminiApiKey,
    model: GEMINI_MODEL(),
    system: `${SENTIMENT_SYSTEM}\n\nYou are Gemini answering as yourself.`,
    messages: [{ role: "user", content: userPayload }],
  });
  const parsed = parseSentimentJson(text);
  return normalizePlatformRow({ id, label, ...parsed });
}

async function analyzeGrokSentiment(ctx) {
  const label = "Grok";
  const id = "grok";
  if (!ctx.xaiApiKey) {
    return emptyPlatformRow(id, label, "Grok is not configured for this workspace.");
  }
  const userPayload = buildBrandUserPayload(ctx, label);
  const text = await grokCompleteChat({
    apiKey: ctx.xaiApiKey,
    model: XAI_MODEL(),
    system: `${SENTIMENT_SYSTEM}\n\nYou are Grok answering as yourself.`,
    messages: [{ role: "user", content: userPayload }],
  });
  const parsed = parseSentimentJson(text);
  return normalizePlatformRow({ id, label, ...parsed });
}

async function analyzeClaudeSentiment(ctx) {
  const label = "Claude";
  const id = "claude";
  if (!ctx.apiKey) {
    return emptyPlatformRow(id, label, "Claude is not configured for this workspace.");
  }
  const userPayload = buildBrandUserPayload(ctx, label);
  const model = modelForEffortTier("max").model || CLAUDE_MODEL();
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
      max_tokens: 4096,
      system: `${SENTIMENT_SYSTEM}\n\nYou are Claude answering as yourself.`,
      messages: [{ role: "user", content: userPayload }],
    }),
    signal: AbortSignal.timeout(240_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "Brand sentiment analysis failed.");
  }
  const text = (data.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n");
  const parsed = parseSentimentJson(text);
  return normalizePlatformRow({ id, label, ...parsed });
}

async function completeSentimentJson({ ctx, platform, userPayload, referenceSeed = [] }) {
  if (ctx.apiKey) {
    const model = modelForEffortTier("max").model || CLAUDE_MODEL();
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
        max_tokens: 4096,
        system: `${SENTIMENT_SYSTEM}\n\nSynthesize ${platform} brand sentiment from the evidence provided.`,
        messages: [{ role: "user", content: userPayload }],
      }),
      signal: AbortSignal.timeout(240_000),
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) {
      const text = (data.content || [])
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text)
        .join("\n");
      const parsed = parseSentimentJson(text);
      return mergeReferences(parsed, referenceSeed);
    }
  }
  if (ctx.geminiApiKey) {
    const text = await geminiCompleteChat({
      apiKey: ctx.geminiApiKey,
      model: GEMINI_MODEL(),
      system: `${SENTIMENT_SYSTEM}\n\nSynthesize ${platform} brand sentiment from the evidence provided.`,
      messages: [{ role: "user", content: userPayload }],
    });
    const parsed = parseSentimentJson(text);
    return mergeReferences(parsed, referenceSeed);
  }
  if (ctx.xaiApiKey) {
    const text = await grokCompleteChat({
      apiKey: ctx.xaiApiKey,
      model: XAI_MODEL(),
      system: `${SENTIMENT_SYSTEM}\n\nSynthesize ${platform} brand sentiment from the evidence provided.`,
      messages: [{ role: "user", content: userPayload }],
    });
    const parsed = parseSentimentJson(text);
    return mergeReferences(parsed, referenceSeed);
  }
  return {
    visibility: "Low",
    sentiment: "Neutral",
    trust: "Unknown",
    authority: "Weak",
    recommendation: "None",
    summary: "Could not analyze ChatGPT sentiment.",
    references: referenceSeed,
  };
}

function buildBrandUserPayload(ctx, platformLabel, { extra = "" } = {}) {
  const tokens = brandTokens(ctx.domain, ctx.knowledge);
  const about = ctx.knowledge?.description
    ? `About: ${String(ctx.knowledge.description).slice(0, 500)}`
    : "";
  return [
    `Platform: ${platformLabel}`,
    `Brand: ${ctx.brandName}`,
    `Website: ${ctx.website}`,
    `Domain: ${ctx.domain}`,
    tokens.length ? `Brand tokens: ${tokens.join(", ")}` : "",
    about,
    "",
    "Assess how this platform currently talks about the brand: visibility in answers, sentiment, trust, authority, and willingness to recommend.",
    extra,
  ]
    .filter(Boolean)
    .join("\n");
}

async function fetchChatGptMentions(domain, config) {
  const task = {
    target: [{ domain, search_filter: "include", search_scope: ["any"] }],
    limit: 40,
    platform: "chat_gpt",
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
    return { items: [] };
  }
  const result = taskResult.result?.[0];
  const items = (result?.items || []).map((item) => normalizeMentionItem(item, domain));
  return { items };
}

function normalizeMentionItem(item, domain) {
  const sources = item.sources || [];
  return {
    question: String(item.question || "").trim(),
    answer_excerpt: String(item.answer || item.markdown || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 320),
    sources: sources.slice(0, 6).map((source) => ({
      domain: source.domain,
      title: source.title,
      url: source.url,
    })),
    ai_search_volume: item.ai_search_volume ?? null,
    domain,
  };
}

function formatMentionSnippets(mentions) {
  return mentions
    .slice(0, 12)
    .map((row, index) => {
      const src = (row.sources || [])
        .map((s) => s.url || s.domain || s.title)
        .filter(Boolean)
        .join(", ");
      return `${index + 1}. Q: ${row.question}\n   A: ${row.answer_excerpt}${src ? `\n   Sources: ${src}` : ""}`;
    })
    .join("\n\n");
}

function collectMentionReferences(mentions, domain) {
  const refs = [];
  for (const row of mentions.slice(0, 15)) {
    for (const source of row.sources || []) {
      if (!source.url && !source.title && !source.domain) continue;
      refs.push({
        title: source.title || source.domain || "Citation",
        url: source.url || "",
        source_type: "indexed_answer",
        excerpt: row.answer_excerpt?.slice(0, 200) || "Indexed ChatGPT answer citing this source.",
        context: row.question ? `Q: ${row.question}` : "",
      });
    }
    if (!row.sources?.length && row.answer_excerpt) {
      refs.push({
        title: "Indexed ChatGPT answer",
        url: "",
        source_type: "indexed_answer",
        excerpt: row.answer_excerpt.slice(0, 220),
        context: row.question ? `Q: ${row.question}` : "",
      });
    }
  }
  return dedupeReferences(refs).slice(0, 20);
}

function mergeReferences(parsed, seed) {
  const combined = dedupeReferences([...(parsed.references || []), ...seed]);
  return { ...parsed, references: combined };
}

function dedupeReferences(refs) {
  const seen = new Set();
  const out = [];
  for (const ref of refs) {
    const key = `${ref.url || ""}|${ref.title || ""}|${ref.excerpt || ""}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function parseSentimentJson(text) {
  const parsed = extractJsonObject(text);
  return {
    visibility: pickEnum(parsed?.visibility, DIMENSIONS.visibility, "Low"),
    sentiment: pickEnum(parsed?.sentiment, DIMENSIONS.sentiment, "Neutral"),
    trust: pickEnum(parsed?.trust, DIMENSIONS.trust, "Unknown"),
    authority: pickEnum(parsed?.authority, DIMENSIONS.authority, "Weak"),
    recommendation: pickEnum(parsed?.recommendation, DIMENSIONS.recommendation, "None"),
    summary: String(parsed?.summary || "").trim(),
    references: normalizeReferences(parsed?.references),
  };
}

function normalizeReferences(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => ({
      title: String(row.title || row.name || "Reference").trim(),
      url: String(row.url || "").trim(),
      source_type: String(row.source_type || row.type || "unknown").trim(),
      excerpt: String(row.excerpt || row.snippet || row.note || "").trim(),
      context: String(row.context || row.prompt || "").trim(),
    }))
    .filter((row) => row.title || row.url || row.excerpt)
    .slice(0, 24);
}

function normalizePlatformRow(row) {
  return {
    id: row.id,
    label: row.label,
    visibility: pickEnum(row.visibility, DIMENSIONS.visibility, "Low"),
    sentiment: pickEnum(row.sentiment, DIMENSIONS.sentiment, "Neutral"),
    trust: pickEnum(row.trust, DIMENSIONS.trust, "Unknown"),
    authority: pickEnum(row.authority, DIMENSIONS.authority, "Weak"),
    recommendation: pickEnum(row.recommendation, DIMENSIONS.recommendation, "None"),
    summary: String(row.summary || "").trim(),
    references: normalizeReferences(row.references),
  };
}

function emptyPlatformRow(id, label, summary) {
  return normalizePlatformRow({
    id,
    label,
    visibility: "Low",
    sentiment: "Neutral",
    trust: "Unknown",
    authority: "Weak",
    recommendation: "None",
    summary,
    references: [],
  });
}

function pickEnum(value, allowed, fallback) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  const hit = allowed.find((item) => item.toLowerCase() === normalized);
  return hit || fallback;
}

function formatBrandSentimentReply(payload) {
  const lines = [];
  lines.push(
    `Brand sentiment for **${payload.brandName}** across ChatGPT, Gemini, Claude, and Grok.`,
  );
  lines.push("");
  lines.push("SENTIMENT_START");
  lines.push(JSON.stringify(payload));
  lines.push("SENTIMENT_END");
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

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function sanitizeError(message) {
  return String(message || "Brand sentiment analysis failed.")
    .replace(/dataforseo/gi, "AI index")
    .replace(/\bDataForSEO\b/g, "AI index")
    .replace(/anthropic|claude/gi, "assistant")
    .replace(/gemini/gi, "assistant");
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}


function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}
