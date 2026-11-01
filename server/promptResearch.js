import { readJson } from "./readJson.js";
import { dataforseoPost } from "./dataforseo.js";
import { geminiCompleteChat } from "./geminiChat.js";
import { grokCompleteChat } from "./grokChat.js";

const OPENAI_MODEL = () => process.env.OPENAI_MODEL?.trim() || "gpt-6-luna";
const CLAUDE_MODEL = () => process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
const GEMINI_MODEL = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
const XAI_MODEL = () => process.env.XAI_MODEL?.trim() || "grok-3-mini";

const PLATFORMS = [
  { id: "chatgpt", label: "ChatGPT" },
  { id: "gemini", label: "Gemini" },
  { id: "claude", label: "Claude" },
  { id: "grok", label: "Grok (X)" },
];

const BATCH_SYSTEM = (platform) => `You are ${platform}. For each prompt in the list, estimate how many times per month real users ask ${platform} that prompt (or close paraphrases with the same intent), worldwide. Be realistic and consistent across the list.

Reply with JSON only, no markdown fences:
{"estimates":[{"prompt":"<exact prompt from the list>","monthly_volume":<integer>}]}`;

const ESTIMATE_SYSTEM = (platform) => `You are ${platform}. Estimate how often real users ask ${platform} a given prompt (or close paraphrases with the same intent) each month, worldwide.

Base the estimate on what you know about your own user base, typical usage patterns, and the topic's popularity. Be realistic: niche prompts may be in the tens or hundreds; mainstream ones can be far higher.

Reply with JSON only, no markdown fences:
{
  "monthly_volume": <integer>,
  "confidence": "high|medium|low",
  "trend": "rising|stable|declining",
  "intent": "informational|commercial|transactional|navigational",
  "reasoning": "one short sentence",
  "related": [
    {"prompt": "a related prompt users ask you", "monthly_volume": <integer>}
  ]
}

Include 6-8 related prompts phrased as natural questions a user would type.`;

export function attachPromptResearch(server, ctx) {
  server.middlewares.use(async (req, res, next) => {
    const [pathOnly, query = ""] = (req.url || "").split("?");
    if (pathOnly !== "/api/prompt-research") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      const body = await readJson(req);
      if (!ctx.openaiApiKey && !ctx.apiKey && !ctx.geminiApiKey && !ctx.xaiApiKey) {
        throw new Error("Prompt research is not available for this workspace yet.");
      }
      if (stream) {
        await streamPromptResearchJob(body, res, ctx);
        return;
      }
      const content = await runPromptResearchJob(body, () => {}, ctx);
      sendJson(res, 200, { content });
    } catch (error) {
      if (stream) {
        writeSse(res, { type: "error", error: error.message || "Prompt research failed." });
        res.end();
        return;
      }
      sendJson(res, 500, { error: error.message || "Prompt research failed." });
    }
  });
}

async function streamPromptResearchJob(body, res, ctx) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (payload) => writeSse(res, payload);
  try {
    const content = await runPromptResearchJob(body, emit, ctx);
    emit({ type: "complete", content });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: error.message || "Prompt research failed." });
    res.end();
  }
}

