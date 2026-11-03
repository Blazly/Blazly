import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
  agentTitle,
  formatOrchestratorDispatchIntro,
  formatPlanSteps,
  runAiChain,
  routeAiObjective,
} from "./aiOrchestratorClient.js";
import { loadWorkspaceMode, saveWorkspaceMode, WORKSPACE_MODES } from "./workspaceMode.js";
import { WorkspaceModeToggle } from "./WorkspaceModeToggle.jsx";
import { IntegrationsView } from "./IntegrationsView.jsx";
import {
  FOLLOW_UP,
  SITE_INTEGRATIONS_BRIEF,
  integrationFollowUp,
  isEmptySiteIntegrationsBrief,
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
import { OutOfCreditsModal } from "./OutOfCreditsModal.jsx";
import { PLANS } from "./plans.js";
import { claimPendingReferral } from "./referralClient.js";
import { acceptPendingTeamInvite, deleteProjectOnServer, editProjectOnServer, registerProject, syncProjectsWithServer } from "./accountClient.js";
import { normalizeWebsite } from "./ProjectSetupWizard.jsx";
import { CreditMeter, useCredits } from "./CreditsCard.jsx";
import {
  createSchedule,
  formatScheduleConfirmation,
  listSchedules,
  loadImportedRunIds,
  saveImportedRunIds,
} from "./schedulesClient.js";
import { useAuth } from "./AuthContext.jsx";
import { Ga4WorkspaceTracker } from "./Ga4Tracker.jsx";
import { ackJobs, attachJobStream, CONNECTION_LOST_STATUS, fetchPendingJobs, isConnectionError, setJobContext } from "./jobsClient.js";
import { fetchCredits, saveProject } from "./firebase.js";
import { ProjectShareModal } from "./ProjectShareModal.jsx";
import {
  chatFingerprint,
  deleteSharedChat,
  fetchSharedChat,
  fetchSharedProjects,
  joinPendingProject,
  leaveSharedProject,
  pushSharedChat,
  stopSharingProject,
  updateSharedProject,
} from "./sharedProjectsClient.js";

import { stripUiBlocks } from "./parseAssistantUi.js";

const MODES = ["Auto", "Fast", "Deep"];
function withFollowUp(reply, followUp) {
  return followUp ? `${reply}\n\n${followUp}` : reply;
}

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
    body: "209 checks across 19 categories per page (10–300 pages depending on your plan), plus off-page authority.",
    chipHint: "209 checks · 19 categories · up to 300 pages",
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
    label: "SEO Agents",
    agentIds: [
      "site-audit",
      "keyword-finder",
      "serp-tracking",
      "ranking-opportunity-finder",
      "competitor-research",
      "backlink-finder",
      "b2b-lead-finder",
      "local-seo",
    ],
  },
  {
    id: "content",
    label: "Content Writing Agents",
    agentIds: ["seo-blog-writer", "geo-blog-writer", "humanization"],
  },
  {
    id: "site",
    label: "Growth Data Assistant",
    agentIds: ["site-integrations"],
  },
  {
    id: "ai-search",
    label: "GEO Agents",
    agentIds: ["prompt-research", "ai-visibility-tracker", "brand-sentiment-analysis"],
  },
];

const GROUPED_AGENT_IDS = new Set(AGENT_GROUP_IDS.flatMap((group) => group.agentIds));
const UNGROUPED_AGENTS = AGENTS.filter((agent) => !GROUPED_AGENT_IDS.has(agent.id));

