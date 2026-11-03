import { productAnalyticsEnabled } from "./analytics.js";

/** Microsoft Clarity project id. Off in dev unless VITE_ANALYTICS_IN_DEV=true (same as GA4). */
export const CLARITY_PROJECT_ID = import.meta.env.VITE_CLARITY_PROJECT_ID || "z789hqau27";

let booted = false;

export function initClarity() {
  if (!productAnalyticsEnabled() || !CLARITY_PROJECT_ID || typeof window === "undefined" || booted) return;
  booted = true;

  const c = window;
  const a = "clarity";
  c[a] =
    c[a] ||
    function clarityStub() {
      (c[a].q = c[a].q || []).push(arguments);
    };

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${CLARITY_PROJECT_ID}`;
  const first = document.getElementsByTagName("script")[0];
  first.parentNode.insertBefore(script, first);
}

/** Helps Clarity attribute recordings to the right SPA screen. */
export function claritySetPage(pagePath) {
  if (!productAnalyticsEnabled() || typeof window.clarity !== "function" || !pagePath) return;
  window.clarity("set", "page", pagePath);
}

/** Links heatmaps/recordings to a signed-in user without sending email (use Firebase uid). */
export function setClarityUser(userId, friendlyName) {
  if (!productAnalyticsEnabled() || typeof window.clarity !== "function" || !userId) return;
  window.clarity("identify", userId, undefined, undefined, friendlyName || undefined);
}
