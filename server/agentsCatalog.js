/** Agent registry for AI orchestrator routing (keep in sync with src/Workspace.jsx AGENTS). */
export const AGENT_CATALOG = [
  {
    id: "site-audit",
    title: "Site Audit",
    when: "Full website SEO audit (209 checks, sitemap crawl). Needs a website URL.",
    briefHint: "User message should be the website URL or start with the URL.",
  },
  {
    id: "seo-blog-writer",
    title: "SEO & AEO writer",
    when: "Long-form SEO blog article with research and humanization.",
    briefHint: "Use SEO blog brief fields: topic, keyword, audience as structured text.",
  },
  {
    id: "geo-blog-writer",
    title: "GEO blog writer",
    when: "Generative Engine Optimization article (citations, FAQs, AI-friendly).",
    briefHint: "Same as SEO writer but GEO-focused topic brief.",
  },
  {
    id: "humanization",
    title: "Humanization",
    when: "Rewrite existing blog or landing copy to sound human.",
    briefHint: "Paste the full article or HTML to humanize.",
  },
  {
    id: "ranking-opportunity-finder",
    title: "Ranking Opportunity Finder",
    when: "Find winnable long-tail keywords for a site.",
    briefHint:
      "Website URL: and Target keyword: lines. Target keyword is a broad seed topic — if the user didn't name one, derive it from the project knowledge base (core product/service, e.g. \"AI visibility tool\"). Never ask the user for it.",
  },
  {
    id: "local-seo",
    title: "Local SEO (Google Maps)",
    when: "Google Business Profile audit and local checklist.",
    briefHint: "Business name: and Google Maps URL: lines.",
  },
  {
    id: "b2b-lead-finder",
    title: "B2B Lead Finder",
    when: "Find companies and emails matching an ICP.",
    briefHint: "Ideal customer profile (ICP): detailed paragraph.",
  },
  {
    id: "backlink-finder",
    title: "Backlink Finder",
    when: "Editorial backlink prospects for a keyword.",
    briefHint: "Target keyword: line; optional Website URL:.",
  },
  {
    id: "serp-tracking",
    title: "SERP Tracking",
    when: "Top ranking pages for a domain.",
    briefHint: "Website URL: line.",
  },
  {
    id: "keyword-finder",
    title: "Keyword Finder",
    when: "Volume, difficulty, trends for one keyword.",
    briefHint: "Keyword: line.",
  },
  {
    id: "prompt-research",
    title: "Prompt Research",
    when: "AI search volume for a prompt across ChatGPT, Gemini, etc.",
    briefHint: "Prompt: line.",
  },
  {
    id: "ai-visibility-tracker",
    title: "AI Visibility Tracker",
    when: "Non-branded AI mentions for a website.",
    briefHint: "Website URL: line.",
  },
  {
    id: "brand-sentiment-analysis",
    title: "Brand Sentiment Analysis",
    when: "How AI assistants talk about a brand.",
    briefHint: "Website URL: line.",
  },
  {
    id: "site-integrations",
    title: "Website & analytics",
    when:
      "Act on the user's connected website and analytics: publish or update WordPress posts (including the blog Blazly just wrote), read Google Search Console queries/pages/index status, submit sitemaps, and run GA4 traffic or conversion reports. Use whenever the user asks to publish, push live, check their real rankings/clicks/traffic, or analyze GSC/GA4 data.",
    briefHint: "Restate the user's request in plain language (e.g. 'Publish the latest article live on WordPress' or 'Show top GSC queries losing clicks in the last 28 days').",
  },
  {
    id: "competitor-research",
    title: "Competitor Research",
    when: "Compare competitors to the user's site on SEO and AI visibility.",
    briefHint: "Competitor website URL(s) and optional Website URL:.",
  },
];

export function catalogForPrompt() {
  return AGENT_CATALOG.map(
    (a) => `- ${a.id} (${a.title}): ${a.when} Format: ${a.briefHint}`,
  ).join("\n");
}