/** Brand palette from the Blazly bolt logo, cycled across agent cards. */
const BRAND_COLORS = ["#F72585", "#FF7A1A", "#E8A800", "#B517E8", "#3D3DF5", "#0EA5E9"];
const agentColor = (id) => BRAND_COLORS[Math.max(0, AGENTS.findIndex((a) => a.id === id)) % BRAND_COLORS.length];
for (const agent of AGENTS) agent.color = agentColor(agent.id);

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
  const [outOfCreditsOpen, setOutOfCreditsOpen] = useState(false);
  const creditPlan = credits?.data?.plan || "free";
  const creditBalance = credits?.data?.balance;
  const lastBalanceRef = useRef(null);
  useEffect(() => {
    const onOut = () => creditPlan !== "free" && setOutOfCreditsOpen(true);
    window.addEventListener("blazly:out-of-credits", onOut);
    return () => window.removeEventListener("blazly:out-of-credits", onOut);
  }, [creditPlan]);
  useEffect(() => {
    if (typeof creditBalance !== "number") return;
    const previous = lastBalanceRef.current;
    lastBalanceRef.current = creditBalance;
    if (creditPlan !== "free" && creditBalance <= 0 && previous > 0) setOutOfCreditsOpen(true);
  }, [creditBalance, creditPlan]);
  const [sharedProjects, setSharedProjects] = useState([]);
  const [shareModalProject, setShareModalProject] = useState(null);
  const [projectsNotice, setProjectsNotice] = useState(null);
  const [scope, setScope] = useState("geo");
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const runningJobsRef = useRef(new Map()); // chatId -> running background job
  const [runningJobsVersion, setRunningJobsVersion] = useState(0);
  const attachedJobRef = useRef(null); // { id, chatId, controller } while following a background job
  const autoOpenedJobsRef = useRef(new Set());
  const busyRef = useRef(false);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const [status, setStatus] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [editorDraft, setEditorDraft] = useState(null);
  const [editorDraftHtml, setEditorDraftHtml] = useState(null);
  const [articleEditorOpen, setArticleEditorOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [pendingAgent, setPendingAgent] = useState(null);
  const [lastAgentId, setLastAgentId] = useState(null);

  function releaseAgent(id) {
    setPendingAgent(null);
    setLastAgentId(id);
  }
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
  const [workspaceMode, setWorkspaceMode] = useState(() => loadWorkspaceMode());
  const [aiOrchestratorProgress, setAiOrchestratorProgress] = useState(null);
  const fileRef = useRef(null);
  const shellRef = useRef(null);
  const promptRef = useRef(null);
  const threadRef = useRef(null);
  const messagesRef = useRef([]);
  const activeChatIdRef = useRef(null);
  const awaitingPublishTimeRef = useRef(null);

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
  const ownProjects = projects.filter((entry) => !entry.shared);

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
    const share = entry.shareId ? sharedProjects.find((item) => item.id === entry.shareId) : null;
    const chatCount = chats.filter((chat) => chatProject(chat) === entry.name).length;
    const chatLabel = chatCount ? `${chatCount} saved chat${chatCount === 1 ? "" : "s"}` : "No chats yet";
    return {
      name: entry.name,
      logo: entry.logo || "",
      website: websiteHost(site),
      fullWebsite: site,
      status: entry.name === project ? `Active · ${chatLabel}` : chatLabel,
      sharedBy: entry.shared?.ownerName || "",
      shareId: entry.shareId || "",
      memberCount: share?.members?.length || 0,
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
    joinPendingProject().then(async (result) => {
      if (!result) return;
      setOpenedProject(null);
      setView("projects");
      if (result.error) {
        setProjectsNotice({ tone: "error", text: result.error });
        return;
      }
      const joined = result.project;
      setProjectsNotice({
        tone: "success",
        text:
          joined.role === "owner"
            ? `That's the share link for your own project “${joined.name}”.`
            : `You joined “${joined.name}”. You can see its chats and run agents on ${joined.ownerName || "the owner"}'s credits.`,
      });
      await refreshSharedRef.current?.();
      credits.refresh();
      const entry = projectsRef.current.find((item) => item.shareId === joined.id);
      if (entry) chooseProject(entry.name);
    });
  }, [user?.uid]);

  /* ---------- Shared projects: teammates' chats live on the server ---------- */
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const projectsRef = useRef(projects);
  projectsRef.current = projects;
  const sharedListRef = useRef([]);
  // chatId -> { updatedAt, fp } of the last version known to be on the server.
  const sharedSyncRef = useRef(new Map());
  const sharedReadyRef = useRef(false);
  const refreshSharedRef = useRef(null);

  refreshSharedRef.current = async function refreshShared() {
    if (!user?.uid) return;
    const startedAt = Date.now();
    let list;
    try {
      list = await fetchSharedProjects();
    } catch {
      return;
    }
    sharedListRef.current = list;
    setSharedProjects(list);
    const merged = mergeSharedProjects(projectsRef.current, list);
    if (merged !== projectsRef.current) {
      projectsRef.current = merged;
      setProjects((current) => mergeSharedProjects(current, list));
    }
    const nameByShare = new Map(merged.filter((entry) => entry.shareId).map((entry) => [entry.shareId, entry.name]));
    const memberShareIds = new Set(list.filter((s) => s.role === "member").map((s) => s.id));
    const ownerShareByName = new Map(list.filter((s) => s.role === "owner").map((s) => [s.name, s.id]));
    const serverChats = new Map(list.map((s) => [s.id, new Set((s.chats || []).map((c) => c.id))]));
    const localById = new Map(chatsRef.current.map((c) => [c.id, c]));
    const sync = sharedSyncRef.current;

    const wanted = [];
    for (const share of list) {
      for (const summary of share.chats || []) {
        const known = sync.get(summary.id);
        const local = localById.get(summary.id);
        if (known?.updatedAt === summary.updatedAt && local) continue;
        if (summary.id === activeChatIdRef.current && busyRef.current) continue;
        // Unsaved local messages: the next save merges with the server copy instead.
        if (known?.pushing || (known && local && chatFingerprint(local.messages) !== known.fp)) continue;
        wanted.push([share.id, summary.id]);
      }
    }
    const fetched = (
      await Promise.all(
        wanted.map(([shareId, chatId]) =>
          fetchSharedChat(shareId, chatId)
            .then((chat) => ({ shareId, chat }))
            .catch(() => null),
        ),
      )
    ).filter(Boolean);
    for (const { chat } of fetched) sync.set(chat.id, { updatedAt: chat.updatedAt, fp: chatFingerprint(chat.messages), at: Date.now() });
    const fetchedById = new Map(fetched.map((item) => [item.chat.id, item]));

    setChats((current) => {
      let changed = false;
      const next = [];
      for (const chat of current) {
        const remote = fetchedById.get(chat.id);
        if (remote) continue;
        const shareId = chat.sharedProjectId || ownerShareByName.get(chat.project || projectsRef.current[0]?.name);
        if (!shareId) {
          next.push(chat);
          continue;
        }
        const isActiveBusy = chat.id === activeChatIdRef.current && busyRef.current;
        const ids = serverChats.get(shareId);
        if (!ids) {
          // Sharing ended: teammates lose the chats, the owner keeps them as normal chats.
          changed = true;
          sync.delete(chat.id);
          if (chat.sharedRole === "member" && !isActiveBusy) continue;
          const { sharedProjectId: _s, sharedRole: _r, ...rest } = chat;
          next.push(rest);
          continue;
        }
        if (!ids.has(chat.id) && sync.get(chat.id)?.at < startedAt && !isActiveBusy) {
          changed = true;
          sync.delete(chat.id);
          continue;
        }
        if (chat.sharedProjectId !== shareId) {
          changed = true;
          next.push({ ...chat, sharedProjectId: shareId, sharedRole: memberShareIds.has(shareId) ? "member" : "owner" });
        } else next.push(chat);
      }
      for (const { shareId, chat: remote } of fetched) {
        const existing = current.find((chat) => chat.id === remote.id);
        changed = true;
        next.push({
          ...(existing || {}),
          id: remote.id,
          title: remote.title,
          agent: remote.agent || existing?.agent || null,
          interactionMode: remote.interactionMode || existing?.interactionMode,
          scope: remote.scope || existing?.scope,
          mode: remote.mode || existing?.mode,
          messages: remote.messages,
          project: nameByShare.get(shareId) || existing?.project,
          sharedProjectId: shareId,
          sharedRole: memberShareIds.has(shareId) ? "member" : "owner",
          updatedAt: Math.max(existing?.updatedAt || 0, remote.updatedAt),
        });
      }
      if (!changed) return current;
      next.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      saveChats(user.uid, next);
      return next;
    });
    const activeRemote = fetchedById.get(activeChatIdRef.current);
    if (activeRemote && !busyRef.current) setMessages(activeRemote.chat.messages);
    if (activeChatIdRef.current && !busyRef.current) {
      const activeLocal = chatsRef.current.find((chat) => chat.id === activeChatIdRef.current);
      const ids = activeLocal?.sharedProjectId ? serverChats.get(activeLocal.sharedProjectId) : null;
      if (activeLocal?.sharedRole === "member" && sync.get(activeLocal.id)?.at < startedAt && (!ids || !ids.has(activeLocal.id))) {
        startNewChat();
      }
    }
    sharedReadyRef.current = true;
  };

  useEffect(() => {
    if (!user?.uid) {
      sharedListRef.current = [];
      sharedSyncRef.current = new Map();
      sharedReadyRef.current = false;
      setSharedProjects([]);
      return undefined;
    }
    const tick = () => {
      if (document.visibilityState === "visible") refreshSharedRef.current?.();
    };
    tick();
    // Only poll while something is shared; otherwise one fetch per visit is enough.
    const timer = setInterval(() => {
      if (sharedListRef.current.length) tick();
    }, 10_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [user?.uid]);

  async function pushSharedChatNow(chat) {
    const sync = sharedSyncRef.current;
    const known = sync.get(chat.id);
    sync.set(chat.id, { ...(known || {}), pushing: true });
    try {
      const saved = await pushSharedChat(chat.sharedProjectId, chat, known?.updatedAt ?? null);
      sync.set(chat.id, { updatedAt: saved.updatedAt, fp: chatFingerprint(saved.messages), at: Date.now() });
      const missingAuthor = saved.messages.some((m, i) => m.author && !chat.messages[i]?.author);
      if (missingAuthor) applySharedMessages(chat.id, saved.messages);
    } catch (error) {
      if (error.code === "conflict") {
        // Someone else saved first: keep their messages and append ours after them.
        const remote = await fetchSharedChat(chat.sharedProjectId, chat.id).catch(() => null);
        if (!remote) {
          sync.set(chat.id, { ...(known || {}), fp: chatFingerprint(chat.messages) });
          return;
        }
        const extra = chat.messages.slice(commonPrefix(remote.messages, chat.messages));
        sync.set(chat.id, { updatedAt: remote.updatedAt, fp: chatFingerprint(remote.messages), at: Date.now() });
        applySharedMessages(chat.id, [...remote.messages, ...extra]);
        return;
      }
      // Don't retry until the chat changes again.
      sync.set(chat.id, { ...(known || {}), fp: chatFingerprint(chat.messages) });
    }
  }

  function applySharedMessages(chatId, nextMessages) {
    setChats((current) => {
      const next = current.map((chat) => (chat.id === chatId ? { ...chat, messages: nextMessages } : chat));
      saveChats(user.uid, next);
      return next;
    });
    if (activeChatIdRef.current === chatId && !busyRef.current) setMessages(nextMessages);
  }

  useEffect(() => {
    if (!user?.uid) return undefined;
    const timer = setTimeout(async () => {
      if (!sharedReadyRef.current) return;
      for (const chat of chatsRef.current) {
        if (!chat.sharedProjectId || !chat.messages?.length) continue;
        if (chat.id === activeChatIdRef.current && busyRef.current) continue;
        const known = sharedSyncRef.current.get(chat.id);
        if (known?.pushing || known?.fp === chatFingerprint(chat.messages)) continue;
        await pushSharedChatNow(chat);
      }
    }, 1200);
    return () => clearTimeout(timer);
  }, [chats, busy, user?.uid]);

  async function leaveProject(entry) {
    if (!entry?.shareId) return;
    if (!window.confirm(`Leave “${entry.name}”? You'll lose access to its chats.`)) return;
    try {
      await leaveSharedProject(entry.shareId);
    } catch (err) {
      setProjectsNotice({ tone: "error", text: err.message || "Could not leave this project." });
      return;
    }
    setProjectsNotice({ tone: "success", text: `You left “${entry.name}”.` });
    await refreshSharedRef.current?.();
    credits.refresh();
  }
  const isBusinessOwner = Boolean(credits.data) && !credits.data.teamOwner && (PLANS[credits.data.plan]?.seats || 1) > 1;

  const projectNamesKey = ownProjects.map((entry) => `${entry.name}\u0001${projectDisplayWebsite(entry)}`).join("\u0000");
  useEffect(() => {
    if (!user?.uid || !projectNamesKey) return;
    const entries = projectNamesKey.split("\u0000").map((pair) => {
      const [name, website] = pair.split("\u0001");
      return { name, website };
    });
    syncProjectsWithServer(entries).catch(() => {});
  }, [user?.uid, projectNamesKey]);
  const isPaidPlan = Boolean(credits.data) && (credits.data.plan || "free") !== "free";

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

  // Agents keep running on the server after the tab closes or the network drops; pull finished results into chats.
  useEffect(() => {
    if (!user?.uid) return undefined;
    let cancelled = false;
    let inFlight = false;
    async function importBackgroundJobs() {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        const all = await fetchPendingJobs();
        if (cancelled) return;
        const running = all.filter((job) => job.status === "running");
        const jobs = all.filter(
          (job) => (job.status === "done" || job.status === "failed") && attachedJobRef.current?.id !== job.id,
        );
        // Remember running tasks so their chats show progress, and make sure each one has a chat with the prompt in it.
        const runningMap = new Map();
        for (const job of running) if (job.chatId) runningMap.set(job.chatId, job);
        runningJobsRef.current = runningMap;
        if (running.length) {
          setChats((current) => {
            let changed = false;
            let next = [...current];
            for (const job of running) {
              if (!job.chatId) continue;
              // The chat that is streaming right now already shows its prompt (possibly reworded by the orchestrator).
              if (job.chatId === activeChatIdRef.current && busyRef.current && attachedJobRef.current?.id !== job.id) continue;
              const idx = next.findIndex((chat) => chat.id === job.chatId);
              if (idx >= 0) {
                const chat = next[idx];
                const last = (chat.messages || []).at(-1);
                if (job.userText && !(last?.role === "user" && (last.content || "").trim() === job.userText.trim())) {
                  next[idx] = { ...chat, messages: [...(chat.messages || []), { role: "user", content: job.userText }], agent: chat.agent || job.agentId || null };
                  changed = true;
                }
              } else {
                next = [
                  {
                    id: job.chatId,
                    title: defaultChatTitle(job.userText || "Background task"),
                    project: job.project || project,
                    scope,
                    mode,
                    agent: job.agentId || null,
                    interactionMode: WORKSPACE_MODES.manual,
                    messages: job.userText ? [{ role: "user", content: job.userText }] : [],
                    updatedAt: Date.now(),
                  },
                  ...next,
                ];
                changed = true;
              }
            }
            if (changed) saveChats(user.uid, next);
            return changed ? next : current;
          });
        }
        setRunningJobsVersion((n) => n + 1);
        if (!jobs.length) return;
        setChats((current) => {
          let next = [...current];
          for (const job of jobs) {
            const reply =
              job.status === "done"
                ? job.content
                : `This task couldn't finish: ${job.error || "unknown error"}`;
            const idx = next.findIndex((chat) => chat.id === job.chatId);
            if (idx >= 0) {
              const chat = next[idx];
              const existing = chat.messages || [];
              const last = existing.at(-1);
              const needsUser = !(last?.role === "user" && (last.content || "").trim() === (job.userText || "").trim());
              const messages = [
                ...existing,
                ...(needsUser && job.userText ? [{ role: "user", content: job.userText }] : []),
                { role: "assistant", content: reply },
              ];
              next[idx] = { ...chat, messages, agent: chat.agent || job.agentId || null, updatedAt: Date.now() };
              if (activeChatIdRef.current === chat.id) setMessages(messages);
            } else {
              next = [
                {
                  id: job.chatId || `job_${job.id}`,
                  title: defaultChatTitle(job.userText || "Background task"),
                  project: job.project || project,
                  scope,
                  mode,
                  agent: job.agentId || null,
                  interactionMode: WORKSPACE_MODES.manual,
                  messages: [
                    ...(job.userText ? [{ role: "user", content: job.userText }] : []),
                    { role: "assistant", content: reply },
                  ],
                  updatedAt: Date.now(),
                },
                ...next,
              ];
            }
          }
          saveChats(user.uid, next);
          return next;
        });
        await ackJobs(jobs.map((job) => job.id));
      } catch {
        // Try again on the next tick.
      } finally {
        inFlight = false;
      }
    }
    importBackgroundJobs();
    const timer = setInterval(importBackgroundJobs, 20_000);
    window.addEventListener("online", importBackgroundJobs);
    document.addEventListener("visibilitychange", importBackgroundJobs);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", importBackgroundJobs);
      document.removeEventListener("visibilitychange", importBackgroundJobs);
    };
  }, [user?.uid]);

  // When the open chat has a task still running on the server, show the thinking state and follow its progress live.
  useEffect(() => {
    if (!user?.uid) return undefined;
    const jobsByChat = runningJobsRef.current;
    if (!activeChatId) {
      // Coming back to the app with a task running: open that chat so the user sees it working.
      const first = [...jobsByChat.values()].find((job) => !autoOpenedJobsRef.current.has(job.id));
      if (first && !busy && messagesRef.current.length === 0 && view === "home") {
        autoOpenedJobsRef.current.add(first.id);
        const chat = chats.find((item) => item.id === first.chatId);
        if (chat) openChat(chat.id);
      }
      return undefined;
    }
    const job = jobsByChat.get(activeChatId);
    if (!job || busy || attachedJobRef.current) return undefined;

    const controller = new AbortController();
    attachedJobRef.current = { id: job.id, chatId: job.chatId, controller };
    autoOpenedJobsRef.current.add(job.id);
    setBusy(true);
    setStatus("");
    if (job.agentId) setPendingAgent(job.agentId);
    const lastMsg = messagesRef.current.at(-1);
    if (job.userText && !(lastMsg?.role === "user" && (lastMsg.content || "").trim() === job.userText.trim())) {
      setMessages([...messagesRef.current, { role: "user", content: job.userText }]);
    }
    const setProgress = progressSetterFor(job.agentId);
    let finished = false;
    attachJobStream(job.id, { onProgress: (event) => setProgress?.(event), signal: controller.signal })
      .then((content) => {
        finished = true;
        setMessages([...messagesRef.current, { role: "assistant", content }]);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        finished = true;
        setMessages([...messagesRef.current, { role: "assistant", content: `This task couldn't finish: ${err.message}` }]);
      })
      .finally(() => {
        if (attachedJobRef.current?.controller === controller) attachedJobRef.current = null;
        clearAllProgress();
        setBusy(false);
        if (controller.signal.aborted) return;
        releaseAgent(job.agentId || null);
        runningJobsRef.current.delete(job.chatId);
        ackJobs([job.id]);
      });
    return undefined;
  }, [activeChatId, runningJobsVersion, user?.uid]);

  // Switching away from a chat that is being followed: detach (the result still lands in that chat later).
  useEffect(() => {
    const attached = attachedJobRef.current;
    if (!attached || attached.chatId === activeChatId) return;
    attached.controller.abort();
    attachedJobRef.current = null;
    clearAllProgress();
    setBusy(false);
  }, [activeChatId]);
  useEffect(
    () => () => {
      attachedJobRef.current?.controller.abort();
      attachedJobRef.current = null;
    },
    [],
  );

  function progressSetterFor(agentId) {
    switch (agentId) {
      case "site-audit": return setAuditProgress;
      case "seo-blog-writer":
      case "geo-blog-writer": return setBlogProgress;
      case "humanization": return setHumanizeProgress;
      case "ranking-opportunity-finder": return setRankingProgress;
      case "keyword-finder": return setKeywordFinderProgress;
      case "ai-visibility-tracker": return setAiVisibilityProgress;
      case "brand-sentiment-analysis": return setBrandSentimentProgress;
      case "competitor-research": return setCompetitorResearchProgress;
      case "prompt-research": return setPromptResearchProgress;
      case "serp-tracking": return setSerpTrackingProgress;
      case "backlink-finder": return setBacklinkFinderProgress;
      case "b2b-lead-finder": return setB2bLeadFinderProgress;
      case "local-seo": return setLocalSeoProgress;
      case "site-integrations": return setSiteIntegrationsProgress;
      default: return null;
    }
  }

  function clearAllProgress() {
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
    setAiOrchestratorProgress(null);
    setSiteIntegrationsProgress(null);
  }

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
    setLastAgentId(null);
    setAuditProgress(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function renameProject(oldName, rawName, rawWebsite) {
    const name = String(rawName || "").trim() || oldName;
    const current = projects.find((entry) => entry.name === oldName);
    if (!current || current.shared) return;
    if (name.length > 60) throw new Error("Keep the project name under 60 characters.");
    if (projects.some((entry) => entry.name !== oldName && entry.name.toLowerCase() === name.toLowerCase())) {
      throw new Error("That project name already exists.");
    }
    const currentSite = projectDisplayWebsite(current);
    const website = rawWebsite === undefined ? currentSite : normalizeWebsite(String(rawWebsite || ""));
    if (name === oldName && website === currentSite) return;
    if (!isPaidPlan) {
      const err = new Error("Editing projects is available on Pro and Business plans.");
      err.code = "plan_required";
      throw err;
    }

    // The server enforces: paid plan, one change per 30 days, and resets integrations when the site changes.
    const result = user?.uid ? await editProjectOnServer({ from: oldName, to: name, website }) : { name, website, websiteChanged: website !== currentSite };
    let knowledge = current.knowledge;
    if (result.websiteChanged) {
      try {
        const response = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ website }),
        });
        const data = await response.json().catch(() => ({}));
        if (response.ok && data.knowledge) knowledge = { ...data.knowledge, companyName: data.knowledge.companyName || name };
      } catch {
        // Keep the old knowledge base if the new site can't be read right now.
      }
    }

    const next = projects.map((entry) =>
      entry.name === oldName ? { ...entry, name, website, knowledge, logo: result.websiteChanged ? "" : entry.logo } : entry,
    );
    setProjects(next);
    if (user?.uid) saveProjects(user.uid, next);

    setChats((current) => {
      const updated = current.map((chat) => (chat.project === oldName ? { ...chat, project: name } : chat));
      if (user?.uid) saveChats(user.uid, updated);
      return updated;
    });

    if (current.shareId) {
      updateSharedProject(current.shareId, { name, website, knowledge, logo: result.websiteChanged ? "" : current.logo || "" })
        .then(() => refreshSharedRef.current?.())
        .catch(() => {});
    }

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
    if (credits.data && ownProjects.length >= plan.projects) {
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
    if (user?.uid) await registerProject(name, data.website);
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

  async function deleteProject(name) {
    const target = projects.find((entry) => entry.name === name);
    if (!target || target.shared) return;
    if (ownProjects.length <= 1) {
      setStatus("Keep at least one project.");
      return;
    }
    if (!isPaidPlan) {
      setBillingNotice("project-edit");
      setView("pricing");
      return;
    }
    const fallback = projects.find((entry) => entry.name !== name)?.name || projects[0]?.name;
    const chatCount = chats.filter((chat) => chat.project === name).length;
    const confirmed = window.confirm(
      `Delete "${name}"? Its ${chatCount ? `${chatCount} chat(s), ` : ""}knowledge base and integrations will be removed. This can't be undone.`
    );
    if (!confirmed) return;
    if (user?.uid) {
      try {
        await deleteProjectOnServer(name);
      } catch (err) {
        if (err.code === "plan_required") {
          setBillingNotice("project-edit");
          setView("pricing");
        } else {
          setStatus(err.message || "Could not delete this project.");
        }
        return;
      }
    }
    if (target.shareId) await stopSharingProject(target.shareId).catch(() => {});
    const next = projects.filter((entry) => entry.name !== name);
    setProjects(next);
    if (user?.uid) saveProjects(user.uid, next);

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
    const accepted = [];
    for (const file of incoming) {
      const error = validateAttachmentFile(file);
      if (error) {
        errors.push(error);
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
    setPendingAgent(chat.messages?.length ? null : chat.agent || null);
    setLastAgentId(chat.agent || null);
    setAuditProgress(null);
    setPrompt("");
    setStatus("");
    setView("home");
    setNavOpen(false);
  }

  function deleteChat(id) {
    const target = chats.find((item) => item.id === id);
    if (target?.sharedProjectId) {
      deleteSharedChat(target.sharedProjectId, id)
        .then(() => sharedSyncRef.current.delete(id))
        // If the server refuses, the next sync brings the chat back.
        .catch((err) => setStatus(err.message || "Could not delete this chat."));
    }
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
      ...(activeProjectRecord?.shareId
        ? { sharedProjectId: activeProjectRecord.shareId, sharedRole: activeProjectRecord.shared ? "member" : "owner" }
        : {}),
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

  function latestArticlePayload() {
    const latest = extractLastBlogArticleFromHistory(messagesRef.current);
    return latest?.html
      ? { title: latest.blogTitle || latest.metaTitle, html: latest.html, metaDescription: latest.metaDescription, slug: latest.urlSlug }
      : null;
  }

  async function resolvePublishTime(text) {
    const token = text.trim().toLowerCase();
    const at = (days, hour) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      d.setHours(hour, 0, 0, 0);
      return d.toISOString();
    };
    if (token === "in1h") return new Date(Date.now() + 60 * 60 * 1000).toISOString();
    if (token === "tomorrow9") return at(1, 9);
    if (token === "monday9") return at(((8 - new Date().getDay()) % 7) || 7, 9);
    const route = await routeAiObjective({
      messages: [{ role: "user", content: `Schedule publishing my latest blog to my website at this time: ${text}` }],
      project,
    }).catch(() => null);
    if (route?.action === "schedule" && route.runAt) return route.runAt;
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }

  async function runFollowUp(kind, label, timeText = "") {
    if (busy) return;
    const history = [...messagesRef.current, { role: "user", content: label }];
    setMessages(history);
    setBusy(true);
    setStatus("");
    const projectCtx = activeProjectContext();
    const reply = (content) => setMessages([...history, { role: "assistant", content }]);
    try {
      if (kind === "schedule-ask") {
        awaitingPublishTimeRef.current = activeChatIdRef.current;
        reply(
          [
            "When should I publish it? Pick an option or type a date and time (for example, *Friday 10am*).",
            "",
            `SECONDARY_ACTION|In 1 hour|${FOLLOW_UP.scheduleAt}in1h`,
            `SECONDARY_ACTION|Tomorrow 9 AM|${FOLLOW_UP.scheduleAt}tomorrow9`,
            `SECONDARY_ACTION|Monday 9 AM|${FOLLOW_UP.scheduleAt}monday9`,
          ].join("\n"),
        );
        return;
      }

      if (kind === "schedule") {
        const article = latestArticlePayload();
        if (!article) {
          awaitingPublishTimeRef.current = null;
          reply("I couldn't find a blog in this chat to schedule.");
          return;
        }
        const runAt = await resolvePublishTime(timeText);
        if (!runAt) {
          reply("I couldn't read that time. Try something like *tomorrow 9am* or *Nov 20, 3pm*.");
          return;
        }
        awaitingPublishTimeRef.current = null;
        try {
          const job = await createSchedule({
            uid: user?.uid,
            project,
            website: projectCtx.website,
            knowledge: projectCtx.knowledge,
            brandName: projectCtx.brandName,
            title: `Publish "${article.title || "blog"}"`,
            runAt,
            steps: [{ agentId: "site-integrations", agentMessage: "Publish the latest Blazly article live on my website." }],
            article,
          });
          setScheduleRefresh((n) => n + 1);
          reply(formatScheduleConfirmation(job, `Scheduled **${article.title || "your blog"}** to publish.`));
        } catch (err) {
          reply(
            err.code === "integration_required"
              ? `${err.message}\n\nLINK_ACTION|Connect integrations|/integrations`
              : err.message || "Could not schedule that.",
          );
        }
        return;
      }

      setSiteIntegrationsProgress({ phase: "integrations", message: "Connecting to your site" });
      const audit = [...messagesRef.current].reverse().find((m) => m.role === "assistant");
      const message =
        kind === "publish"
          ? "Publish the latest Blazly article live on my website now."
          : [
              "Fix the issues from this site audit on my website using the connected integrations.",
              "Update posts and pages you can reach (titles, meta descriptions, headings, content, internal links, image alt text); resubmit the sitemap if Search Console is connected.",
              "Then report what you fixed with links, and list anything that needs a manual change.",
              "",
              "Site audit:",
              stripUiBlocks(String(audit?.content || "")).slice(0, 20_000),
            ].join("\n");
      const content = await runSiteIntegrationsStream({
        uid: user?.uid,
        project,
        website: projectCtx.website,
        message,
        messages: messagesRef.current,
        article: latestArticlePayload(),
        onProgress: (event) => setSiteIntegrationsProgress(event),
      });
      reply(content);
    } catch (err) {
      if (isUpgradeError(err)) reply(upgradeReply(err));
      else {
        setMessages(history.slice(0, -1));
        setStatus(err.message || "Blazly could not reply.");
      }
    } finally {
      setSiteIntegrationsProgress(null);
      setBusy(false);
    }
  }

  async function runPlannedAgents(route, history, projectCtx) {
    const plan = Array.isArray(route.plan) && route.plan.length ? route.plan : [{ agentId: route.agentId, task: "" }];
    const intro =
      plan.length > 1
        ? `${route.intro || "Here's the plan."}\n\n**Plan — ${plan.length} agents**\n${formatPlanSteps(plan, 0)}\n\nStarting with **${agentTitle(route.agentId)}**.`
        : route.intro;
    const creditsStart = credits.data?.used ?? null;
    let thread = [...history];
    let ranAgents = [];
    let current = null;
    const append = (content) => {
      thread = [...thread, { role: "assistant", content }];
      setMessages(thread);
    };
    const clearCurrent = () => {
      if (current) progressSetterFor(current)?.(null);
    };
    setJobContext(null);
    await runAiChain({
      route: { ...route, intro },
      messages: history,
      project,
      website: projectCtx.website,
      knowledge: projectCtx.knowledge,
      brandName: projectCtx.brandName,
      onEvent: (event) => {
        if (event.type === "step_start") {
          setAiOrchestratorProgress(null);
          current = event.agentId;
          (progressSetterFor(current) || setAiOrchestratorProgress)({ phase: "orchestrator", stage: "route", message: `Running ${agentTitle(current)}` });
        } else if (event.type === "progress") {
          (progressSetterFor(event.agentId) || setAiOrchestratorProgress)(event.event);
        } else if (event.type === "step_done") {
          clearCurrent();
          ranAgents = [...ranAgents, event.agentId];
          append(String(event.content || "").replace(/^active\|/gm, "done|"));
        } else if (event.type === "thinking") {
          setAiOrchestratorProgress({ phase: "orchestrator", stage: "route", message: event.message });
        } else if (event.type === "error") {
          clearCurrent();
          setAiOrchestratorProgress(null);
          append(`I couldn't finish this step: ${event.error}${ranAgents.length ? "\n\nThe results above are complete — reply to retry or continue." : ""}`);
        } else if (event.type === "complete") {
          setAiOrchestratorProgress(null);
          ranAgents = event.ranAgents || ranAgents;
          const lines = [event.message || "All done."];
          if (ranAgents.length > 1) {
            lines.push("", "CARD_START|Completed run", `Agents|${ranAgents.map(agentTitle).join(" → ")}`, "CARD_END");
          }
          append(lines.join("\n"));
        }
      },
    });
    clearCurrent();
    if (ranAgents.length > 1 && creditsStart != null) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const after = await fetchCredits().catch(() => null);
      window.dispatchEvent(new Event("blazly:credits-changed"));
      if (after?.used != null) {
        const used = Math.max(0, after.used - creditsStart).toLocaleString();
        const last = thread.at(-1);
        if (last?.content?.includes("CARD_START|Completed run")) {
          thread = [...thread.slice(0, -1), { ...last, content: last.content.replace("CARD_END", `Credits used|${used}\nCARD_END`) }];
          setMessages(thread);
        }
      }
    }
  }

  async function send(overrideText) {
    if (overrideText === FOLLOW_UP.publish) return runFollowUp("publish", "Publish");
    if (overrideText === FOLLOW_UP.schedule) return runFollowUp("schedule-ask", "Schedule");
    if (overrideText === FOLLOW_UP.fixAudit) return runFollowUp("fix", "Fix these issues");
    if (typeof overrideText === "string" && overrideText.startsWith(FOLLOW_UP.scheduleAt)) {
      const token = overrideText.slice(FOLLOW_UP.scheduleAt.length);
      const labels = { in1h: "In 1 hour", tomorrow9: "Tomorrow 9 AM", monday9: "Monday 9 AM" };
      return runFollowUp("schedule", labels[token] || token, token);
    }
    if (typeof overrideText !== "string" && awaitingPublishTimeRef.current && awaitingPublishTimeRef.current === activeChatIdRef.current) {
      const typed = readPrompt();
      if (typed && !attachments.length) {
        setPrompt("");
        return runFollowUp("schedule", typed, typed);
      }
    }
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
    if (!text && !pendingFiles.length) return;
    if (busy) {
      setStatus("Blazly is still working on the last task. Wait for it to finish, then send again.");
      return;
    }
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
        ...(activeProjectRecord?.shareId && user?.uid ? { author: { uid: user.uid, name: displayName } } : {}),
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
          await runPlannedAgents(route, history, projectCtx);
          setBusy(false);
          return;
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
    setJobContext({ chatId: activeChatIdRef.current, agentId: dispatchAgent, project });
    const agentEngaged = (id) =>
      dispatchAgent === id || pendingAgent === id;
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
    if (rankingFinderActive && aiDispatchAgentId === "ranking-opportunity-finder") {
      const fields = parseRankingOpportunityBrief(userMessage.content);
      const ctx = activeProjectContext();
      const k = ctx.knowledge || {};
      const listFirst = (v) => (Array.isArray(v) ? v[0]?.name || v[0] : v);
      const website = fields.website || ctx.website || firstUrlInText(userMessage.content) || "";
      const targetKeyword =
        fields.targetKeyword || String(listFirst(k.services) || listFirst(k.products) || k.industry || ctx.brandName || "").trim();
      if (website && targetKeyword) {
        userMessage = { ...userMessage, content: `Website URL: ${website}\nTarget keyword: ${targetKeyword}` };
      }
    }
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
    const siteIntegrationsActive = agentEngaged("site-integrations");
    const runSiteIntegrations =
      siteIntegrationsActive &&
      !isEmptySiteIntegrationsBrief(userMessage.content) &&
      userMessage.content.trim().length >= 3;

    if (siteIntegrationsActive && isEmptySiteIntegrationsBrief(userMessage.content)) {
      if (!fromAction) setPrompt(draft);
      setStatus("Say what you want to know from Search Console, GA4, or WordPress, then send.");
      setBusy(false);
      setMessages(history.slice(0, -1));
      return;
    }

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
        setMessages([...history, { role: "assistant", content: withFollowUp(mergeAiIntro(reply), await integrationFollowUp("audit", user?.uid, project)) }]);
        releaseAgent("site-audit");
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
        setMessages([...history, { role: "assistant", content: withFollowUp(mergeAiIntro(reply), await integrationFollowUp("blog", user?.uid, project)) }]);
        releaseAgent(blogAgentId);
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
        setMessages([...history, { role: "assistant", content: withFollowUp(mergeAiIntro(reply), await integrationFollowUp("blog", user?.uid, project)) }]);
        releaseAgent(blogAgentId);
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
        releaseAgent("ranking-opportunity-finder");
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
        releaseAgent("keyword-finder");
        setKeywordFinderProgress(null);
        return;
      }

      if (runLocalSeo) {
        setLocalSeoProgress({ phase: "local_seo", stage: "resolve", message: "Starting" });
        const reply = await runLocalSeoStream({
          message: userMessage.content,
          onProgress: (event) => setLocalSeoProgress(event),
        });
        setMessages([...history, { role: "assistant", content: mergeAiIntro(reply) }]);
        releaseAgent("local-seo");
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
        releaseAgent("b2b-lead-finder");
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
        releaseAgent("backlink-finder");
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
        releaseAgent("serp-tracking");
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
        releaseAgent("ai-visibility-tracker");
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
        releaseAgent("brand-sentiment-analysis");
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
        releaseAgent("prompt-research");
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
        releaseAgent("competitor-research");
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
        releaseAgent("site-integrations");
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
        releaseAgent("humanization");
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
      setStatus(
        isConnectionError(err) && !navigator.onLine
          ? CONNECTION_LOST_STATUS
          : err.message || (siteAuditUrl ? "Site audit failed." : "Blazly could not reply."),
      );
    } finally {
      setJobContext(null);
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
        isEmptyAiVisibilityBrief(prompt) ||
        isEmptySiteIntegrationsBrief(prompt))
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
    if (agent.id === "site-audit" && messages.length === 0) {
      setPrompt("Website URL:");
    }
    if (agent.id === "seo-blog-writer" && !prompt.trim() && messages.length === 0) {
      setPrompt(SEO_BLOG_WRITER_BRIEF);
    }
    if (agent.id === "geo-blog-writer" && !prompt.trim() && messages.length === 0) {
      setPrompt(GEO_BLOG_WRITER_BRIEF);
    }
    if (agent.id === "ranking-opportunity-finder" && messages.length === 0) {
      setPrompt(rankingBriefPrefill());
    }
    if (agent.id === "keyword-finder" && messages.length === 0) {
      setPrompt(keywordFinderPrefill());
    }
    if (agent.id === "ai-visibility-tracker" && messages.length === 0) {
      setPrompt(aiVisibilityBriefPrefill());
    }
    if (agent.id === "brand-sentiment-analysis" && messages.length === 0) {
      setPrompt(brandSentimentBriefPrefill());
    }
    if (agent.id === "local-seo" && messages.length === 0) {
      const ctx = activeProjectContext();
      setPrompt(localSeoBriefPrefill(ctx.knowledge?.companyName || ""));
    }
    if (agent.id === "b2b-lead-finder" && messages.length === 0) {
      setPrompt(b2bLeadFinderBriefPrefill());
    }
    if (agent.id === "backlink-finder" && messages.length === 0) {
      setPrompt(backlinkFinderBriefPrefill());
    }
    if (agent.id === "serp-tracking" && messages.length === 0) {
      setPrompt(serpTrackingBriefPrefill());
    }
    if (agent.id === "prompt-research" && messages.length === 0) {
      setPrompt(PROMPT_RESEARCH_BRIEF);
    }
    if (agent.id === "competitor-research" && messages.length === 0) {
      setPrompt(competitorResearchBriefPrefill());
    }
    if (agent.id === "site-integrations" && messages.length === 0) {
      setPrompt(SITE_INTEGRATIONS_BRIEF);
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
                : activeAgent?.id === "site-integrations"
                  ? inChat
                    ? "Ask another question about Search Console, GA4, or WordPress…"
                    : "What you want to know from Search Console, GA4, or WordPress, then send…"
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
    reuseAgent: !isAiWorkspaceMode && inChat && !activeAgent ? AGENTS.find((agent) => agent.id === lastAgentId) || null : null,
    onReuseAgent: chooseAgent,
    agents: isAiWorkspaceMode ? null : AGENTS,
    onPickAgent: chooseAgent,
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
      <Ga4WorkspaceTracker view={view} />
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
              <img className="sidebar-brand-mark" src="/assets/logo.png" alt="" width={26} height={26} />
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
                title={sidebarCollapsed ? "Invite friends, get 250 credits" : undefined}
                onClick={() => setReferralOpen(true)}
              >
                <span className="sidebar-referral-gift" aria-hidden="true">🎁</span>
                <span className="nav-label">
                  Invite friends, <strong>get +250 credits</strong>
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
                        canEdit={isPaidPlan && !item.shared}
                        canDelete={isPaidPlan && !item.shared && ownProjects.length > 1}
                        onSelect={() => {
                          chooseProject(item.name);
                          setProjectOpen(false);
                        }}
                        onDelete={() => deleteProject(item.name)}
                        onRename={() => {
                          setProjectOpen(false);
                          setOpenedProject(null);
                          setView("projects");
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
                      <Fragment key={`${message.role}-${index}`}>
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
                        showAuthor={Boolean(activeChat?.sharedProjectId)}
                        chatId={activeChatId}
                        animateSteps={message.role === "assistant" && index === messages.length - 1 && !busy}
                      />
                      {auditDock?.messageIndex === index ? (
                        <ChatAuditDock dock={auditDock} chatId={activeChatId} onRerun={send} rerunDisabled={busy} inThread />
                      ) : null}
                      </Fragment>
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
                            aiOrchestratorProgress || siteIntegrationsProgress,
                          )}
                        />
                      </div>
                    </div>
                  )}
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
                  <img src="/assets/logo.png" alt="" width={34} height={34} className="greeting-mark" />
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
                      <h3 className="agents-group-label">{group.label}</h3>
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
                  {projectsNotice ? (
                    <p className={`integration-notice is-${projectsNotice.tone}`}>{projectsNotice.text}</p>
                  ) : null}
                  <div className="cards">
                    {projectCards.map((item) => (
                      <ProjectWorkCard
                        key={item.name}
                        title={item.name}
                        logo={item.logo}
                        website={item.fullWebsite}
                        body={item.website || "No website yet"}
                        status={item.status}
                        current={item.name === project}
                        canEdit={isPaidPlan && !item.sharedBy}
                        canDelete={isPaidPlan && !item.sharedBy && ownProjects.length > 1}
                        sharedBy={item.sharedBy}
                        memberCount={item.memberCount}
                        onShare={isBusinessOwner && !item.sharedBy ? () => setShareModalProject(item.name) : null}
                        onLeave={() => leaveProject(projects.find((entry) => entry.name === item.name))}
                        onSelect={() => openProjectDetail(item.name)}
                        onDelete={() => deleteProject(item.name)}
                        onRename={(next, website) => renameProject(item.name, next, website)}
                        onUpgrade={() => {
                          setBillingNotice("project-edit");
                          setView("pricing");
                        }}
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
                  onOpenProjects={() => {
                    setOpenedProject(null);
                    openView("projects");
                  }}
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
                <IntegrationsView
                  uid={activeProjectRecord?.shared ? null : user?.uid}
                  project={project}
                  website={projectDisplayWebsite(activeProjectRecord)}
                  notice={integrationsNotice}
                  managedBy={activeProjectRecord?.shared?.ownerName || ""}
                />
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
      <OutOfCreditsModal
        open={outOfCreditsOpen}
        onClose={() => setOutOfCreditsOpen(false)}
        credits={credits}
        email={user?.email}
        onSeePlans={() => {
          setOutOfCreditsOpen(false);
          setView("pricing");
        }}
      />
      {shareModalProject && projects.some((entry) => entry.name === shareModalProject) ? (
        <ProjectShareModal
          project={projects.find((entry) => entry.name === shareModalProject)}
          share={sharedProjects.find((item) => item.id === projects.find((entry) => entry.name === shareModalProject)?.shareId) || null}
          onClose={() => setShareModalProject(null)}
          onChanged={() => refreshSharedRef.current?.()}
        />
      ) : null}
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
  const card = (
    <button
      type="button"
      className={`agent-card${active ? " is-active" : ""}${disabled ? " is-disabled" : ""}`}
      style={{ "--agent-c": agentColor(agent.id) }}
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
        <span className="agent-card-title">{agent.title}</span>
        <span className="agent-card-body">{agent.body}</span>
        {agent.chipHint ? <span className="agent-card-meta">{agent.chipHint}</span> : null}
      </span>
      <Icon name="arrowRight" size={16} className="agent-card-arrow" />
    </button>
  );
  if (!disabled) return card;
  return (
    <span className="agent-card-lock" data-tooltip="Switch to Manual mode to use this agent directly">
      {card}
    </span>
  );
}

/** Own projects (tagged with their share id) followed by projects teammates shared with you. */
function mergeSharedProjects(current, shares) {
  const own = current.filter((entry) => !entry.shared);
  const ownerShare = new Map(shares.filter((s) => s.role === "owner").map((s) => [s.name, s.id]));
  const ownNext = own.map((entry) => {
    const shareId = ownerShare.get(entry.name);
    if ((entry.shareId || "") === (shareId || "")) return entry;
    const { shareId: _old, ...rest } = entry;
    return shareId ? { ...rest, shareId } : rest;
  });
  const previous = new Map(current.filter((entry) => entry.shared).map((entry) => [entry.shareId, entry]));
  const taken = new Set(ownNext.map((entry) => entry.name.toLowerCase()));
  const joined = shares
    .filter((s) => s.role === "member")
    .map((s) => {
      const ownerFirst = (s.ownerName || "teammate").split(" ")[0];
      const name = taken.has(s.name.toLowerCase()) ? `${s.name} (${ownerFirst})` : s.name;
      taken.add(name.toLowerCase());
      return {
        id: `shared_${s.id}`,
        name,
        website: s.website || "",
        knowledge: s.knowledge || null,
        logo: s.logo || previous.get(s.id)?.logo || "",
        shareId: s.id,
        shared: { role: "member", ownerName: s.ownerName || "Your teammate" },
      };
    });
  const next = [...ownNext, ...joined];
  return JSON.stringify(next) === JSON.stringify(current) ? current : next;
}

/** Number of leading messages two chats agree on. */
function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i].role === b[i].role && a[i].content === b[i].content) i += 1;
  return i;
}

