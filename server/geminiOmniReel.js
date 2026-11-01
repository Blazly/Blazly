import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const INTERACTIONS_ROOT = "https://generativelanguage.googleapis.com/v1beta/interactions";
const FILES_ROOT = "https://generativelanguage.googleapis.com/v1beta";
const UPLOAD_ROOT = "https://generativelanguage.googleapis.com/upload/v1beta/files";
export const OMNI_REEL_MODEL = () =>
  process.env.GEMINI_OMNI_MODEL?.trim() || "gemini-omni-1.1-flash";

const REEL_DIR = path.join(process.cwd(), ".reels");
const SEGMENT_SECONDS = 10;
const MAX_SEGMENTS = 3;

export { SEGMENT_SECONDS, MAX_SEGMENTS };

export async function generateReelSegment({
  apiKey,
  prompt,
  seedPrompt,
  image,
  priorVideoBuffer,
  priorVideoMimeType,
  priorMediaFile,
  previousInteractionId,
  isExtension,
  onProgress,
}) {
  if (!apiKey) throw new Error("Video generation is not configured.");

  const priorMime = /^video\/(mp4|quicktime|webm)$/.test(priorVideoMimeType || "") ? priorVideoMimeType : "video/mp4";
  let priorVideoUri = null;
  if (isExtension && priorVideoBuffer?.length) {
    onProgress?.({
      type: "progress",
      phase: "reels_creation",
      stage: "prompt",
      message: "Uploading your previous clip for continuity",
    });
    priorVideoUri = await uploadGeminiVideoFile(apiKey, priorVideoBuffer, onProgress, priorMime);
  } else if (isExtension && priorMediaFile) {
    onProgress?.({
      type: "progress",
      phase: "reels_creation",
      stage: "prompt",
      message: "Loading previous segment for continuity",
    });
    try {
      const filePath = path.join(REEL_DIR, path.basename(priorMediaFile));
      const priorBuffer = await fs.readFile(filePath);
      priorVideoUri = await uploadGeminiVideoFile(apiKey, priorBuffer, onProgress);
    } catch {
      priorVideoUri = null;
    }
  }

  const body = buildInteractionBody({
    prompt,
    seedPrompt,
    image,
    priorVideoUri,
    priorVideoMimeType: priorVideoBuffer?.length ? priorMime : "video/mp4",
    previousInteractionId: priorVideoUri ? null : previousInteractionId,
    isExtension,
  });

  if (isExtension) {
    console.info(
      `[reels] extend request: ${priorVideoUri ? `video=${priorVideoUri}` : `previous_interaction_id=${body.previous_interaction_id}`}`,
    );
  }

  onProgress?.({
    type: "progress",
    phase: "reels_creation",
    stage: "generate",
    message: isExtension ? "Extending reel (+10s)" : "Rendering 1080p clip (up to 10s)",
  });

  let interaction = await postInteraction(apiKey, body);
  if (interaction.id && interaction.status !== "completed") {
    interaction = await pollInteraction(apiKey, interaction.id, onProgress);
  }

  onProgress?.({
    type: "progress",
    phase: "reels_creation",
    stage: "save",
    message: "Saving your reel",
  });

  const videoBuffer = await resolveInteractionVideo(apiKey, interaction);
  const saved = await persistReelFile(videoBuffer);

  return {
    interactionId: interaction.id,
    mediaUrl: saved.mediaUrl,
    mediaFilename: saved.mediaFilename,
    segmentSeconds: SEGMENT_SECONDS,
  };
}

function buildExtensionPrompt(seedPrompt, segmentPrompt) {
  const seed = String(seedPrompt || "").trim();
  const extra = String(segmentPrompt || "").trim();
  const lines = [
    "Extend this video. The scene continues seamlessly from the final frame with no jump cut or new scene.",
    "Keep the identical person, face, hair, clothing, room, props, lighting, and camera framing.",
    "Continue motion, dialogue, and ambient audio naturally for up to 10 more seconds.",
  ];
  if (seed) lines.push(`Stay faithful to this creative direction: ${seed}`);
  if (extra && extra !== seed) lines.push(`For this next 10 seconds: ${extra}`);
  return lines.join("\n");
}