export async function runPromptResearchJob(body, onProgress, ctx) {
  const prompt = parsePromptInput(body.message, body.prompt);
  if (!prompt) {
    throw new Error("Enter a prompt in the composer (Prompt:) to estimate AI search volume.");
  }

  const callers = {
    chatgpt: ctx.openaiApiKey ? (system, user) => openaiComplete(ctx.openaiApiKey, system, user) : null,
    gemini: ctx.geminiApiKey
      ? (system, user) =>
          geminiCompleteChat({
            apiKey: ctx.geminiApiKey,
            model: GEMINI_MODEL(),
            system,
            messages: [{ role: "user", content: user }],
          })
      : null,
    claude: ctx.apiKey ? (system, user) => claudeComplete(ctx, system, user) : null,
    grok: ctx.xaiApiKey
      ? (system, user) =>
          grokCompleteChat({
            apiKey: ctx.xaiApiKey,
            model: XAI_MODEL(),
            system,
            messages: [{ role: "user", content: user }],
          })
      : null,
  };

  onProgress?.({ type: "progress", phase: "prompt_research", stage: "asking", message: "Asking each AI platform" });

  const results = await Promise.all(
    PLATFORMS.map(async (platform) => {
      const call = callers[platform.id];
      if (!call) return { ...platform, available: false };
      try {
        const text = await call(ESTIMATE_SYSTEM(platform.label.replace(" (X)", "")), `Prompt: "${prompt}"`);
        onProgress?.({
          type: "progress",
          phase: "prompt_research",
          stage: platform.id,
          message: `${platform.label} replied`,
        });
        const parsed = normalizeEstimate(extractJson(text));
        if (!Number.isFinite(parsed.monthly_volume)) {
          return {
            ...platform,
            available: false,
            failureReason: `${platform.label} returned a reply we could not parse. Try again.`,
          };
        }
        return { ...platform, available: true, ...parsed };
      } catch (error) {
        return {
          ...platform,
          available: false,
          failureReason: platformFailureReason(platform.label, error),
        };
      }
    }),
  );

  const answered = results.filter((row) => row.available && Number.isFinite(row.monthly_volume));
  if (!answered.length) {
    throw new Error("None of the AI platforms returned an estimate. Try again in a moment.");
  }

  const candidates = mergeRelated(answered).slice(0, 12);

  onProgress?.({
    type: "progress",
    phase: "prompt_research",
    stage: "related",
    message: "Estimating related prompts on every platform",
  });
  await Promise.all(
    answered.map(async (platform) => {
      try {
        const list = candidates.map((row, i) => `${i + 1}. ${row.prompt}`).join("\n");
        const text = await callers[platform.id](BATCH_SYSTEM(platform.label.replace(" (X)", "")), list);
        const rows = extractJson(text)?.estimates || [];
        rows.forEach((row, i) => {
          const volume = toInt(row?.monthly_volume);
          if (!Number.isFinite(volume)) return;
          const key = normalizeKey(row?.prompt);
          const match = candidates.find((c) => normalizeKey(c.prompt) === key) || candidates[i];
          if (match) match.volumes[platform.id] = volume;
        });
      } catch {
        // Keep first-pass numbers for this platform.
      }
    }),
  );
  const relatedPrompts = candidates
    .map((row) => ({ ...row, total: Object.values(row.volumes).reduce((sum, n) => sum + n, 0) }))
    .sort((a, b) => b.total - a.total);

  onProgress?.({
    type: "progress",
    phase: "prompt_research",
    stage: "indexed",
    message: "Cross-checking indexed AI search volume",
  });
  const indexed = await fetchIndexedAiVolume([prompt, ...relatedPrompts.map((r) => r.prompt)], ctx.dataForSeo);

  return formatReply({ prompt, results, answered, relatedPrompts, indexed });
}

function parsePromptInput(message, explicit) {
  const fromBody = String(explicit || "").trim();
  if (fromBody) return fromBody.slice(0, 300);
  const raw = String(message || "").trim();
  for (const line of raw.split("\n")) {
    const match = line.trim().match(/^prompt\s*:\s*(.+)$/i);
    if (match?.[1]?.trim()) return match[1].trim().slice(0, 300);
  }
  if (raw && !/^prompt\s*:/im.test(raw)) return raw.split("\n")[0].trim().slice(0, 300);
  return "";
}

