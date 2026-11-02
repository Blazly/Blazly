import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

/**
 * Background agent jobs. One JSON file per job under .jobs/ so results survive a
 * browser disconnect and a server restart; cleaned up after they are delivered.
 */
const DIR = () => process.env.JOBS_DIR?.trim() || path.join(process.cwd(), ".jobs");
const KEEP_DELIVERED_MS = 24 * 60 * 60 * 1000;
const KEEP_UNDELIVERED_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_CONTENT_CHARS = 4_000_000;

const jobs = new Map();
let loaded = null;

/** Live SSE frames for running jobs (memory only) so a returning tab can replay progress. */
const live = new Map(); // id -> { frames: string[], bytes: number, subscribers: Set<fn> }
const MAX_LIVE_BYTES = 6_000_000;

export function appendFrame(id, text) {
  const entry = live.get(id) || { frames: [], bytes: 0, subscribers: new Set() };
  entry.frames.push(text);
  entry.bytes += text.length;
  while (entry.bytes > MAX_LIVE_BYTES && entry.frames.length > 1) entry.bytes -= entry.frames.shift().length;
  live.set(id, entry);
  for (const fn of entry.subscribers) fn(text, false);
}

/** Replays buffered frames, then streams new ones. Returns an unsubscribe function. */
export function subscribeFrames(id, fn) {
  const entry = live.get(id) || { frames: [], bytes: 0, subscribers: new Set() };
  live.set(id, entry);
  for (const frame of entry.frames) fn(frame, false);
  entry.subscribers.add(fn);
  return () => entry.subscribers.delete(fn);
}

function closeLive(id) {
  const entry = live.get(id);
  if (!entry) return;
  for (const fn of entry.subscribers) fn("", true);
  live.delete(id);
}

export async function getJob(id) {
  await load();
  return jobs.get(id) || null;
}

async function load() {
  if (loaded) return loaded;
  loaded = (async () => {
    await fs.mkdir(DIR(), { recursive: true });
    const files = await fs.readdir(DIR());
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      try {
        const job = JSON.parse(await fs.readFile(path.join(DIR(), file), "utf8"));
        if (job?.id) jobs.set(job.id, job);
      } catch {
        // Skip unreadable files.
      }
    }
    // Anything still "running" belonged to a previous process and will never finish.
    for (const job of jobs.values()) {
      if (job.status === "running") {
        job.status = "failed";
        job.error = "The server restarted while this task was running. Please run it again.";
        job.finishedAt = new Date().toISOString();
        await persist(job);
      }
    }
    await sweep();
  })();
  return loaded;
}

async function persist(job) {
  await fs.mkdir(DIR(), { recursive: true });
  const file = path.join(DIR(), `${job.id}.json`);
  await fs.writeFile(`${file}.tmp`, JSON.stringify(job));
  await fs.rename(`${file}.tmp`, file);
}

async function remove(job) {
  jobs.delete(job.id);
  await fs.rm(path.join(DIR(), `${job.id}.json`), { force: true });
}

async function sweep() {
  const now = Date.now();
  for (const job of [...jobs.values()]) {
    if (job.status === "running") continue;
    const finished = new Date(job.finishedAt || job.createdAt).getTime() || 0;
    const keep = job.delivered ? KEEP_DELIVERED_MS : KEEP_UNDELIVERED_MS;
    if (now - finished > keep) await remove(job);
  }
}

export async function createJob(fields) {
  await load();
  const job = {
    id: `job_${crypto.randomBytes(8).toString("hex")}`,
    status: "running",
    delivered: false,
    createdAt: new Date().toISOString(),
    finishedAt: null,
    content: "",
    error: "",
    ...fields,
  };
  jobs.set(job.id, job);
  await persist(job);
  return job;
}

export async function finishJob(id, { ok, content, error, delivered }) {
  await load();
  const job = jobs.get(id);
  if (!job) return null;
  job.status = ok ? "done" : "failed";
  job.content = ok ? String(content || "").slice(0, MAX_CONTENT_CHARS) : "";
  job.error = ok ? "" : String(error || "The task failed.");
  job.delivered = Boolean(delivered);
  job.finishedAt = new Date().toISOString();
  if (job.delivered) await remove(job);
  else await persist(job);
  closeLive(id);
  return job;
}

export async function runningJobCount(uid) {
  await load();
  let count = 0;
  for (const job of jobs.values()) if (job.uid === uid && job.status === "running") count += 1;
  return count;
}

/** Finished jobs the user has not seen yet, plus running ones (so the client knows something is pending). */
export async function listUndelivered(uid) {
  await load();
  await sweep();
  return [...jobs.values()]
    .filter((job) => job.uid === uid && !job.delivered)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .map(({ uid: _uid, ...job }) => job);
}

export async function markDelivered(uid, ids) {
  await load();
  let count = 0;
  for (const id of ids) {
    const job = jobs.get(id);
    if (!job || job.uid !== uid || job.status === "running") continue;
    await remove(job);
    count += 1;
  }
  return count;
}

export function preloadJobs() {
  return load().catch((error) => console.warn(`[jobs] could not load job store: ${error.message}`));
}