function buildInteractionBody({
  prompt,
  seedPrompt,
  image,
  priorVideoUri,
  priorVideoMimeType,
  previousInteractionId,
  isExtension,
}) {
  const reelPrompt = String(prompt || "").trim();
  const textPrompt = isExtension
    ? buildExtensionPrompt(seedPrompt || reelPrompt, reelPrompt)
    : `${reelPrompt}\n\nSingle vertical social reel clip, maximum ${SEGMENT_SECONDS} seconds, portrait 9:16, smooth continuous motion.`;

  const body = {
    model: OMNI_REEL_MODEL(),
    response_format: isExtension
      ? {
          type: "video",
          resolution: "1080p",
          delivery: "uri",
        }
      : {
          type: "video",
          resolution: "1080p",
          aspect_ratio: "9:16",
          delivery: "uri",
        },
  };

  if (isExtension) {
    if (priorVideoUri) {
      body.input = [
        { type: "video", uri: priorVideoUri, mime_type: priorVideoMimeType || "video/mp4" },
        { type: "text", text: textPrompt },
      ];
      body.generation_config = {
        video_config: { task: "extend" },
      };
      return body;
    }
    if (previousInteractionId) {
      body.previous_interaction_id = previousInteractionId;
      body.input = textPrompt;
      body.generation_config = {
        video_config: { task: "extend" },
      };
      return body;
    }
    throw new Error("Could not continue this reel. Generate segment 1 again, then continue.");
  }

  if (image?.data) {
    body.input = [
      {
        type: "image",
        data: image.data,
        mime_type: image.mimeType || "image/jpeg",
      },
      {
        type: "text",
        text: `${textPrompt}\n\nUse the reference image for the main person or subject; match their appearance and follow the scene instructions.`,
      },
    ];
    body.generation_config = {
      video_config: {
        task: "image_to_video",
      },
    };
  } else {
    body.input = textPrompt;
  }

  return body;
}

async function postInteraction(apiKey, body) {
  const response = await fetch(INTERACTIONS_ROOT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(sanitizeProviderError(data?.error?.message || "Could not start reel generation."));
  }
  return data;
}

