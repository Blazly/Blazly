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

export function formatOrchestratorClarify(message) {
  const body = String(message || "").trim();
  if (!body) return "";
  return `Before I run the right specialist, I need a bit more detail:\n\n${body}`;
}

export async function routeAiObjective({ messages, project, website, knowledge }) {
  const response = await fetch("/api/ai-orchestrator", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: (messages || []).map((m) => ({ role: m.role, content: m.content })),
      project,
      website,
      knowledge,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not route your objective.");
  return data;
}
