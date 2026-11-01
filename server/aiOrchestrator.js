import { readJson as sharedReadJson } from "./readJson.js";
import { catalogForPrompt, AGENT_CATALOG } from "./agentsCatalog.js";

const CLASSIFIER =
  process.env.ANTHROPIC_CLASSIFIER_MODEL?.trim() ||
  process.env.ANTHROPIC_BLOG_MODEL?.trim() ||
  "claude-sonnet-5-5";

export function attachAiOrchestrator(server, ctx) {
  server.middlewares.use(async (req, res, next) => {
    const path = (req.url || "").split("?")[0];
    if (path !== "/api/ai-orchestrator") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    try {
      const body = await readJson(req);
      const route = await routeObjective(body, ctx);
      sendJson(res, 200, route);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Could not route objective." });
    }
  });
}

export async function routeObjective(body, ctx) {
  const apiKey = ctx?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI routing is not configured.");

  const messages = normalizeMessages(body.messages);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const objective = String(lastUser?.content || body.objective || "").trim();
  if (!objective) throw new Error("Enter an objective first.");

  const project = text(body.project);
  const website = text(body.website);
  const knowledge = body.knowledge;
  const brand = knowledge?.companyName || knowledge?.brandName || "";

  const timezone = validTimezone(body.timezone);
  const nowLocal = new Date().toLocaleString("en-US", {
    timeZone: timezone,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "longOffset",
  });

  const transcript = messages
    .slice(-12)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 4000)}`)
    .join("\n\n");

  const system = `You are Blazly's AI mode router. Read the full conversation, then either run ONE specialist agent, ask the user for missing details, or give a brief strategy answer.

Available agents:
${catalogForPrompt()}

Reply with ONLY valid JSON (no markdown fences). Always include an "action" field.

Actions:
- "run_agent" — You have enough concrete input to run one agent now.
  Fields: agentId, agentMessage (formatted exactly as that agent expects: Keyword:, Website URL:, Reel prompt:, Business name:, etc.), intro (1–2 friendly sentences).
- "clarify" — You are unsure, missing required fields, or the objective is too vague to run an agent safely. Do NOT guess URLs, keywords, or business details.
  Field: clarifyMessage — 1–3 specific questions (short bullets or numbered list). Tell the user what you need and why in plain language.
- "chat" — Pure strategy/explanation; no agent run yet. Field: message.
- "schedule" — The user wants work done at a FUTURE date/time or on a repeat ("tomorrow at 9", "on 12 Nov", "every Monday for the next month", "next Friday publish…").
  Fields:
    title — short label (max ~80 chars), e.g. "Weekly SERP check for blazly.ai".
    runAt — first run as ISO 8601 WITH the user's UTC offset, e.g. "2026-11-05T09:00:00+05:30".
    repeat — "none", "daily", or "weekly".
    repeatUntil — ISO 8601 with offset for the last allowed run, or null (defaults to 30 days out).
    steps — ordered array (1–4) of { agentId, agentMessage } formatted exactly as each agent expects. Chain when asked, e.g. write a blog with seo-blog-writer, then site-integrations with agentMessage "Publish the latest article live" — later steps automatically receive earlier output.
    confirmMessage — 1–2 sentences confirming what will run and when, in the user's local time.

Current date/time for the user: ${nowLocal} (timezone ${timezone}).
Scheduling rules:
- Resolve relative dates ("tomorrow", "next Monday", "in 3 days") from the current date/time above.
- Only schedule up to 30 days ahead. If the user asks for later than that, use clarify and explain the 30-day limit.
- If a date is given but no time, use 09:00 local and mention it in confirmMessage. If no date at all can be inferred, clarify.
- Times in the past are not allowed — clarify instead.
- Each step still needs its required inputs (keyword, URL, etc.). If missing, clarify before scheduling.
- Agents that can be scheduled: every agent above except humanization of text that isn't in the request itself.