async function pollInteraction(apiKey, id, onProgress) {
  const url = `${INTERACTIONS_ROOT}/${encodeURIComponent(id)}`;
  for (let attempt = 0; attempt < 180; attempt++) {
    const response = await fetch(url, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(60_000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(sanitizeProviderError(data?.error?.message || "Reel generation failed."));
    }
    if (data.status === "completed") return data;
    if (data.status === "failed" || data.status === "cancelled") {
      throw new Error("Reel generation failed. Try a simpler prompt or a different reference photo.");
    }
    if (attempt % 3 === 0) {
      onProgress?.({
        type: "progress",
        phase: "reels_creation",
        stage: "generate",
        message: "Still rendering (1080p can take a few minutes)…",
      });
    }
    await sleep(5000);
  }
  throw new Error("Reel generation timed out. Try again with a shorter or simpler prompt.");
}

async function resolveInteractionVideo(apiKey, interaction) {
  const inline = extractInlineVideo(interaction);
  if (inline) return Buffer.from(inline, "base64");

  const uri = extractVideoUri(interaction);
  if (uri) return downloadFileByUri(apiKey, uri);

  throw new Error("The model did not return a video. Try adjusting your prompt.");
}

function extractInlineVideo(interaction) {
  for (const step of interaction?.steps || []) {
    if (step.type !== "model_output") continue;
    for (const part of step.content || []) {
      if (part.type === "video" && part.data) return part.data;
    }
  }
  return null;
}

function extractVideoUri(interaction) {
  const fromOutput = interaction?.output_video?.uri;
  if (fromOutput) return fromOutput;
  for (const step of interaction?.steps || []) {
    if (step.type !== "model_output") continue;
    for (const part of step.content || []) {
      if (part.type === "video" && part.uri) return part.uri;
    }
  }
  return null;
}

function parseGeminiFileId(uri) {
  const raw = String(uri || "");
  const match = raw.match(/\/files\/([a-zA-Z0-9_-]+)/);
  return match?.[1] || null;
}

async function downloadFileByUri(apiKey, uri) {
  const fileId = parseGeminiFileId(uri);
  if (!fileId) throw new Error("Could not download generated video.");

  const keyQuery = `key=${encodeURIComponent(apiKey)}`;

  for (let attempt = 0; attempt < 120; attempt++) {
    const metaRes = await fetch(`${FILES_ROOT}/files/${fileId}?${keyQuery}`, {
      signal: AbortSignal.timeout(60_000),
    });
    const meta = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok) {
      throw new Error(sanitizeProviderError(meta?.error?.message || "Could not fetch generated video."));
    }
    const state = meta.state || meta.file?.state;
    if (state === "FAILED") throw new Error("Video processing failed.");
    if (state === "ACTIVE") break;
    await sleep(4000);
  }

  const downloadUrl = `${FILES_ROOT}/files/${fileId}:download?alt=media&${keyQuery}`;
  const downloadRes = await fetch(downloadUrl, {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(300_000),
  });
  if (!downloadRes.ok) {
    const err = await downloadRes.json().catch(() => ({}));
    throw new Error(sanitizeProviderError(err?.error?.message || "Could not download generated video."));
  }
  const arrayBuffer = await downloadRes.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

async function uploadGeminiVideoFile(apiKey, buffer, onProgress, mimeType = "video/mp4") {
  onProgress?.({
    type: "progress",
    phase: "reels_creation",
    stage: "prompt",
    message: "Uploading previous clip",
  });

  const startRes = await fetch(`${UPLOAD_ROOT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(buffer.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
    },
    body: JSON.stringify({ file: { display_name: "reel_previous_clip" } }),
    signal: AbortSignal.timeout(120_000),
  });
  const startData = await startRes.json().catch(() => ({}));
  if (!startRes.ok) {
    throw new Error(sanitizeProviderError(startData?.error?.message || "Could not upload previous clip."));
  }

  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Could not upload previous clip.");

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(buffer.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: buffer,
    signal: AbortSignal.timeout(300_000),
  });
  const uploadData = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok) {
    throw new Error(sanitizeProviderError(uploadData?.error?.message || "Could not upload previous clip."));
  }

  const fileUri = uploadData.file?.uri || uploadData.uri || "";
  const resource = uploadData.file?.name || uploadData.name || parseGeminiFileId(fileUri);
  const fileId = typeof resource === "string" && resource.includes("/") ? resource.split("/").pop() : resource;
  if (!fileId) throw new Error("Could not upload previous clip.");

  // Uploaded videos stay PROCESSING for a while; the model ignores or rejects them until ACTIVE.
  onProgress?.({ type: "progress", phase: "reels_creation", stage: "prompt", message: "Processing previous clip" });
  for (let attempt = 0; attempt < 100; attempt++) {
    const metaRes = await fetch(`${FILES_ROOT}/files/${fileId}?key=${encodeURIComponent(apiKey)}`, {
      signal: AbortSignal.timeout(60_000),
    });
    const meta = await metaRes.json().catch(() => ({}));
    if (!metaRes.ok) {
      throw new Error(sanitizeProviderError(meta?.error?.message || "Could not check the uploaded clip."));
    }
    const state = meta.state || meta.file?.state;
    if (state === "ACTIVE") {
      const uri = meta.uri || meta.file?.uri || fileUri || `${FILES_ROOT}/files/${fileId}`;
      console.info(`[reels] prior clip ready: ${fileId} (${buffer.length} bytes, ${mimeType}) after ${attempt} checks`);
      return uri;
    }
    if (state === "FAILED") throw new Error("Your previous clip could not be processed. Try exporting it as MP4.");
    await sleep(3000);
  }
  throw new Error("Your previous clip is taking too long to process. Try a shorter or smaller file.");
}

async function persistReelFile(buffer) {
  await fs.mkdir(REEL_DIR, { recursive: true });
  const id = crypto.randomBytes(12).toString("hex");
  const filename = `${id}.mp4`;
  await fs.writeFile(path.join(REEL_DIR, filename), buffer);
  return { mediaUrl: `/api/reel-media/${filename}`, mediaFilename: filename };
}

export function attachReelMedia(server) {
  server.middlewares.use(async (req, res, next) => {
    const url = req.url?.split("?")[0] || "";
    const match = url.match(/^\/api\/reel-media\/([a-f0-9]+\.mp4)$/i);
    if (!match) return next();
    const filename = match[1];
    if (filename.includes("..")) {
      sendJson(res, 400, { error: "Invalid path" });
      return;
    }
    try {
      const filePath = path.join(REEL_DIR, filename);
      const data = await fs.readFile(filePath);
      res.statusCode = 200;
      res.setHeader("Content-Type", "video/mp4");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.end(data);
    } catch {
      sendJson(res, 404, { error: "Not found" });
    }
  });
}

function sanitizeProviderError(message) {
  return String(message || "Reel generation failed.")
    .replace(/gemini[-\w.]*/gi, "")
    .replace(/google|generativelanguage|omni\s*flash?/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 280) || "Reel generation failed.";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
