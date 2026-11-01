/** 1 credit ≈ $0.01 of provider cost (AI tokens + data APIs + media). */
export const FREE_STARTING_CREDITS = 500;

const SITE_AUDIT_BASE = 10;
const SITE_AUDIT_PER_PAGE = 5;
const SITE_AUDIT_MAX_PAGES = 100;
const BLOG_STANDARD = 30;
const BLOG_MAX = 100;
const HUMANIZE_PER_2000_WORDS = 10;

const blogTierCredits = (tier) => (tier === "max" || tier === "extraHigh" ? BLOG_MAX : BLOG_STANDARD);

function wordCount(text) {
  return String(text || "").replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
}

/**
 * reserve(): credits held before the agent runs (the most it can cost).
 * minimum: smallest possible charge; when set, the hold shrinks to the user's balance (never below minimum).
 * settle(completeEvent, reserved): final charge once the result is known (defaults to reserved).
 */
export const AGENT_PRICING = {
  "/api/chat": { agent: "chat", label: "Chat", reserve: () => 1 },
  "/api/ai-orchestrator": { agent: "ai-router", label: "AI mode", reserve: () => 1 },
  "/api/keyword-finder": { agent: "keyword-finder", label: "Keyword Finder", reserve: () => 5 },
  "/api/serp-tracking": { agent: "serp-tracking", label: "SERP Tracking", reserve: () => 5 },
  "/api/integrations/agent": { agent: "site-integrations", label: "Website & analytics", reserve: () => 5 },
  "/api/humanize": {
    agent: "humanization",
    label: "Humanization",
    reserve: () => HUMANIZE_PER_2000_WORDS * 3,
    minimum: HUMANIZE_PER_2000_WORDS,
    settle: (event, reserved) =>
      Math.min(reserved, HUMANIZE_PER_2000_WORDS * Math.max(1, Math.ceil(wordCount(event?.content) / 2000))),
  },
  "/api/prompt-research": { agent: "prompt-research", label: "Prompt Research", reserve: () => 20 },
  "/api/ranking-opportunities": { agent: "ranking-opportunity-finder", label: "Ranking Opportunity Finder", reserve: () => 25 },
  "/api/backlink-finder": { agent: "backlink-finder", label: "Backlink Finder", reserve: () => 30 },
  "/api/local-seo": { agent: "local-seo", label: "Local SEO", reserve: () => 30 },
  "/api/ai-visibility": { agent: "ai-visibility-tracker", label: "AI Visibility Tracker", reserve: () => 35 },
  "/api/brand-sentiment": { agent: "brand-sentiment-analysis", label: "Brand Sentiment", reserve: () => 45 },
  "/api/competitor-research": { agent: "competitor-research", label: "Competitor Research", reserve: () => 70 },
  "/api/b2b-lead-finder": { agent: "b2b-lead-finder", label: "B2B Lead Finder", reserve: () => 70 },
  "/api/blog-writer": {
    agent: "blog-writer",
    label: "Blog writer",
    reserve: () => BLOG_MAX,
    minimum: BLOG_STANDARD,
    settle: (event, reserved) => (event?.result?.effortTier ? Math.min(reserved, blogTierCredits(event.result.effortTier)) : reserved),
  },
  "/api/site-audit": {
    agent: "site-audit",
    label: "Site Audit",
    reserve: () => SITE_AUDIT_BASE + SITE_AUDIT_PER_PAGE * SITE_AUDIT_MAX_PAGES,
    minimum: SITE_AUDIT_BASE + SITE_AUDIT_PER_PAGE,
    settle: (event, reserved) => {
      const pages = Number(event?.report?.pageCount);
      return Number.isFinite(pages) ? Math.min(reserved, SITE_AUDIT_BASE + SITE_AUDIT_PER_PAGE * Math.max(0, pages)) : reserved;
    },
  },
  "/api/reels-creation": { agent: "reels-creation", label: "Reels", reserve: () => 400 },
};
