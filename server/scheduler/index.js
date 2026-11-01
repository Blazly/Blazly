import { ensureProject } from "../billing/projects.js";
import { chainLimit, requireFeature } from "../billing/entitlements.js";
import { limitsFor } from "../billing/rateLimit.js";
import crypto from "crypto";
import { MAX_DAYS_AHEAD, listJobs, mutateJobs, newJobId } from "./store.js";
import { SCHEDULABLE_AGENTS, runJobSteps } from "./runner.js";
import { getProjectIntegrations } from "../integrations/store.js";
import { MCP_SERVER_FACTORIES } from "../mcp/servers.js";

const DAY = 24 * 60 * 60 * 1000;
const TICK_MS = 30 * 1000;
const LOCK_MS = 40 * 60 * 1000;
const RETRY_DELAY_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 2;
const KEEP_RUNS = 10;
const KEEP_FINISHED_MS = 30 * DAY;
const ACTIVE = new Set(["scheduled", "running"]);

function concurrency() {
  return Math.max(1, Number(process.env.SCHEDULER_CONCURRENCY) || 2);
}

const PUBLISH_PROVIDERS = ["wordpress", "webflow", "site"];
const PUBLISH_INTENT = /\b(publish|post|upload|go live|push live|live on|update (the )?(post|article|blog))\b/i;

function isPublishStep(step) {
  return step.agentId === "site-integrations" && PUBLISH_INTENT.test(step.agentMessage);
}

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function parseDate(value, label) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw fail(`${label} must be a valid date and time.`);
  return date;
}

function trimKnowledge(knowledge) {
  if (!knowledge || typeof knowledge !== "object") return null;
  if (JSON.stringify(knowledge).length <= 60_000) return knowledge;
  const { companyName, brandName, website, summary, description, audience, tone, products, services } = knowledge;
  return { companyName, brandName, website, summary, description, audience, tone, products, services };
}

export async function createJob(input) {
  const uid = String(input.uid || "").trim();
  if (!uid) throw fail("Sign in to schedule tasks.", 401);
  const project = String(input.project || "").trim() || "default";

  const steps = (Array.isArray(input.steps) ? input.steps : [])
    .map((s) => ({ agentId: String(s?.agentId || "").trim(), agentMessage: String(s?.agentMessage || "").trim() }))
    .filter((s) => s.agentId && s.agentMessage);
  if (!steps.length) throw fail("Nothing to run. Describe what Blazly should do.");
  const plan = await requireFeature(uid, "scheduling");
  await ensureProject(uid, project);
  const maxSteps = chainLimit(plan);
  if (steps.length > maxSteps) throw fail(`Your plan can chain at most ${maxSteps} steps in one task.`);
  const unknown = steps.find((s) => !SCHEDULABLE_AGENTS.includes(s.agentId));
  if (unknown) throw fail(`"${unknown.agentId}" can't be scheduled.`);

  if (steps.some(isPublishStep)) {
    const integrations = await getProjectIntegrations(uid, project);
    if (!PUBLISH_PROVIDERS.some((p) => MCP_SERVER_FACTORIES[p].connectedWhen(integrations))) {
      throw Object.assign(
        fail(
          `To schedule publishing, first connect your website to ${project} — WordPress, Webflow, or a custom site via webhook. Then ask me again and I'll schedule it.`,
          409,
        ),
        { code: "integration_required" },
      );
    }
  }

  const now = Date.now();
  const runAt = parseDate(input.runAt, "Run time");
  const horizon = now + MAX_DAYS_AHEAD * DAY;
  if (runAt.getTime() < now - 2 * 60 * 1000) throw fail("That time is in the past. Pick a future date and time.");
  if (runAt.getTime() > horizon) throw fail(`You can schedule up to ${MAX_DAYS_AHEAD} days ahead.`);

  const repeat = ["daily", "weekly"].includes(input.repeat) ? input.repeat : "none";
  let repeatUntil = null;
  if (repeat !== "none") {
    const until = input.repeatUntil ? parseDate(input.repeatUntil, "Repeat end") : new Date(horizon);
    repeatUntil = new Date(Math.min(until.getTime(), horizon)).toISOString();
    if (new Date(repeatUntil) < runAt) throw fail("The repeat end must be after the first run.");
  }

  const job = {
    id: newJobId(),
    uid,
    project,
    title: String(input.title || steps[0].agentMessage).trim().slice(0, 140),
    steps,
    website: String(input.website || "").trim(),
    brandName: String(input.brandName || "").trim(),
    knowledge: trimKnowledge(input.knowledge),
    timezone: String(input.timezone || "UTC").slice(0, 64),
    runAt: runAt.toISOString(),
    nextRunAt: runAt.toISOString(),
    repeat,
    repeatUntil,
    status: "scheduled",
    attempts: 0,
    lockUntil: null,
    runs: [],
    createdAt: new Date(now).toISOString(),
  };

  await mutateJobs((jobs) => {
    const active = jobs.filter((j) => j.uid === uid && ACTIVE.has(j.status)).length;
    const maxActive = limitsFor(plan).activeSchedules;
    if (active >= maxActive) {
      throw fail(`Your plan allows ${maxActive} active scheduled tasks and you already have ${active}. Cancel some first or upgrade.`);
    }
    jobs.push(job);
  });
  return publicJob(job);
}

export async function cancelJob(uid, id) {
  return mutateJobs((jobs) => {
    const job = jobs.find((j) => j.id === id && j.uid === uid);
    if (!job) throw fail("Scheduled task not found.", 404);
    if (job.status === "running") throw fail("This task is running right now. Try again when it finishes.");
    if (job.status === "scheduled") job.status = "cancelled";
    return publicJob(job);
  });
}

