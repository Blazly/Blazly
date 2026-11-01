import crypto from "crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runSteps } from "../scheduler/runner.js";
import { cancelJob, createJob, listUserJobs } from "../scheduler/index.js";
import { getProjectIntegrations } from "../integrations/store.js";
import { MCP_SERVER_FACTORIES } from "../mcp/servers.js";
import { wpPublishPost } from "../integrations/wordpress.js";
import { webflowPublishPost } from "../integrations/webflow.js";
import { webhookPublishPost } from "../integrations/webhook.js";
import { extractLastBlogArticleFromHistory } from "../../src/chatBlocks.js";

const INLINE_WAIT_MS = 50_000;
const TASK_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_RUNNING_TASKS_PER_USER = 5;

/** In-memory task registry; long agent runs outlive a single tool call. */
const tasks = globalThis.__blazlyMcpTasks || (globalThis.__blazlyMcpTasks = new Map());

function pruneTasks() {
  const now = Date.now();
  for (const [id, task] of tasks) if (now - task.startedAt > TASK_TTL_MS) tasks.delete(id);
}

function text(data) {
  const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text: body.slice(0, 100_000) }] };
}

function errorResult(error) {
  return { content: [{ type: "text", text: `Error: ${error.message || error}` }], isError: true };
}

function lines(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
    .map(([label, value]) => `${label}: ${String(value).trim()}`)
    .join("\n");
}

function taskOutput(task) {
  const messages = task.messages || [];
  const report = messages.filter((m) => m.role === "assistant").map((m) => m.content).join("\n\n---\n\n");
  const latest = extractLastBlogArticleFromHistory(messages);
  const article = latest?.html
    ? {
        title: latest.blogTitle || latest.metaTitle || "",
        meta_description: latest.metaDescription || "",
        slug: latest.urlSlug || "",
        html: latest.html,
      }
    : undefined;
  return { task_id: task.id, status: "done", agent: task.agentId, report, ...(article ? { article } : {}) };
}

function describeTask(task) {
  if (task.status === "done") return taskOutput(task);
  if (task.status === "failed") return { task_id: task.id, status: "failed", agent: task.agentId, error: task.error };
  const seconds = Math.round((Date.now() - task.startedAt) / 1000);
  return {
    task_id: task.id,
    status: "running",
    agent: task.agentId,
    running_for_seconds: seconds,
    next: "Still working. Call get_task_result with this task_id in about 30–60 seconds.",
  };
}

