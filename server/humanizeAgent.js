import { readJson as sharedReadJson } from "./readJson.js";
import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resetBlogWriterModelChain, setBlogWriterModelChain } from "./blog-writer/blogLlmChain.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(__dirname, { interopDefault: true, esmResolve: true });
const { advancedHumanizeText } = jiti("./blog-writer/ai/flows/advanced-humanize-text.ts");

const VALID_TONES = new Set([
  "Informational",
  "Casual",
  "Formal",
  "Humorous",
  "Persuasive",
  "Technical",
  "Storytelling",
  "Academic",
  "Empathetic",
]);

export function attachHumanizeAgent(server) {
  server.middlewares.use(async (req, res, next) => {
    const [pathOnly, query = ""] = (req.url || "").split("?");
    if (pathOnly !== "/api/humanize") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      const body = await readJson(req);
      if (stream) {
        await streamHumanize(body, res);
        return;
      }
      const content = await runHumanizeJob(body, () => {});
      sendJson(res, 200, { content });
    } catch (error) {
      if (stream) {
        writeSse(res, { type: "error", error: error.message || "Humanization failed." });
        res.end();
        return;
      }
      sendJson(res, 500, { error: error.message || "Humanization failed." });
    }
  });
}

async function streamHumanize(body, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const emit = (payload) => writeSse(res, payload);

  try {
    const content = await runHumanizeJob(body, emit);
    emit({ type: "complete", content });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: error.message || "Humanization failed." });
    res.end();
  }
}

export async function runHumanizeJob(body, onProgress) {
  const { resolveBlogWriterGenkitChain } = await import("./blogModelRouter.js");
  const routed = await resolveBlogWriterGenkitChain({
    message: body.message || body.htmlContent?.slice(0, 500) || "humanize",
    effortAuto: body.effortAuto,
    effortTier: body.effortTier,
  });
  setBlogWriterModelChain(routed.chain);

  try {
    onProgress?.({
      type: "progress",
      phase: "humanize",
      stage: "humanizing",
      message: "Humanizing tone and flow",
      model: routed.model,
      effortTier: routed.resolvedTier,
      etaSeconds: 90,
    });

    let parsed = parseHumanizeRequest(body.message, { knowledge: body.knowledge });
    const priorHtml = String(body.previousHtml || "").trim();
    if (priorHtml && parsed.htmlContent.length < 120) {
      parsed = {
        ...parsed,
        htmlContent: priorHtml,
        preserveExactFormat: parsed.preserveExactFormat ?? true,
        blogTitle: parsed.blogTitle || body.previousTitle || "Humanized content",
        primaryKeyword: parsed.primaryKeyword || body.previousKeyword || "",
      };
    }

    if (!parsed.htmlContent || parsed.htmlContent.length < 20) {
      throw new Error(
        "Paste your blog article or landing page copy to humanize (HTML or plain text, at least a few sentences).",
      );
    }

    const result = await advancedHumanizeText({
      htmlContent: parsed.htmlContent,
      blogTitle: parsed.blogTitle,
      primaryKeyword: parsed.primaryKeyword || undefined,
      keywordOccurrences: parsed.primaryKeyword ? parsed.keywordOccurrences : undefined,
      tone: parsed.tone,
      language: parsed.language,
      humanizationLevel: parsed.humanizationLevel,
      knowledgeBase: parsed.knowledgeBase,
      preserveExactFormat: parsed.preserveExactFormat,
      deadlineAt: Date.now() + 770_000,
    });

    return formatHumanizeReply(result, parsed, routed);
  } finally {
    resetBlogWriterModelChain();
  }
}

