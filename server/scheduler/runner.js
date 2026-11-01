import { extractLastBlogArticleFromHistory } from "../../src/chatBlocks.js";
import { internalHeaders } from "../credits/middleware.js";

/** How the scheduler calls each agent: endpoint plus request body (all endpoints accept ?stream=1 SSE). */
const AGENT_ENDPOINTS = {
  "site-audit": { path: "/api/site-audit", body: (s, c) => ({ url: firstUrl(s.agentMessage) || c.website, website: c.website }) },
  "seo-blog-writer": { path: "/api/blog-writer", body: (s, c) => ({ ...base(s, c), effortAuto: false, effortTier: "max" }) },
  "geo-blog-writer": {
    path: "/api/blog-writer",
    body: (s, c) => ({ ...base(s, c), writerMode: "geo", effortAuto: false, effortTier: "max" }),
  },
  humanization: { path: "/api/humanize", body: (s, c) => ({ message: s.agentMessage, knowledge: c.knowledge }) },
  "ranking-opportunity-finder": { path: "/api/ranking-opportunities", body: base },
  "local-seo": { path: "/api/local-seo", body: (s) => ({ message: s.agentMessage }) },
  "b2b-lead-finder": { path: "/api/b2b-lead-finder", body: (s) => ({ message: s.agentMessage }) },
  "backlink-finder": { path: "/api/backlink-finder", body: base },
  "serp-tracking": { path: "/api/serp-tracking", body: (s, c) => ({ message: s.agentMessage, website: c.website }) },
  "keyword-finder": { path: "/api/keyword-finder", body: (s) => ({ message: s.agentMessage }) },
  "prompt-research": { path: "/api/prompt-research", body: (s) => ({ message: s.agentMessage }) },
  "ai-visibility-tracker": { path: "/api/ai-visibility", body: base },
  "brand-sentiment-analysis": { path: "/api/brand-sentiment", body: base },
  "competitor-research": { path: "/api/competitor-research", body: base },
  "reels-creation": { path: "/api/reels-creation", body: (s) => ({ message: s.agentMessage }) },
  "site-integrations": {
    path: "/api/integrations/agent",
    body: (s, c, prev) => ({
      uid: c.uid,
      project: c.project,
      website: c.website,
      message: s.agentMessage,
      messages: prev.messages,
      article: prev.article,
    }),
  },
};

export const SCHEDULABLE_AGENTS = Object.keys(AGENT_ENDPOINTS);

function base(step, ctx) {
  return { message: step.agentMessage, website: ctx.website, knowledge: ctx.knowledge, brandName: ctx.brandName };
}

function firstUrl(text) {
  return String(text || "").match(/https?:\/\/[^\s)]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s)]*)?/i)?.[0] || "";
}

async function callAgentSse(baseUrl, path, body, timeoutMs, ctx) {
  const response = await fetch(`${baseUrl}${path}?stream=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Blazly-Scheduler": "1",
      ...(ctx?.uid ? internalHeaders(ctx.uid, ctx.source || "scheduler") : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Agent request failed (${response.status}).`);
  }

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
      const payload = line.slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      if (event.type === "error") throw new Error(event.error || "Agent failed.");
      if (event.type === "complete") {
        reader.cancel().catch(() => {});
        return String(event.content || "").trim();
      }
    }
  }
  throw new Error("Agent ended without a result.");
}

/**
 * Run every step of a job in order. Each step sees earlier output (so "write a blog, then publish it" works).
 * Returns the chat transcript produced by the run.
 */
export async function runJobSteps(job, { baseUrl, timeoutMs = 25 * 60 * 1000 }) {
  const ctx = {
    uid: job.uid,
    project: job.project,
    website: job.website || "",
    knowledge: job.knowledge || null,
    brandName: job.brandName || "",
  };
  return runSteps(job.steps, ctx, { baseUrl, timeoutMs });
}

export async function runSteps(steps, ctx, { baseUrl, timeoutMs = 25 * 60 * 1000, history = [] }) {
  const messages = [...history];
  for (const step of steps) {
    const endpoint = AGENT_ENDPOINTS[step.agentId];
    if (!endpoint) throw new Error(`Agent "${step.agentId}" can't be scheduled.`);
    const latest = extractLastBlogArticleFromHistory(messages);
    const prev = {
      messages,
      article: latest?.html
        ? { title: latest.blogTitle || latest.metaTitle, html: latest.html, metaDescription: latest.metaDescription, slug: latest.urlSlug }
        : null,
    };
    messages.push({ role: "user", content: step.agentMessage });
    const content = await callAgentSse(baseUrl, endpoint.path, endpoint.body(step, ctx, prev), timeoutMs, ctx);
    messages.push({ role: "assistant", content, agentId: step.agentId });
  }
  return messages;
}
