import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { attachAnalyze } from "./server/analyze.js";
import { attachChat } from "./server/chat.js";
import { attachSiteAudit } from "./server/siteAudit.js";
import { attachBlogWriter } from "./server/blogWriter.js";
import { attachHumanizeAgent } from "./server/humanizeAgent.js";
import { attachRankingOpportunityFinder } from "./server/rankingOpportunity.js";
import { attachKeywordFinder } from "./server/keywordFinder.js";
import { attachAiVisibilityTracker } from "./server/aiVisibilityTracker.js";
import { attachBrandSentimentAnalysis } from "./server/brandSentiment.js";
import { attachCompetitorResearch } from "./server/competitorResearch.js";
import { attachPromptResearch } from "./server/promptResearch.js";
import { attachSerpTracking } from "./server/serpTracking.js";
import { attachBacklinkFinder } from "./server/backlinkFinder.js";
import { attachB2bLeadFinder } from "./server/b2bLeadFinder.js";
import { attachLocalSeo } from "./server/localSeo.js";
import { attachReelsCreation } from "./server/reelsCreation.js";
import { attachAiOrchestrator } from "./server/aiOrchestrator.js";
import { attachIntegrations } from "./server/integrations/routes.js";
import { attachSiteLogo } from "./server/siteLogo.js";
import { attachScheduler } from "./server/scheduler/routes.js";
import { attachPublicMcp } from "./server/publicMcp/routes.js";
import { attachEmailOtp } from "./server/emailOtp.js";
import { attachCredits } from "./server/credits/middleware.js";
import { attachJobRelay } from "./server/jobs/relay.js";
import { attachBilling } from "./server/billing/routes.js";
import { attachReferrals } from "./server/referrals.js";
import { attachCommunity } from "./server/community.js";
import { attachAccountRoutes } from "./server/billing/accountRoutes.js";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  process.env.GEMINI_MODEL = env.GEMINI_MODEL || process.env.GEMINI_MODEL;
  process.env.PAGESPEED_API_KEY =
    env.PAGESPEED_API_KEY || env.GOOGLE_PAGESPEED_API_KEY || process.env.PAGESPEED_API_KEY;
  process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_WORKSPACE_ID = env.ANTHROPIC_WORKSPACE_ID || process.env.ANTHROPIC_WORKSPACE_ID;
  process.env.ANTHROPIC_BLOG_MODEL = env.ANTHROPIC_BLOG_MODEL || process.env.ANTHROPIC_BLOG_MODEL;
  process.env.GEMINI_API_KEY = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  process.env.XAI_API_KEY = env.XAI_API_KEY || process.env.XAI_API_KEY;
  for (const key of [
    "ANTHROPIC_MODEL",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "INTEGRATIONS_SECRET",
    "WEBFLOW_CLIENT_ID",
    "WEBFLOW_CLIENT_SECRET",
    "WEBFLOW_REDIRECT_URI",
    "APP_BASE_URL",
    "CRON_SECRET",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_PRO_MONTHLY",
    "STRIPE_PRICE_PRO_ANNUAL",
    "STRIPE_PRICE_BUSINESS_MONTHLY",
    "STRIPE_PRICE_BUSINESS_ANNUAL",
    "STRIPE_PORTAL_CONFIG",
    "BREVO_API_KEY",
    "BREVO_VERIFICATION_TEMPLATE_ID",
    "BREVO_PASSWORD_RESET_TEMPLATE_ID",
    "FIREBASE_SERVICE_ACCOUNT",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "BREVO_SENDER_EMAIL",
    "BREVO_SENDER_NAME",
    "MCP_KEYS_DIR",
    "SCHEDULER_ENABLED",
    "SCHEDULER_BASE_URL",
    "SCHEDULER_CONCURRENCY",
    "SCHEDULES_DIR",
  ]) {
    if (env[key]) process.env[key] = env[key];
  }
  process.env.XAI_MODEL = env.XAI_MODEL || process.env.XAI_MODEL;
  process.env.OPENAI_MODEL = env.OPENAI_MODEL || process.env.OPENAI_MODEL;
  process.env.OPENAI_API_KEY = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  process.env.SEARCHAPI_API_KEY = env.SEARCHAPI_API_KEY || process.env.SEARCHAPI_API_KEY;
  process.env.SEARCHAPI_LOCATION = env.SEARCHAPI_LOCATION || process.env.SEARCHAPI_LOCATION;

  const searchApiCtx = {
    searchApiKey: env.SEARCHAPI_API_KEY,
    searchApiLocation: env.SEARCHAPI_LOCATION || "United States",
  };
  process.env.HUNTER_API_KEY = env.HUNTER_API_KEY || process.env.HUNTER_API_KEY;

  const llmAgentCtx = {
    apiKey: env.ANTHROPIC_API_KEY,
    workspaceId: env.ANTHROPIC_WORKSPACE_ID,
    geminiApiKey: env.GEMINI_API_KEY,
    xaiApiKey: env.XAI_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
  };

  return {
    plugins: [
      react(),
      {
        name: "blazly-analyze",
        configureServer(server) {
          attachBilling(server);
          attachReferrals(server);
          attachCommunity(server);
          attachAccountRoutes(server);
          attachJobRelay(server);
          attachCredits(server);
          attachAnalyze(server, env.GEMINI_API_KEY);
          const dataForSeo = {
            login: env.DATAFORSEO_LOGIN,
            password: env.DATAFORSEO_PASSWORD,
            languageCode: env.DATAFORSEO_LANGUAGE_CODE || "en",
            locationCode: env.DATAFORSEO_LOCATION_CODE || "2356",
          };
          attachChat(server, {
            apiKey: env.ANTHROPIC_API_KEY,
            workspaceId: env.ANTHROPIC_WORKSPACE_ID,
            model: env.ANTHROPIC_MODEL,
            geminiApiKey: env.GEMINI_API_KEY,
            dataForSeo,
          });
          attachSiteAudit(server, {
            dataForSeo,
            apiKey: env.ANTHROPIC_API_KEY,
            model: env.ANTHROPIC_MODEL,
          });
          attachBlogWriter(server);
          attachHumanizeAgent(server);
          attachRankingOpportunityFinder(server, {
            apiKey: env.ANTHROPIC_API_KEY,
            workspaceId: env.ANTHROPIC_WORKSPACE_ID,
            dataForSeo,
          });
          attachKeywordFinder(server, { dataForSeo });
          attachAiVisibilityTracker(server, { dataForSeo, ...llmAgentCtx });
          attachBrandSentimentAnalysis(server, { dataForSeo, ...llmAgentCtx });
          attachCompetitorResearch(server, { dataForSeo, ...llmAgentCtx });
          attachPromptResearch(server, { dataForSeo, ...llmAgentCtx });
          attachSerpTracking(server, { dataForSeo, ...searchApiCtx });
          attachBacklinkFinder(server, {
            dataForSeo,
            ...searchApiCtx,
            hunterApiKey: env.HUNTER_API_KEY,
            ...llmAgentCtx,
          });
          attachB2bLeadFinder(server, {
            hunterApiKey: env.HUNTER_API_KEY,
            ...llmAgentCtx,
          });
          attachLocalSeo(server, { ...searchApiCtx, ...llmAgentCtx });
          attachReelsCreation(server, { geminiApiKey: env.GEMINI_API_KEY });
          attachAiOrchestrator(server, {
            apiKey: env.ANTHROPIC_API_KEY,
            workspaceId: env.ANTHROPIC_WORKSPACE_ID,
          });
          attachSiteLogo(server);
          attachScheduler(server);
          attachPublicMcp(server);
          attachEmailOtp(server);
          attachIntegrations(server, {
            apiKey: env.ANTHROPIC_API_KEY,
            workspaceId: env.ANTHROPIC_WORKSPACE_ID,
          });
        },
        configurePreviewServer(server) {
          attachBilling(server);
          attachReferrals(server);
          attachCommunity(server);
          attachAccountRoutes(server);
          attachJobRelay(server);
          attachCredits(server);
          attachAnalyze(server, env.GEMINI_API_KEY);
          const dataForSeo = {
            login: env.DATAFORSEO_LOGIN,
            password: env.DATAFORSEO_PASSWORD,
            languageCode: env.DATAFORSEO_LANGUAGE_CODE || "en",
            locationCode: env.DATAFORSEO_LOCATION_CODE || "2356",
          };
          attachChat(server, {
            apiKey: env.ANTHROPIC_API_KEY,
            workspaceId: env.ANTHROPIC_WORKSPACE_ID,
            model: env.ANTHROPIC_MODEL,
            geminiApiKey: env.GEMINI_API_KEY,
            dataForSeo,
          });
          attachSiteAudit(server, {
            dataForSeo,
            apiKey: env.ANTHROPIC_API_KEY,
            model: env.ANTHROPIC_MODEL,
          });
          attachBlogWriter(server);
          attachHumanizeAgent(server);
          attachRankingOpportunityFinder(server, {
            apiKey: env.ANTHROPIC_API_KEY,
            workspaceId: env.ANTHROPIC_WORKSPACE_ID,
            dataForSeo,
          });
          attachKeywordFinder(server, { dataForSeo });
          attachAiVisibilityTracker(server, { dataForSeo, ...llmAgentCtx });
          attachBrandSentimentAnalysis(server, { dataForSeo, ...llmAgentCtx });
          attachCompetitorResearch(server, { dataForSeo, ...llmAgentCtx });
          attachPromptResearch(server, { dataForSeo, ...llmAgentCtx });
          attachSerpTracking(server, { dataForSeo, ...searchApiCtx });
          attachBacklinkFinder(server, {
            dataForSeo,
            ...searchApiCtx,
            hunterApiKey: env.HUNTER_API_KEY,
            ...llmAgentCtx,
          });
          attachB2bLeadFinder(server, {
            hunterApiKey: env.HUNTER_API_KEY,
            ...llmAgentCtx,
          });
          attachLocalSeo(server, { ...searchApiCtx, ...llmAgentCtx });
          attachReelsCreation(server, { geminiApiKey: env.GEMINI_API_KEY });
          attachAiOrchestrator(server, {
            apiKey: env.ANTHROPIC_API_KEY,
            workspaceId: env.ANTHROPIC_WORKSPACE_ID,
          });
          attachSiteLogo(server);
          attachScheduler(server);
          attachPublicMcp(server);
          attachEmailOtp(server);
          attachIntegrations(server, {
            apiKey: env.ANTHROPIC_API_KEY,
            workspaceId: env.ANTHROPIC_WORKSPACE_ID,
          });
        },
      },
    ],
    server: { port: 5173 },
    preview: { port: 4173, host: true, allowedHosts: ["app.blazly.ai", "localhost"] },
  };
});
