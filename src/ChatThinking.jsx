import { Icon } from "./Icon.jsx";

export function ChatThinking({ label = "Blazly is thinking" }) {
  return (
    <div className="chat-thinking" role="status" aria-live="polite">
      <span className="chat-thinking-mark" aria-hidden="true">
        <Icon name="bolt" size={20} strokeWidth={1.3} />
      </span>
      <span className="chat-thinking-label">{label}</span>
    </div>
  );
}

export function formatAuditProgressLabel(progress) {
  if (!progress) return "Running site audit";
  const etaSec = Number(progress.etaSeconds || 60);
  const etaMin = Math.max(1, Math.ceil(etaSec / 60));
  const etaLabel = etaMin === 1 ? "~1 min left" : `~${etaMin} min left`;
  const auditTotal = Number(progress.totalToAudit) || 0;
  const discovered = Number(progress.totalDiscovered ?? progress.total) || 0;
  if (progress.phase === "crawl" && auditTotal > 0) {
    return `Site audit · page ${progress.current}/${auditTotal} · 209 checks · ${etaLabel}`;
  }
  if (discovered > 0 && progress.phase === "sitemap") {
    return `Site audit · mapping up to 100 pages · ${etaLabel}`;
  }
  const message = progress.message || "Starting crawl";
  return `Site audit · ${message} · ${etaLabel}`;
}

const BLOG_STAGE_LABELS = {
  researching: "Researching topic",
  gathering_references: "Gathering references",
  writing: "Writing draft",
  seo_optimizing: "SEO optimization",
  humanizing: "Humanizing",
  fact_checking: "Fact checking",
  finalizing: "Final polish",
  rewriting: "Rewriting from your instructions",
};

export function formatBlogProgressLabel(progress, { geoWriter } = {}) {
  const agentName = geoWriter ? "GEO blog writer" : "SEO & AEO writer";
  if (!progress) return `Writing ${agentName} article`;
  const stage = progress.stage || progress.message || "blog";
  const label = BLOG_STAGE_LABELS[stage] || progress.message || `Writing ${agentName} article`;
  const eta = Math.max(1, Math.ceil(Number(progress.etaSeconds || 180) / 60));
  const etaLabel = eta === 1 ? "~1 min left" : `~${eta} min left`;
  return `${agentName} · ${label} · ${etaLabel}`;
}

const RANKING_STAGE_LABELS = {
  seeds: "Reading your expertise",
  backlinks: "Checking site authority",
  keywords: "Expanding keyword ideas",
  volume: "Pulling search volume",
  serp: "Reviewing SERP difficulty",
  synthesis: "Building your opportunity list",
};

export function formatRankingProgressLabel(progress) {
  if (!progress) return "Finding ranking opportunities";
  const stage = progress.stage || "ranking";
  const label = RANKING_STAGE_LABELS[stage] || progress.message || "Finding ranking opportunities";
  return `Ranking Opportunity Finder · ${label}`;
}

const KEYWORD_FINDER_STAGE_LABELS = {
  global: "Worldwide search volume",
  overview: "Difficulty and trend",
  related: "Related keywords",
};

export function formatKeywordFinderProgressLabel(progress) {
  if (!progress) return "Analyzing keyword";
  const stage = progress.stage || "keyword";
  const label = KEYWORD_FINDER_STAGE_LABELS[stage] || progress.message || "Analyzing keyword";
  return `Keyword Finder · ${label}`;
}

const AI_VISIBILITY_STAGE_LABELS = {
  google: "Google AI Overview",
  chat_gpt: "ChatGPT answers",
  claude: "Claude non-branded mentions",
  gemini: "Gemini non-branded mentions",
  grok: "Grok non-branded mentions",
};

export function formatAiVisibilityProgressLabel(progress) {
  if (!progress) return "Scanning AI mentions";
  const stage = progress.stage || "ai_visibility";
  const label = AI_VISIBILITY_STAGE_LABELS[stage] || progress.message || "Scanning AI mentions";
  return `AI Visibility Tracker · ${label}`;
}

