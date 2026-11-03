/** Google Analytics 4 (gtag) for Blazly app usage. Off in dev unless VITE_ANALYTICS_IN_DEV=true. */
export const GA4_MEASUREMENT_ID = import.meta.env.VITE_GA4_MEASUREMENT_ID || "G-P8ZCKHBJFV";

/** Production builds, or local dev when explicitly enabled (GA4 + Clarity). */
export function productAnalyticsEnabled() {
  return (
    import.meta.env.PROD ||
    import.meta.env.VITE_ANALYTICS_IN_DEV === "true" ||
    import.meta.env.VITE_GA4_IN_DEV === "true"
  );
}

export function analyticsEnabled() {
  return Boolean(GA4_MEASUREMENT_ID) && productAnalyticsEnabled();
}

let booted = false;

export function initGa4() {
  if (!analyticsEnabled() || typeof window === "undefined" || booted) return;
  booted = true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() {
    window.dataLayer.push(arguments);
  };
  window.gtag("js", new Date());
  window.gtag("config", GA4_MEASUREMENT_ID, { send_page_view: false });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${GA4_MEASUREMENT_ID}`;
  document.head.appendChild(script);

  trackPageView(pagePathFromLocation(), document.title);
}

function pagePathFromLocation() {
  return `${window.location.pathname}${window.location.search}${window.location.hash || ""}`;
}

/** SPA screen change — use a stable virtual path, not the raw URL when the app doesn't use routes. */
export function trackPageView(pagePath, pageTitle) {
  if (!analyticsEnabled() || typeof window.gtag !== "function") return;
  window.gtag("event", "page_view", {
    page_path: pagePath,
    page_title: pageTitle || document.title,
    page_location: window.location.href,
  });
}

export function setAnalyticsUser(userId) {
  if (!analyticsEnabled() || typeof window.gtag !== "function" || !userId) return;
  window.gtag("config", GA4_MEASUREMENT_ID, { user_id: userId });
}

export function clearAnalyticsUser() {
  if (!analyticsEnabled() || typeof window.gtag !== "function") return;
  window.gtag("config", GA4_MEASUREMENT_ID, { user_id: null });
}

export function trackEvent(name, params = {}) {
  if (!analyticsEnabled() || typeof window.gtag !== "function") return;
  window.gtag("event", name, params);
}
