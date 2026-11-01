import { useEffect, useMemo, useRef, useState } from "react";
import { ChatThinking, thinkingLabel } from "./ChatThinking.jsx";
import { firstUrlInText, messageLooksLikeSiteAuditUrl, runSiteAuditStream } from "./siteAuditClient.js";
import {
  GEO_BLOG_WRITER_BRIEF,
  SEO_BLOG_WRITER_BRIEF,
  isEmptyGeoBlogBrief,
  isEmptySeoBlogBrief,
  runBlogWriterRewriteStream,
  runBlogWriterStream,
  shouldRunBlogWriterPipeline,
  shouldRunBlogWriterRewrite,
} from "./blogWriterClient.js";
import { runHumanizeStream, shouldRunHumanizeAgent } from "./humanizeClient.js";
import {
  isEmptyRankingBrief,
  looksLikeRankingBrief,
  parseRankingOpportunityBrief,
  rankingBriefPrefill,
  runRankingOpportunityStream,
  shouldRunRankingOpportunityFinder,
} from "./rankingOpportunityClient.js";
import {
  isEmptyKeywordFinderBrief,
  keywordFinderPrefill,
  looksLikeKeywordFinderBrief,
  parseKeywordFinderBrief,
  runKeywordFinderStream,
  shouldRunKeywordFinder,
} from "./keywordFinderClient.js";
import {
  aiVisibilityBriefPrefill,
  isEmptyAiVisibilityBrief,
  looksLikeAiVisibilityBrief,
  parseAiVisibilityBrief,
  runAiVisibilityStream,
  shouldRunAiVisibilityTracker,
} from "./aiVisibilityTrackerClient.js";
import {
  brandSentimentBriefPrefill,
  isEmptyBrandSentimentBrief,
  looksLikeBrandSentimentBrief,
  parseBrandSentimentBrief,
  runBrandSentimentStream,
  shouldRunBrandSentimentAnalysis,
} from "./brandSentimentClient.js";
import {
  competitorResearchBriefPrefill,
  isEmptyCompetitorResearchBrief,
  looksLikeCompetitorResearchBrief,
  parseCompetitorResearchBrief,
  runCompetitorResearchStream,
  shouldRunCompetitorResearch,
} from "./competitorResearchClient.js";
import {
  PROMPT_RESEARCH_BRIEF,
  isEmptyPromptResearchBrief,
  parsePromptResearchBrief,
  runPromptResearchStream,
  shouldRunPromptResearch,
} from "./promptResearchClient.js";
import {
  isEmptySerpTrackingBrief,
  looksLikeSerpTrackingBrief,
  parseSerpTrackingBrief,
  runSerpTrackingStream,
  serpTrackingBriefPrefill,
  shouldRunSerpTracking,
} from "./serpTrackingClient.js";
import {
  backlinkFinderBriefPrefill,
  isEmptyBacklinkFinderBrief,
  looksLikeBacklinkFinderBrief,
  parseBacklinkFinderBrief,
  runBacklinkFinderStream,
  shouldRunBacklinkFinder,
} from "./backlinkFinderClient.js";
import {
  b2bLeadFinderBriefPrefill,
  isEmptyB2bLeadFinderBrief,
  looksLikeB2bLeadFinderBrief,
  parseB2bLeadFinderBrief,
  runB2bLeadFinderStream,
  shouldRunB2bLeadFinder,
} from "./b2bLeadFinderClient.js";
import {
  isEmptyLocalSeoBrief,
  localSeoBriefPrefill,
  looksLikeLocalSeoBrief,
  parseLocalSeoBrief,
  runLocalSeoStream,
  shouldRunLocalSeo,
} from "./localSeoClient.js";
import {
  extractReelStateFromMessages,
  isContinueReelSetup,
  isEmptyReelsCreationBrief,
  looksLikeReelsCreationBrief,
  parseReelsCreationBrief,

  reelsCreationBriefPrefill,
  runReelsCreationStream,
  shouldRunReelsCreation,
} from "./reelsCreationClient.js";
import { ArticleEditor } from "./ArticleEditor.jsx";
import { ShareChatButton } from "./ShareChatButton.jsx";
import {
  extractLastBlogArticleFromHistory,
  extractLatestAuditDock,
  extractWorkpaneData,
  userWantsFullArticle,
} from "./chatBlocks.js";
import { ChatAuditDock } from "./ChatAuditDock.jsx";
import { streamAssistantReply } from "./streamChat.js";
import {
  formatOrchestratorClarify,
  formatOrchestratorDispatchIntro,
  routeAiObjective,
} from "./aiOrchestratorClient.js";
import { loadWorkspaceMode, saveWorkspaceMode, WORKSPACE_MODES } from "./workspaceMode.js";
import { WorkspaceModeToggle } from "./WorkspaceModeToggle.jsx";
import { IntegrationsView } from "./IntegrationsView.jsx";
import {
  deleteProjectIntegrations,
  renameProjectIntegrations,
  runSiteIntegrationsStream,
} from "./integrationsClient.js";
import { Icon } from "./Icon.jsx";
import { useThemePreference } from "./theme.js";
import { ProfileView } from "./ProfileView.jsx";
import { SettingsView } from "./SettingsView.jsx";
import { SignOutConfirmModal } from "./SignOutConfirmModal.jsx";
import {
  PromptShell,
  apiModeFromComposer,
  inferComposerFromMode,
} from "./PromptComposer.jsx";
import { ChatMessage } from "./ChatMessage.jsx";
import { ChatNavItem } from "./ChatNavItem.jsx";
import {
  attachmentKey,
  buildUserMessagePayload,
  isVideoAttachmentFile,
  stripMessagesForStorage,
  validateAttachmentFile,
} from "./chatAttachments.js";
import { defaultChatTitle, loadChats, newChatId, saveChats } from "./chatStorage.js";
import {
  defaultProjects,
  loadProjects,
  newProjectId,
  projectDisplayWebsite,
  saveProjects,
} from "./projectStorage.js";
import { ProjectSetupWizard } from "./ProjectSetupWizard.jsx";
import { fetchSiteLogo, ProjectAvatar } from "./ProjectAvatar.jsx";
import { ScheduledView } from "./ScheduledView.jsx";
import { ConnectAiView } from "./ConnectAiView.jsx";
import { PricingView } from "./PricingView.jsx";
import { DiscussionsView } from "./DiscussionsView.jsx";
import { ReferralModal } from "./ReferralModal.jsx";
import { PLANS } from "./plans.js";
import { claimPendingReferral } from "./referralClient.js";
import { acceptPendingTeamInvite, registerProject, syncProjectsWithServer } from "./accountClient.js";
import { CreditMeter, useCredits } from "./CreditsCard.jsx";
import {
  createSchedule,
  formatScheduleConfirmation,
  listSchedules,
  loadImportedRunIds,
  saveImportedRunIds,
} from "./schedulesClient.js";
import { useAuth } from "./AuthContext.jsx";
import { saveProject } from "./firebase.js";

const MODES = ["Auto", "Fast", "Deep"];

const SCOPE_LABELS = {
  seo: "SEO",
  geo: "GEO & AEO",
  links: "Link Building",
  local: "Local SEO",
  leads: "Lead Finder",
  content: "Content",
};

const AGENTS = [
  {
    id: "site-audit",
    title: "Site Audit",
    body: "209 checks across 19 categories per page (up to 100 URLs), plus off-page authority.",
    chipHint: "209 checks · 19 categories · 100 pages",
    scope: "seo",
    icon: "clipboardCheck",
  },
  {
    id: "seo-blog-writer",
    title: "SEO & AEO writer",
    body: "Full Blazly Blog Writer pipeline: research → draft → SEO → humanize → fact-check → finalize.",
    chipHint: "Humanized · fact-checked · GEO-ready",
    scope: "seo",
    icon: "fileText",
  },
  {
    id: "geo-blog-writer",
    title: "GEO blog writer",
    body: "Generative Engine Optimization article: answer-first, citation-ready, FAQs; always runs on Max effort.",
    chipHint: "AI citations · TL;DR · Max mode",
    scope: "geo",
    icon: "newspaper",
  },
  {
    id: "reels-creation",
    title: "Reels creation",
    body: "Describe a vertical reel (1080p, 9:16). Each reel is a single clip of up to 10 seconds. Optional: attach a person photo as reference.",
    chipHint: "10s clips · 1080p vertical",
    scope: "content",
    icon: "film",
  },
  {
    id: "humanization",
    title: "Humanization",
    body: "Paste a blog article or landing page for an anti-AI rewrite with varied rhythm, no clichés, facts preserved.",
    chipHint: "Perplexity · burstiness · detector-safe",
    scope: "geo",
    icon: "feather",
  },
  {
    id: "ranking-opportunity-finder",
    title: "Ranking Opportunity Finder",
    body: "Enter your website URL and a target keyword. We find winnable long-tail ideas with blog titles and monthly search volume.",
    chipHint: "Low competition · long-tail · Max mode",
    scope: "seo",
    icon: "target",
  },
  {
    id: "local-seo",
    title: "Local SEO (Google Maps)",
    body: "Enter your business name and Google Maps listing URL. We pull your Business Profile, compare nearby competitors on Maps, and deliver a prioritized local SEO to-do list.",
    chipHint: "Maps profile · competitors · checklist · Max mode",
    scope: "local",
    icon: "mapPin",
  },
  {
    id: "b2b-lead-finder",
    title: "B2B Lead Finder",
    body: "Describe your ideal customer profile in detail. We match companies with Hunter Discover and surface decision-maker emails for outbound outreach.",
    chipHint: "ICP · company match · verified emails · Max mode",
    scope: "links",
    icon: "mapPin",
  },
  {
    id: "backlink-finder",
    title: "Backlink Finder",
    body: "Enter a target keyword. We scan Google results across related queries, drop competitors, keep editorial blogs, and find marketing contacts for outreach.",
    chipHint: "SERP · blogs · outreach emails · Max mode",
    scope: "links",
    icon: "link",
  },
  {
    id: "serp-tracking",
    title: "SERP Tracking",
    body: "Enter your website URL to see your top Google ranking pages with keyword, live position, and monthly search volume.",
    chipHint: "Top 10 rankings · live SERP · Max mode",
    scope: "seo",
    icon: "gauge",
  },
  {
    id: "keyword-finder",
    title: "Keyword Finder",
    body: "Enter a keyword to see worldwide search volume, difficulty, a six-month trend chart, and related keywords.",
    chipHint: "Global volume · difficulty · trend · Max mode",
    scope: "seo",
    icon: "hash",
  },
  {
    id: "prompt-research",
    title: "Prompt Research",
    body: "Enter a prompt to estimate how often people ask it in ChatGPT, Gemini, Claude, and Grok, plus related prompts with volume per platform.",
    chipHint: "4 AI platforms · prompt volume · Max mode",
    scope: "geo",
    icon: "messages",
  },
  {
    id: "ai-visibility-tracker",
    title: "AI Visibility Tracker",
    body: "Enter your website URL to map non-branded prompts across Google AI Overview, ChatGPT, Claude, Gemini, and Grok.",
    chipHint: "5 AI platforms · non-branded · Max mode",
    scope: "geo",
    icon: "eye",
  },
  {
    id: "brand-sentiment-analysis",
    title: "Brand Sentiment Analysis",
    body: "Enter your website URL to see how ChatGPT, Gemini, Claude, and Grok talk about your brand: visibility, trust, and recommendations.",
    chipHint: "4 AI platforms · references · Max mode",
    scope: "geo",
    icon: "smile",
  },
  {
    id: "site-integrations",
    title: "Website & analytics",
    body: "Publish blogs live to WordPress and work with your real Google Search Console and GA4 data. Connect your site under Integrations first.",
    chipHint: "WordPress · Search Console · GA4",
    scope: "seo",
    icon: "plug",
  },
  {
    id: "competitor-research",
    title: "Competitor Research",
    body: "Enter competitor website URLs (one or many). We compare them to your project site on search authority, organic footprint, and AI visibility—then show how to surpass them.",
    chipHint: "SEO + AI visibility · comparison · Max mode",
    scope: "seo",
    icon: "users",
  },
];

const AGENT_GROUP_IDS = [
  {
    id: "research",
    label: "Research & audits",
    agentIds: [
      "site-audit",
      "keyword-finder",
      "serp-tracking",
      "ranking-opportunity-finder",
      "competitor-research",
      "backlink-finder",
      "b2b-lead-finder",
    ],
  },
  {
    id: "local",
    label: "Local SEO",
    agentIds: ["local-seo"],
  },
  {
    id: "content",
    label: "Content",
    agentIds: ["seo-blog-writer", "geo-blog-writer", "reels-creation", "humanization"],
  },
  {
    id: "site",
    label: "Your website",
    agentIds: ["site-integrations"],
  },
  {
    id: "ai-search",
    label: "AI search visibility",
    agentIds: ["prompt-research", "ai-visibility-tracker", "brand-sentiment-analysis"],
  },
];

