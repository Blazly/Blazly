import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

const DIR = () => process.env.SCHEDULES_DIR?.trim() || path.join(process.cwd(), ".schedules");
const FILE = () => path.join(DIR(), "jobs.json");

export const MAX_DAYS_AHEAD = 30;
export const MAX_ACTIVE_JOBS_PER_USER = 50;

let queue = Promise.resolve();

/** Serialize every read-modify-write in this process so concurrent requests can't clobber the file. */
function withLock(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function readJobs() {
  try {
    const data = JSON.parse(await fs.readFile(FILE(), "utf8"));
    return Array.isArray(data.jobs) ? data.jobs : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeJobs(jobs) {
  await fs.mkdir(DIR(), { recursive: true });
  const tmp = `${FILE()}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({ version: 1, jobs }, null, 2), { mode: 0o600 });
  await fs.rename(tmp, FILE());
}

export function mutateJobs(mutator) {
  return withLock(async () => {
    const jobs = await readJobs();
    const result = await mutator(jobs);
    await writeJobs(jobs);
    return result;
  });
}

export function listJobs(filter = () => true) {
  return withLock(async () => (await readJobs()).filter(filter));
}

export function newJobId() {
  return `job_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}
