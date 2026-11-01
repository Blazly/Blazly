import { geminiCompleteChat } from "./geminiChat.js";
import { grokCompleteChat } from "./grokChat.js";
import { modelForEffortTier } from "./modelRouter.js";
import { normalizeDomain } from "./dataforseo.js";

const CLAUDE_MODEL = () => process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
const GEMINI_MODEL = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
const XAI_MODEL = () => process.env.XAI_MODEL?.trim() || "grok-3-mini";

const META_SYSTEM = `You analyze AI visibility for a website. Reply with JSON only — no markdown fences.

Find non-branded user prompts: questions a real person would ask an AI assistant that do NOT contain the brand name, company name, or domain (or obvious variants).

For each prompt where the site would plausibly be mentioned, cited, or recommended in a helpful answer, include it.

JSON shape:
{"mentions":[{"prompt":"...","cites_site":true,"answer_excerpt":"1-2 sentence sample answer snippet that mentions the site","confidence":"high|medium|low"}]}

Rules:
- 8–18 items max.
- prompts must be non-branded (no brand/domain tokens provided).
- answer_excerpt should read like the assistant's answer; mention the site naturally when cites_site is true.
- Never mention third-party data vendors.`;

export function brandTokens(domain, knowledge) {
  const tokens = new Set();
  const normalized = normalizeDomain(domain);
  if (normalized) {
    tokens.add(normalized);
    const base = normalized.replace(/^www\./, "").split(".")[0];
    if (base.length > 2) tokens.add(base);
  }
  const company = String(knowledge?.companyName || "").trim();
  if (company.length > 2) tokens.add(company.toLowerCase());
  return [...tokens];
}

export function isNonBrandedPrompt(prompt, tokens) {
  const hay = String(prompt || "").toLowerCase();
  if (!hay.trim()) return false;
  return !tokens.some((token) => token && hay.includes(String(token).toLowerCase()));
}

export async function fetchClaudeNonBrandedMentions(ctx, extraProbePrompts = []) {
  const meta = await fetchClaudeMetaMentions(ctx);
  const probeList = [...new Set([...(meta.probePrompts || []), ...(extraProbePrompts || [])])];
  const probes = await probeClaudeLivePrompts(ctx, probeList);
  return dedupeMentions([...meta.mentions, ...probes]);
}

export async function fetchGeminiNonBrandedMentions(ctx, extraProbePrompts = []) {
  const meta = await fetchGeminiMetaMentions(ctx);
  const probeList = [...new Set([...(meta.probePrompts || []), ...(extraProbePrompts || [])])];
  const probes = await probeGeminiLivePrompts(ctx, probeList);
  return dedupeMentions([...meta.mentions, ...probes]);
}

export async function fetchGrokNonBrandedMentions(ctx, extraProbePrompts = []) {
  const meta = await fetchGrokMetaMentions(ctx);
  const probeList = [...new Set([...(meta.probePrompts || []), ...(extraProbePrompts || [])])];
  const probes = await probeGrokLivePrompts(ctx, probeList);
  return dedupeMentions([...meta.mentions, ...probes]);
}

async function fetchClaudeMetaMentions(ctx) {
  if (!ctx.apiKey) return { mentions: [], probePrompts: [] };
  const userPayload = buildMetaUserPayload(ctx);
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
      system: META_SYSTEM,
      messages: [{ role: "user", content: userPayload }],
    }),
    signal: AbortSignal.timeout(240_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "Claude visibility analysis failed.");
  }

  const text = (data.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n");

  return parseMetaMentions(text, ctx, "Claude");
}

async function fetchGeminiMetaMentions(ctx) {
  if (!ctx.geminiApiKey) return { mentions: [], probePrompts: [] };
  const userPayload = buildMetaUserPayload(ctx);

  const text = await geminiCompleteChat({
    apiKey: ctx.geminiApiKey,
    model: GEMINI_MODEL(),
    system: META_SYSTEM,
    messages: [{ role: "user", content: userPayload }],
  });

  return parseMetaMentions(text, ctx, "Gemini");
}

async function fetchGrokMetaMentions(ctx) {
  if (!ctx.xaiApiKey) return { mentions: [], probePrompts: [] };
  const userPayload = buildMetaUserPayload(ctx);

  const text = await grokCompleteChat({
    apiKey: ctx.xaiApiKey,
    model: XAI_MODEL(),
    system: META_SYSTEM,
    messages: [{ role: "user", content: userPayload }],
  });

  return parseMetaMentions(text, ctx, "Grok");
}

