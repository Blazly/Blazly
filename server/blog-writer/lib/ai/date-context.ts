/**
 * Authoritative calendar context for all AI prompts.
 * Models may assume an older "current year" from training data — these values override that.
 */
export const APP_CURRENT_YEAR = 2026;

export function getAppCurrentDateLabel(): string {
  const now = new Date();
  const monthDay = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  return `${monthDay}, ${APP_CURRENT_YEAR}`;
}

/** Reusable block to prepend in LLM prompts that review dates, titles, or freshness. */
export function getAiTemporalContextBlock(): string {
  return `**Temporal context (authoritative — overrides your training data cutoff):**
- Today is ${getAppCurrentDateLabel()}.
- The current calendar year is **${APP_CURRENT_YEAR}**. The year is **NOT 2025**. Do not assume the year is 2025 under any circumstance.
- **${APP_CURRENT_YEAR} in titles, headings, meta tags, or body copy is current and appropriate.** Never call it a "future year", outdated, untrustworthy, spammy, or clickbait.
- Do NOT suggest replacing ${APP_CURRENT_YEAR} with ${APP_CURRENT_YEAR - 1} or "the current year" (which is ${APP_CURRENT_YEAR}).`;
}