const GROUPED_AGENT_IDS = new Set(AGENT_GROUP_IDS.flatMap((group) => group.agentIds));
const UNGROUPED_AGENTS = AGENTS.filter((agent) => !GROUPED_AGENT_IDS.has(agent.id));

const AGENT_GROUPS = [
  ...AGENT_GROUP_IDS.map((group) => ({
    ...group,
    agents: group.agentIds.map((id) => AGENTS.find((agent) => agent.id === id)).filter(Boolean),
  })),
  ...(UNGROUPED_AGENTS.length ? [{ id: "more", label: "More agents", agents: UNGROUPED_AGENTS }] : []),
].filter((group) => group.agents.length > 0);

const PLAYBOOKS = [
  {
    title: "Website GEO Audit",
    body: "On-page, technical, and content.",
    icon: "globe",
    scope: "geo",
  },
  {
    title: "Local map pack",
    body: "Listings, reviews, and service area.",
    icon: "mapPin",
    scope: "local",
  },
  {
    title: "Link gap",
    body: "Pages that should earn a mention.",
    icon: "link",
    scope: "links",
  },
];

const PROMPT_MAX_HEIGHT = 168;

function fitPrompt(element) {
  if (!element) return;
  element.style.height = "0px";
  const next = Math.min(element.scrollHeight, PROMPT_MAX_HEIGHT);
  element.style.height = `${next}px`;
  element.style.overflowY = element.scrollHeight > PROMPT_MAX_HEIGHT ? "auto" : "hidden";
}

const SIDEBAR_KEY = "blazly-sidebar-collapsed";

function readSidebarCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

function greetingFor(name) {
  const hour = new Date().getHours();
  const part = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  return name ? `Good ${part}, ${name}` : `Good ${part}`;
}

function websiteHost(url) {
  const value = String(url || "").trim();
  if (!value) return "";
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, "");
  } catch {
    return value.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  }
}

const UPGRADE_PATTERN = /plan and above|Not enough credits|limit reached for your plan|Your plan allows/i;

function isUpgradeError(err) {
  return err?.code === "plan_required" || err?.code === "insufficient_credits" || err?.code === "rate_limited" || UPGRADE_PATTERN.test(err?.message || "");
}

function upgradeReply(err) {
  const label = /Not enough credits/i.test(err.message) ? "Get more credits" : "See plans";
  return `${err.message}\n\nLINK_ACTION|${label}|/pricing`;
}