function buildMetaUserPayload(ctx) {
  const tokens = brandTokens(ctx.domain, ctx.knowledge);
  const knowledgeLine = ctx.knowledge?.description
    ? `About the site: ${String(ctx.knowledge.description).slice(0, 400)}`
    : "";
  return [
    `Website: ${ctx.website || ctx.domain}`,
    `Domain: ${ctx.domain}`,
    `Brand tokens to exclude from prompts: ${tokens.join(", ") || "(none)"}`,
    knowledgeLine,
    "",
    "List non-branded prompts where this site should appear in AI answers on your platform.",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseMetaMentions(text, ctx, platformLabel) {
  const parsed = extractJsonObject(text);
  const rows = Array.isArray(parsed?.mentions) ? parsed.mentions : [];
  const tokens = brandTokens(ctx.domain, ctx.knowledge);
  const mentions = [];
  const probePrompts = [];

  for (const row of rows) {
    const prompt = String(row.prompt || "").trim();
    if (!prompt || !isNonBrandedPrompt(prompt, tokens)) continue;
    const cites = row.cites_site !== false;
    mentions.push({
      platform: platformLabel.toLowerCase(),
      platform_label: platformLabel,
      question: prompt,
      answer_excerpt: String(row.answer_excerpt || "").replace(/\s+/g, " ").trim().slice(0, 280),
      ai_search_volume: null,
      cited: cites,
      source: "meta",
    });
    probePrompts.push(prompt);
  }

  return { mentions, probePrompts: [...new Set(probePrompts)].slice(0, 10) };
}

async function probeClaudeLivePrompts(ctx, prompts) {
  if (!ctx.apiKey || !prompts?.length) return [];
  const tokens = brandTokens(ctx.domain, ctx.knowledge);
  const unique = [...new Set(prompts.filter((p) => isNonBrandedPrompt(p, tokens)))].slice(0, 8);
  const model = modelForEffortTier("max").model || CLAUDE_MODEL();
  const results = [];

  for (const prompt of unique) {
    try {
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
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: AbortSignal.timeout(120_000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) continue;
      const text = (data.content || [])
        .filter((block) => block.type === "text" && block.text)
        .map((block) => block.text)
        .join("\n");
      const cited = domainMentioned(ctx.domain, text);
      if (!cited) continue;
      results.push({
        platform: "claude",
        platform_label: "Claude",
        question: prompt,
        answer_excerpt: text.replace(/\s+/g, " ").trim().slice(0, 280),
        ai_search_volume: null,
        cited: true,
        source: "live",
      });
    } catch {
      // skip failed probe
    }
  }

  return dedupeMentions(results);
}

async function probeGeminiLivePrompts(ctx, prompts) {
  if (!ctx.geminiApiKey || !prompts?.length) return [];
  const tokens = brandTokens(ctx.domain, ctx.knowledge);
  const unique = [...new Set(prompts.filter((p) => isNonBrandedPrompt(p, tokens)))].slice(0, 8);
  const results = [];

  for (const prompt of unique) {
    try {
      const text = await geminiCompleteChat({
        apiKey: ctx.geminiApiKey,
        model: GEMINI_MODEL(),
        system: "Answer the user question helpfully and concisely. Include specific product or site recommendations when relevant.",
        messages: [{ role: "user", content: prompt }],
      });
      const cited = domainMentioned(ctx.domain, text);
      if (!cited) continue;
      results.push({
        platform: "gemini",
        platform_label: "Gemini",
        question: prompt,
        answer_excerpt: text.replace(/\s+/g, " ").trim().slice(0, 280),
        ai_search_volume: null,
        cited: true,
        source: "live",
      });
    } catch {
      // skip
    }
  }

  return dedupeMentions(results);
}

async function probeGrokLivePrompts(ctx, prompts) {
  if (!ctx.xaiApiKey || !prompts?.length) return [];
  const tokens = brandTokens(ctx.domain, ctx.knowledge);
  const unique = [...new Set(prompts.filter((p) => isNonBrandedPrompt(p, tokens)))].slice(0, 8);
  const results = [];

  for (const prompt of unique) {
    try {
      const text = await grokCompleteChat({
        apiKey: ctx.xaiApiKey,
        model: XAI_MODEL(),
        system:
          "Answer the user question helpfully and concisely. Include specific product or site recommendations when relevant.",
        messages: [{ role: "user", content: prompt }],
      });
      const cited = domainMentioned(ctx.domain, text);
      if (!cited) continue;
      results.push({
        platform: "grok",
        platform_label: "Grok",
        question: prompt,
        answer_excerpt: text.replace(/\s+/g, " ").trim().slice(0, 280),
        ai_search_volume: null,
        cited: true,
        source: "live",
      });
    } catch {
      // skip
    }
  }

  return dedupeMentions(results);
}

export function buildProbePromptSeeds(dataForSeoMentions, metaPrompts, tokens) {
  const seeds = [];
  for (const row of dataForSeoMentions) {
    if (row.question && isNonBrandedPrompt(row.question, tokens)) seeds.push(row.question);
  }
  seeds.push(...(metaPrompts || []));
  return [...new Set(seeds)].slice(0, 12);
}

function domainMentioned(domain, text) {
  const needle = normalizeDomain(domain);
  if (!needle) return false;
  const hay = String(text || "").toLowerCase();
  return hay.includes(needle) || hay.includes(`www.${needle}`) || hay.includes(needle.split(".")[0]);
}

function dedupeMentions(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = `${row.platform_label}|${row.question}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function dedupeCombinedMentions(rows) {
  return dedupeMentions(rows);
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
