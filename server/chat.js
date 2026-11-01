import { readJson as sharedReadJson } from "./readJson.js";
import { scrapeWebsiteContext, urlsFromText } from "./analyze.js";
import { buildDataForSeoContext } from "./dataforseo.js";
import { blazlyLayoutPrompt } from "./auditLayoutPrompt.js";
import { geminiCompleteChat, geminiStreamChat } from "./geminiChat.js";
import { resolveComposerModel } from "./modelRouter.js";

const MODEL = "claude-opus-5-5";
const MAX_OUTPUT_TOKENS = Number(process.env.ANTHROPIC_MAX_OUTPUT_TOKENS) || 16384;

export function attachChat(server, { apiKey, workspaceId, model, geminiApiKey, dataForSeo }) {
  server.middlewares.use(async (req, res, next) => {
    const path = (req.url || "").split("?")[0];
    if (path !== "/api/chat") return next();
    if (req.method !== "POST") {
      send(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJson(req);
      const query = (req.url || "").split("?")[1] || "";
      const stream = new URLSearchParams(query).get("stream") === "1";
      const payload = {
        apiKey,
        workspaceId,
        geminiApiKey: geminiApiKey || process.env.GEMINI_API_KEY,
        model: model || process.env.ANTHROPIC_MODEL || MODEL,
        messages: body.messages,
        project: text(body.project),
        scope: text(body.scope),
        mode: text(body.mode),
        effortAuto:
          body.effortAuto === undefined || body.effortAuto === true || body.effortAuto === "true",
        effortTier: text(body.effortTier) || "medium",
        website: text(body.website),
        knowledge: body.knowledge,
        wantsFullArticle: Boolean(body.wantsFullArticle),
        dataForSeo,
      };
      if (stream) {
        await streamCompleteChat(payload, res);
        return;
      }
      const reply = await completeChat(payload);
      send(res, 200, { reply });
    } catch (error) {
      send(res, error.status || 500, { error: error.message || "Claude could not reply." });
    }
  });
}

async function prepareChatRequest({
  apiKey,
  workspaceId,
  geminiApiKey,
  model,
  messages,
  project,
  scope,
  mode,
  effortAuto,
  effortTier,
  website,
  knowledge,
  wantsFullArticle,
  dataForSeo,
}) {
  if (!apiKey) fail(500, "Claude is not configured.");
  const history = normalizeMessages(messages);
  if (!history.length) fail(400, "Enter a message first.");

  const routed = await resolveComposerModel({
    effortAuto: Boolean(effortAuto),
    effortTier,
    messages: history,
    apiKey,
    workspaceId,
  });

  const [scraped, dataForSeoContext] = await Promise.all([
    buildScrapeContext(history),
    buildDataForSeoContext({
      apiKey,
      model: routed.provider === "anthropic" ? routed.model : model,
      messages: history,
      website,
      config: dataForSeo,
      scope,
      mode,
      project,
    }),
  ]);

  const system = systemPrompt({
    project,
    scope,
    mode,
    effortTier: routed.resolvedTier,
    effortAuto: routed.effortAuto,
    website,
    knowledge,
    scraped,
    wantsFullArticle,
    dataForSeoContext,
  });

  return {
    history,
    routed,
    system,
    body: {
      model: routed.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages: history,
    },
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-workspace-id": workspaceId || "",
    },
    geminiApiKey,
  };
}

async function completeChat(payload) {
  const prepared = await prepareChatRequest(payload);
  if (prepared.routed.provider === "gemini") {
    return geminiCompleteChat({
      apiKey: prepared.geminiApiKey,
      model: prepared.routed.model,
      system: prepared.system,
      messages: prepared.history,
    });
  }
  const { body, headers } = prepared;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    fail(response.status === 401 || response.status === 403 ? 502 : response.status || 502, cleanError(data));
  }
  const reply = (data.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!reply) fail(502, "Claude returned an empty reply.");
  return reply;
}

async function streamCompleteChat(payload, res) {
  const prepared = await prepareChatRequest(payload);
  if (prepared.routed.provider === "gemini") {
    await geminiStreamChat(
      {
        apiKey: prepared.geminiApiKey,
        model: prepared.routed.model,
        system: prepared.system,
        messages: prepared.history,
      },
      res,
    );
    return;
  }
  const { body, headers } = prepared;
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, stream: true }),
    signal: AbortSignal.timeout(300000),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    send(res, response.status === 401 || response.status === 403 ? 502 : response.status || 502, {
      error: cleanError(data),
    });
    return;
  }

  if (!response.body) {
    send(res, 502, { error: "Claude could not reply." });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let wrote = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
      for (const line of block.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        res.write(`data: ${data}\n\n`);
        try {
          const event = JSON.parse(data);
          if (event.type === "content_block_delta" && event.delta?.type === "text_delta" && event.delta.text) {
            wrote = true;
          }
        } catch {
          // Ignore malformed frames.
        }
      }
    }
  }

  if (!wrote) {
    res.write(`data: ${JSON.stringify({ type: "error", error: "Claude returned an empty reply." })}\n\n`);
  }
  res.write("data: [DONE]\n\n");
  res.end();
}

async function buildScrapeContext(messages) {
  const urls = new Set();
  for (const message of messages.filter((item) => item.role === "user").slice(-3)) {
    for (const url of urlsFromText(messagePlainText(message.content))) urls.add(url);
  }
  if (!urls.size) return "";

  const blocks = await Promise.all(
    [...urls].map(async (url) => {
      try {
        const page = await scrapeWebsiteContext(url);
        return `URL: ${page.url}\n${page.text}`;
      } catch (error) {
        return `URL: ${url}\nBlazly scrape note: ${error.message || "Could not read this page."}`;
      }
    })
  );
  return blocks.join("\n\n---\n\n");
}