function ProjectMenuRow({ name, logo, current, canEdit, canDelete, onSelect, onDelete, onRename }) {
  return (
    <div className={`menu-project-row${current ? " is-current" : ""}`}>
      <button type="button" role="menuitem" className="menu-project-select" onClick={onSelect}>
        <ProjectAvatar name={name} logo={logo} className="project-badge is-sm" />
        <span className="menu-project-name">{name}</span>
        {current ? <Icon name="check" size={15} className="menu-project-check" /> : null}
      </button>
      {canEdit ? (
        <button
          type="button"
          className="menu-project-delete menu-project-rename"
          aria-label={`Edit ${name}`}
          title={`Edit ${name}`}
          onClick={(event) => {
            event.stopPropagation();
            onRename();
          }}
        >
          <Icon name="pencil" size={14} />
        </button>
      ) : null}
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

function ProjectWorkCard({
  title,
  logo,
  website,
  body,
  status,
  current,
  canEdit,
  canDelete,
  sharedBy,
  memberCount,
  onShare,
  onLeave,
  onSelect,
  onDelete,
  onRename,
  onUpgrade,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const [siteDraft, setSiteDraft] = useState(website || "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function startEditing() {
    setDraft(title);
    setSiteDraft(website || "");
    setError("");
    setEditing(true);
  }

  async function submit(event) {
    event.preventDefault();
    const siteChanged = siteDraft.trim() !== (website || "");
    if (
      siteChanged &&
      !window.confirm(
        "Changing the website rebuilds this project's knowledge base and disconnects its integrations (they only work with the project's own site). You can change a project once every 30 days. Continue?",
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onRename(draft, siteDraft);
      setEditing(false);
    } catch (err) {
      if (err.code === "plan_required") onUpgrade?.();
      setError(err.message || "Could not update this project.");
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
            placeholder="Project name"
            autoFocus
          />
          <input
            className="project-rename-input"
            value={siteDraft}
            onChange={(e) => setSiteDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditing(false);
            }}
            aria-label="Project website"
            placeholder="https://yoursite.com"
            inputMode="url"
          />
          <span className="project-rename-hint">Projects can be changed once every 30 days.</span>
          {error ? <span className="project-rename-error">{error}</span> : null}
          <span className="project-rename-actions">
            <button type="submit" className="btn btn-primary" disabled={saving || !draft.trim() || !siteDraft.trim()}>
              {saving ? (siteDraft.trim() !== (website || "") ? "Analyzing site…" : "Saving…") : "Save"}
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
      {!editing && sharedBy ? (
        <div className="project-card-footer">
          <span className="project-card-shared">
            <Icon name="users" size={13} />
            Shared by {sharedBy}
          </span>
          <button type="button" className="project-card-delete" onClick={onLeave}>
            Leave
          </button>
        </div>
      ) : null}
      {!editing && !sharedBy ? (
        <div className="project-card-footer">
          {onShare ? (
            <button type="button" className="project-card-action project-card-share" onClick={onShare}>
              <Icon name="link" size={13} />
              {memberCount ? `Shared · ${memberCount + 1} people` : "Share"}
            </button>
          ) : null}
          {canEdit ? (
            <button type="button" className="project-card-action" onClick={startEditing}>
              Edit
            </button>
          ) : (
            <button type="button" className="project-card-action" onClick={onUpgrade} title="Editing and deleting projects is available on paid plans">
              Upgrade to edit
            </button>
          )}
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