export function Workspace() {
  const { user, profile, signOutUser } = useAuth();
  const credits = useCredits(Boolean(user));
  const [view, setView] = useState("home");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed);
  const [theme, setTheme] = useThemePreference();
  const [chats, setChats] = useState([]);
  const [activeChatId, setActiveChatId] = useState(null);
  const [projects, setProjects] = useState(() => defaultProjects());
  const [project, setProject] = useState(() => defaultProjects()[0]?.name || "My project");
  const [openedProject, setOpenedProject] = useState(null);
  const [projectOpen, setProjectOpen] = useState(false);
  const [addProjectSession, setAddProjectSession] = useState(0);
  const [effortAuto, setEffortAuto] = useState(false);
  const [effortTier, setEffortTier] = useState("low");
  const mode = useMemo(() => apiModeFromComposer(effortAuto, effortTier), [effortAuto, effortTier]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [scope, setScope] = useState("geo");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [editorDraft, setEditorDraft] = useState(null);
  const [editorDraftHtml, setEditorDraftHtml] = useState(null);
  const [articleEditorOpen, setArticleEditorOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [pendingAgent, setPendingAgent] = useState(null);
  const [auditProgress, setAuditProgress] = useState(null);
  const [blogProgress, setBlogProgress] = useState(null);
  const [humanizeProgress, setHumanizeProgress] = useState(null);
  const [siteIntegrationsProgress, setSiteIntegrationsProgress] = useState(null);
  const [integrationsNotice, setIntegrationsNotice] = useState(null);
  const [scheduleRefresh, setScheduleRefresh] = useState(0);
  const [rankingProgress, setRankingProgress] = useState(null);
  const [keywordFinderProgress, setKeywordFinderProgress] = useState(null);
  const [aiVisibilityProgress, setAiVisibilityProgress] = useState(null);
  const [brandSentimentProgress, setBrandSentimentProgress] = useState(null);
  const [competitorResearchProgress, setCompetitorResearchProgress] = useState(null);
  const [promptResearchProgress, setPromptResearchProgress] = useState(null);
  const [serpTrackingProgress, setSerpTrackingProgress] = useState(null);
  const [backlinkFinderProgress, setBacklinkFinderProgress] = useState(null);
  const [b2bLeadFinderProgress, setB2bLeadFinderProgress] = useState(null);
  const [localSeoProgress, setLocalSeoProgress] = useState(null);
  const [reelsCreationProgress, setReelsCreationProgress] = useState(null);
  const [workspaceMode, setWorkspaceMode] = useState(() => loadWorkspaceMode());
  const [aiOrchestratorProgress, setAiOrchestratorProgress] = useState(null);
  const fileRef = useRef(null);
  const shellRef = useRef(null);
  const promptRef = useRef(null);
  const threadRef = useRef(null);
  const messagesRef = useRef([]);
  const activeChatIdRef = useRef(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    activeChatIdRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    if (!pendingAgent) return;
    setEffortAuto(false);
    setEffortTier("max");
  }, [pendingAgent]);
  const displayName = user?.displayName || profile?.name || user?.email?.split("@")[0] || "User";
  const initial = displayName.trim().charAt(0).toUpperCase() || "U";
  const avatarUrl = profile?.avatarURL || user?.photoURL || "";
  const renderAvatar = (sizeClass = "") =>
    avatarUrl ? (
      <img className={`avatar avatar-img ${sizeClass}`.trim()} src={avatarUrl} alt="" referrerPolicy="no-referrer" />
    ) : (
      <span className={`avatar ${sizeClass}`.trim()}>{initial}</span>
    );

  useEffect(() => {
    function onPointerDown(event) {
      if (!shellRef.current?.contains(event.target)) return;
      const inMenu = event.target.closest?.("[data-menu]");
      if (!inMenu) {
        setProjectOpen(false);
        setProfileOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const activeProjectRecord = useMemo(
    () => projects.find((entry) => entry.name === project) || null,
    [projects, project]
  );

  function activeProjectContext() {
    const website =
      projectDisplayWebsite(activeProjectRecord) ||
      profile?.website ||
      profile?.knowledge?.website ||
      "";
    const knowledge = activeProjectRecord?.knowledge || profile?.knowledge || null;
    const brandName = knowledge?.companyName || profile?.name || profile?.knowledge?.brandName;
    return { website, knowledge, brandName };
  }

  const firstProjectName = projects[0]?.name;
  const chatProject = (chat) => chat.project || firstProjectName;
  const projectChats = chats.filter((chat) => chatProject(chat) === project);

  const projectCards = projects.map((entry) => {
    const site = projectDisplayWebsite(entry);
    const chatCount = chats.filter((chat) => chatProject(chat) === entry.name).length;
    const chatLabel = chatCount ? `${chatCount} saved chat${chatCount === 1 ? "" : "s"}` : "No chats yet";
    return {
      name: entry.name,
      logo: entry.logo || "",
      website: websiteHost(site),
      status: entry.name === project ? `Active · ${chatLabel}` : chatLabel,
    };
  });

  const logoAttemptedRef = useRef(new Set());
  useEffect(() => {
    if (!user?.uid) return;
    const missing = projects.filter(
      (entry) => !entry.logo && projectDisplayWebsite(entry) && !logoAttemptedRef.current.has(entry.name),
    );
    if (!missing.length) return;
    for (const entry of missing) logoAttemptedRef.current.add(entry.name);
    Promise.all(missing.map(async (entry) => [entry.name, await fetchSiteLogo(projectDisplayWebsite(entry))])).then(
      (found) => {
        const logos = new Map(found.filter(([, logo]) => logo));
        if (!logos.size) return;
        setProjects((current) => {
          const next = current.map((entry) => (logos.has(entry.name) && !entry.logo ? { ...entry, logo: logos.get(entry.name) } : entry));
          saveProjects(user.uid, next);
          return next;
        });
      },
    );
  }, [projects, user?.uid]);

  useEffect(() => {
    if (!user?.uid) {
      setProjects(defaultProjects(profile));
      return;
    }
    let list = loadProjects(user.uid, profile);
    if (!list.length) {
      list = defaultProjects(profile);
      saveProjects(user.uid, list);
    }
    setProjects(list);
  }, [user?.uid, profile?.project, profile?.website, profile?.knowledge]);

  useEffect(() => {
    if (!user?.uid || !profile?.project) return;
    setProjects((current) => {
      const index = current.findIndex((entry) => entry.name === profile.project);
      if (index === -1) return current;
      const existing = current[index];
      const website = existing.website || profile.website || profile.knowledge?.website || "";
      const knowledge = existing.knowledge || profile.knowledge || null;
      if (existing.website === website && existing.knowledge === knowledge) return current;
      const next = [...current];
      next[index] = { ...existing, website, knowledge };
      saveProjects(user.uid, next);
      return next;
    });
  }, [user?.uid, profile?.project, profile?.website, profile?.knowledge]);

  const profileProjectSyncedRef = useRef(false);
  useEffect(() => {
    if (!user?.uid) {
      profileProjectSyncedRef.current = false;
      return;
    }
    if (profileProjectSyncedRef.current || !profile?.project || !projects.length) return;
    if (projects.some((entry) => entry.name === profile.project)) setProject(profile.project);
    profileProjectSyncedRef.current = true;
  }, [user?.uid, profile?.project, projects]);

  useEffect(() => {
    if (projects.length && !projects.some((entry) => entry.name === project)) {
      setProject(projects[0].name);
    }
  }, [projects, project]);

  useEffect(() => {
    setChats(loadChats(user?.uid));
  }, [user?.uid]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("integrations");
    if (!result) return;
    setView("integrations");
    setIntegrationsNotice(
      result === "google-connected"
        ? { tone: "success", text: "Google connected. Choose your Search Console and GA4 properties below." }
        : result === "webflow-connected"
          ? { tone: "success", text: "Webflow connected. Choose your site and blog collection below." }
          : result === "wordpress-connected"
            ? { tone: "success", text: "WordPress connected. Blazly can now publish and update posts on your site." }
            : { tone: "error", text: `Connection failed: ${params.get("reason") || "unknown error"}` },
    );
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  const [accountNotice, setAccountNotice] = useState(null);
  useEffect(() => {
    if (!user?.uid) return;
    claimPendingReferral();
    acceptPendingTeamInvite().then((notice) => {
      if (!notice) return;
      setAccountNotice(notice);
      setView("profile");
    });
  }, [user?.uid]);

  const projectNamesKey = projects.map((entry) => entry.name).join("\u0000");
  useEffect(() => {
    if (!user?.uid || !projectNamesKey) return;
    syncProjectsWithServer(projectNamesKey.split("\u0000")).catch(() => {});
  }, [user?.uid, projectNamesKey]);

  const [billingNotice, setBillingNotice] = useState("");
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("view") !== "pricing") return;
    setView("pricing");
    setBillingNotice(params.get("billing") || "");
    window.history.replaceState({}, "", window.location.pathname);
  }, []);

  useEffect(() => {
    if (!user?.uid || !activeChatId || messages.length === 0) return;
    setChats((current) => {
      const next = current.map((chat) => (
        chat.id === activeChatId
          ? {
              ...chat,
              messages: stripMessagesForStorage(messages),
              project: chat.project || project,
              scope,
              mode,
              agent: pendingAgent || chat.agent,
              interactionMode:
                chat.interactionMode ||
                (workspaceMode === WORKSPACE_MODES.ai ? WORKSPACE_MODES.ai : WORKSPACE_MODES.manual),
              updatedAt: Date.now(),
            }
          : chat
      ));
      saveChats(user.uid, next);
      return next;
    });
  }, [messages, activeChatId, project, scope, mode, pendingAgent, user?.uid]);

  useEffect(() => {
    if (!user?.uid) return undefined;
    let cancelled = false;
    async function importFinishedRuns() {
      let jobs;
      try {
        jobs = await listSchedules(user.uid);
      } catch {
        return;
      }
      if (cancelled) return;
      const imported = loadImportedRunIds(user.uid);
      const fresh = [];
      for (const job of jobs) {
        for (const run of job.runs || []) {
          if (imported.has(run.id)) continue;
          imported.add(run.id);
          const lastAgent = job.steps.at(-1)?.agentId || null;
          fresh.push({
            id: `run_${run.id}`,
            title: `Scheduled · ${job.title}`.slice(0, 60),
            project: job.project,
            scope,
            mode,
            agent: lastAgent,
            interactionMode: WORKSPACE_MODES.ai,
            scheduledJobId: job.id,
            messages:
              run.status === "done"
                ? (run.messages || []).map(({ role, content }) => ({ role, content }))
                : [
                    { role: "user", content: job.title },
                    { role: "assistant", content: `This scheduled run failed: ${run.error || "unknown error"}` },
                  ],
            updatedAt: new Date(run.finishedAt).getTime() || Date.now(),
          });
        }
      }
      saveImportedRunIds(user.uid, imported);
      if (!fresh.length) return;
      setChats((current) => {
        const ids = new Set(current.map((chat) => chat.id));
        const next = [...fresh.filter((chat) => !ids.has(chat.id)), ...current];
        saveChats(user.uid, next);
        return next;
      });
    }
    importFinishedRuns();
    const timer = setInterval(importFinishedRuns, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user?.uid, scheduleRefresh]);

  function chooseProject(next) {
    if (next !== project) {
      const openChat = chats.find((chat) => chat.id === activeChatIdRef.current);
      if (openChat || messagesRef.current.length) resetChatState();
    }
    setProject(next);
    if (user) saveProject(user.uid, next).catch(() => {});
  }

  function resetChatState() {
    activeChatIdRef.current = null;
    setActiveChatId(null);
    setMessages([]);
    setPrompt("");
    setStatus("");
    setAttachments([]);
    setPendingAgent(null);
    setAuditProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function renameProject(oldName, rawName) {
    const name = String(rawName || "").trim();
    if (!name || name === oldName) return;
    if (name.length > 60) throw new Error("Keep the project name under 60 characters.");
    if (projects.some((entry) => entry.name !== oldName && entry.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("That project name already exists.");
    }
    if (user?.uid) await renameProjectIntegrations({ uid: user.uid, from: oldName, to: name });

    const next = projects.map((entry) => (entry.name === oldName ? { ...entry, name } : entry));
    setProjects(next);
    if (user?.uid) saveProjects(user.uid, next);

    setChats((current) => {
      const updated = current.map((chat) => (chat.project === oldName ? { ...chat, project: name } : chat));
      if (user?.uid) saveChats(user.uid, updated);
      return updated;
    });

    if (project === oldName) {
      setProject(name);
      if (user) saveProject(user.uid, name).catch(() => {});
    }
    if (openedProject === oldName) setOpenedProject(name);
  }

  function openProjectDetail(name) {
    chooseProject(name);
    setOpenedProject(name);
    setView("projects");
    setNavOpen(false);
    setProfileOpen(false);
  }

  function closeProjectDetail() {
    setOpenedProject(null);
  }

  function openAddProject() {
    const plan = PLANS[credits.data?.plan] || PLANS.free;
    if (credits.data && projects.length >= plan.projects) {
      setProjectOpen(false);
      setNavOpen(false);
      setBillingNotice("project-limit");
      setView("pricing");
      return;
    }
    setAddProjectSession((n) => n + 1);
    setView("add-project");
    setProjectOpen(false);
    setNavOpen(false);
  }

  function cancelAddProject() {
    setView("projects");
  }

  async function completeAddProject(data) {
    const name = data.projectName.trim();
    if (projects.some((entry) => entry.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("That project name already exists.");
    }
    if (user?.uid) await registerProject(name);
    const record = {
      id: newProjectId(),
      name,
      website: data.website,
      knowledge: data.knowledge,
    };
    const next = [...projects, record];
    setProjects(next);
    if (user?.uid) saveProjects(user.uid, next);
    chooseProject(name);
    setView("home");
    startNewChat();
    setStatus("");
  }

  function deleteProject(name) {
    if (projects.length <= 1) {
      setStatus("Keep at least one project.");
      return;
    }
    const fallback = projects.find((entry) => entry.name !== name)?.name || projects[0]?.name;
    const chatCount = chats.filter((chat) => chat.project === name).length;
    const confirmed = window.confirm(
      `Delete "${name}"? Its ${chatCount ? `${chatCount} chat(s), ` : ""}knowledge base and integrations will be removed. This can't be undone.`
    );
    if (!confirmed) return;
    const next = projects.filter((entry) => entry.name !== name);
    setProjects(next);
    if (user?.uid) {
      saveProjects(user.uid, next);
      deleteProjectIntegrations({ uid: user.uid, project: name }).catch(() => {});
    }

    setChats((current) => {
      const updated = current.filter((chat) => chat.project !== name);
      if (user?.uid) saveChats(user.uid, updated);
      return updated;
    });

    if (project === name) chooseProject(fallback);
    if (openedProject === name) setOpenedProject(null);
    setStatus("");
  }

  function startNewChat() {
    resetChatState();
    setView("home");
    setNavOpen(false);
  }

  function clearAttachments() {
    setAttachments([]);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function queueAttachmentFiles(fileList) {
    const incoming = [...(fileList || [])];
    if (!incoming.length) return;
    const errors = [];
    const reelsActive =
      pendingAgent === "reels-creation" ||
      chats.find((item) => item.id === activeChatIdRef.current)?.agent === "reels-creation" ||
      activeAgent?.id === "reels-creation";

    const accepted = [];
    for (const file of incoming) {
      const error = validateAttachmentFile(file);
      if (error) {
        errors.push(error);
        continue;
      }
      if (reelsActive && isVideoAttachmentFile(file)) {
        errors.push(`"${file.name}": reels use a photo reference, not a video. Attach an image instead.`);
        continue;
      }
      accepted.push(file);
    }

    setAttachments((current) => {
      const keys = new Set(current.map((file) => attachmentKey(file)));
      const next = [...current];
      for (const file of accepted) {
        const key = attachmentKey(file);
        if (keys.has(key)) continue;
        keys.add(key);
        next.push(file);
      }
      return next;
    });
    if (errors.length) setStatus(errors[0]);
    else setStatus((current) => (current && /too large|25 MB/i.test(current) ? "" : current));
  }

  function removeAttachment(index) {
    setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
    if (fileRef.current) fileRef.current.value = "";
  }

  function onPromptPaste(event) {
    const items = event.clipboardData?.items;
    if (!items?.length) return;
    const imageFiles = [];
    for (const item of items) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (!imageFiles.length) return;
    event.preventDefault();
    queueAttachmentFiles(imageFiles);
  }

  function openChat(id) {
    const chat = chats.find((item) => item.id === id);
    if (!chat) return;
    activeChatIdRef.current = chat.id;
    setActiveChatId(chat.id);
    setMessages(chat.messages || []);
    setProject(chat.project || project);
    setScope(chat.scope || scope);
    const inferred = inferComposerFromMode(chat.mode || mode);
    setEffortAuto(inferred.effortAuto);
    setEffortTier(inferred.effortTier);
    setPendingAgent(chat.agent || null);
    setAuditProgress(null);
    setPrompt("");
    setStatus("");
    setView("home");
    setNavOpen(false);
  }

  function deleteChat(id) {
    setChats((current) => {
      const next = current.filter((item) => item.id !== id);
      if (user?.uid) saveChats(user.uid, next);
      return next;
    });
    if (activeChatId === id) startNewChat();
  }

  function renameChat(id, title) {
    setChats((current) => {
      const next = current.map((item) => (item.id === id ? { ...item, title, updatedAt: Date.now() } : item));
      if (user?.uid) saveChats(user.uid, next);
      return next;
    });
  }

  function beginChat(draft) {
    if (activeChatIdRef.current) return activeChatIdRef.current;
    const id = newChatId();
    activeChatIdRef.current = id;
    const chat = {
      id,
      title: defaultChatTitle(draft),
      project,
      scope,
      mode,
      interactionMode:
        workspaceMode === WORKSPACE_MODES.ai ? WORKSPACE_MODES.ai : WORKSPACE_MODES.manual,
      messages: [],
      updatedAt: Date.now(),
    };
    setActiveChatId(id);
    setChats((current) => {
      const next = [chat, ...current.filter((item) => item.id !== id)];
      if (user?.uid) saveChats(user.uid, next);
      return next;
    });
    return id;
  }

  function readPrompt(overrideText) {
    if (typeof overrideText === "string") return overrideText.trim();
    return (promptRef.current?.value ?? prompt).trim();
  }

  function chatApiContext(history) {
    const lastUser = [...(history || messagesRef.current)].reverse().find((item) => item.role === "user");
    const { website, knowledge } = activeProjectContext();
    return {
      project,
      scope: SCOPE_LABELS[scope] || scope,
      mode,
      effortAuto,
      effortTier,
      website,
      knowledge,
      wantsFullArticle: userWantsFullArticle(lastUser?.content),
    };
  }

  async function fetchAssistantReply(history) {
    const updateStreaming = (partial) => {
      setMessages([...history, { role: "assistant", content: partial, streaming: true }]);
    };
    updateStreaming("");
    const reply = await streamAssistantReply({
      history,
      context: chatApiContext(history),
      onDelta: updateStreaming,
    });
    return reply;
  }

  function editUserMessageAndResend(messageIndex, newContent) {
    if (busy) return;
    const current = messagesRef.current;
    const message = current[messageIndex];
    if (!message || message.role !== "user") return;
    const trimmed = String(newContent || "").trim();
    if (!trimmed) return;
    if (message.attachments?.length) {
      setStatus("Remove attachments and send a new message to change this prompt.");
      return;
    }
    const prior = current.slice(0, messageIndex);
    messagesRef.current = prior;
    setMessages(prior);
    setStatus("");
    send(trimmed);
  }

  async function retryAssistant(assistantIndex) {
    if (busy) return;
    let history = messagesRef.current.slice(0, assistantIndex);
    while (history.length && history[history.length - 1]?.role !== "user") {
      history = history.slice(0, -1);
    }
    if (!history.length || history[history.length - 1]?.role !== "user") return;

    setMessages(history);
    setBusy(true);
    setStatus("");
    try {
      const reply = await fetchAssistantReply(history);
      setMessages([...history, { role: "assistant", content: reply }]);
    } catch (err) {
      setStatus(err.message || "Blazly could not reply.");
    } finally {
      setBusy(false);
    }
  }

  async function send(overrideText) {
    if (overrideText === "/integrations") {
      openView("integrations");
      return;
    }
    if (overrideText === "/scheduled") {
      openView("scheduled");
      return;
    }
    if (overrideText === "/pricing") {
      openView("pricing");
      return;
    }
    let text = readPrompt(overrideText);
    const fromAction = typeof overrideText === "string";
    const pendingFiles = fromAction ? [] : attachments;
    if ((!text && !pendingFiles.length) || busy) return;
    const draft = text;
    setBusy(true);
    setStatus("");
    if (!fromAction) setPrompt("");

    let userMessage;
    try {
      userMessage = await buildUserMessagePayload(draft, pendingFiles);
    } catch (err) {
      if (!fromAction) setPrompt(draft);
      setStatus(err.message || "Could not read that file.");
      setBusy(false);
      return;
    }

    if (!userMessage.content && !userMessage.attachments?.length) {
      setStatus("Enter a message first.");
      if (!fromAction) setPrompt(draft);
      setBusy(false);
      return;
    }

    beginChat(activeAgent?.title || draft || pendingFiles[0]?.name || "New chat");
    const history = [
      ...messagesRef.current,
      {
        role: "user",
        content: userMessage.content,
        attachments: userMessage.attachments,
      },
    ];
    setMessages(history);
    clearAttachments();

    let aiDispatchAgentId = null;
    let aiIntroPending = null;
    const chatAgentRecord = chats.find((item) => item.id === activeChatIdRef.current)?.agent;
    const chatInteractionMode = chats.find((item) => item.id === activeChatIdRef.current)?.interactionMode;
    const useAiOrchestrator =
      workspaceMode === WORKSPACE_MODES.ai && chatInteractionMode !== WORKSPACE_MODES.manual;

    if (useAiOrchestrator) {
      setAiOrchestratorProgress({
        phase: "orchestrator",
        stage: "route",
        message: "Understanding your objective",
      });
      try {
        const projectCtx = activeProjectContext();
        const route = await routeAiObjective({
          messages: history,
          project,
          website: projectCtx.website,
          knowledge: projectCtx.knowledge,
        });
        if (route.action === "clarify") {
          setMessages([
            ...history,
            { role: "assistant", content: formatOrchestratorClarify(route.clarifyMessage) },
          ]);
          setBusy(false);
          return;
        }
        if (route.action === "chat") {
          setMessages([...history, { role: "assistant", content: route.message }]);
          setBusy(false);
          return;
        }
        if (route.action === "schedule") {
          setAiOrchestratorProgress({ phase: "orchestrator", stage: "route", message: "Scheduling your task" });
          let content;
          try {
            const job = await createSchedule({
              uid: user?.uid,
              project,
              website: projectCtx.website,
              knowledge: projectCtx.knowledge,
              brandName: projectCtx.brandName,
              title: route.title,
              runAt: route.runAt,
              repeat: route.repeat,
              repeatUntil: route.repeatUntil,
              steps: route.steps,
            });
            content = formatScheduleConfirmation(job, route.confirmMessage);
            setScheduleRefresh((n) => n + 1);
          } catch (scheduleErr) {
            content =
              scheduleErr.code === "integration_required"
                ? `${scheduleErr.message}\n\nLINK_ACTION|Connect integrations|/integrations`
                : isUpgradeError(scheduleErr)
                  ? upgradeReply(scheduleErr)
                  : `I couldn't schedule that: ${scheduleErr.message}`;
          }
          setMessages([...history, { role: "assistant", content }]);
          setBusy(false);
          return;
        }
        if (route.action === "run_agent") {
          aiDispatchAgentId = route.agentId;
          aiIntroPending = formatOrchestratorDispatchIntro(route.intro, route.agentId);
          userMessage = { ...userMessage, content: route.agentMessage };
          setPendingAgent(route.agentId);
          setEffortAuto(false);
          setEffortTier("max");
        }
      } catch (err) {
        setBusy(false);
        if (isUpgradeError(err)) {
          setMessages([...history, { role: "assistant", content: upgradeReply(err) }]);
          return;
        }
        if (!fromAction) setPrompt(draft);
        setStatus(err.message || "Could not route your objective.");
        setMessages(history.slice(0, -1));
        return;
      } finally {
        setAiOrchestratorProgress(null);
      }
    }

    const dispatchAgent = aiDispatchAgentId || pendingAgent;
    const agentEngaged = (id) =>
      dispatchAgent === id || pendingAgent === id || chatAgentRecord === id;
    const mergeAiIntro = (reply) => (aiIntroPending ? `${aiIntroPending}\n\n${reply}` : reply);

    const siteAuditActive =
      agentEngaged("site-audit");
    const siteAuditUrl =
      siteAuditActive && messageLooksLikeSiteAuditUrl(userMessage.content)
        ? firstUrlInText(userMessage.content)
        : null;

    const geoBlogWriterActive =
      agentEngaged("geo-blog-writer");
    const seoBlogWriterActive =
      agentEngaged("seo-blog-writer");
    const blogWriterActive = seoBlogWriterActive || geoBlogWriterActive;
    const priorBlogArticle = blogWriterActive
      ? extractLastBlogArticleFromHistory(messagesRef.current)
      : null;
    const runBlogRewrite =
      blogWriterActive &&
      shouldRunBlogWriterRewrite(userMessage.content, priorBlogArticle);
    const runBlogWriter =
      blogWriterActive &&
      !runBlogRewrite &&
      shouldRunBlogWriterPipeline(userMessage.content, {
        hasPriorArticle: Boolean(priorBlogArticle?.html),
      });
    const blogWriterMode = geoBlogWriterActive ? "geo" : undefined;
    const blogEffortAuto = pendingAgent ? false : effortAuto;
    const blogEffortTier = pendingAgent ? "max" : effortTier;
    const blogAgentId = geoBlogWriterActive ? "geo-blog-writer" : "seo-blog-writer";

    const rankingFinderActive =
      agentEngaged("ranking-opportunity-finder");
    const rankingInChat = messagesRef.current.length > 0;
    const runRankingFinder =
      rankingFinderActive &&
      shouldRunRankingOpportunityFinder(userMessage.content, {
        agentActive: true,
        inChat: rankingInChat,
      });

    if (rankingFinderActive && !runRankingFinder) {
      const rankingFields = parseRankingOpportunityBrief(userMessage.content);
      let rankingStatus = "";
      if (isEmptyRankingBrief(userMessage.content) || looksLikeRankingBrief(userMessage.content)) {
        if (!rankingFields.website || !rankingFields.targetKeyword) {
          rankingStatus = "Enter both Website URL and Target keyword, then send.";
        }
      } else if (!rankingInChat) {
        rankingStatus = "Fill in Website URL and Target keyword in the composer, then send.";
      } else if (userMessage.content.trim().length < 3) {
        rankingStatus = "Add a bit more detail or send an updated URL and keyword brief.";
      }
      if (rankingStatus) {
        if (!fromAction) setPrompt(draft);
        setStatus(rankingStatus);
        setBusy(false);
        setMessages(history.slice(0, -1));
        return;
      }
    }

    const keywordFinderActive =
      agentEngaged("keyword-finder");
    const keywordFinderInChat = messagesRef.current.length > 0;
    const runKeywordFinderAgent =
      keywordFinderActive &&
      shouldRunKeywordFinder(userMessage.content, {
        agentActive: true,
        inChat: keywordFinderInChat,
      });

    if (keywordFinderActive && !runKeywordFinderAgent) {
      let keywordStatus = "";
      if (isEmptyKeywordFinderBrief(userMessage.content) || looksLikeKeywordFinderBrief(userMessage.content)) {
        if (!parseKeywordFinderBrief(userMessage.content)) {
          keywordStatus = "Enter a keyword after Keyword:, then send.";
        }
      } else if (!keywordFinderInChat) {
        keywordStatus = "Fill in Keyword: in the composer, then send.";
      } else if (userMessage.content.trim().length < 2) {
        keywordStatus = "Enter a keyword to analyze.";
      }
      if (keywordStatus) {
        if (!fromAction) setPrompt(draft);
        setStatus(keywordStatus);
        setBusy(false);
        setMessages(history.slice(0, -1));
        return;
      }
    }

    const reelsCreationActive =
      agentEngaged("reels-creation") ||
      Boolean(extractReelStateFromMessages(messagesRef.current));
    const reelsCreationInChat = messagesRef.current.length > 0;

    const runReelsCreation =
      reelsCreationActive &&
      shouldRunReelsCreation(userMessage.content, {
        agentActive: true,
        inChat: reelsCreationInChat,
      });

    if (reelsCreationActive && !runReelsCreation) {
      let reelsStatus = "";
      const parsedReel = parseReelsCreationBrief(userMessage.content);
      if (isEmptyReelsCreationBrief(userMessage.content) || looksLikeReelsCreationBrief(userMessage.content)) {
        if (!parsedReel.prompt || parsedReel.prompt.length < 12) {
          reelsStatus =
            "Describe your reel after Reel prompt: (scene, style, action). Remember: each clip is max 10 seconds.";
        }
      } else if (!parsedReel.prompt || parsedReel.prompt.length < 12) {
        reelsStatus = "Add a detailed reel prompt (at least 12 characters), then send.";
      }
      if (reelsStatus) {
        if (!fromAction) setPrompt(draft);
        setStatus(reelsStatus);
        setBusy(false);
        setMessages(history.slice(0, -1));
        return;
      }
    }

    const localSeoActive =
      agentEngaged("local-seo");
    const localSeoInChat = messagesRef.current.length > 0;
    const runLocalSeo =
      localSeoActive &&
      shouldRunLocalSeo(userMessage.content, {
        agentActive: true,
        inChat: localSeoInChat,
      });

    if (localSeoActive && !runLocalSeo) {
      let localStatus = "";
      const fields = parseLocalSeoBrief(userMessage.content);
      if (isEmptyLocalSeoBrief(userMessage.content) || looksLikeLocalSeoBrief(userMessage.content)) {
        if (!fields.businessName) {
          localStatus = "Enter your business name after Business name:, then send.";
        } else if (!fields.mapsUrl) {
          localStatus = "Paste your Google Maps listing URL after Google Maps URL:, then send.";
        }
      } else if (!localSeoInChat) {
        localStatus = "Fill in Business name and Google Maps URL in the composer, then send.";
      } else if (!fields.businessName || !fields.mapsUrl) {
        localStatus = "Include both business name and a Google Maps link to run the audit.";
      }
      if (localStatus) {
        if (!fromAction) setPrompt(draft);
        setStatus(localStatus);
        setBusy(false);
        setMessages(history.slice(0, -1));
        return;
      }
    }

    const b2bLeadFinderActive =
      agentEngaged("b2b-lead-finder");
    const b2bLeadFinderInChat = messagesRef.current.length > 0;
    const runB2bLeadFinder =
      b2bLeadFinderActive &&
      shouldRunB2bLeadFinder(userMessage.content, {
        agentActive: true,
        inChat: b2bLeadFinderInChat,
      });

    if (b2bLeadFinderActive && !runB2bLeadFinder) {
      let b2bStatus = "";
      const icpBody = parseB2bLeadFinderBrief(userMessage.content);
      if (isEmptyB2bLeadFinderBrief(userMessage.content) || looksLikeB2bLeadFinderBrief(userMessage.content)) {
        if (!icpBody || icpBody.length < 55) {
          b2bStatus =
            "Add a detailed ICP under Ideal customer profile (ICP): industry, geography, company size, and target job titles—then send.";
        }
      } else if (!b2bLeadFinderInChat && (!icpBody || icpBody.length < 55)) {
        b2bStatus = "Fill in your ICP in the composer (see the template), then send.";
      } else if (!icpBody || icpBody.length < 40) {
        b2bStatus = "Your ICP is too short. Add more detail so we can match quality leads.";
      }
      if (b2bStatus) {
        if (!fromAction) setPrompt(draft);
        setStatus(b2bStatus);
        setBusy(false);
        setMessages(history.slice(0, -1));
        return;
      }
    }

    const backlinkFinderActive =
      agentEngaged("backlink-finder");
    const backlinkFinderInChat = messagesRef.current.length > 0;
    const runBacklinkFinder =
      backlinkFinderActive &&
      shouldRunBacklinkFinder(userMessage.content, {
        agentActive: true,
        inChat: backlinkFinderInChat,
      });

    if (backlinkFinderActive && !runBacklinkFinder) {
      let backlinkStatus = "";
      if (isEmptyBacklinkFinderBrief(userMessage.content) || looksLikeBacklinkFinderBrief(userMessage.content)) {
        if (!parseBacklinkFinderBrief(userMessage.content).targetKeyword) {
          backlinkStatus = "Enter a target keyword after Target keyword:, then send.";
        }
      } else if (!backlinkFinderInChat) {
        backlinkStatus = "Fill in Target keyword: in the composer, then send.";
      } else if (userMessage.content.trim().length < 3) {
        backlinkStatus = "Enter a target keyword to find backlink opportunities.";
      }
      if (backlinkStatus) {
        if (!fromAction) setPrompt(draft);
        setStatus(backlinkStatus);
        setBusy(false);
        setMessages(history.slice(0, -1));
        return;
      }
    }

    const serpTrackingActive =
      agentEngaged("serp-tracking");
    const serpTrackingInChat = messagesRef.current.length > 0;
    const runSerpTracking =
      serpTrackingActive &&
      shouldRunSerpTracking(userMessage.content, {
        agentActive: true,
        inChat: serpTrackingInChat,
      });

    if (serpTrackingActive && !runSerpTracking) {
      let serpStatus = "";
      if (isEmptySerpTrackingBrief(userMessage.content) || looksLikeSerpTrackingBrief(userMessage.content)) {
        if (!parseSerpTrackingBrief(userMessage.content)) {
          serpStatus = "Enter your Website URL, then send.";
        }
      } else if (!serpTrackingInChat) {
        serpStatus = "Fill in Website URL: in the composer, then send.";
      } else if (userMessage.content.trim().length < 3) {
        serpStatus = "Enter a website URL to track rankings.";
      }
      if (serpStatus) {
        if (!fromAction) setPrompt(draft);
        setStatus(serpStatus);
        setBusy(false);
        setMessages(history.slice(0, -1));
        return;
      }
    }

    const aiVisibilityActive =
      agentEngaged("ai-visibility-tracker");
    const aiVisibilityInChat = messagesRef.current.length > 0;
    const runAiVisibility =
      aiVisibilityActive &&
      shouldRunAiVisibilityTracker(userMessage.content, {
        agentActive: true,
        inChat: aiVisibilityInChat,
      });

    if (aiVisibilityActive && !runAiVisibility) {
      let aiVisibilityStatus = "";
      if (isEmptyAiVisibilityBrief(userMessage.content) || looksLikeAiVisibilityBrief(userMessage.content)) {
        if (!parseAiVisibilityBrief(userMessage.content)) {
          aiVisibilityStatus = "Enter your Website URL, then send.";
        }
      } else if (!aiVisibilityInChat) {
        aiVisibilityStatus = "Fill in Website URL: in the composer, then send.";
      } else if (userMessage.content.trim().length < 3) {
        aiVisibilityStatus = "Enter a website URL to scan AI mentions.";
      }
      if (aiVisibilityStatus) {
        if (!fromAction) setPrompt(draft);
        setStatus(aiVisibilityStatus);
        setBusy(false);
        setMessages(history.slice(0, -1));
        return;
      }
    }

    const brandSentimentActive =
      agentEngaged("brand-sentiment-analysis");
    const brandSentimentInChat = messagesRef.current.length > 0;
    const runBrandSentiment =
      brandSentimentActive &&
      shouldRunBrandSentimentAnalysis(userMessage.content, {
        agentActive: true,
        inChat: brandSentimentInChat,
      });

    if (brandSentimentActive && !runBrandSentiment) {
      let brandSentimentStatus = "";
      if (
        isEmptyBrandSentimentBrief(userMessage.content) ||
        looksLikeBrandSentimentBrief(userMessage.content)
      ) {
        if (!parseBrandSentimentBrief(userMessage.content)) {
          brandSentimentStatus = "Enter your Website URL, then send.";
        }
      } else if (!brandSentimentInChat) {
        brandSentimentStatus = "Fill in Website URL: in the composer, then send.";
      } else if (userMessage.content.trim().length < 3) {
        brandSentimentStatus = "Enter a website URL to analyze brand sentiment.";
      }
      if (brandSentimentStatus) {
        if (!fromAction) setPrompt(draft);
        setStatus(brandSentimentStatus);
        setBusy(false);
        setMessages(history.slice(0, -1));
        return;
      }
    }

    const promptResearchActive =
      agentEngaged("prompt-research");
    const runPromptResearch =
      promptResearchActive && shouldRunPromptResearch(userMessage.content, { agentActive: true });

    if (promptResearchActive && !runPromptResearch) {
      if (!fromAction) setPrompt(draft);
      setStatus(
        isEmptyPromptResearchBrief(userMessage.content)
          ? "Enter a prompt after Prompt:, then send."
          : "Enter a prompt to estimate its AI search volume.",
      );
      setBusy(false);
      setMessages(history.slice(0, -1));
      return;
    }

    const competitorResearchActive =
      agentEngaged("competitor-research");
    const competitorResearchInChat = messagesRef.current.length > 0;
    const projectWebsiteForCompetitors = activeProjectContext().website;
    const runCompetitorResearch =
      competitorResearchActive &&
      shouldRunCompetitorResearch(userMessage.content, {
        agentActive: true,
        inChat: competitorResearchInChat,
        projectWebsite: projectWebsiteForCompetitors,
      });

    if (competitorResearchActive && !runCompetitorResearch) {
      let competitorStatus = "";
      const parsed = parseCompetitorResearchBrief(userMessage.content, {
        projectWebsite: projectWebsiteForCompetitors,
      });
      if (
        isEmptyCompetitorResearchBrief(userMessage.content) ||
        looksLikeCompetitorResearchBrief(userMessage.content)
      ) {
        if (!parsed.competitors.length) {
          competitorStatus = "Enter competitor website URL(s) after Competitor website URL:, then send.";
        } else if (!parsed.website && !projectWebsiteForCompetitors) {
          competitorStatus = "Set your website in project settings, or add Website URL: in the composer.";
        }
      } else if (!competitorResearchInChat) {
        competitorStatus = "Paste competitor website URL(s) in the composer, then send.";
      } else if (!parsed.competitors.length) {
        competitorStatus = "Include at least one competitor website URL.";
      } else if (!parsed.website && !projectWebsiteForCompetitors) {
        competitorStatus = "Set your website in project settings to compare against competitors.";
      }
      if (competitorStatus) {
        if (!fromAction) setPrompt(draft);
        setStatus(competitorStatus);
        setBusy(false);
        setMessages(history.slice(0, -1));
        return;
      }
    }

    const humanizeActive =
      agentEngaged("humanization");
    const priorHumanizeArticle = humanizeActive
      ? extractLastBlogArticleFromHistory(messagesRef.current)
      : null;
    const runSiteIntegrations =
      agentEngaged("site-integrations") && userMessage.content.trim().length >= 3;

    const runHumanize =
      !runSiteIntegrations &&
      humanizeActive &&
      shouldRunHumanizeAgent(userMessage.content, {
        agentActive: true,
        hasPriorArticle: Boolean(priorHumanizeArticle?.html),
      });

    try {
      if (siteAuditUrl) {
        setAuditProgress({
          phase: "sitemap",
          message: "Reading sitemap",
          current: 0,
          total: 0,
          etaSeconds: 180,
        });
        const reply = await runSiteAuditStream(siteAuditUrl, {
          onProgress: (event) => setAuditProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("site-audit");
        setAuditProgress(null);
        return;
      }

      if (runBlogRewrite) {
        setBlogProgress({ phase: "blog", stage: "rewriting", message: "Applying your instructions" });
        const projectCtx = activeProjectContext();
        const reply = await runBlogWriterRewriteStream({
          rewritePrompt: userMessage.content,
          previousArticle: priorBlogArticle,
          knowledge: projectCtx.knowledge,
          website: projectCtx.website,
          brandName: projectCtx.brandName,
          effortAuto: blogEffortAuto,
          effortTier: blogEffortTier,
          writerMode: blogWriterMode,
          onProgress: (event) => setBlogProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent(blogAgentId);
        setBlogProgress(null);
        return;
      }

      if (runBlogWriter) {
        setBlogProgress({ phase: "blog", stage: "researching", message: "Starting blog pipeline" });
        const projectCtx = activeProjectContext();
        const reply = await runBlogWriterStream(userMessage.content, {
          knowledge: projectCtx.knowledge,
          website: projectCtx.website,
          brandName: projectCtx.brandName,
          effortAuto: blogEffortAuto,
          effortTier: blogEffortTier,
          writerMode: blogWriterMode,
          onProgress: (event) => setBlogProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent(blogAgentId);
        setBlogProgress(null);
        return;
      }

      if (runRankingFinder) {
        setRankingProgress({ phase: "ranking", stage: "seeds", message: "Starting keyword research" });
        const projectCtx = activeProjectContext();
        const rankingFields = parseRankingOpportunityBrief(userMessage.content);
        const reply = await runRankingOpportunityStream({
          message: userMessage.content,
          website: rankingFields.website || projectCtx.website,
          targetKeyword: rankingFields.targetKeyword,
          knowledge: projectCtx.knowledge,
          brandName: projectCtx.brandName,
          onProgress: (event) => setRankingProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("ranking-opportunity-finder");
        setRankingProgress(null);
        return;
      }

      if (runKeywordFinderAgent) {
        setKeywordFinderProgress({ phase: "keyword", stage: "global", message: "Analyzing keyword" });
        const keyword = parseKeywordFinderBrief(userMessage.content);
        const reply = await runKeywordFinderStream({
          message: userMessage.content,
          keyword,
          onProgress: (event) => setKeywordFinderProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("keyword-finder");
        setKeywordFinderProgress(null);
        return;
      }

      if (runReelsCreation) {
        setReelsCreationProgress({ phase: "reels_creation", stage: "prompt", message: "Starting" });
        const reelState = extractReelStateFromMessages(messagesRef.current);
        const reply = await runReelsCreationStream({
          message: userMessage.content,
          attachments: userMessage.attachments,
          reelState,
          onProgress: (event) => setReelsCreationProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("reels-creation");
        setReelsCreationProgress(null);
        return;
      }

      if (runLocalSeo) {
        setLocalSeoProgress({ phase: "local_seo", stage: "resolve", message: "Starting" });
        const reply = await runLocalSeoStream({
          message: userMessage.content,
          onProgress: (event) => setLocalSeoProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("local-seo");
        setLocalSeoProgress(null);
        return;
      }

      if (runB2bLeadFinder) {
        setB2bLeadFinderProgress({ phase: "b2b_lead_finder", stage: "icp", message: "Starting" });
        const reply = await runB2bLeadFinderStream({
          message: userMessage.content,
          onProgress: (event) => setB2bLeadFinderProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("b2b-lead-finder");
        setB2bLeadFinderProgress(null);
        return;
      }

      if (runBacklinkFinder) {
        setBacklinkFinderProgress({ phase: "backlink_finder", stage: "expand", message: "Starting" });
        const projectCtx = activeProjectContext();
        const fields = parseBacklinkFinderBrief(userMessage.content);
        const reply = await runBacklinkFinderStream({
          message: userMessage.content,
          website: fields.website || projectCtx.website,
          knowledge: projectCtx.knowledge,
          onProgress: (event) => setBacklinkFinderProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("backlink-finder");
        setBacklinkFinderProgress(null);
        return;
      }

      if (runSerpTracking) {
        setSerpTrackingProgress({ phase: "serp_tracking", stage: "keywords", message: "Finding rankings" });
        const projectCtx = activeProjectContext();
        const website = parseSerpTrackingBrief(userMessage.content) || projectCtx.website;
        const reply = await runSerpTrackingStream({
          message: userMessage.content,
          website,
          onProgress: (event) => setSerpTrackingProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("serp-tracking");
        setSerpTrackingProgress(null);
        return;
      }

      if (runAiVisibility) {
        setAiVisibilityProgress({ phase: "ai_visibility", stage: "google", message: "Starting AI scan" });
        const projectCtx = activeProjectContext();
        const website = parseAiVisibilityBrief(userMessage.content) || projectCtx.website;
        const reply = await runAiVisibilityStream({
          message: userMessage.content,
          website,
          knowledge: projectCtx.knowledge,
          onProgress: (event) => setAiVisibilityProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("ai-visibility-tracker");
        setAiVisibilityProgress(null);
        return;
      }

      if (runBrandSentiment) {
        setBrandSentimentProgress({ phase: "brand_sentiment", stage: "chatgpt", message: "Starting analysis" });
        const projectCtx = activeProjectContext();
        const website = parseBrandSentimentBrief(userMessage.content) || projectCtx.website;
        const reply = await runBrandSentimentStream({
          message: userMessage.content,
          website,
          knowledge: projectCtx.knowledge,
          onProgress: (event) => setBrandSentimentProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("brand-sentiment-analysis");
        setBrandSentimentProgress(null);
        return;
      }

      if (runPromptResearch) {
        setPromptResearchProgress({ phase: "prompt_research", stage: "asking", message: "Asking AI platforms" });
        const reply = await runPromptResearchStream({
          message: userMessage.content,
          prompt: parsePromptResearchBrief(userMessage.content),
          onProgress: (event) => setPromptResearchProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("prompt-research");
        setPromptResearchProgress(null);
        return;
      }

      if (runCompetitorResearch) {
        setCompetitorResearchProgress({
          phase: "competitor_research",
          stage: "your_site",
          message: "Starting competitor research",
        });
        const projectCtx = activeProjectContext();
        const fields = parseCompetitorResearchBrief(userMessage.content, {
          projectWebsite: projectCtx.website,
        });
        const reply = await runCompetitorResearchStream({
          message: userMessage.content,
          website: fields.website || projectCtx.website,
          knowledge: projectCtx.knowledge,
          onProgress: (event) => setCompetitorResearchProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("competitor-research");
        setCompetitorResearchProgress(null);
        return;
      }

      if (runSiteIntegrations) {
        setSiteIntegrationsProgress({ phase: "integrations", message: "Connecting to your site" });
        const projectCtx = activeProjectContext();
        const latest = extractLastBlogArticleFromHistory(messagesRef.current);
        const reply = await runSiteIntegrationsStream({
          uid: user?.uid,
          project,
          website: projectCtx.website,
          message: userMessage.content,
          messages: messagesRef.current,
          article: latest?.html
            ? {
                title: latest.blogTitle || latest.metaTitle,
                html: latest.html,
                metaDescription: latest.metaDescription,
                slug: latest.urlSlug,
              }
            : null,
          onProgress: (event) => setSiteIntegrationsProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("site-integrations");
        setSiteIntegrationsProgress(null);
        return;
      }

      if (runHumanize) {
        setHumanizeProgress({ phase: "humanize", stage: "humanizing", message: "Humanizing tone and flow" });
        const projectCtx = activeProjectContext();
        const reply = await runHumanizeStream({
          message: userMessage.content,
          previousHtml: priorHumanizeArticle?.html,
          previousTitle: priorHumanizeArticle?.blogTitle,
          previousKeyword: priorHumanizeArticle?.primaryKeyword,
          knowledge: projectCtx.knowledge,
          effortAuto,
          effortTier,
          onProgress: (event) => setHumanizeProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        setPendingAgent("humanization");
        setHumanizeProgress(null);
        return;
      }

      const reply = await fetchAssistantReply(history);
      setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
    } catch (err) {
      if (isUpgradeError(err)) {
        setMessages([...history, { role: "assistant", content: upgradeReply(err) }]);
        return;
      }
      setMessages(history.slice(0, -1));
      if (!fromAction) setPrompt(draft);
      setStatus(err.message || (siteAuditUrl ? "Site audit failed." : "Blazly could not reply."));
    } finally {
      setAuditProgress(null);
      setBlogProgress(null);
      setHumanizeProgress(null);
      setRankingProgress(null);
      setKeywordFinderProgress(null);
      setAiVisibilityProgress(null);
      setBrandSentimentProgress(null);
      setCompetitorResearchProgress(null);
      setPromptResearchProgress(null);
      setSerpTrackingProgress(null);
      setBacklinkFinderProgress(null);
      setB2bLeadFinderProgress(null);
      setLocalSeoProgress(null);
      setReelsCreationProgress(null);
      setAiOrchestratorProgress(null);
      setSiteIntegrationsProgress(null);
      setBusy(false);
    }
  }

  useEffect(() => {
    fitPrompt(promptRef.current);
  }, [prompt]);

  useEffect(() => {
    if (
      messages.length > 0 &&
      (isEmptySeoBlogBrief(prompt) ||
        isEmptyGeoBlogBrief(prompt) ||
        isEmptyRankingBrief(prompt) ||
        isEmptyKeywordFinderBrief(prompt) ||
        isEmptyAiVisibilityBrief(prompt))
    ) {
      setPrompt("");
    }
  }, [messages.length, prompt]);

  function onPromptKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
  }

  function chooseAgent(agent) {
    if (busy) return;
    setScope(agent.scope);
    setPendingAgent(agent.id);
    setEffortAuto(false);
    setEffortTier("max");
    setStatus("");
    setView("home");
    setNavOpen(false);
    if (agent.id === "site-audit") {
      const websiteHint = activeProjectContext().website;
      if (websiteHint && !prompt.trim()) setPrompt(websiteHint);
    }
    if (agent.id === "seo-blog-writer" && !prompt.trim() && messages.length === 0) {
      setPrompt(SEO_BLOG_WRITER_BRIEF);
    }
    if (agent.id === "geo-blog-writer" && !prompt.trim() && messages.length === 0) {
      setPrompt(GEO_BLOG_WRITER_BRIEF);
    }
    if (agent.id === "ranking-opportunity-finder" && messages.length === 0) {
      setPrompt(rankingBriefPrefill(activeProjectContext().website));
    }
    if (agent.id === "keyword-finder" && messages.length === 0) {
      setPrompt(keywordFinderPrefill());
    }
    if (agent.id === "ai-visibility-tracker" && messages.length === 0) {
      setPrompt(aiVisibilityBriefPrefill(activeProjectContext().website));
    }
    if (agent.id === "brand-sentiment-analysis" && messages.length === 0) {
      setPrompt(brandSentimentBriefPrefill(activeProjectContext().website));
    }
    if (agent.id === "reels-creation" && messages.length === 0) {
      setPrompt(reelsCreationBriefPrefill());
    }
    if (agent.id === "local-seo" && messages.length === 0) {
      const ctx = activeProjectContext();
      setPrompt(
        localSeoBriefPrefill(
          ctx.knowledge?.companyName || "",
          ctx.website?.includes("google.com/maps") ? ctx.website : "",
        ),
      );
    }
    if (agent.id === "b2b-lead-finder" && messages.length === 0) {
      setPrompt(b2bLeadFinderBriefPrefill());
    }
    if (agent.id === "backlink-finder" && messages.length === 0) {
      setPrompt(backlinkFinderBriefPrefill());
    }
    if (agent.id === "serp-tracking" && messages.length === 0) {
      setPrompt(serpTrackingBriefPrefill(activeProjectContext().website));
    }
    if (agent.id === "prompt-research" && messages.length === 0) {
      setPrompt(PROMPT_RESEARCH_BRIEF);
    }
    if (agent.id === "competitor-research" && messages.length === 0) {
      setPrompt(competitorResearchBriefPrefill());
    }
    if (agent.id === "humanization" && messages.length === 0) {
      setPrompt("");
    }
    requestAnimationFrame(() => {
      fitPrompt(promptRef.current);
      promptRef.current?.focus();
      promptRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function clearSelectedAgent() {
    setPendingAgent(null);
    setStatus("");
  }

  function openView(next) {
    setView(next);
    setNavOpen(false);
    setProfileOpen(false);
    setOpenedProject(null);
  }

  function requestSignOut() {
    setProfileOpen(false);
    setSignOutConfirmOpen(true);
  }

  function confirmSignOut() {
    setSignOutConfirmOpen(false);
    signOutUser();
  }

  function handleDefaultModeChange(item) {
    const inferred = inferComposerFromMode(item);
    setEffortAuto(inferred.effortAuto);
    setEffortTier(inferred.effortTier);
  }

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0");
      } catch {
        // The layout still toggles for this session if storage is blocked.
      }
      return next;
    });
  }

  function toggleProjectMenu() {
    setProjectOpen((open) => !open);
    setProfileOpen(false);
  }

  function toggleProfileMenu() {
    setProfileOpen((open) => !open);
    setProjectOpen(false);
  }

  const inChat = view === "home" && messages.length > 0;
  const activeChat = activeChatId ? chats.find((chat) => chat.id === activeChatId) || null : null;
  const isAiWorkspaceMode =
    workspaceMode === WORKSPACE_MODES.ai &&
    (!activeChat || activeChat.interactionMode !== WORKSPACE_MODES.manual);
  const activeAgent = useMemo(
    () => AGENTS.find((agent) => agent.id === pendingAgent) || null,
    [pendingAgent]
  );
  const promptPlaceholder = isAiWorkspaceMode
    ? inChat
      ? "Reply with the details Blazly asked for, or describe your next step…"
      : "Describe your objective — Blazly picks and runs the right agents…"
    : activeAgent?.id === "site-audit"
      ? "Paste your website URL to audit…"
      : activeAgent?.id === "ranking-opportunity-finder"
        ? inChat
          ? "Optional: narrow the niche (e.g. “local clinics”) or send a new Website URL / Target keyword brief…"
          : "Website URL and Target keyword — fill both lines, then send to find opportunities…"
        : activeAgent?.id === "keyword-finder"
          ? inChat
            ? "Enter another keyword or refine with Keyword: …"
            : "Enter a keyword after Keyword:, then send to analyze volume and difficulty…"
          : activeAgent?.id === "reels-creation"
            ? inChat
              ? "Reel prompt: describe another 10-second clip…"
              : "Reel prompt — each clip is max 10 seconds (1080p). Attach a person photo if needed, then send…"
          : activeAgent?.id === "local-seo"
            ? inChat
              ? "Send an updated business name and Maps URL to refresh the audit…"
              : "Business name and Google Maps URL — paste your listing link from Share on Maps, then send…"
          : activeAgent?.id === "b2b-lead-finder"
            ? inChat
              ? "Send an updated ICP to refresh your lead list…"
              : "Describe your ideal customer profile in detail under ICP, then send…"
          : activeAgent?.id === "backlink-finder"
            ? inChat
              ? "Try another target keyword to refresh backlink prospects…"
              : "Target keyword — the Google query you want editorial backlinks for, then send…"
          : activeAgent?.id === "serp-tracking"
            ? inChat
              ? "Send another Website URL: brief to refresh SERP rankings…"
              : "Website URL — paste your site, then send to see top ranking pages…"
          : activeAgent?.id === "ai-visibility-tracker"
            ? inChat
              ? "Send another Website URL: brief to rescan AI mentions…"
              : "Website URL — paste your site, then send to track AI mentions…"
            : activeAgent?.id === "brand-sentiment-analysis"
              ? inChat
                ? "Send another Website URL: brief to re-run brand sentiment…"
                : "Website URL — paste your site, then send to analyze AI brand sentiment…"
              : activeAgent?.id === "prompt-research"
                ? inChat
                  ? "Enter another prompt to estimate its AI search volume…"
                  : "Prompt: — type a question people ask AI assistants, then send…"
              : activeAgent?.id === "competitor-research"
                ? inChat
                  ? "Add or change competitor website URLs, then send to compare again…"
                  : "Competitor website URL — paste one or more competitor sites (one per line), then send…"
        : activeAgent?.id === "geo-blog-writer"
        ? inChat
          ? "Ask for GEO-focused edits, more citations, or FAQ changes…"
          : GEO_BLOG_WRITER_BRIEF
        : activeAgent?.id === "humanization"
        ? inChat
          ? "Paste updated blog or landing page copy, or ask for a different tone…"
          : "Paste your blog article or landing page copy to humanize (HTML or plain text)…"
        : activeAgent?.id === "seo-blog-writer"
        ? inChat
          ? "Ask for edits, a shorter version, or another article…"
          : SEO_BLOG_WRITER_BRIEF
        : "Ask about your visibility, run a site audit, generate content, build strategy…";
  const latestArticle = useMemo(() => (inChat ? extractWorkpaneData(messages) : null), [inChat, messages]);
  const auditDock = useMemo(() => (inChat ? extractLatestAuditDock(messages) : null), [inChat, messages]);
  const projectHost = websiteHost(activeProjectContext().website);

  function handleWorkspaceModeChange(nextMode) {
    setWorkspaceMode(nextMode);
    saveWorkspaceMode(nextMode);
    if (nextMode === WORKSPACE_MODES.manual) {
      setPendingAgent(null);
    }
  }
  const firstName = displayName.trim().split(/\s+/)[0] || "";

  const composerProps = {
    activeAgent: isAiWorkspaceMode ? null : activeAgent,
    onClearAgent: clearSelectedAgent,
    prompt,
    promptRef,
    placeholder: promptPlaceholder,
    status,
    attachments,
    onRemoveAttachment: removeAttachment,
    fileRef,
    onFiles: queueAttachmentFiles,
    onSubmit: send,
    onPromptChange: (event) => {
      setPrompt(event.target.value);
      fitPrompt(event.currentTarget);
      if (status) setStatus("");
    },
    onPromptKeyDown,
    onPromptPaste,
    onPromptValueChange: (value) => {
      setPrompt(value);
      fitPrompt(promptRef.current);
    },
    effortTier,
    effortTierLocked: Boolean(pendingAgent) || isAiWorkspaceMode,
    onEffortTierChange: (tier) => {
      setEffortAuto(false);
      setEffortTier(tier);
    },
    busy,
  };

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages, busy, auditDock?.signature]);

  useEffect(() => {
    if (latestArticle?.signature) {
      setEditorDraft(null);
      setEditorDraftHtml(null);
      setArticleEditorOpen(false);
    }
  }, [latestArticle?.signature]);

  return (
    <div className="product-page">
      {articleEditorOpen && latestArticle?.body && (
        <ArticleEditor
          title={latestArticle.title}
          initialContent={editorDraftHtml || editorDraft || latestArticle.body}
          onSave={({ html, markdown }) => {
            setEditorDraftHtml(html);
            setEditorDraft(markdown);
            setArticleEditorOpen(false);
          }}
          onClose={() => setArticleEditorOpen(false)}
        />
      )}
      <div
        className={`shell${navOpen ? " is-nav-open" : ""}${sidebarCollapsed ? " is-sidebar-collapsed" : ""}${articleEditorOpen ? " is-hidden" : ""}`}
        ref={shellRef}
      >
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Close menu"
          onClick={() => setNavOpen(false)}
        />
        <aside className="sidebar" aria-label="Sidebar">
          <div className="sidebar-head">
            <button type="button" className="sidebar-brand" onClick={startNewChat} aria-label="Blazly home">
              <img className="sidebar-brand-mark" src="/assets/logo.webp" alt="" width={26} height={26} />
              <span className="sidebar-brand-name">Blazly</span>
            </button>
            <button
              type="button"
              className="icon-button sidebar-collapse"
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={toggleSidebar}
            >
              <Icon name="panelLeft" size={18} />
            </button>
          </div>
          <div className="sidebar-scroll">
            <nav className="nav" aria-label="Primary">
              <button
                type="button"
                className="nav-item nav-new-chat"
                title={sidebarCollapsed ? "New chat" : undefined}
                onClick={startNewChat}
              >
                <span className="nav-new-chat-icon">
                  <Icon name="plus" size={14} strokeWidth={2.2} />
                </span>
                <span className="nav-label">New chat</span>
              </button>
              <NavItem
                icon="folder"
                label="Projects"
                collapsed={sidebarCollapsed}
                active={view === "projects" || view === "add-project"}
                onClick={() => openView("projects")}
              />
              <NavItem
                icon="plug"
                label="Integrations"
                collapsed={sidebarCollapsed}
                active={view === "integrations"}
                onClick={() => openView("integrations")}
              />
              <NavItem
                icon="sparkles"
                label="Connect AI tools"
                collapsed={sidebarCollapsed}
                active={view === "connect-ai"}
                onClick={() => openView("connect-ai")}
              />
              <NavItem
                icon="clock"
                label="Scheduled"
                collapsed={sidebarCollapsed}
                active={view === "scheduled"}
                onClick={() => openView("scheduled")}
              />
              <NavItem
                icon="book"
                label="Playbooks"
                collapsed={sidebarCollapsed}
                active={view === "playbooks"}
                onClick={() => openView("playbooks")}
              />
              <NavItem
                icon="messages"
                label="Discussions"
                collapsed={sidebarCollapsed}
                active={view === "discussions"}
                onClick={() => openView("discussions")}
              />
            </nav>
            {chats.length > 0 && (
              <div className="nav-chats">
                <p className="nav-section-label">Recents</p>
                {projectChats.length === 0 ? (
                  <p className="nav-empty">No chats in {project} yet</p>
                ) : null}
                {[...projectChats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map((chat) => (
                  <ChatNavItem
                    key={chat.id}
                    chat={chat}
                    active={activeChatId === chat.id}
                    onOpen={() => openChat(chat.id)}
                    onDelete={() => deleteChat(chat.id)}
                    onRename={(title) => renameChat(chat.id, title)}
                  />
                ))}
              </div>
            )}
          </div>
          <div className="sidebar-foot">
            <div className="sidebar-promos">
              <button
                type="button"
                className={`sidebar-pricing${view === "pricing" ? " is-active" : ""}`}
                title={sidebarCollapsed ? "Plans & credits" : undefined}
                onClick={() => openView("pricing")}
              >
                <Icon name="bolt" size={15} />
                <span className="nav-label">{credits.data?.plan && credits.data.plan !== "free" ? "Plans & credits" : "Upgrade plan"}</span>
              </button>
              <button
                type="button"
                className="sidebar-referral"
                title={sidebarCollapsed ? "Invite friends, get 100 credits" : undefined}
                onClick={() => setReferralOpen(true)}
              >
                <span className="sidebar-referral-gift" aria-hidden="true">🎁</span>
                <span className="nav-label">
                  Invite friends, <strong>get +100 credits</strong>
                </span>
              </button>
            </div>
            <button
              type="button"
              className="sidebar-usage"
              aria-label={`Credits used: ${credits.used} of ${credits.granted}`}
              title={credits.data ? `${credits.balance.toLocaleString()} credits left` : undefined}
              onClick={() => openView("pricing")}
            >
              <div className="sidebar-usage-head">
                <span>Credits used</span>
                <strong>
                  {credits.data ? `${credits.used.toLocaleString()} / ${credits.granted.toLocaleString()}` : "—"}
                </strong>
              </div>
              <CreditMeter credits={credits} />
            </button>
            <div className="account-row">
              <button
                type="button"
                className={`account-button${view === "profile" ? " is-active" : ""}`}
                aria-current={view === "profile" ? "page" : undefined}
                title={sidebarCollapsed ? "Profile" : undefined}
                onClick={() => openView("profile")}
              >
                {renderAvatar("avatar-sm")}
                <span className="account-text">
                  <span className="account-name">{displayName}</span>
                  <span className="account-meta">{user?.email || "Profile"}</span>
                </span>
              </button>
              <button
                type="button"
                className={`icon-button${view === "settings" ? " is-active" : ""}`}
                aria-label="Settings"
                title="Settings"
                onClick={() => openView("settings")}
              >
                <Icon name="settings" size={17} />
              </button>
              <button
                type="button"
                className="icon-button is-danger"
                aria-label="Sign out"
                title="Sign out"
                onClick={requestSignOut}
              >
                <Icon name="logOut" size={17} />
              </button>
            </div>
          </div>
        </aside>

        <main className={`main${inChat ? " is-chat" : ""}`}>
          <header className="topbar">
            <div className="topbar-start">
              <button
                type="button"
                className="icon-button nav-toggle"
                aria-label={navOpen ? "Close menu" : "Open menu"}
                aria-expanded={navOpen}
                onClick={() => setNavOpen((open) => !open)}
              >
                <Icon name="menu" size={18} />
              </button>
              <div className="menu" data-menu="project">
                <button
                  type="button"
                  className="project-switcher"
                  aria-haspopup="menu"
                  aria-expanded={projectOpen}
                  onClick={toggleProjectMenu}
                >
                  <ProjectAvatar name={project} logo={activeProjectRecord?.logo} />
                  <span className="project-switcher-name">{project}</span>
                  <Icon name="chevronDown" size={14} />
                </button>
                {projectOpen && (
                  <div className="menu-list menu-list-projects" role="menu">
                    <p className="menu-label">Switch project</p>
                    {projects.map((item) => (
                      <ProjectMenuRow
                        key={item.id}
                        name={item.name}
                        logo={item.logo}
                        current={item.name === project}
                        canDelete={projects.length > 1}
                        onSelect={() => {
                          chooseProject(item.name);
                          setProjectOpen(false);
                        }}
                        onDelete={() => deleteProject(item.name)}
                        onRename={() => {
                          const next = window.prompt("Rename project", item.name);
                          if (next == null) return;
                          renameProject(item.name, next).catch((err) => setStatus(err.message));
                          setProjectOpen(false);
                        }}
                      />
                    ))}
                    <div className="menu-sep" />
                    <button type="button" className="menu-item menu-add-project" role="menuitem" onClick={openAddProject}>
                      <Icon name="plus" size={16} />
                      Add project
                    </button>
                    <button
                      type="button"
                      className="menu-item"
                      role="menuitem"
                      onClick={() => {
                        setProjectOpen(false);
                        openView("projects");
                      }}
                    >
                      <Icon name="folder" size={16} />
                      All projects
                    </button>
                  </div>
                )}
              </div>
              {inChat && activeChat?.title ? (
                <>
                  <span className="topbar-sep" aria-hidden="true">
                    /
                  </span>
                  <span className="topbar-title" title={activeChat.title}>
                    {activeChat.title}
                  </span>
                </>
              ) : null}
            </div>

            <div className="topbar-end">
              <WorkspaceModeToggle
                mode={workspaceMode}
                disabled={busy}
                onChange={handleWorkspaceModeChange}
              />
              {inChat && activeChat && user?.uid ? (
                <ShareChatButton
                  uid={user.uid}
                  chat={activeChat}
                  messages={messages}
                  ownerName={displayName}
                  disabled={busy}
                  onShared={(shareId) =>
                    setChats((current) => {
                      const next = current.map((chat) => (chat.id === activeChat.id ? { ...chat, shareId } : chat));
                      saveChats(user.uid, next);
                      return next;
                    })
                  }
                />
              ) : null}
              <div className="menu" data-menu="profile">
                <button
                  type="button"
                  className="avatar-button"
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                  aria-label="Account"
                  onClick={toggleProfileMenu}
                >
                  {renderAvatar()}
                </button>
                {profileOpen && (
                  <div className="menu-list menu-list-right" role="menu">
                    <div className="menu-account">
                      {renderAvatar("avatar-sm")}
                      <span className="menu-account-text">
                        <span className="menu-account-name">{displayName}</span>
                        {user?.email ? <span className="menu-account-email">{user.email}</span> : null}
                      </span>
                    </div>
                    <div className="menu-sep" />
                    <button type="button" className="menu-item" role="menuitem" onClick={() => openView("profile")}>
                      <Icon name="user" size={16} />
                      Profile
                    </button>
                    <button type="button" className="menu-item" role="menuitem" onClick={() => openView("settings")}>
                      <Icon name="settings" size={16} />
                      Settings
                    </button>
                    <div className="menu-sep" />
                    <button type="button" className="menu-item is-danger" role="menuitem" onClick={requestSignOut}>
                      <Icon name="logOut" size={16} />
                      Sign out
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          {view === "home" ? (
            inChat ? (
              <div className="chat-layout">
                <div className="chat-thread" ref={threadRef} aria-live="polite">
                  {messages.map((message, index) => {
                    const lastUser = [...messages.slice(0, index)].reverse().find((item) => item.role === "user");
                    return (
                      <ChatMessage
                        key={`${message.role}-${index}`}
                        message={message}
                        messageIndex={index}
                        lastUserMessage={lastUser?.content}
                        onAction={send}
                        onRetry={retryAssistant}
                        retryDisabled={busy}
                        onEditUserMessage={editUserMessageAndResend}
                        editUserDisabled={busy}
                        feedbackUid={user?.uid}
                        chatId={activeChatId}
                        animateSteps={message.role === "assistant" && index === messages.length - 1 && !busy}
                      />
                    );
                  })}
                  {busy && !messages[messages.length - 1]?.streaming && (
                    <div className="chat-msg is-assistant is-pending">
                      <div className="chat-bubble">
                        <ChatThinking
                          label={thinkingLabel(
                            messages[messages.length - 1]?.content || "",
                            auditProgress,
                            blogProgress,
                            humanizeProgress,
                            activeAgent?.id === "geo-blog-writer" || pendingAgent === "geo-blog-writer",
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
                            aiOrchestratorProgress || siteIntegrationsProgress,
                          )}
                        />
                      </div>
                    </div>
                  )}
                  {auditDock ? (
                    <ChatAuditDock
                      dock={auditDock}
                      chatId={activeChatId}
                      onRerun={send}
                      rerunDisabled={busy}
                      inThread
                    />
                  ) : null}
                </div>
                <div className="chat-dock">
                  <PromptShell isCompact {...composerProps} />
                  <p className="chat-disclaimer">
                    Blazly can make mistakes. Double-check important numbers before you publish.
                  </p>
                </div>
              </div>
            ) : (
            <div className="stage">
              <div className="stage-inner">
                <div className="greeting">
                  <Icon name="bolt" size={34} className="greeting-mark" strokeWidth={1.4} />
                  <h1 className="greeting-title">{greetingFor(firstName)}</h1>
                </div>
                <p className="greeting-context">
                  <ProjectAvatar name={project} logo={activeProjectRecord?.logo} className="project-badge is-sm" />
                  <span>
                    Working in <strong>{project}</strong>
                    {projectHost ? (
                      <>
                        <span className="dot-sep">·</span>
                        {projectHost}
                      </>
                    ) : null}
                  </span>
                </p>

                <PromptShell {...composerProps} />

                {isAiWorkspaceMode ? (
                  <>
                    <p className="ai-mode-lead">
                      Describe your goal in plain language. Blazly picks the right specialists, asks if anything is
                      unclear, and can chain audits, keywords and content in one go.
                    </p>
                    <div className="ai-schedule-tip">
                      <span className="ai-schedule-icon" aria-hidden="true">
                        <Icon name="clock" size={16} />
                      </span>
                      <div className="ai-schedule-body">
                        <p className="ai-schedule-title">
                          Plan ahead — schedule tasks up to 30 days out
                          <button type="button" className="ai-schedule-link" onClick={() => openView("scheduled")}>
                            View scheduled
                            <Icon name="arrowRight" size={13} />
                          </button>
                        </p>
                        <div className="ai-schedule-examples">
                          {[
                            "Every Monday at 9am, find new keywords for my site",
                            "On Nov 12 at 10am, write a blog and publish it",
                          ].map((example) => (
                            <button
                              key={example}
                              type="button"
                              className="ai-schedule-chip"
                              onClick={() => {
                                setPrompt(example);
                                promptRef.current?.focus();
                              }}
                            >
                              {example}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </>
                ) : null}

                <section
                  className={`agents-section${isAiWorkspaceMode ? " is-ai-locked" : ""}`}
                  aria-labelledby="agents-heading"
                >
                  <div className="agents-head">
                    <h2 id="agents-heading" className="agents-title">
                      Agents
                    </h2>
                    <p className="agents-sub">
                      {isAiWorkspaceMode
                        ? "Available specialists — Blazly assigns these automatically in AI mode."
                        : "Pick a workflow. It fills in the brief and pulls live data."}
                    </p>
                  </div>
                  {AGENT_GROUPS.map((group) => (
                    <div key={group.id} className="agents-group">
                      <p className="eyebrow agents-group-label">{group.label}</p>
                      <div className="agents-grid">
                        {group.agents.map((agent) => (
                          <AgentCard
                            key={agent.id}
                            agent={agent}
                            active={!isAiWorkspaceMode && pendingAgent === agent.id}
                            disabled={isAiWorkspaceMode}
                            onSelect={() => chooseAgent(agent)}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              </div>
            </div>
            )
          ) : (
            <section className={`subpage${view === "add-project" ? " project-setup-in-app" : ""}`}>
              {view === "add-project" && (
                <div className="project-setup-wrap">
                  <button type="button" className="project-setup-back" onClick={cancelAddProject}>
                    <Icon name="arrowLeft" size={16} />
                    Back to projects
                  </button>
                  <ProjectSetupWizard
                    key={addProjectSession}
                    variant="inApp"
                    titleStep1="Add a project"
                    leadStep1="Name the workspace and enter its website. We’ll analyze the site and build a knowledge base for this project."
                    onCancel={cancelAddProject}
                    onComplete={completeAddProject}
                  />
                </div>
              )}
              {view === "projects" && openedProject ? (
                <ProjectChatsView
                  projectName={openedProject}
                  website={
                    websiteHost(projectDisplayWebsite(projects.find((entry) => entry.name === openedProject))) ||
                    "No website yet"
                  }
                  chats={chats.filter((chat) => chatProject(chat) === openedProject)}
                  activeChatId={activeChatId}
                  agents={AGENTS}
                  onBack={closeProjectDetail}
                  onNewChat={() => {
                    chooseProject(openedProject);
                    startNewChat();
                  }}
                  onOpenChat={openChat}
                  onDeleteChat={deleteChat}
                  onRenameChat={renameChat}
                />
              ) : null}
              {view === "projects" && !openedProject && (
                <div className="page">
                  <PageIntro
                    title="Projects"
                    lead="Each project keeps its own website, knowledge base, and chats. Agents use the active one."
                    action={
                      <button type="button" className="btn btn-primary" onClick={openAddProject}>
                        <Icon name="plus" size={16} />
                        New project
                      </button>
                    }
                  />
                  <div className="cards">
                    {projectCards.map((item) => (
                      <ProjectWorkCard
                        key={item.name}
                        title={item.name}
                        logo={item.logo}
                        body={item.website || "No website yet"}
                        status={item.status}
                        current={item.name === project}
                        canDelete={projects.length > 1}
                        onSelect={() => openProjectDetail(item.name)}
                        onDelete={() => deleteProject(item.name)}
                        onRename={(next) => renameProject(item.name, next)}
                      />
                    ))}
                  </div>
                </div>
              )}
              {view === "playbooks" && (
                <div className="page">
                  <PageIntro
                    title="Playbooks"
                    lead="Saved ways of asking. Pick one and it starts a chat with the right focus."
                  />
                  <div className="cards">
                    {PLAYBOOKS.map((item) => (
                      <WorkCard
                        key={item.title}
                        icon={item.icon}
                        title={item.title}
                        body={item.body}
                        onClick={() => {
                          setScope(item.scope);
                          setPrompt(item.title);
                          setStatus("");
                          openView("home");
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
              {view === "discussions" && <DiscussionsView />}
              {view === "profile" && (
                <ProfileView
                  notice={accountNotice}
                  onUpgrade={() => openView("pricing")}
                  displayName={displayName}
                  email={user?.email}
                  initial={initial}
                  profile={profile}
                  avatarUrl={avatarUrl}
                  projectName={project}
                  projectWebsite={activeProjectContext().website}
                  projects={projects}
                  chatCounts={Object.fromEntries(
                    projects.map((entry) => [entry.name, chats.filter((chat) => chatProject(chat) === entry.name).length]),
                  )}
                  onSwitchProject={chooseProject}
                />
              )}
              {view === "pricing" && (
                <PricingView key={billingNotice} credits={credits} email={user?.email} notice={billingNotice} />
              )}
              {view === "connect-ai" && (
                <ConnectAiView uid={user?.uid} project={project} projectContext={activeProjectContext()} />
              )}
              {view === "scheduled" && (
                <ScheduledView
                  uid={user?.uid}
                  project={project}
                  refreshKey={scheduleRefresh}
                  onOpenChat={(runId) => openChat(`run_${runId}`)}
                  importedChatIds={new Set(chats.map((chat) => chat.id))}
                  onNewTask={() => {
                    openView("home");
                    setPrompt("Every Monday at 9am, ");
                  }}
                />
              )}
              {view === "integrations" && (
                <IntegrationsView uid={user?.uid} project={project} notice={integrationsNotice} />
              )}
              {view === "settings" && (
                <SettingsView
                  mode={mode}
                  modes={MODES}
                  onModeChange={handleDefaultModeChange}
                  theme={theme}
                  onThemeChange={setTheme}
                />
              )}
            </section>
          )}
        </main>
      </div>
      <ReferralModal open={referralOpen} onClose={() => setReferralOpen(false)} />
      <SignOutConfirmModal
        open={signOutConfirmOpen}
        onClose={() => setSignOutConfirmOpen(false)}
        onConfirm={confirmSignOut}
      />
    </div>
  );
}

function PageIntro({ title, lead, action }) {
  return (
    <header className="page-intro">
      <div className="page-intro-text">
        <h1>{title}</h1>
        {lead ? <p className="subpage-lead">{lead}</p> : null}
      </div>
      {action ? <div className="page-intro-action">{action}</div> : null}
    </header>
  );
}

function formatChatListMeta(chat, agents) {
  const agent = agents.find((entry) => entry.id === chat.agent);
  const parts = [];
  if (agent?.title) parts.push(agent.title);
  if (chat.updatedAt) parts.push(formatChatUpdatedAt(chat.updatedAt));
  return parts.join(" · ");
}

function formatChatUpdatedAt(timestamp) {
  const date = new Date(Number(timestamp) || 0);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((startOfToday - startOfDate) / 86400000);
  if (dayDiff === 0) {
    return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  if (dayDiff === 1) return "Yesterday";
  if (dayDiff < 7) return date.toLocaleDateString(undefined, { weekday: "short" });
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function ProjectChatsView({
  projectName,
  website,
  chats,
  activeChatId,
  agents,
  onBack,
  onNewChat,
  onOpenChat,
  onDeleteChat,
  onRenameChat,
}) {
  const sorted = [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const countLabel = `${sorted.length} chat${sorted.length === 1 ? "" : "s"}`;

  return (
    <div className="page">
      <button type="button" className="page-back" onClick={onBack}>
        <Icon name="arrowLeft" size={16} />
        All projects
      </button>
      <PageIntro
        title={projectName}
        lead={website}
        action={
          <button type="button" className="btn btn-primary" onClick={onNewChat}>
            <Icon name="plus" size={16} />
            New chat
          </button>
        }
      />
      {sorted.length ? (
        <section className="project-chat-list" aria-label={`Chats in ${projectName}`}>
          <p className="project-chat-list-head">{countLabel}</p>
          <ul className="project-chat-list-items">
            {sorted.map((chat) => (
              <li key={chat.id}>
                <ChatNavItem
                  chat={chat}
                  meta={formatChatListMeta(chat, agents)}
                  active={activeChatId === chat.id}
                  onOpen={() => onOpenChat(chat.id)}
                  onDelete={() => onDeleteChat(chat.id)}
                  onRename={(title) => onRenameChat(chat.id, title)}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="empty project-chat-empty">
          <span className="empty-icon" aria-hidden="true">
            <Icon name="messages" size={20} />
          </span>
          <p className="empty-title">No chats in {projectName} yet</p>
          <p className="empty-text">Start a new chat and it will stay with this project.</p>
          <button type="button" className="btn btn-secondary empty-action" onClick={onNewChat}>
            New chat
          </button>
        </div>
      )}
    </div>
  );
}

function AgentCard({ agent, active, disabled = false, onSelect }) {
  return (
    <button
      type="button"
      className={`agent-card${active ? " is-active" : ""}${disabled ? " is-disabled" : ""}`}
      aria-pressed={active}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={disabled ? undefined : onSelect}
    >
      <span className="agent-card-icon">
        <Icon name={agent.icon} size={18} />
      </span>
      <span className="agent-card-copy">
        <span className="agent-card-title">
          {agent.title}
          {active ? <span className="agent-card-state">In composer</span> : null}
        </span>
        <span className="agent-card-body">{agent.body}</span>
        {agent.chipHint ? <span className="agent-card-meta">{agent.chipHint}</span> : null}
      </span>
      <Icon name="arrowRight" size={16} className="agent-card-arrow" />
    </button>
  );
}

function ProjectMenuRow({ name, logo, current, canDelete, onSelect, onDelete, onRename }) {
  return (
    <div className={`menu-project-row${current ? " is-current" : ""}`}>
      <button type="button" role="menuitem" className="menu-project-select" onClick={onSelect}>
        <ProjectAvatar name={name} logo={logo} className="project-badge is-sm" />
        <span className="menu-project-name">{name}</span>
        {current ? <Icon name="check" size={15} className="menu-project-check" /> : null}
      </button>
      <button
        type="button"
        className="menu-project-delete menu-project-rename"
        aria-label={`Rename ${name}`}
        title={`Rename ${name}`}
        onClick={(event) => {
          event.stopPropagation();
          onRename();
        }}
      >
        <Icon name="pencil" size={14} />
      </button>
      {canDelete ? (
        <button
          type="button"
          className="menu-project-delete"
          aria-label={`Delete ${name}`}
          title={`Delete ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
        >
          <Icon name="trash" size={14} />
        </button>
      ) : null}
    </div>
  );
}

function ProjectWorkCard({ title, logo, body, status, current, canDelete, onSelect, onDelete, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function startEditing() {
    setDraft(title);
    setError("");
    setEditing(true);
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onRename(draft);
      setEditing(false);
    } catch (err) {
      setError(err.message || "Could not rename this project.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`card project-card-wrap${current ? " is-current" : ""}`}>
      {editing ? (
        <form className="project-card-main project-card-rename" onSubmit={submit}>
          <span className="card-icon">{(draft.trim() || title).charAt(0).toUpperCase() || "P"}</span>
          <input
            className="project-rename-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            maxLength={60}
            aria-label="Project name"
            autoFocus
          />
          {error ? <span className="project-rename-error">{error}</span> : null}
          <span className="project-rename-actions">
            <button type="submit" className="btn btn-primary" disabled={saving || !draft.trim()}>
              {saving ? "Saving…" : "Save"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </span>
        </form>
      ) : (
        <button type="button" className="project-card-main" aria-pressed={current} onClick={onSelect}>
          <ProjectAvatar name={title} logo={logo} className="card-icon" />
          <span className="card-title">{title}</span>
          <span className="card-body">{body}</span>
          {status ? <span className="project-card-status">{status}</span> : null}
          <Icon name="arrowRight" size={16} className="card-arrow" />
        </button>
      )}
      {!editing ? (
        <div className="project-card-footer">
          <button type="button" className="project-card-action" onClick={startEditing}>
            Rename
          </button>
          {canDelete ? (
            <button type="button" className="project-card-delete" aria-label={`Delete ${title}`} onClick={onDelete}>
              Delete project
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function WorkCard({ icon, title, body, onClick, current = false }) {
  return (
    <button
      type="button"
      className={`card${current ? " is-current" : ""}`}
      aria-pressed={current}
      onClick={onClick}
    >
      <span className="card-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="card-title">{title}</span>
      <span className="card-body">{body}</span>
      <Icon name="arrowRight" size={16} className="card-arrow" />
    </button>
  );
}

function NavItem({ icon, label, active, collapsed, onClick }) {
  return (
    <button
      type="button"
      className={`nav-item${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      onClick={onClick}
    >
      <span className="nav-icon">
        <Icon name={icon} size={18} />
      </span>
      <span className="nav-label">{label}</span>
    </button>
  );
}