export function parseHumanizeRequest(text, { knowledge } = {}) {
  let raw = String(text || "").trim();
  let tone = "Storytelling";
  let language = "English";
  let primaryKeyword = "";
  let preserveExactFormat = false;
  let humanizationLevel = 2;

  const split = raw.match(/^([\s\S]*?)\n---+\n([\s\S]+)$/);
  if (split) {
    const meta = parseMetaLines(split[1]);
    if (meta.tone) tone = meta.tone;
    if (meta.language) language = meta.language;
    if (meta.keyword) primaryKeyword = meta.keyword;
    if (meta.format != null) preserveExactFormat = meta.format;
    if (meta.level != null) humanizationLevel = meta.level;
    raw = split[2].trim();
  } else {
    const lines = raw.split("\n");
    const body = [];
    for (const line of lines) {
      const toneMatch = line.match(/^tone\s*:\s*(.+)$/i);
      if (toneMatch) {
        tone = toneMatch[1].trim();
        continue;
      }
      const langMatch = line.match(/^language\s*:\s*(.+)$/i);
      if (langMatch) {
        language = langMatch[1].trim();
        continue;
      }
      const kwMatch = line.match(/^keyword\s*:\s*(.+)$/i);
      if (kwMatch) {
        primaryKeyword = kwMatch[1].trim();
        continue;
      }
      const formatMatch = line.match(/^format\s*:\s*(.+)$/i);
      if (formatMatch) {
        preserveExactFormat = /preserve/i.test(formatMatch[1]);
        continue;
      }
      const levelMatch = line.match(/^level\s*:\s*(\d+)/i);
      if (levelMatch) {
        humanizationLevel = Math.min(3, Math.max(1, Number(levelMatch[1]) || 2));
        continue;
      }
      const contentTypeMatch = line.match(/^content type\s*:\s*(.+)$/i);
      if (contentTypeMatch) continue;
      if (/^(tone|language|keyword|format|level)\s*:\s*$/i.test(line)) continue;
      if (/^paste the content to humanize below\s*:?\s*$/i.test(line)) continue;
      body.push(line);
    }
    raw = body.join("\n").trim();
  }

  let htmlContent = raw;
  const looksLikeHtml = /<(?:p|h1|h2|h3|h4|ul|ol|li|div|table|article|section|blockquote|br)\b/i.test(htmlContent);
  if (!looksLikeHtml) {
    htmlContent = plainTextToHtml(htmlContent);
  } else if (!preserveExactFormat) {
    preserveExactFormat = true;
  }

  const normalizedTone = normalizeTone(tone);

  return {
    htmlContent,
    tone: normalizedTone,
    language: language || "English",
    primaryKeyword,
    keywordOccurrences: 4,
    preserveExactFormat,
    humanizationLevel,
    knowledgeBase: buildKnowledgeBlock(knowledge),
    blogTitle: primaryKeyword || "Humanized content",
  };
}

function parseMetaLines(block) {
  const out = {};
  for (const line of String(block || "").split("\n")) {
    const toneMatch = line.match(/^tone\s*:\s*(.+)$/i);
    if (toneMatch) out.tone = toneMatch[1].trim();
    const langMatch = line.match(/^language\s*:\s*(.+)$/i);
    if (langMatch) out.language = langMatch[1].trim();
    const kwMatch = line.match(/^keyword\s*:\s*(.+)$/i);
    if (kwMatch) out.keyword = kwMatch[1].trim();
    const formatMatch = line.match(/^format\s*:\s*(.+)$/i);
    if (formatMatch) out.format = /preserve/i.test(formatMatch[1]);
    const levelMatch = line.match(/^level\s*:\s*(\d+)/i);
    if (levelMatch) out.level = Math.min(3, Math.max(1, Number(levelMatch[1]) || 2));
  }
  return out;
}

function normalizeTone(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "Storytelling";
  const match = [...VALID_TONES].find((item) => item.toLowerCase() === trimmed.toLowerCase());
  if (match) return match;
  const title = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
  return VALID_TONES.has(title) ? title : "Storytelling";
}

function buildKnowledgeBlock(knowledge) {
  if (!knowledge || typeof knowledge !== "object") return undefined;
  const parts = [];
  for (const [key, value] of Object.entries(knowledge)) {
    if (value == null || value === "") continue;
    parts.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  }
  return parts.length ? parts.join("\n") : undefined;
}

function plainTextToHtml(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block.replace(/\n+/g, " "))}</p>`)
    .join("\n");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatHumanizeReply(result, input, routed) {
  const title = input.blogTitle || "Humanized content";
  const lines = [
    `WORKPANE|article|${title}`,
    "",
    "Humanized with the advanced anti-AI editor — higher perplexity and burstiness, clichés removed, facts preserved.",
    "",
    "METRICS_START",
    `Tone|${input.tone}`,
    `Language|${input.language}`,
  ];
  if (input.primaryKeyword) lines.push(`Target keyword|${input.primaryKeyword}`);
  if (routed?.model) lines.push(`Model|${routed.model}`);
  lines.push("METRICS_END", "", result.humanizedHtmlContent || "");
  return lines.join("\n");
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function readJson(req) {
  return sharedReadJson(req, { maxBytes: 2_000_000 });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