const BRAND_SENTIMENT_STAGE_LABELS = {
  chatgpt: "ChatGPT brand signals",
  gemini: "Gemini brand view",
  claude: "Claude brand view",
  grok: "Grok brand view",
};

export function formatBrandSentimentProgressLabel(progress) {
  if (!progress) return "Analyzing brand sentiment";
  const stage = progress.stage || "brand_sentiment";
  const label = BRAND_SENTIMENT_STAGE_LABELS[stage] || progress.message || "Analyzing brand sentiment";
  return `Brand Sentiment Analysis · ${label}`;
}

const COMPETITOR_RESEARCH_STAGE_LABELS = {
  your_site: "Your site SEO and AI visibility",
  competitor: "Competitor metrics",
  google: "Google AI Overview",
  chat_gpt: "ChatGPT answers",
  agent_ai_user: "Assistant visibility (your site)",
  agent_ai_competitor: "Assistant visibility (competitor)",
  synthesis: "Comparison and action plan",
};

export function formatCompetitorResearchProgressLabel(progress) {
  if (!progress) return "Researching competitors";
  const stage = progress.stage || "competitor_research";
  const label =
    COMPETITOR_RESEARCH_STAGE_LABELS[stage] || progress.message || "Researching competitors";
  return `Competitor Research · ${label}`;
}

const PROMPT_RESEARCH_STAGE_LABELS = {
  asking: "Asking ChatGPT, Gemini, Claude and Grok",
  chatgpt: "ChatGPT estimate in",
  gemini: "Gemini estimate in",
  claude: "Claude estimate in",
  grok: "Grok estimate in",
  related: "Estimating related prompts on every platform",
  indexed: "Cross-checking indexed AI volume",
};

export function formatPromptResearchProgressLabel(progress) {
  if (!progress) return "Estimating prompt volume";
  const label = PROMPT_RESEARCH_STAGE_LABELS[progress.stage] || progress.message || "Estimating prompt volume";
  return `Prompt Research · ${label}`;
}

const SERP_TRACKING_STAGE_LABELS = {
  keywords: "Finding your ranking keywords",
  tracking: "Checking live Google positions",
  serp: "Live rank check",
};

export function formatSerpTrackingProgressLabel(progress) {
  if (!progress) return "Tracking SERP rankings";
  const label = SERP_TRACKING_STAGE_LABELS[progress.stage] || progress.message || "Tracking SERP rankings";
  return `SERP Tracking · ${label}`;
}

const BACKLINK_FINDER_STAGE_LABELS = {
  expand: "Building keyword variations",
  serp: "Pulling Google results",
  filter: "Filtering blogs and competitors",
  contacts: "Finding marketing contacts",
  hunter: "Looking up outreach emails",
};

export function formatBacklinkFinderProgressLabel(progress) {
  if (!progress) return "Finding backlink opportunities";
  const label =
    BACKLINK_FINDER_STAGE_LABELS[progress.stage] || progress.message || "Finding backlink opportunities";
  return `Backlink Finder · ${label}`;
}

const B2B_LEAD_FINDER_STAGE_LABELS = {
  icp: "Understanding your ICP",
  discover: "Discovering target companies",
  people: "Finding decision-makers",
  reveal: "Revealing contact emails",
};

export function formatB2bLeadFinderProgressLabel(progress) {
  if (!progress) return "Finding B2B leads";
  const label =
    B2B_LEAD_FINDER_STAGE_LABELS[progress.stage] || progress.message || "Finding B2B leads";
  return `B2B Lead Finder · ${label}`;
}

const LOCAL_SEO_STAGE_LABELS = {
  resolve: "Reading Maps link",
  profile: "Loading Business Profile",
  competitors: "Analyzing competitors",
  analysis: "Writing your action plan",
};