export function createBlazlyMcpServer(account, { baseUrl }) {
  const ctx = {
    uid: account.uid,
    project: account.project,
    website: account.website || "",
    knowledge: account.knowledge || null,
    brandName: account.brandName || "",
    source: "mcp",
  };

  const server = new McpServer(
    { name: "blazly", version: "1.0.0", title: "Blazly" },
    {
      instructions: `Blazly is an AI SEO and content team for the project "${ctx.project}"${ctx.website ? ` (${ctx.website})` : ""}. Use these tools for keyword research, site audits, SEO/GEO blog writing, competitor and AI-visibility research, publishing to the user's connected website, and scheduling recurring work. Long tasks return a task_id: poll get_task_result until status is "done", then share the report with the user.`,
    },
  );

  async function runAgent(agentId, agentMessage) {
    pruneTasks();
    const running = [...tasks.values()].filter((t) => t.uid === ctx.uid && t.status === "running").length;
    if (running >= MAX_RUNNING_TASKS_PER_USER) {
      throw new Error(`You already have ${running} Blazly tasks running. Wait for one to finish (get_task_result) and try again.`);
    }
    const task = {
      id: `task_${crypto.randomBytes(8).toString("hex")}`,
      uid: ctx.uid,
      agentId,
      status: "running",
      startedAt: Date.now(),
    };
    tasks.set(task.id, task);
    task.promise = runSteps([{ agentId, agentMessage }], ctx, { baseUrl })
      .then((messages) => Object.assign(task, { status: "done", messages, finishedAt: Date.now() }))
      .catch((error) => Object.assign(task, { status: "failed", error: error.message, finishedAt: Date.now() }));

    await Promise.race([task.promise, new Promise((resolve) => setTimeout(resolve, INLINE_WAIT_MS))]);
    return text(describeTask(task));
  }

  function agentTool(name, { title, description, inputSchema, agentId, brief }) {
    server.registerTool(
      name,
      { title, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: true } },
      async (args) => {
        try {
          return await runAgent(agentId, brief(args || {}));
        } catch (error) {
          return errorResult(error);
        }
      },
    );
  }

  const websiteArg = z
    .string()
    .optional()
    .describe(ctx.website ? `Website URL. Defaults to the project website (${ctx.website}).` : "Website URL.");
  const site = (value) => value || ctx.website;

  server.registerTool(
    "get_project",
    {
      title: "Get Blazly project",
      description: "Show the Blazly project this connection uses: name, website, brand and which publishing/analytics integrations are connected.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const integrations = await getProjectIntegrations(ctx.uid, ctx.project);
        const connected = Object.fromEntries(
          Object.entries(MCP_SERVER_FACTORIES).map(([id, f]) => [id === "site" ? "custom_website" : id, f.connectedWhen(integrations)]),
        );
        return text({
          project: ctx.project,
          website: ctx.website || null,
          brand: ctx.brandName || null,
          summary: ctx.knowledge?.summary || ctx.knowledge?.description || null,
          integrations: connected,
        });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  agentTool("keyword_research", {
    title: "Keyword research",
    description: "Search volume, keyword difficulty, CPC, trend and related keywords for one keyword.",
    inputSchema: { keyword: z.string().min(2).describe("The keyword to research.") },
    agentId: "keyword-finder",
    brief: (a) => lines({ Keyword: a.keyword }),
  });

  agentTool("site_audit", {
    title: "Website SEO audit",
    description: "Full technical and on-page SEO audit of a website (crawls the sitemap, 200+ checks). Takes several minutes.",
    inputSchema: { website_url: websiteArg },
    agentId: "site-audit",
    brief: (a) => site(a.website_url),
  });

  const blogInput = {
    keyword: z.string().min(2).describe("Primary keyword or topic."),
    word_count: z.number().int().min(500).max(5000).optional(),
    intent: z.string().optional().describe("Search intent, e.g. informational, commercial."),
    target_url: z.string().optional().describe("Page on the site the article should support or link to."),
    notes: z.string().optional().describe("Extra instructions: audience, angle, must-cover points."),
  };
  const blogBrief = (a) =>
    [
      lines({ Keyword: a.keyword, "Word Count": a.word_count, Intent: a.intent, "Target URL": a.target_url || ctx.website }),
      a.notes ? `\n${a.notes}` : "",
    ].join("");

  agentTool("write_seo_blog", {
    title: "Write SEO blog article",
    description:
      "Research and write a long-form, humanized SEO/AEO blog article in the brand's voice. Returns the article (title, meta description, slug, HTML) ready for publish_post. Takes a few minutes.",
    inputSchema: blogInput,
    agentId: "seo-blog-writer",
    brief: blogBrief,
  });

  agentTool("write_geo_blog", {
    title: "Write GEO blog article",
    description:
      "Write a Generative Engine Optimization article built to be cited by ChatGPT, Gemini and Perplexity (citations, FAQs, entity-rich). Returns the article ready for publish_post.",
    inputSchema: blogInput,
    agentId: "geo-blog-writer",
    brief: blogBrief,
  });

  agentTool("humanize_text", {
    title: "Humanize text",
    description: "Rewrite an article or landing page copy so it reads naturally and passes as human-written.",
    inputSchema: { text: z.string().min(50).describe("The full text or HTML to rewrite.") },
    agentId: "humanization",
    brief: (a) => a.text,
  });

  agentTool("find_ranking_opportunities", {
    title: "Find ranking opportunities",
    description: "Find winnable long-tail keywords a website can realistically rank for.",
    inputSchema: { website_url: websiteArg, target_keyword: z.string().optional().describe("Seed keyword or niche.") },
    agentId: "ranking-opportunity-finder",
    brief: (a) => lines({ "Website URL": site(a.website_url), "Target keyword": a.target_keyword }),
  });

  agentTool("find_backlinks", {
    title: "Find backlink prospects",
    description: "Find editorial backlink prospects (sites, pages and angles) for a keyword.",
    inputSchema: { target_keyword: z.string().min(2), website_url: websiteArg },
    agentId: "backlink-finder",
    brief: (a) => lines({ "Target keyword": a.target_keyword, "Website URL": site(a.website_url) }),
  });

  agentTool("serp_tracking", {
    title: "SERP tracking",
    description: "Top ranking pages and keywords for a domain in Google.",
    inputSchema: { website_url: websiteArg },
    agentId: "serp-tracking",
    brief: (a) => lines({ "Website URL": site(a.website_url) }),
  });

  agentTool("ai_visibility", {
    title: "AI visibility tracker",
    description: "How often a website is mentioned in non-branded answers from ChatGPT, Gemini, Perplexity and other AI assistants.",
    inputSchema: { website_url: websiteArg },
    agentId: "ai-visibility-tracker",
    brief: (a) => lines({ "Website URL": site(a.website_url) }),
  });

  agentTool("brand_sentiment", {
    title: "Brand sentiment in AI",
    description: "How AI assistants describe and feel about a brand.",
    inputSchema: { website_url: websiteArg },
    agentId: "brand-sentiment-analysis",
    brief: (a) => lines({ "Website URL": site(a.website_url) }),
  });

  agentTool("competitor_research", {
    title: "Competitor research",
    description: "Compare competitor websites to the user's site on SEO and AI visibility.",
    inputSchema: {
      competitor_urls: z.array(z.string()).min(1).max(5).describe("Competitor website URLs."),
      website_url: websiteArg,
    },
    agentId: "competitor-research",
    brief: (a) => `${a.competitor_urls.join("\n")}\n${lines({ "Website URL": site(a.website_url) })}`,
  });

  agentTool("prompt_research", {
    title: "AI prompt research",
    description: "Estimated AI-search volume for a prompt across ChatGPT, Gemini and others.",
    inputSchema: { prompt: z.string().min(3).describe("The prompt people might ask an AI assistant.") },
    agentId: "prompt-research",
    brief: (a) => lines({ Prompt: a.prompt }),
  });

  agentTool("local_seo_audit", {
    title: "Local SEO audit",
    description: "Google Business Profile audit and local SEO checklist.",
    inputSchema: { business_name: z.string().min(2), google_maps_url: z.string().optional() },
    agentId: "local-seo",
    brief: (a) => lines({ "Business name": a.business_name, "Google Maps URL": a.google_maps_url }),
  });

  agentTool("find_b2b_leads", {
    title: "Find B2B leads",
    description: "Find companies and contacts that match an ideal customer profile.",
    inputSchema: { ideal_customer_profile: z.string().min(20).describe("Who to find: industry, size, location, roles.") },
    agentId: "b2b-lead-finder",
    brief: (a) => lines({ "Ideal customer profile (ICP)": a.ideal_customer_profile }),
  });

  agentTool("search_console_and_analytics", {
    title: "Search Console & GA4 insights",
    description:
      "Answer questions with the project's real Google Search Console and GA4 data (top queries, pages losing clicks, index status, traffic, conversions). Requires Google to be connected in Blazly.",
    inputSchema: { question: z.string().min(5).describe("What to look up, in plain language.") },
    agentId: "site-integrations",
    brief: (a) => a.question,
  });

  server.registerTool(
    "get_task_result",
    {
      title: "Get Blazly task result",
      description: "Check a long-running Blazly task. Returns the report (and article, for blog writers) once status is done.",
      inputSchema: { task_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ task_id }) => {
      const task = tasks.get(task_id);
      if (!task || task.uid !== ctx.uid) return errorResult(new Error("Task not found or expired."));
      if (task.status === "running") {
        await Promise.race([task.promise, new Promise((resolve) => setTimeout(resolve, 25_000))]);
      }
      return text(describeTask(task));
    },
  );

  server.registerTool(
    "publish_post",
    {
      title: "Publish blog post",
      description:
        "Publish an article live (or as a draft) on the project's connected website: WordPress, Webflow or custom site. Pass the article from write_seo_blog / write_geo_blog or your own HTML.",
      inputSchema: {
        title: z.string().min(3),
        html: z.string().min(50).describe("Post body as HTML."),
        meta_description: z.string().optional(),
        slug: z.string().optional(),
        status: z.enum(["publish", "draft"]).optional().describe("Defaults to publish."),
        destination: z.enum(["wordpress", "webflow", "custom_website"]).optional().describe("Needed only if several are connected."),
      },
      annotations: { destructiveHint: false, openWorldHint: true },
    },
    async (args) => {
      try {
        const integrations = await getProjectIntegrations(ctx.uid, ctx.project);
        const connected = {
          wordpress: MCP_SERVER_FACTORIES.wordpress.connectedWhen(integrations),
          webflow: MCP_SERVER_FACTORIES.webflow.connectedWhen(integrations),
          custom_website: MCP_SERVER_FACTORIES.site.connectedWhen(integrations),
        };
        const available = Object.keys(connected).filter((k) => connected[k]);
        if (!available.length) {
          throw new Error(
            `No website is connected to the Blazly project "${ctx.project}". Ask the user to connect WordPress, Webflow or their custom site in Blazly → Integrations.`,
          );
        }
        const destination = args.destination || (available.length === 1 ? available[0] : null);
        if (!destination) throw new Error(`Several websites are connected (${available.join(", ")}). Ask the user which one, then pass destination.`);
        if (!connected[destination]) throw new Error(`${destination} isn't connected for this project. Connected: ${available.join(", ")}.`);
        const input = {
          title: args.title,
          content: args.html,
          excerpt: args.meta_description,
          slug: args.slug,
          status: args.status || "publish",
        };
        const publish = { wordpress: wpPublishPost, webflow: webflowPublishPost, custom_website: webhookPublishPost }[destination];
        return text({ destination, ...(await publish(ctx.uid, ctx.project, input)) });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  const scheduleAgents = {
    keyword_research: "keyword-finder",
    site_audit: "site-audit",
    write_seo_blog: "seo-blog-writer",
    write_geo_blog: "geo-blog-writer",
    find_ranking_opportunities: "ranking-opportunity-finder",
    find_backlinks: "backlink-finder",
    serp_tracking: "serp-tracking",
    ai_visibility: "ai-visibility-tracker",
    brand_sentiment: "brand-sentiment-analysis",
    competitor_research: "competitor-research",
    prompt_research: "prompt-research",
    publish_latest_article: "site-integrations",
    search_console_and_analytics: "site-integrations",
  };

  server.registerTool(
    "schedule_task",
    {
      title: "Schedule Blazly task",
      description:
        "Schedule Blazly work for a future date/time (up to 30 days ahead), once, daily or weekly. Results appear in the user's Blazly app. Chain steps like write_seo_blog then publish_latest_article.",
      inputSchema: {
        title: z.string().min(3).describe("Short name, e.g. 'Weekly keyword check'."),
        run_at: z.string().describe("First run as ISO 8601 with timezone offset, e.g. 2026-11-10T09:00:00+05:30."),
        timezone: z.string().optional().describe("IANA timezone, e.g. Asia/Kolkata."),
        repeat: z.enum(["none", "daily", "weekly"]).optional(),
        repeat_until: z.string().optional().describe("ISO date; max 30 days from now."),
        steps: z
          .array(
            z.object({
              tool: z.enum(Object.keys(scheduleAgents)),
              request: z
                .string()
                .min(2)
                .describe("What this step should do, e.g. 'Keyword: crm software' or 'Publish the latest article live'."),
            }),
          )
          .min(1)
          .max(4),
      },
    },
    async (args) => {
      try {
        const job = await createJob({
          uid: ctx.uid,
          project: ctx.project,
          website: ctx.website,
          brandName: ctx.brandName,
          knowledge: ctx.knowledge,
          title: args.title,
          runAt: args.run_at,
          timezone: args.timezone,
          repeat: args.repeat,
          repeatUntil: args.repeat_until,
          steps: args.steps.map((s) => ({ agentId: scheduleAgents[s.tool], agentMessage: s.request })),
        });
        return text({ scheduled: true, id: job.id, title: job.title, next_run_at: job.nextRunAt, repeat: job.repeat });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "list_scheduled_tasks",
    {
      title: "List scheduled tasks",
      description: "List the project's scheduled Blazly tasks and their recent runs.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const jobs = await listUserJobs(ctx.uid, ctx.project);
        return text(
          jobs.map((j) => ({
            id: j.id,
            title: j.title,
            status: j.status,
            next_run_at: j.nextRunAt,
            repeat: j.repeat,
            steps: j.steps.map((s) => s.agentId),
            last_run: j.runs?.at(-1) ? { status: j.runs.at(-1).status, finished_at: j.runs.at(-1).finishedAt, error: j.runs.at(-1).error } : null,
          })),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  server.registerTool(
    "cancel_scheduled_task",
    {
      title: "Cancel scheduled task",
      description: "Cancel a scheduled Blazly task by id.",
      inputSchema: { id: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      try {
        const job = await cancelJob(ctx.uid, id);
        return text({ cancelled: true, id: job.id, title: job.title });
      } catch (error) {
        return errorResult(error);
      }
    },
  );

  return server;
}
