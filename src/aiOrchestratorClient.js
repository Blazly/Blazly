import { AGENTS } from "./agentsMeta.js";

export function agentTitle(agentId) {
  return AGENTS.find((a) => a.id === agentId)?.title || agentId;
}

export function parseOrchestratorBadge(content) {
  const m = String(content || "").match(/^ORCHESTRATOR_AGENT\|([^|]+)\|([^\n]+)/m);
  if (!m) return null;
  return { agentId: m[1].trim(), title: m[2].trim() };
}

export function formatOrchestratorDispatchIntro(intro, agentId) {
  const title = agentTitle(agentId);
  const lead = intro?.trim() || `Running **${title}** for you.`;
  return `${lead}\n\nORCHESTRATOR_AGENT|${agentId}|${title}`;
}

/** Renders the agent plan as a STEPS block: finished steps done, the current one active. */
export function formatPlanSteps(plan, doneCount) {
  const rows = plan.map((step, i) => {
    const state = i < doneCount ? "done" : i === doneCount ? "active" : "pending";
    const task = String(step.task || "").replace(/\n/g, " ").trim();
    return `${state}|${agentTitle(step.agentId)}${task ? ` — ${task}` : ""}`;
  });
  return ["STEPS_START", ...rows, "STEPS_END"].join("\n");
}

/** Runs the routed plan on the server; onEvent gets step_start, progress, step_done, thinking, complete and error events. */
export async function runAiChain({ route, messages, project, website, knowledge, brandName, onEvent }) {
  const response = await fetch("/api/ai-run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      route,
      messages: (messages || []).map((m) => ({ role: m.role, content: m.content })),
      project,
      website,
      knowledge,
      brandName,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "AI mode could not start.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      const payload = line?.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type !== "ping") onEvent(event);
    }
  }
}

export function formatOrchestratorClarify(message) {
  const body = String(message || "").trim();
  if (!body) return "";
  return `Before I run the right specialist, I need a bit more detail:\n\n${body}`;
}

export async function routeAiObjective({ messages, project, website, knowledge, continuation = false, ranAgents = [], plan = [] }) {
  const response = await fetch("/api/ai-orchestrator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: (messages || []).map((m) => ({ role: m.role, content: m.content })),
      project,
      website,
      knowledge,
      continuation,
      ranAgents,
      plan,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not route your objective.");
  return data;
}