export function formatLocalSeoProgressLabel(progress) {
  if (!progress) return "Analyzing Google Maps profile";
  const label =
    LOCAL_SEO_STAGE_LABELS[progress.stage] || progress.message || "Analyzing Google Maps profile";
  return `Local SEO · ${label}`;
}

const REELS_CREATION_STAGE_LABELS = {
  prompt: "Preparing prompt",
  generate: "Generating 1080p reel (up to 10s)",
  save: "Saving video",
};

export function formatReelsCreationProgressLabel(progress) {
  if (!progress) return "Creating reel";
  const label =
    REELS_CREATION_STAGE_LABELS[progress.stage] || progress.message || "Creating reel";
  return `Reels creation · ${label}`;
}

export function formatHumanizeProgressLabel(progress) {
  if (!progress) return "Humanizing content";
  const label = progress.message || "Humanizing tone and flow";
  const eta = Math.max(1, Math.ceil(Number(progress.etaSeconds || 90) / 60));
  const etaLabel = eta === 1 ? "~1 min left" : `~${eta} min left`;
  return `Humanization · ${label} · ${etaLabel}`;
}

export function formatAiOrchestratorProgressLabel(progress) {
  if (!progress) return "AI mode · planning next step";
  if (progress.phase === "integrations") return `Website & analytics · ${progress.message || "Working"}`;
  return `AI mode · ${progress.message || "Understanding your objective"}`;
}

export function thinkingLabel(
  lastUserText,
  auditProgress,
  blogProgress,
  humanizeProgress,
  geoBlogWriter,
  rankingProgress,
  keywordFinderProgress,
  aiVisibilityProgress,
  brandSentimentProgress,
  competitorResearchProgress,
  promptResearchProgress,
  serpTrackingProgress,
  backlinkFinderProgress,
  b2bLeadFinderProgress,
  localSeoProgress,
  reelsCreationProgress,
  aiOrchestratorProgress,
) {
  if (aiOrchestratorProgress) return formatAiOrchestratorProgressLabel(aiOrchestratorProgress);
  if (auditProgress) return formatAuditProgressLabel(auditProgress);
  if (reelsCreationProgress) return formatReelsCreationProgressLabel(reelsCreationProgress);
  if (localSeoProgress) return formatLocalSeoProgressLabel(localSeoProgress);
  if (b2bLeadFinderProgress) return formatB2bLeadFinderProgressLabel(b2bLeadFinderProgress);
  if (backlinkFinderProgress) return formatBacklinkFinderProgressLabel(backlinkFinderProgress);
  if (serpTrackingProgress) return formatSerpTrackingProgressLabel(serpTrackingProgress);
  if (promptResearchProgress) return formatPromptResearchProgressLabel(promptResearchProgress);
  if (competitorResearchProgress) return formatCompetitorResearchProgressLabel(competitorResearchProgress);
  if (brandSentimentProgress) return formatBrandSentimentProgressLabel(brandSentimentProgress);
  if (aiVisibilityProgress) return formatAiVisibilityProgressLabel(aiVisibilityProgress);
  if (keywordFinderProgress) return formatKeywordFinderProgressLabel(keywordFinderProgress);
  if (rankingProgress) return formatRankingProgressLabel(rankingProgress);
  if (blogProgress) return formatBlogProgressLabel(blogProgress, { geoWriter: geoBlogWriter });
  if (humanizeProgress) return formatHumanizeProgressLabel(humanizeProgress);
  const last = String(lastUserText || "");
  if (/\bhttps?:\/\/|\bwww\./i.test(last)) return "Reading the website";
  if (/create the article|write the article|yes, create|full.*article|show me the.*article|review article/i.test(last)) {
    return "Writing your article";
  }
  if (/audit|analyze|scan/i.test(last)) return "Analyzing your site";
  return "Blazly is thinking";
}
