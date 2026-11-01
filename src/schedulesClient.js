import { agentTitle } from "./aiOrchestratorClient.js";

async function json(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || fallback), { code: data.code });
  return data;
}

export function userTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export async function createSchedule(payload) {
  const data = await json(
    await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, timezone: userTimezone() }),
    }),
    "Could not schedule that task.",
  );
  return data.job;
}

export async function listSchedules(uid, project) {
  const qs = new URLSearchParams({ uid, ...(project ? { project } : {}) });
  const data = await json(await fetch(`/api/schedules?${qs}`), "Could not load scheduled tasks.");
  return data.jobs || [];
}

export async function cancelSchedule(uid, id) {
  const data = await json(
    await fetch("/api/schedules/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, id }),
    }),
    "Could not cancel that task.",
  );
  return data.job;
}

export function formatScheduleTime(iso, timezone) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      ...(timezone ? { timeZone: timezone } : {}),
    });
  } catch {
    return iso;
  }
}

export function describeRepeat(job) {
  if (job.repeat === "daily") return `Daily until ${formatScheduleTime(job.repeatUntil, job.timezone)}`;
  if (job.repeat === "weekly") return `Weekly until ${formatScheduleTime(job.repeatUntil, job.timezone)}`;
  return "One time";
}

export function formatScheduleConfirmation(job, confirmMessage) {
  const lines = [confirmMessage || `Scheduled **${job.title}**.`, "", "CARD_START|Scheduled task"];
  lines.push(`Task|${job.title.replace(/\|/g, "/")}`);
  lines.push(`First run|${formatScheduleTime(job.nextRunAt, job.timezone)}`);
  lines.push(`Repeats|${describeRepeat(job)}`);
  lines.push(`Steps|${job.steps.map((s) => agentTitle(s.agentId)).join(" → ")}`);
  lines.push("CARD_END", "");
  lines.push("Results land in this project's chats when each run finishes, even if Blazly is closed.");
  lines.push("", "LINK_ACTION|View scheduled tasks|/scheduled");
  return lines.join("\n");
}

const IMPORTED_KEY = "blazly-imported-runs";

export function loadImportedRunIds(uid) {
  try {
    return new Set(JSON.parse(localStorage.getItem(`${IMPORTED_KEY}-${uid}`) || "[]"));
  } catch {
    return new Set();
  }
}

export function saveImportedRunIds(uid, ids) {
  try {
    localStorage.setItem(`${IMPORTED_KEY}-${uid}`, JSON.stringify([...ids].slice(-500)));
  } catch {
    /* storage full */
  }
}