function systemPrompt({
  project,
  scope,
  mode,
  effortTier,
  effortAuto,
  website,
  knowledge,
  scraped,
  wantsFullArticle,
  dataForSeoContext,
}) {
  const brief = knowledgeBrief(knowledge);
  return [
    "You are Blazly, the assistant inside an SEO, GEO, and AEO workspace.",
    "Answer the user's latest message directly. Use the project context when it helps.",
    "Blazly classifies each message first: normal marketing/strategy/copy questions get a normal answer with no live metric block. When Blazly live SEO data appears below, live research already ran for this turn — use it.",
    "When the user names a domain or URL, backlink and authority metrics refer to THAT domain. Only use Website from context when they mean our/my site with no other domain named. Present backlink summary rank as domain strength (0-1000).",
    "Never mention vendor names or backend tools. When live SEO data is present, use those numbers; do not say data is missing or run keyword volume on the user's question sentence.",
    "If live SEO data is present, show the relevant metrics (volume, backlinks, domain rank, referring domains, AI mentions) in TABLE_START or markdown tables. Do not add ACTION buttons to fetch metrics.",
    "If no live SEO data block is attached, answer from strategy and context like a marketing partner — do not apologize for missing API data.",
    "When scraped website text appears below, Blazly already fetched those pages with its crawler. Use that text as your source. Do not say you cannot browse, open, or scan URLs when scrape data is present.",
    "When the user attaches images, describe and use what you see in them. When they attach files, use any inlined file text in their message.",
    blazlyLayoutPrompt(),
    "Article default plan rows: Target Keyword, SEO Title, Meta Description, Word Count, Internal Linking, Tone. Do not include Images or image prompts.",
    "Do not suggest generating, sourcing, or adding images, hero banners, stock photos, or alt-text sections unless the user explicitly asks.",
    wantsFullArticle
      ? "The user wants the FULL article now. Reply with one short intro line, then WORKPANE|article|Title on its own line, then stream the complete markdown article (H1 title, sections, lists, tables as needed). Do not use ACTION|Review Article. Do not stop at a preview or excerpt."
      : "After plan approval, stream the full article in the same reply: WORKPANE|article|Title then complete markdown. Skip ACTION|Review Article when the full draft is included.",
    "When delivering a full article, put all prose after WORKPANE so the right panel can render it while you stream.",
    "Always finish every answer completely. Never stop mid-table, mid-list, or mid-sentence due to length.",
    project && `Project: ${project}`,
    website && `Website: ${website}`,
    scope && `Selected workstream: ${scope}`,
    mode && `Mode: ${mode}`,
    effortAuto
      ? `Effort: Auto (routed tier: ${effortTier || "medium"})`
      : effortTier && `Effort tier: ${effortTier}`,
    brief && `Knowledge base:\n${brief}`,
    scraped && `Scraped website text (fetched by Blazly with a custom user agent):\n${scraped}`,
    dataForSeoContext,
  ].filter(Boolean).join("\n");
}

function knowledgeBrief(knowledge) {
  if (!knowledge || typeof knowledge !== "object") return "";
  const brief = {
    companyName: knowledge.companyName,
    description: knowledge.description,
    industry: knowledge.industry,
    location: knowledge.location,
    services: knowledge.services,
    products: knowledge.products,
    targetAudiences: knowledge.targetAudiences,
    competitors: knowledge.competitors,
    marketAnalysis: knowledge.marketAnalysis,
  };
  return JSON.stringify(brief).slice(0, 6000);
}

function normalizeMessages(value) {
  if (!Array.isArray(value)) return [];
  const messages = value
    .filter((item) => item && (item.role === "user" || item.role === "assistant"))
    .map((item) => normalizeMessage(item))
    .filter((item) => messageHasPayload(item))
    .slice(-24);
  while (messages[0]?.role === "assistant") messages.shift();
  return messages;
}

function normalizeMessage(item) {
  if (item.role === "assistant") {
    return { role: "assistant", content: text(item.content).slice(0, 48000) };
  }

  const textPart = text(item.content).slice(0, 12000);
  const images = Array.isArray(item.attachments)
    ? item.attachments.filter((part) => part?.type === "image" && part?.data)
    : [];

  if (!images.length) {
    return { role: "user", content: textPart };
  }

  const blocks = images.slice(0, 8).map((image) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: imageMediaType(image.mediaType),
      data: String(image.data).slice(0, 28_000_000),
    },
  }));

  if (textPart) blocks.push({ type: "text", text: textPart });
  return { role: "user", content: blocks.length === 1 && blocks[0].type === "text" ? textPart : blocks };
}

function imageMediaType(value) {
  const type = text(value).toLowerCase();
  if (/^image\/(jpeg|png|gif|webp)$/.test(type)) return type;
  if (type === "image/jpg") return "image/jpeg";
  return "image/png";
}

function messageHasPayload(item) {
  if (!item) return false;
  if (item.role === "assistant") return Boolean(text(item.content));
  if (Array.isArray(item.content)) return item.content.length > 0;
  return Boolean(text(item.content));
}

function cleanError(data) {
  const message = data?.error?.message || "";
  if (/api key|authentication|permission/i.test(message)) return "Claude rejected the API key.";
  if (/workspace/i.test(message)) return "Claude could not use that workspace.";
  if (/model/i.test(message)) return "Claude Opus 5.5 is not available for this key.";
  if (!message) return "Claude could not reply.";
  return message.length > 180 ? "Claude could not reply." : message;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function messagePlainText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n");
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function readJson(req) {
  return sharedReadJson(req, { maxBytes: 4_000_000 });
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
