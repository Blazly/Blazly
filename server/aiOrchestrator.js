import { readJson as sharedReadJson } from "./readJson.js";
import { catalogForPrompt, AGENT_CATALOG } from "./agentsCatalog.js";
import { identify } from "./credits/middleware.js";
import { agentRequest, callAgentSse } from "./scheduler/runner.js";
import { resolveBaseUrl } from "./scheduler/index.js";
import { extractLastBlogArticleFromHistory } from "../src/chatBlocks.js";

const CLASSIFIER =
  process.env.ANTHROPIC_CLASSIFIER_MODEL?.trim() ||
  process.env.ANTHROPIC_BLOG_MODEL?.trim() ||
  "claude-sonnet-5-5";

const MAX_CHAIN = 8;

export function attachAiOrchestrator(server, ctx) {
  server.middlewares.use(async (req, res, next) => {
    const path = (req.url || "").split("?")[0];
    if (path === "/api/ai-run" && req.method === "POST") {
      await runChain(req, res, ctx, server);
      return;
    }
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

/**
 * Runs a routed objective end to end: the planned agents one after another, each fed the earlier output,
 * streaming every agent's result to the chat as it lands. Agents are called over HTTP with the user's identity,
 * so each one is charged through the normal credits middleware.
 */
async function runChain(req, res, ctx, server) {
  const who = await identify(req);
  if (!who) {
    sendJson(res, 401, { error: "Sign in to use Blazly agents." });
    return;
  }
  const body = await readJson(req);
  const first = body.route;
  if (!first?.agentId || !first?.agentMessage) {
    sendJson(res, 400, { error: "Nothing to run." });
    return;
  }

  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
  let closed = false;
  req.on("close", () => {
    closed = true;
  });
  const emit = (event) => {
    if (!closed) res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const heartbeat = setInterval(() => emit({ type: "ping" }), 15_000);

  const agentCtx = {
    uid: who.uid,
    source: who.source,
    project: text(body.project) || "default",
    website: text(body.website),
    knowledge: body.knowledge || null,
    brandName: text(body.brandName),
  };
  const routeBody = { project: body.project, website: body.website, knowledge: body.knowledge, timezone: body.timezone };
  const plan = Array.isArray(first.plan) && first.plan.length ? first.plan : [{ agentId: first.agentId, task: "" }];
  const messages = normalizeMessages(body.messages);
  const objective = [...messages].reverse().find((m) => m.role === "user")?.content || "";
  const ranAgents = [];
  let step = { agentId: first.agentId, agentMessage: first.agentMessage, intro: first.intro };
  const baseUrl = resolveBaseUrl(server);

  try {
    while (step && ranAgents.length < MAX_CHAIN && !closed) {
      emit({ type: "step_start", agentId: step.agentId, index: ranAgents.length, plan });
      const latest = extractLastBlogArticleFromHistory(messages);
      const prev = {
        messages,
        article: latest?.html
          ? { title: latest.blogTitle || latest.metaTitle, html: latest.html, metaDescription: latest.metaDescription, slug: latest.urlSlug }
          : null,
      };
      const request = agentRequest(step, agentCtx, prev);
      const output = await callAgentSse(baseUrl, request.path, request.body, 25 * 60 * 1000, agentCtx, (event) =>
        emit({ type: "progress", agentId: step.agentId, event }),
      );
      const content = `${step.intro ? `${step.intro}\n\n` : ""}ORCHESTRATOR_AGENT|${step.agentId}|${agentTitleOf(step.agentId)}\n\n${output}`;
      messages.push({ role: "user", content: step.agentMessage }, { role: "assistant", content: output });
      ranAgents.push(step.agentId);
      emit({ type: "step_done", agentId: step.agentId, content });

      if (ranAgents.length >= MAX_CHAIN) break;
      emit({ type: "thinking", message: plan[ranAgents.length] ? `Passing results to ${agentTitleOf(plan[ranAgents.length].agentId)}` : "Checking what's next" });
      const next = await routeObjective(
        { ...routeBody, messages, objective, continuation: true, ranAgents, plan },
        ctx,
      ).catch(() => ({ action: "done", message: "" }));
      if (next.action !== "run_agent") {
        emit({ type: "complete", message: next.message || "", ranAgents });
        step = null;
        break;
      }
      step = {
        agentId: next.agentId,
        agentMessage: next.agentMessage,
        intro: `Passing **${agentTitleOf(ranAgents.at(-1))}** output to **${agentTitleOf(next.agentId)}**.${next.intro ? ` ${next.intro}` : ""}\n\n${planSteps(plan, ranAgents.length)}`,
      };
    }
    if (step) emit({ type: "complete", message: `I ran ${ranAgents.length} agents and paused. Reply "continue" to keep going.`, ranAgents });
  } catch (error) {
    emit({ type: "error", error: error.message || "An agent failed.", ranAgents });
  } finally {
    clearInterval(heartbeat);
    if (!closed) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  }
}

function agentTitleOf(id) {
  return AGENT_CATALOG.find((a) => a.id === id)?.title || id;
}

function planSteps(plan, doneCount) {
  const rows = plan.map((s, i) => {
    const state = i < doneCount ? "done" : i === doneCount ? "active" : "pending";
    return `${state}|${agentTitleOf(s.agentId)}${s.task ? ` — ${String(s.task).replace(/\n/g, " ")}` : ""}`;
  });
  return ["STEPS_START", ...rows, "STEPS_END"].join("\n");
}

export async function routeObjective(body, ctx) {
  const apiKey = ctx?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("AI routing is not configured.");

  const messages = normalizeMessages(body.messages);
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const objective = String(body.objective || lastUser?.content || "").trim();
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

  const continuation = Boolean(body.continuation);
  const ranAgents = Array.isArray(body.ranAgents) ? body.ranAgents.map(String).slice(0, 12) : [];

  const transcript = messages
    .slice(-12)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, continuation ? 9000 : 4000)}`)
    .join("\n\n");

  const system = `You are Blazly's AI mode router. Read the full conversation, then either run ONE specialist agent, ask the user for missing details, or give a brief strategy answer.

Available agents:
${catalogForPrompt()}

Reply with ONLY valid JSON (no markdown fences). Always include an "action" field.

Actions:
- "run_agent" — You have enough concrete input to run one agent now.
  Fields: agentId, agentMessage (formatted exactly as that agent expects: Keyword:, Website URL:, Business name:, etc.), intro (1–2 friendly sentences),
  plan — ordered array of EVERY agent needed to fully complete the objective, starting with agentId: [{ "agentId": "...", "task": "short description of what this agent does for the objective" }]. Usually 1–5 steps. E.g. "keyword research, then write a blog and publish it" → ranking-opportunity-finder, seo-blog-writer, site-integrations.
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

AI MODE RUNS END TO END WITHOUT ASKING. Strongly prefer "run_agent" with a full plan. Fill missing inputs from the project website and knowledge base (seed keywords, topics, audience, location, ICP). Only use "clarify" when the request is unintelligible or depends on something only the user can know and the project context can't supply (e.g. a specific competitor they mention but don't name, or no website at all when one is required).

When "clarify" may apply (only if the project context can't fill the gap):
- Required inputs for the best-matching agent are missing or ambiguous.
- Vague goals ("help with SEO", "improve visibility", "get leads") without site, keyword, location, or ICP.
- Several agents could apply and the user did not state the outcome they want first.
- The latest message only answers part of what you asked — ask for the rest, or run_agent if you now have everything.
- Project website is ${website ? `"${website}"` : "NOT SET"} — if an agent needs a URL and the user did not give one${website ? ", you may use the project website in agentMessage" : ', use clarify to ask for their website URL'}.
- Brand context: ${brand || "unknown"}.
- Project knowledge base (use it to fill seed keywords, topics, audience, services, location — be context aware instead of asking):
${projectBrief(knowledge) || "(none)"}

When to choose "run_agent":
- The latest user message (plus earlier turns) supplies the fields that agent needs.
- If you asked clarifying questions in a prior assistant turn and the user just replied, merge that reply with the original objective and run the agent if ready.

When to choose "chat":
- User wants advice or explanation only, with no request to execute a tool yet.

Other rules:
- One agent per turn; multi-step objectives start with the first logical agent. Blazly automatically runs the following agents after each one finishes, so for "find keywords and write a blog" start with keyword-finder — don't ask the user to pick a keyword first.
- Never invent competitor URLs or business names the user did not provide (except using the project website when allowed above). Seed keywords/topics MAY be derived from the user's request and the project knowledge base — do not clarify just to get a seed keyword when the project context makes it obvious.${continuation ? continuationRules(ranAgents, body.plan) : ""}`;

  const userPayload = `Conversation:\n${transcript || "(new chat)"}\n\n${continuation ? "Original objective" : "Latest objective"}:\n${objective}`;

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
  if (continuation) {
    const action = String(parsed?.action || "").toLowerCase();
    if (action !== "run_agent") return { action: "done", message: String(parsed?.message || parsed?.clarifyMessage || "").trim() };
  }
  validateRoute(parsed);
  return parsed;
}

function projectBrief(knowledge) {
  if (!knowledge || typeof knowledge !== "object") return "";
  const { companyName, description, industry, location, services, products, targetAudiences, competitors } = knowledge;
  return JSON.stringify({ companyName, description, industry, location, services, products, targetAudiences, competitors }).slice(0, 4000);
}

function continuationRules(ranAgents, plan) {
  const steps = (Array.isArray(plan) ? plan : [])
    .map((s, i) => `${i + 1}. ${s?.agentId} — ${String(s?.task || "").slice(0, 160)}`)
    .join("\n");
  return `

CONTINUATION MODE — an agent just finished as part of the user's objective. Agents already run for this objective, in order: ${ranAgents.join(" → ") || "(none)"}.
${steps ? `Plan made at the start (follow it; step ${ranAgents.length + 1} is next, adapt only if the results make a step pointless):\n${steps}` : ""}
Decide whether the user's objective (the latest user message) is FULLY done.
- If more work is needed, reply "run_agent" with the NEXT agent. Build agentMessage from the earlier agents' output in the conversation (e.g. pick the best keyword from Keyword Finder results for the blog writer's Keyword: line). intro = one short sentence on why this agent is next.
- Agents receive earlier output automatically: site-integrations can publish the latest blog article with "Publish the latest article live".
- Do not run the same agent again with the same input. Do not go beyond what the user asked for.
- If the objective is complete, or the last agent failed / needs the user's input, reply {"action":"done","message":"1–2 sentence wrap-up of what was completed, or what you need from the user"}.
- Never use "clarify", "chat" or "schedule" in this mode.`;
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
    const plan = (Array.isArray(route.plan) ? route.plan : [])
      .map((s) => ({ agentId: String(s?.agentId || "").trim(), task: String(s?.task || "").trim().slice(0, 160) }))
      .filter((s) => AGENT_CATALOG.some((a) => a.id === s.agentId))
      .slice(0, 8);
    if (plan[0]?.agentId !== id) plan.unshift({ agentId: id, task: "" });
    route.plan = plan;
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
