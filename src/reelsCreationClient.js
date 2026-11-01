export const REELS_CREATION_BRIEF = `Reel prompt:

Each clip is up to 10 seconds (1080p, 9:16).
Optional: attach a photo of a person to match their look in the reel.`;

export const REELS_CONTINUE_SETUP_USER = "Continue reel setup";

export const REELS_CONTINUE_EXTEND_PREFILL = `Extension prompt:

Attach your previous video clip with + (must be under 10 seconds).`;

export function reelsCreationBriefPrefill() {
  return REELS_CREATION_BRIEF;
}

export function reelsContinueExtendPrefill() {
  return REELS_CONTINUE_EXTEND_PREFILL;
}

export function isContinueReelSetup(text) {
  const normalized = String(text || "").trim();
  return /^continue\s+reel\s*(setup)?\s*$/i.test(normalized);
}

export function isLegacyContinueReelMessage(text) {
  const normalized = String(text || "").trim();
  return /^continue\s+reel\s*:/i.test(normalized) && !/^continue\s+reel\s*(setup)?\s*$/i.test(normalized);
}

/** True when user tapped Continue or sent legacy text — open upload + prompt step, not generation. */
export function shouldOpenContinueReelSetup(content, attachments) {
  if (isContinueReelSetup(content)) return true;
  if (!isLegacyContinueReelMessage(content)) return false;
  const extensionPrompt =
    parseExtensionPrompt(content) ||
    String(content || "")
      .replace(/^continue\s+reel\s*:\s*/i, "")
      .trim();
  if (hasVideoAttachment(attachments) && extensionPrompt.length >= 8) return false;
  return true;
}

export function hasVideoAttachment(attachments) {
  return (attachments || []).some((item) => item.type === "video" && item.data);
}

export function isEmptyReelsCreationBrief(text) {
  const normalized = String(text || "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (normalized === REELS_CREATION_BRIEF.trim()) return true;
  return !parseReelsCreationBrief(normalized).prompt;
}

export function parseExtensionPrompt(raw) {
  let extensionPrompt = "";
  for (const line of String(raw || "").split("\n")) {
    const m = line.trim().match(/^extension\s*prompt\s*:\s*(.*)$/i);
    if (m) extensionPrompt = m[1].trim();
  }
  return extensionPrompt;
}

export function parseReelsCreationBrief(text, attachments) {
  const raw = String(text || "").replace(/\r\n/g, "\n").trim();
  if (isContinueReelSetup(raw)) {
    return { mode: "continue_setup" };
  }

  const legacyMatch = raw.match(/^continue\s+reel\s*:\s*([\s\S]*)$/i);
  if (legacyMatch) {
    const extensionPrompt = parseExtensionPrompt(raw) || legacyMatch[1].trim();
    if (hasVideoAttachment(attachments) && extensionPrompt.length >= 8) {
      return { mode: "continue_extend", extensionPrompt, prompt: extensionPrompt };
    }
    return { mode: "continue_setup" };
  }

  const extensionPrompt = parseExtensionPrompt(raw);
  if (extensionPrompt) {
    return { mode: "continue_extend", extensionPrompt, prompt: extensionPrompt };
  }

  let prompt = "";
  for (const line of raw.split("\n")) {
    const m = line.trim().match(/^reel\s*prompt\s*:\s*(.+)$/i);
    if (m) prompt = m[1].trim();
  }
  if (!prompt && raw && !/^reel\s*prompt\s*:/im.test(raw)) {
    const lines = raw.split("\n").filter((line) => !/^each clip is up to 10/i.test(line.trim()));
    const first = lines[0]?.trim();
    if (first && first.length >= 12 && !/^continue\s+reel\s*:/i.test(first)) {
      prompt = first;
    }
  }
  return { mode: "create", prompt };
}

export function looksLikeReelsCreationBrief(text) {
  const t = String(text || "");
  if (isEmptyReelsCreationBrief(t)) return true;
  return (
    /^reel\s*prompt\s*:/im.test(t) ||
    /^extension\s*prompt\s*:/im.test(t) ||
    isContinueReelSetup(t)
  );
}

export function reelsContinueSetupAssistantMessage() {
  return `To add the next **10 seconds** to your reel:

1. **Previous video** — attach your last clip with **+** (must be **under 10 seconds**).
2. **Extension prompt** — describe what happens next in the same scene.

Fill in **Extension prompt:** below and send when both are ready.

METRICS_START
Previous video|Required — under 10 seconds (attach with +)
Extension prompt|Required — next action in the same scene
METRICS_END`;
}

export function extractReelStateFromMessages(messages) {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg?.role !== "assistant") continue;
    const block = String(msg.content || "").match(/REEL_STATE_START\n([\s\S]*?)\nREEL_STATE_END/);
    if (!block) continue;
    const state = {};
    for (const line of block[1].split("\n")) {
      const pipe = line.indexOf("|");
      if (pipe === -1) continue;
      const key = line.slice(0, pipe).trim();
      const value = line.slice(pipe + 1).trim();
      if (key === "interaction_id") state.interactionId = value;
      if (key === "segment") state.segment = Number(value) || 1;
      if (key === "seed_prompt") state.seedPrompt = value;
      if (key === "media_file") state.mediaFile = value;
    }
    if (state.interactionId) return state;
  }
  return null;
}

export function shouldRunReelsCreation(text, { agentActive, inChat } = {}) {
  if (!agentActive) return false;
  if (/^continue\s+reel/i.test(String(text || "").trim())) return false;
  const parsed = parseReelsCreationBrief(text);
  if (parsed.mode !== "create") return false;

  if (parsed.prompt && parsed.prompt.length >= 12) return true;
  if (inChat && parsed.prompt && parsed.prompt.length >= 8) return true;
  return false;
}

export async function runReelsCreationStream({ message, attachments, reelState, onProgress } = {}) {
  const response = await fetch("/api/reels-creation?stream=1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      attachments: (attachments || []).map((item) => ({
        type: item.type,
        name: item.name,
        mediaType: item.mediaType,
        data: item.data,
      })),
      reelState,
    }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Reels creation failed.");
  }

  return consumeReelsCreationSse(response, onProgress);
}

async function consumeReelsCreationSse(response, onProgress) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type === "progress") onProgress?.(event);
      if (event.type === "error") throw new Error(event.error || "Reels creation failed.");
      if (event.type === "complete") {
        const content = String(event.content || "").trim();
        if (!content) throw new Error("Reels creation returned empty content.");
        return content;
      }
    }
  }

  throw new Error("Reels creation ended without a result.");
}
