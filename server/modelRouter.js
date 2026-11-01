const VALID_TIERS = new Set(["low", "medium", "high", "extraHigh", "max"]);

const GEMINI_FLASH = () => process.env.GEMINI_MODEL?.trim() || "gemini-3.6-flash";
const CLAUDE_OPUS = () => process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
/** Intent classification only — not used for generation. */
const CLASSIFIER_MODEL =
  process.env.ANTHROPIC_CLASSIFIER_MODEL?.trim() ||
  process.env.ANTHROPIC_BLOG_MODEL?.trim() ||
  "claude-sonnet-5-5";

export function modelForEffortTier(tier) {
  const id = VALID_TIERS.has(tier) ? tier : "medium";
  if (id === "extraHigh" || id === "max") {
    return { provider: "anthropic", model: CLAUDE_OPUS(), resolvedTier: id };
  }
  return { provider: "gemini", model: GEMINI_FLASH(), resolvedTier: id };
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role !== "user") continue;
    const content = messages[i].content;
    if (typeof content === "string") return content.trim().slice(0, 8000);
    if (Array.isArray(content)) {
      return content
        .filter((b) => b?.type === "text" && b.text)
        .map((b) => b.text)
        .join("\n")
        .trim()
        .slice(0, 8000);
    }
  }
  return "";
}

export async function classifyEffortTier(messages, { apiKey, workspaceId }) {
  const snippet = lastUserText(messages);
  if (!snippet) return "medium";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
    },
    body: JSON.stringify({
      model: CLASSIFIER_MODEL,
      max_tokens: 16,
      system:
        "Classify the user's request effort for an SEO/marketing assistant. Reply with exactly one token: low, medium, high, or extraHigh. No punctuation or explanation.\n" +
        "low = quick factual answer or tiny edit.\n" +
        "medium = routine SEO/copy/strategy task.\n" +
        "high = multi-step analysis, audits, structured deliverables.\n" +
        "extraHigh = deep reasoning, long reports, complex agentic work.",
      messages: [{ role: "user", content: snippet }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) return "medium";

  const raw = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    .toLowerCase();

  if (raw.includes("extra")) return "extraHigh";
  if (raw.includes("high")) return "high";
  if (raw.includes("low")) return "low";
  if (raw.includes("medium")) return "medium";
  return "medium";
}

export async function classifyBlogEffortTier(briefText, { apiKey, workspaceId }) {
  const snippet = String(briefText || "")
    .trim()
    .slice(0, 8000);
  if (!snippet || !apiKey) return "medium";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
    },
    body: JSON.stringify({
      model: CLASSIFIER_MODEL,
      max_tokens: 16,
      system:
        "Classify SEO blog generation effort. Reply with exactly one token: low, medium, high, or extraHigh.\n" +
        "low = short/simple listicle or brief under ~900 words.\n" +
        "medium = standard SEO article (~1000-2000 words), informational tone.\n" +
        "high = long guide, comparisons, multiple sections, heavy structure.\n" +
        "extraHigh = very long (2500+ words), YMYL/sensitive claims, deep research, complex comparisons.",
      messages: [{ role: "user", content: snippet }],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) return "medium";

  const raw = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim()
    .toLowerCase();

  if (raw.includes("extra")) return "extraHigh";
  if (raw.includes("high")) return "high";
  if (raw.includes("low")) return "low";
  if (raw.includes("medium")) return "medium";
  return "medium";
}

export async function resolveComposerModel({ effortAuto, effortTier, messages, apiKey, workspaceId }) {
  if (effortAuto) {
    const tier = await classifyEffortTier(messages, { apiKey, workspaceId });
    return { ...modelForEffortTier(tier), effortAuto: true };
  }
  return { ...modelForEffortTier(effortTier), effortAuto: false };
}