export async function listUserJobs(uid, project) {
  const jobs = await listJobs((j) => j.uid === uid && (!project || j.project === project));
  return jobs.sort((a, b) => new Date(a.nextRunAt) - new Date(b.nextRunAt)).map(publicJob);
}

function publicJob(job) {
  const { knowledge, lockUntil, uid, ...rest } = job;
  return rest;
}

function nextOccurrence(job) {
  if (job.repeat === "none") return null;
  const step = job.repeat === "daily" ? DAY : 7 * DAY;
  let next = new Date(job.nextRunAt).getTime() + step;
  while (next < Date.now()) next += step;
  return next <= new Date(job.repeatUntil).getTime() ? new Date(next).toISOString() : null;
}

/** Atomically mark due jobs as running so overlapping ticks (or instances sharing the file) never double-run. */
async function claimDueJobs(limit) {
  const now = Date.now();
  return mutateJobs((jobs) => {
    const claimed = [];
    for (const job of jobs) {
      if (claimed.length >= limit) break;
      const due = job.status === "scheduled" && new Date(job.nextRunAt).getTime() <= now;
      const stale = job.status === "running" && job.lockUntil && new Date(job.lockUntil).getTime() < now;
      if (!due && !stale) continue;
      job.status = "running";
      job.attempts = (job.attempts || 0) + 1;
      job.lockUntil = new Date(now + LOCK_MS).toISOString();
      job.claimToken = crypto.randomBytes(8).toString("hex");
      claimed.push(structuredClone(job));
    }
    const cutoff = now - KEEP_FINISHED_MS;
    for (let i = jobs.length - 1; i >= 0; i -= 1) {
      const j = jobs[i];
      const last = new Date(j.runs?.at(-1)?.finishedAt || j.createdAt).getTime();
      if (!ACTIVE.has(j.status) && last < cutoff) jobs.splice(i, 1);
    }
    return claimed;
  });
}

async function finishJob(claimed, outcome) {
  await mutateJobs((jobs) => {
    const job = jobs.find((j) => j.id === claimed.id);
    if (!job || job.claimToken !== claimed.claimToken) return;
    const finishedAt = new Date().toISOString();
    const willRetry = !outcome.ok && job.attempts < MAX_ATTEMPTS;

    if (!willRetry) {
      job.runs = [
        ...(job.runs || []),
        {
          id: `${job.id}_${job.runs?.length || 0}`,
          scheduledFor: job.nextRunAt,
          finishedAt,
          status: outcome.ok ? "done" : "failed",
          error: outcome.ok ? undefined : outcome.error,
          messages: outcome.ok ? outcome.messages : undefined,
        },
      ].slice(-KEEP_RUNS);
    }

    job.lockUntil = null;
    delete job.claimToken;
    if (job.status === "cancelled") return;

    if (willRetry) {
      job.status = "scheduled";
      job.nextRunAt = new Date(Date.now() + RETRY_DELAY_MS).toISOString();
      return;
    }
    const next = nextOccurrence(job);
    job.attempts = 0;
    if (next) {
      job.status = "scheduled";
      job.nextRunAt = next;
    } else {
      job.status = outcome.ok ? "done" : "failed";
    }
  });
}

let ticking = false;

export async function tick(baseUrl) {
  if (ticking) return { ran: 0, skipped: true };
  ticking = true;
  try {
    const claimed = await claimDueJobs(concurrency());
    await Promise.all(
      claimed.map(async (job) => {
        try {
          const messages = await runJobSteps(job, { baseUrl });
          await finishJob(job, { ok: true, messages });
          console.info(`[scheduler] ${job.id} done (${job.title})`);
        } catch (error) {
          await finishJob(job, { ok: false, error: String(error.message || error).slice(0, 500) });
          console.warn(`[scheduler] ${job.id} failed: ${error.message}`);
        }
      }),
    );
    return { ran: claimed.length };
  } finally {
    ticking = false;
  }
}

function resolveBaseUrl(server) {
  const configured = process.env.SCHEDULER_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const address = server.httpServer?.address?.();
  const port = typeof address === "object" && address ? address.port : Number(process.env.PORT) || 5173;
  const https = Boolean(server.config?.server?.https || server.config?.preview?.https);
  const bound = typeof address === "object" && address ? address.address : "";
  const host = !bound || bound === "::" || bound === "0.0.0.0" ? "127.0.0.1" : bound.includes(":") ? `[${bound}]` : bound;
  return `${https ? "https" : "http"}://${host}:${port}`;
}

/** In-process ticker. Disable with SCHEDULER_ENABLED=false when an external cron calls /api/scheduler/tick. */
export function startScheduler(server) {
  if (process.env.SCHEDULER_ENABLED === "false") return;
  if (globalThis.__blazlySchedulerTimer) clearInterval(globalThis.__blazlySchedulerTimer);
  const run = () => tick(resolveBaseUrl(server)).catch((e) => console.warn(`[scheduler] tick failed: ${e.message}`));
  const start = () => {
    globalThis.__blazlySchedulerTimer = setInterval(run, TICK_MS);
    globalThis.__blazlySchedulerTimer.unref?.();
    setTimeout(run, 5000).unref?.();
    console.info(`[scheduler] running every ${TICK_MS / 1000}s via ${resolveBaseUrl(server)}`);
  };
  if (server.httpServer?.listening) start();
  else if (server.httpServer) server.httpServer.once("listening", start);
  else start();
}

export { resolveBaseUrl };
