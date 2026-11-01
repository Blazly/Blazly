import { readJson as sharedReadJson } from "./readJson.js";
import {
  MAX_SEGMENTS,
  SEGMENT_SECONDS,
  attachReelMedia,
  generateReelSegment,
} from "./geminiOmniReel.js";
import { assertContinueVideoDuration, getVideoDurationSeconds } from "./videoDuration.js";

export function attachReelsCreation(server, ctx) {
  attachReelMedia(server);

  server.middlewares.use(async (req, res, next) => {
    const [pathOnly, query = ""] = (req.url || "").split("?");
    if (pathOnly !== "/api/reels-creation") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      if (!ctx?.geminiApiKey) throw new Error("Reels creation is not available for this workspace yet.");
      if (stream) {
        await streamReelsJob(readJson(req), res, ctx);
        return;
      }
      const body = await readJson(req);
      const content = await runReelsCreationJob(body, () => {}, ctx);
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

async function streamReelsJob(bodyPromise, res, ctx) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (payload) => writeSse(res, payload);
  try {
    const body = await bodyPromise;
    const content = await runReelsCreationJob(body, emit, ctx);
    emit({ type: "complete", content });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: sanitizeError(error.message) });
    res.end();
  }
}

export async function runReelsCreationJob(body, onProgress, ctx) {
  const parsed = parseReelsBrief(body.message, body.reelState, body.attachments);
  if (parsed.mode === "continue_extend") {
    throw new Error("Reels are single 10-second clips. Describe a new reel after Reel prompt:.");
  }
  const isContinue = false;

  if (!isContinue && (!parsed.prompt || parsed.prompt.length < 12)) {
    throw new Error(
      "Describe your reel after Reel prompt: (scene, mood, camera, action). Each clip is up to 10 seconds.",
    );
  }

  if (isContinue) {
    if (!parsed.reelState?.interactionId) {
      throw new Error("Generate a first reel segment before continuing.");
    }
    if ((parsed.reelState.segment || 1) >= MAX_SEGMENTS) {
      throw new Error(`This reel is at the ${MAX_SEGMENTS * SEGMENT_SECONDS}-second maximum (3 × 10s segments).`);
    }
    if (!parsed.continueVideo) {
      throw new Error("Attach your previous video clip with + (must be under 10 seconds).");
    }
    if (!parsed.prompt || parsed.prompt.length < 8) {
      throw new Error("Describe the next 10 seconds after Extension prompt:, then send.");
    }
  }

  onProgress?.({
    type: "progress",
    phase: "reels_creation",
    stage: "prompt",
    message: isContinue ? "Continuing your reel" : "Preparing your reel",
  });

  const image = pickReferenceImage(body.attachments);
  if (!isContinue && image) {
    onProgress?.({
      type: "progress",
      phase: "reels_creation",
      stage: "prompt",
      message: "Using your reference photo",
    });
  }

  const seedPrompt = isContinue
    ? parsed.reelState?.seedPrompt || parsed.prompt
    : parsed.prompt;

  let priorVideoBuffer = null;
  if (isContinue && parsed.continueVideo?.data) {
    priorVideoBuffer = Buffer.from(parsed.continueVideo.data, "base64");
    const duration = getVideoDurationSeconds(priorVideoBuffer);
    console.info(
      `[reels] continue: received ${parsed.continueVideo.name} (${priorVideoBuffer.length} bytes, ${parsed.continueVideo.mimeType}, ${duration ?? "?"}s)`,
    );
    assertContinueVideoDuration(duration);
  }

  const result = await generateReelSegment({
    apiKey: ctx.geminiApiKey,
    prompt: parsed.prompt,
    seedPrompt,
    image: isContinue ? null : image,
    priorVideoBuffer: isContinue ? priorVideoBuffer : null,
    priorVideoMimeType: parsed.continueVideo?.mimeType,
    priorMediaFile: null,
    previousInteractionId: isContinue ? parsed.reelState.interactionId : null,
    isExtension: isContinue,
    onProgress,
  });

  const segment = isContinue ? (parsed.reelState.segment || 1) + 1 : 1;
  const totalSeconds = segment * SEGMENT_SECONDS;
  const canContinue = segment < MAX_SEGMENTS;

  return formatReelsReply({
    prompt: parsed.prompt || seedPrompt,
    seedPrompt,
    mediaUrl: result.mediaUrl,
    mediaFile: result.mediaFilename,
    segment,
    totalSeconds,
    maxSeconds: MAX_SEGMENTS * SEGMENT_SECONDS,
    interactionId: result.interactionId,
    canContinue,
    usedReferenceImage: Boolean(image) && !isContinue,
    isExtension: isContinue,
  });
}