When to choose "clarify" (prefer this over guessing):
- Required inputs for the best-matching agent are missing or ambiguous.
- Vague goals ("help with SEO", "improve visibility", "get leads") without site, keyword, location, or ICP.
- Several agents could apply and the user did not state the outcome they want first.
- The latest message only answers part of what you asked — ask for the rest, or run_agent if you now have everything.
- Project website is ${website ? `"${website}"` : "NOT SET"} — if an agent needs a URL and the user did not give one${website ? ", you may use the project website in agentMessage" : ', use clarify to ask for their website URL'}.
- Brand context: ${brand || "unknown"}.

When to choose "run_agent":
- The latest user message (plus earlier turns) supplies the fields that agent needs.
- If you asked clarifying questions in a prior assistant turn and the user just replied, merge that reply with the original objective and run the agent if ready.

When to choose "chat":
- User wants advice or explanation only, with no request to execute a tool yet.

Other rules:
- One agent per turn; multi-step objectives start with the first logical agent.
- Never invent competitor URLs, keywords, or business names the user did not provide (except using the project website when allowed above).`;

  const userPayload = `Conversation:\n${transcript || "(new chat)"}\n\nLatest objective:\n${objective}`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...(ctx?.workspaceId ? { "anthropic-workspace-id": ctx.workspaceId } : {}),
    },
    body: JSON.stringify({
      model: CLASSIFIER,
      max_tokens: 1600,
      system,
      messages: [{ role: "user", content: userPayload }],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || "Routing failed.");
  }

  const raw = (data.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const parsed = parseRouteJson(raw);
  validateRoute(parsed);
  return parsed;
}

function parseRouteJson(raw) {
  const trimmed = raw.replace(/^```json?\s*|\s*```$/gi, "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("Could not parse routing response.");
  }
}

function validateRoute(route) {
  const action = String(route?.action || "").toLowerCase();
  if (action === "schedule") {
    route.action = action;
    const steps = (Array.isArray(route.steps) ? route.steps : [])
      .map((s) => ({ agentId: String(s?.agentId || "").trim(), agentMessage: String(s?.agentMessage || "").trim() }))
      .filter((s) => s.agentId && s.agentMessage);
    if (!steps.length || steps.some((s) => !AGENT_CATALOG.some((a) => a.id === s.agentId))) {
      throw new Error("Could not work out what to schedule.");
    }
    if (Number.isNaN(new Date(route.runAt).getTime())) throw new Error("Could not work out when to run it.");
    route.steps = steps.slice(0, 4);
    route.repeat = ["daily", "weekly"].includes(route.repeat) ? route.repeat : "none";
    route.repeatUntil = route.repeatUntil && !Number.isNaN(new Date(route.repeatUntil).getTime()) ? route.repeatUntil : null;
    route.title = String(route.title || steps[0].agentMessage).trim().slice(0, 140);
    route.confirmMessage = String(route.confirmMessage || "").trim();
    return;
  }
  if (!["run_agent", "clarify", "chat"].includes(action)) {
    throw new Error("Invalid routing action.");
  }
  route.action = action;
  if (action === "run_agent") {
    const id = String(route.agentId || "").trim();
    if (!AGENT_CATALOG.some((a) => a.id === id)) {
      throw new Error("Unknown agent selected.");
    }
    route.agentId = id;
    route.agentMessage = String(route.agentMessage || "").trim();
    if (route.agentMessage.length < 3) throw new Error("Agent message too short.");
    route.intro = String(route.intro || "").trim();
  }
  if (action === "clarify") {
    route.clarifyMessage = String(route.clarifyMessage || route.message || "").trim();
    if (!route.clarifyMessage) throw new Error("Missing clarify message.");
  }
  if (action === "chat") {
    route.message = String(route.message || "").trim();
    if (!route.message) throw new Error("Missing chat message.");
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => m?.role === "user" || m?.role === "assistant")
    .map((m) => ({
      role: m.role,
      content: String(m.content || "").trim(),
    }))
    .filter((m) => m.content);
}

function validTimezone(value) {
  const tz = String(value || "").trim();
  try {
    if (tz) {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return tz;
    }
  } catch {
    /* invalid zone */
  }
  return "UTC";
}

function text(value) {
  return String(value || "").trim();
}

function readJson(req) {
  return sharedReadJson(req, { maxBytes: 4_000_000 });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
