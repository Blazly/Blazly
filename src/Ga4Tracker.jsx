import { useEffect } from "react";
import { useAuth } from "./AuthContext.jsx";
import { clearAnalyticsUser, setAnalyticsUser, trackPageView } from "./analytics.js";
import { claritySetPage, setClarityUser } from "./clarity.js";

function trackScreen(pagePath, pageTitle) {
  trackPageView(pagePath, pageTitle);
  claritySetPage(pagePath);
}

const VIEW_TITLES = {
  home: "Home",
  projects: "Projects",
  "add-project": "New project",
  integrations: "Integrations",
  "connect-ai": "Connect AI",
  scheduled: "Scheduled",
  playbooks: "Playbooks",
  discussions: "Discussions",
  pricing: "Pricing",
  profile: "Profile",
  settings: "Settings",
};

/** Tracks workspace sub-views as virtual page paths. */
export function Ga4WorkspaceTracker({ view }) {
  useEffect(() => {
    const label = VIEW_TITLES[view] || view;
    trackScreen(`/app/${view}`, `Blazly · ${label}`);
  }, [view]);
  return null;
}

/** Auth / onboarding funnel screens. */
export function Ga4AuthTracker({ screen }) {
  useEffect(() => {
    const paths = { auth: "/auth", onboarding: "/onboarding", workspace: "/app/home" };
    const titles = { auth: "Sign in", onboarding: "Onboarding", workspace: "Blazly" };
    trackScreen(paths[screen] || `/app/${screen}`, titles[screen] || "Blazly");
  }, [screen]);
  return null;
}

export function Ga4ShareTracker({ shareId }) {
  useEffect(() => {
    trackScreen(`/share/${shareId}`, "Shared chat");
  }, [shareId]);
  return null;
}

/** Tie signed-in Firebase uid to GA4 user_id (not email). */
export function Ga4UserTracker() {
  const { user, ready } = useAuth();
  useEffect(() => {
    if (!ready) return;
    if (user?.uid) {
      setAnalyticsUser(user.uid);
      setClarityUser(user.uid, user.displayName || undefined);
    } else clearAnalyticsUser();
  }, [ready, user?.uid]);
  return null;
}