function normalizeEstimate(data) {
  if (!data) return { monthly_volume: NaN };
  const related = Array.isArray(data.related) ? data.related : [];
  return {
    monthly_volume: toInt(data.monthly_volume),
    confidence: oneOf(data.confidence, ["high", "medium", "low"], "low"),
    trend: oneOf(data.trend, ["rising", "stable", "declining"], "stable"),
    intent: oneOf(
      data.intent,
      ["informational", "commercial", "transactional", "navigational"],
      "informational",
    ),
    reasoning: String(data.reasoning || "").replace(/\|/g, "/").trim().slice(0, 220),
    related: related
      .map((row) => ({
        prompt: String(row?.prompt || "").replace(/\|/g, "/").trim().slice(0, 160),
        monthly_volume: toInt(row?.monthly_volume),
      }))
      .filter((row) => row.prompt && Number.isFinite(row.monthly_volume))
      .slice(0, 8),
  };
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FILLER_WORDS = new Set(["a", "an", "the", "is", "s", "what", "whats", "for", "to", "my", "of", "which", "are"]);

function intentKey(value) {
  const words = normalizeKey(value)
    .split(" ")
    .filter((word) => word && !FILLER_WORDS.has(word) && !/^20\d\d$/.test(word));
  return [...new Set(words)].sort().join(" ");
}

function mergeRelated(answered) {
  const map = new Map();
  for (const platform of answered) {
    for (const row of platform.related || []) {
      const key = intentKey(row.prompt);
      const entry = map.get(key) || { prompt: row.prompt, volumes: {} };
      entry.volumes[platform.id] = row.monthly_volume;
      map.set(key, entry);
    }
  }
  return [...map.values()]
    .map((entry) => ({
      ...entry,
      total: Object.values(entry.volumes).reduce((sum, n) => sum + n, 0),
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 20);
}

async function fetchIndexedAiVolume(prompts, config) {
  const out = new Map();
  if (!config?.login || !config?.password) return out;
  try {
    const raw = await dataforseoPost({
      login: config.login,
      password: config.password,
      path: "/v3/ai_optimization/ai_keyword_data/keywords_search_volume/live",
      tasks: [{ keywords: prompts.slice(0, 20), location_code: 2840, language_code: "en" }],
    });
    const items = raw?.tasks?.[0]?.result?.[0]?.items || [];
    for (const item of items) {
      const volume = Number(item.ai_search_volume);
      if (item.keyword && Number.isFinite(volume)) out.set(item.keyword.toLowerCase(), volume);
    }
  } catch {
    // Indexed volume is a cross-check only.
  }
  return out;
}

function formatReply({ prompt, results, answered, relatedPrompts, indexed }) {
  const total = answered.reduce((sum, row) => sum + row.monthly_volume, 0);
  const top = [...answered].sort((a, b) => b.monthly_volume - a.monthly_volume)[0];
  const indexedMain = indexed.get(prompt.toLowerCase());
  const lines = [];

  lines.push(
    `Estimated monthly demand for “${prompt}” across AI assistants. Each platform was asked directly to estimate how often its users ask this prompt, so treat these as directional estimates rather than exact counts.`,
  );
  lines.push("");
  lines.push("METRICS_START");
  lines.push(`Prompt|${prompt.replace(/\|/g, "/")}`);
  lines.push(`Estimated monthly prompts (all platforms)|${formatInteger(total)}`);
  lines.push(`Highest demand|${top.label}`);
  lines.push(`Search intent|${capitalize(top.intent)}`);
  if (Number.isFinite(indexedMain)) lines.push(`Indexed AI search volume|${formatInteger(indexedMain)}`);
  lines.push("METRICS_END");
  lines.push("");

  lines.push("CHART_START|Estimated monthly prompts by platform");
  for (const row of answered) lines.push(`${row.label}|${row.monthly_volume}`);
  lines.push("CHART_END");
  lines.push("");

  lines.push("TABLE_START");
  lines.push("Platform|Est. monthly prompts|Trend|Confidence|Why");
  for (const row of results) {
    if (!row.available || !Number.isFinite(row.monthly_volume)) {
      const why = String(row.failureReason || "Not available right now").replace(/\|/g, "/");
      lines.push(`${row.label}|—|—|—|${why}`);
      continue;
    }
    lines.push(
      `${row.label}|${formatInteger(row.monthly_volume)}|${capitalize(row.trend)}|${capitalize(row.confidence)}|${row.reasoning || "—"}`,
    );
  }
  lines.push("TABLE_END");
  lines.push("");

  if (relatedPrompts.length) {
    lines.push("Related prompts people ask AI assistants:");
    lines.push("");
    lines.push("TABLE_START");
    const headers = ["Related prompt", ...answered.map((row) => row.label), "Total"];
    lines.push(headers.join("|"));
    for (const row of relatedPrompts) {
      lines.push(
        [
          row.prompt,
          ...answered.map((platform) => formatInteger(row.volumes[platform.id])),
          formatInteger(row.total),
        ].join("|"),
      );
    }
    lines.push("TABLE_END");
  }

  return lines.join("\n");
}

async function openaiComplete(apiKey, system, user) {
  const model = OPENAI_MODEL();
  const payload = {
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
  };

  let response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180_000),
  });
  let data = await response.json().catch(() => ({}));

  if (!response.ok && shouldRetryOpenAiWithoutJsonFormat(data)) {
    const { response_format: _removed, ...withoutFormat } = payload;
    response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(withoutFormat),
      signal: AbortSignal.timeout(180_000),
    });
    data = await response.json().catch(() => ({}));
  }

  if (!response.ok) throw new Error(data?.error?.message || "ChatGPT could not reply.");
  const content = String(data.choices?.[0]?.message?.content || "").trim();
  if (!content) throw new Error("ChatGPT returned an empty reply.");
  return content;
}

function shouldRetryOpenAiWithoutJsonFormat(data) {
  const message = String(data?.error?.message || "").toLowerCase();
  return message.includes("response_format") || message.includes("json");
}

function platformFailureReason(label, error) {
  const raw = String(error?.message || "").trim();
  if (!raw) return `${label} is not available right now. Restart the dev server after updating .env.`;
  if (/incorrect api key|invalid api key|authentication/i.test(raw)) {
    return `${label}: API key rejected. Check OPENAI_API_KEY in .env and restart npm run dev.`;
  }
  if (/model.*not found|does not exist|must be verified/i.test(raw)) {
    return `${label}: model error (${OPENAI_MODEL()}). Update OPENAI_MODEL in .env.`;
  }
  return `${label}: ${raw.replace(/\|/g, "/").slice(0, 160)}`;
}

async function claudeComplete(ctx, system, user) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ctx.apiKey,
      "anthropic-version": "2023-06-01",
      ...(ctx.workspaceId ? { "anthropic-workspace-id": ctx.workspaceId } : {}),
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL(),
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Claude could not reply.");
  return (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function extractJson(text) {
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

function toInt(value) {
  const n = Math.round(Number(String(value ?? "").replace(/[, ]/g, "")));
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

function oneOf(value, allowed, fallback) {
  const v = String(value || "").toLowerCase().trim();
  return allowed.includes(v) ? v : fallback;
}

function capitalize(value) {
  const s = String(value || "");
  return s ? s[0].toUpperCase() + s.slice(1) : "—";
}

function formatInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}


function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