function pickReferenceImage(attachments) {
  const row = (attachments || []).find((item) => item.type === "image" && item.data);
  if (!row) return null;
  return {
    data: row.data,
    mimeType: row.mediaType || "image/jpeg",
    name: row.name || "reference.jpg",
  };
}

function formatReelsReply({
  prompt,
  seedPrompt,
  mediaUrl,
  mediaFile,
  segment,
  totalSeconds,
  maxSeconds,
  interactionId,
  canContinue,
  usedReferenceImage,
  isExtension,
}) {
  const lines = [];
  lines.push(`Your reel is ready (up to ${SEGMENT_SECONDS}s, 1080p portrait).`);
  lines.push("");
  lines.push("METRICS_START");
  lines.push(`Clip length|Up to ${SEGMENT_SECONDS}s`);
  lines.push(`Resolution|1080p · 9:16`);
  lines.push(`Reference photo|${usedReferenceImage ? "Yes" : "No"}`);
  lines.push(`Prompt|${prompt.replace(/\|/g, "/").slice(0, 200)}`);
  lines.push("METRICS_END");
  lines.push("");
  lines.push("VIDEO_START");
  lines.push(`Reel|${mediaUrl}`);
  lines.push("VIDEO_END");
  lines.push("");
  lines.push("Want another take? Send a new **Reel prompt:** to generate a different 10-second clip.");
  lines.push("");
  lines.push("REEL_STATE_START");
  lines.push(`interaction_id|${interactionId}`);
  lines.push(`segment|${segment}`);
  lines.push(`total_seconds|${totalSeconds}`);
  lines.push(`seed_prompt|${String(seedPrompt || prompt).replace(/\|/g, "/").slice(0, 500)}`);
  if (mediaFile) lines.push(`media_file|${mediaFile}`);
  lines.push("REEL_STATE_END");
  return lines.join("\n");
}

function pickContinueVideo(attachments) {
  const row = (attachments || []).find((item) => item.type === "video" && item.data);
  if (!row) return null;
  return {
    data: row.data,
    mimeType: row.mediaType || "video/mp4",
    name: row.name || "previous.mp4",
  };
}

function parseExtensionPrompt(raw) {
  let extensionPrompt = "";
  for (const line of String(raw || "").split("\n")) {
    const m = line.trim().match(/^extension\s*prompt\s*:\s*(.*)$/i);
    if (m) extensionPrompt = m[1].trim();
  }
  return extensionPrompt;
}

export function parseReelsBrief(message, explicitState, attachments) {
  const raw = String(message || "").replace(/\r\n/g, "\n").trim();
  let mode = "create";
  let prompt = "";
  const continueVideo = pickContinueVideo(attachments);
  const extensionPrompt = parseExtensionPrompt(raw);

  if (extensionPrompt && continueVideo) {
    mode = "continue_extend";
    prompt = extensionPrompt;
  } else if (extensionPrompt) {
    mode = "continue_extend";
    prompt = extensionPrompt;
  } else {
    for (const line of raw.split("\n")) {
      const m = line.trim().match(/^reel\s*prompt\s*:\s*(.+)$/i);
      if (m) prompt = m[1].trim();
    }
    if (!prompt && raw && !/^reel\s*prompt\s*:/im.test(raw)) {
      const first = raw.split("\n")[0]?.trim();
      if (first && first.length >= 12) prompt = first;
    }
  }

  const reelState = explicitState || parseReelStateFromText(raw);
  return { mode, prompt, reelState, continueVideo };
}

function parseReelStateFromText(text) {
  const block = String(text || "").match(/REEL_STATE_START\n([\s\S]*?)\nREEL_STATE_END/);
  if (!block) return null;
  const state = {};
  for (const line of block[1].split("\n")) {
    const pipe = line.indexOf("|");
    if (pipe === -1) continue;
    const key = line.slice(0, pipe).trim();
    const value = line.slice(pipe + 1).trim();
    if (key === "interaction_id") state.interactionId = value;
    if (key === "segment") state.segment = Number(value) || 1;
    if (key === "total_seconds") state.totalSeconds = Number(value) || 0;
    if (key === "seed_prompt") state.seedPrompt = value;
    if (key === "media_file") state.mediaFile = value;
  }
  return state.interactionId ? state : null;
}

function sanitizeError(message) {
  return String(message || "Reels creation failed.")
    .replace(/gemini[-\w.]*/gi, "")
    .replace(/google|generativelanguage|omni\s*flash?/gi, "")
    .replace(/anthropic|claude[-\w.]*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim() || "Reels creation failed.";
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function readJson(req) {
  return sharedReadJson(req, { maxBytes: 3_000_000 });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
