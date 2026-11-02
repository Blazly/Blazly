import { AGENT_PRICING } from "../credits/pricing.js";
import { identify, internalHeaders } from "../credits/middleware.js";
import { readJson } from "../readJson.js";
import { resolveBilling } from "../billing/team.js";
import { limitsFor } from "../billing/rateLimit.js";
import { resolveBaseUrl } from "../scheduler/index.js";
import { appendFrame, createJob, finishJob, getJob, listUndelivered, markDelivered, preloadJobs, runningJobCount, subscribeFrames } from "./store.js";

/** Quick, conversational endpoints stay attached to the browser; everything else becomes a background job. */
const PASSTHROUGH = new Set(["/api/chat", "/api/ai-orchestrator"]);
const JOB_TIMEOUT_MS = 40 * 60 * 1000;

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function sseHeaders(res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

function userText(body) {
  return String(body.message || body.rewritePrompt || body.url || body.website || "").slice(0, 4000);
}

/** Parses SSE frames as they arrive to learn whether the agent finished and what it produced. */
function createOutcomeTracker() {
  let carry = "";
  const state = { complete: null, error: null };
  return {
    state,
    feed(text, final = false) {
      carry += text;
      const parts = carry.split("\n\n");
      carry = final ? "" : parts.pop() || "";
      if (final && carry) parts.push(carry);
      for (const part of parts) {
        const line = part.split("\n").find((l) => l.startsWith("data: "));
        if (!line) continue;
        const payload = line.slice(6).trim();
        if (!payload.startsWith("{")) continue;
        let event;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        if (event.type === "error") state.error = event.error || "The task failed.";
        if (event.type === "complete") state.complete = String(event.content || "");
      }
      if (carry.length > 8_000_000) carry = "";
    },
  };
}

async function runDetached({ baseUrl, path, body, who, job, browser }) {
  const tracker = createOutcomeTracker();
  const decoder = new TextDecoder();
  let upstream;
  try {
    upstream = await fetch(`${baseUrl}${path}?stream=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...internalHeaders(who.uid, who.source) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(JOB_TIMEOUT_MS),
    });
  } catch (error) {
    await finishJob(job.id, { ok: false, error: error.message, delivered: browser.alive() });
    if (browser.alive()) sendJson(browser.res, 502, { error: "The task could not be started." });
    return;
  }

  // Plan / credit / rate-limit rejections come back as JSON; forward them unchanged and drop the job record.
  if (!upstream.ok || !String(upstream.headers.get("content-type") || "").includes("text/event-stream")) {
    const text = await upstream.text().catch(() => "");
    await finishJob(job.id, { ok: false, error: "rejected", delivered: true });
    if (browser.alive()) {
      browser.res.statusCode = upstream.status;
      browser.res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
      browser.res.end(text);
    }
    return;
  }

  if (browser.alive()) {
    sseHeaders(browser.res);
    browser.res.write(`data: ${JSON.stringify({ type: "job", id: job.id })}\n\n`);
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      tracker.feed(text);
      appendFrame(job.id, text);
      if (browser.alive()) browser.res.write(value);
    }
    tracker.feed(decoder.decode(), true);
  } catch (error) {
    tracker.state.error ||= error.message || "The task was interrupted.";
  }

  const ok = tracker.state.complete !== null && !tracker.state.error;
  const delivered = browser.alive();
  await finishJob(job.id, { ok, content: tracker.state.complete, error: tracker.state.error || (ok ? "" : "Agent ended without a result."), delivered });
  if (delivered) browser.res.end();
}

export function attachJobRelay(server) {
  preloadJobs();

  server.middlewares.use(async (req, res, next) => {
    const [path, query = ""] = (req.url || "").split("?");

    if (path === "/api/jobs/pending" && req.method === "GET") {
      const who = await identify(req);
      if (!who) return sendJson(res, 401, { error: "Sign in first." });
      return sendJson(res, 200, { jobs: await listUndelivered(who.uid) });
    }
    if (path === "/api/jobs/ack" && req.method === "POST") {
      const who = await identify(req);
      if (!who) return sendJson(res, 401, { error: "Sign in first." });
      const body = await readJson(req).catch(() => ({}));
      const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : [];
      return sendJson(res, 200, { acknowledged: await markDelivered(who.uid, ids) });
    }

    const streamMatch = req.method === "GET" && path.match(/^\/api\/jobs\/([a-z0-9_]+)\/stream$/);
    if (streamMatch) {
      const who = await identify(req);
      if (!who) return sendJson(res, 401, { error: "Sign in first." });
      const job = await getJob(streamMatch[1]);
      if (!job || job.uid !== who.uid) return sendJson(res, 404, { error: "Task not found." });
      sseHeaders(res);
      if (job.status !== "running") {
        const frame = job.status === "done" ? { type: "complete", content: job.content } : { type: "error", error: job.error };
        res.end(`data: ${JSON.stringify(frame)}\n\n`);
        return;
      }
      const unsubscribe = subscribeFrames(job.id, (text, ended) => {
        if (res.writableEnded || res.destroyed) return;
        if (ended) {
          // The final frame was already forwarded; make sure a late subscriber still gets a terminal event.
          getJob(job.id).then((finished) => {
            if (res.writableEnded || res.destroyed) return;
            const frame = !finished || finished.status === "done"
              ? { type: "complete", content: finished?.content || "" }
              : { type: "error", error: finished.error };
            res.end(`data: ${JSON.stringify(frame)}\n\n`);
          });
          return;
        }
        res.write(text);
      });
      const keepAlive = setInterval(() => {
        if (!res.writableEnded && !res.destroyed) res.write(": ping\n\n");
      }, 15_000);
      res.on("close", () => {
        clearInterval(keepAlive);
        unsubscribe();
      });
      return;
    }

    if (req.method !== "POST" || !AGENT_PRICING[path] || PASSTHROUGH.has(path)) return next();
    if (!new URLSearchParams(query).has("stream")) return next();
    if (req.headers["x-blazly-internal"]) return next(); // already detached (scheduler, MCP, or this relay)

    const who = await identify(req);
    if (!who) return next(); // credits middleware answers with the standard 401

    let body;
    try {
      body = await readJson(req, { maxBytes: 4_000_000 });
    } catch (error) {
      return sendJson(res, error.status || 400, { error: error.message });
    }
    if (path === "/api/integrations/agent") body.uid = who.uid;

    try {
      const billing = await resolveBilling(who.uid);
      const max = limitsFor(billing.plan).concurrentJobs;
      const running = await runningJobCount(who.uid);
      if (running >= max) {
        return sendJson(res, 429, {
          error: `You already have ${running} task${running === 1 ? "" : "s"} running. Your plan allows ${max} at a time — wait for one to finish or upgrade.`,
          code: "rate_limited",
        });
      }
    } catch (error) {
      return sendJson(res, error.status || 500, { error: error.message });
    }

    const job = await createJob({
      uid: who.uid,
      path,
      agentId: String(req.headers["x-blazly-agent"] || AGENT_PRICING[path].agent || "").slice(0, 80),
      chatId: String(req.headers["x-blazly-chat"] || "").slice(0, 120),
      project: String(req.headers["x-blazly-project"] || "").slice(0, 200),
      userText: userText(body),
    });

    let alive = true;
    res.on("close", () => {
      alive = false;
    });
    const browser = { res, alive: () => alive && !res.writableEnded && !res.destroyed };

    runDetached({ baseUrl: resolveBaseUrl(server), path, body, who, job, browser }).catch((error) => {
      console.warn(`[jobs] ${job.id} crashed: ${error.message}`);
      finishJob(job.id, { ok: false, error: error.message, delivered: browser.alive() }).catch(() => {});
      if (browser.alive()) sendJson(res, 500, { error: error.message || "The task failed." });
    });
  });
}
