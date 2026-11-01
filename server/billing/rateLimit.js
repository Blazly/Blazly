import { PLANS } from "../../src/plans.js";

/** Sliding-window limiter kept in memory (single server). Keys look like "agent:<uid>" or "mcp:<keyId>". */
const windows = new Map();
let lastSweep = Date.now();

function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, entry] of windows) {
    if (entry.times.every((t) => now - t > entry.windowMs)) windows.delete(key);
  }
}

export function limitsFor(plan) {
  return PLANS[plan]?.limits || PLANS.free.limits;
}

/**
 * Records a hit and throws 429 when `max` hits already happened inside `windowMs`.
 * `max` of 0 means the feature is unavailable; Infinity means unlimited.
 */
export function enforceLimit(key, max, windowMs, label) {
  sweep();
  if (max === Infinity) return;
  const now = Date.now();
  const entry = windows.get(key) || { times: [], windowMs };
  entry.times = entry.times.filter((t) => now - t < windowMs);
  if (entry.times.length >= max) {
    const retryMs = windowMs - (now - entry.times[0]);
    const mins = Math.max(1, Math.ceil(retryMs / 60_000));
    throw Object.assign(
      new Error(`${label} limit reached for your plan (${max} per ${describe(windowMs)}). Try again in about ${mins} minute${mins === 1 ? "" : "s"}, or upgrade for higher limits.`),
      { status: 429, code: "rate_limited", retryAfterMs: retryMs, limit: max },
    );
  }
  entry.times.push(now);
  windows.set(key, entry);
}

export function currentUsage(key) {
  const entry = windows.get(key);
  if (!entry) return 0;
  const now = Date.now();
  return entry.times.filter((t) => now - t < entry.windowMs).length;
}

function describe(ms) {
  if (ms >= 86_400_000) return "day";
  if (ms >= 3_600_000) return "hour";
  return "minute";
}

export const HOUR = 60 * 60 * 1000;
export const MINUTE = 60 * 1000;
export const DAY = 24 * HOUR;
