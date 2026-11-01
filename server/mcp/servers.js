import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getProjectIntegrations } from "../integrations/store.js";
import { wpGetPost, wpListPosts, wpPublishPost, wpUpdatePost } from "../integrations/wordpress.js";
import {
  gscInspectUrl,
  gscListSitemaps,
  gscSearchAnalytics,
  gscSubmitSitemap,
  listGscSites,
} from "../integrations/gsc.js";
import { ga4RunReport, listGa4Properties } from "../integrations/ga4.js";
import { webhookPublishPost, webhookUpdatePost } from "../integrations/webhook.js";
import {
  describeWebflowCollection,
  listWebflowCollections,
  webflowGetPost,
  webflowListPosts,
  webflowPublishPost,
  webflowUpdatePost,
} from "../integrations/webflow.js";

function ok(data) {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2).slice(0, 60_000) }] };
}

function fail(error) {
  return { content: [{ type: "text", text: `Error: ${error.message || error}` }], isError: true };
}

function wrap(handler) {
  return async (args) => {
    try {
      return ok(await handler(args || {}));
    } catch (error) {
      return fail(error);
    }
  };
}

/** ctx: { uid, project, article } — article is the latest Blazly blog draft in the chat, if any. */
export function createWordPressServer(ctx) {
  const server = new McpServer({ name: "blazly-wordpress", version: "1.0.0" });

  server.registerTool(
    "publish_post",
    {
      description:
        "Publish a blog post live on the user's connected WordPress site. Set use_latest_article=true to publish the most recent Blazly-written article from this chat without re-sending its HTML.",
      inputSchema: {
        use_latest_article: z.boolean().optional().describe("Publish the latest article Blazly wrote in this chat."),
        title: z.string().optional().describe("Post title (required unless use_latest_article)."),
        content: z.string().optional().describe("Post HTML (required unless use_latest_article)."),
        slug: z.string().optional(),
        excerpt: z.string().optional().describe("Meta description / excerpt."),
        categories: z.array(z.string()).optional().describe("Category names; created if missing."),
        tags: z.array(z.string()).optional().describe("Tag names; created if missing."),
        status: z.enum(["publish", "draft"]).optional().describe("Defaults to publish."),
      },
    },
    wrap(async (args) => {
      let { title, content, slug, excerpt } = args;
      if (args.use_latest_article) {
        if (!ctx.article?.html) throw new Error("No Blazly article found in this chat to publish.");
        title = title || ctx.article.title;
        content = ctx.article.html;
        slug = slug || ctx.article.slug;
        excerpt = excerpt || ctx.article.metaDescription;
      }
      if (!title || !content) throw new Error("title and content are required.");
      return wpPublishPost(ctx.uid, ctx.project, { ...args, title, content, slug, excerpt });
    }),
  );

  server.registerTool(
    "update_post",
    {
      description: "Update an existing WordPress post (title, HTML content, slug, excerpt, or status).",
      inputSchema: {
        post_id: z.number().int(),
        use_latest_article: z.boolean().optional().describe("Replace the content with the latest Blazly article."),
        title: z.string().optional(),
        content: z.string().optional(),
        slug: z.string().optional(),
        excerpt: z.string().optional(),
        status: z.enum(["publish", "draft", "private"]).optional(),
      },
    },
    wrap(async ({ post_id, use_latest_article, ...rest }) => {
      if (use_latest_article) {
        if (!ctx.article?.html) throw new Error("No Blazly article found in this chat.");
        rest.content = ctx.article.html;
        rest.title = rest.title || ctx.article.title;
      }
      return wpUpdatePost(ctx.uid, ctx.project, post_id, rest);
    }),
  );

  server.registerTool(
    "list_posts",
    {
      description: "List recent posts on the user's WordPress site, optionally filtered by search text.",
      inputSchema: {
        search: z.string().optional(),
        per_page: z.number().int().optional(),
      },
    },
    wrap(({ search, per_page }) => wpListPosts(ctx.uid, ctx.project, { search, perPage: per_page })),
  );

  server.registerTool(
    "get_post",
    {
      description: "Fetch one WordPress post including its HTML content.",
      inputSchema: { post_id: z.number().int() },
    },
    wrap(({ post_id }) => wpGetPost(ctx.uid, ctx.project, post_id)),
  );

  return server;
}

export function createWebflowServer(ctx) {
  const server = new McpServer({ name: "blazly-webflow", version: "1.0.0" });

  server.registerTool(
    "publish_post",
    {
      description:
        "Create a blog post as an item in the user's Webflow CMS blog collection and publish it live. Set use_latest_article=true to publish the most recent Blazly-written article from this chat without re-sending its HTML.",
      inputSchema: {
        use_latest_article: z.boolean().optional().describe("Publish the latest article Blazly wrote in this chat."),
        title: z.string().optional().describe("Post title (required unless use_latest_article)."),
        content: z.string().optional().describe("Post HTML (required unless use_latest_article)."),
        slug: z.string().optional(),
        excerpt: z.string().optional().describe("Summary / meta description."),
        featured_image_url: z.string().optional(),
        extra_fields: z
          .record(z.string(), z.any())
          .optional()
          .describe("Values for other collection fields by field slug (see describe_collection), e.g. required custom fields."),
        status: z.enum(["publish", "draft"]).optional().describe("Defaults to publish (live)."),
        collection_id: z.string().optional().describe("Defaults to the project's selected blog collection."),
      },
    },
    wrap(async (args) => {
      let { title, content, slug, excerpt } = args;
      if (args.use_latest_article) {
        if (!ctx.article?.html) throw new Error("No Blazly article found in this chat to publish.");
        title = title || ctx.article.title;
        content = ctx.article.html;
        slug = slug || ctx.article.slug;
        excerpt = excerpt || ctx.article.metaDescription;
      }
      if (!title || !content) throw new Error("title and content are required.");
      return webflowPublishPost(ctx.uid, ctx.project, { ...args, title, content, slug, excerpt });
    }),
  );

  server.registerTool(
    "update_post",
    {
      description: "Update an existing Webflow CMS blog item (and push the change live unless status is draft).",
      inputSchema: {
        item_id: z.string(),
        use_latest_article: z.boolean().optional().describe("Replace the content with the latest Blazly article."),
        title: z.string().optional(),
        content: z.string().optional(),
        slug: z.string().optional(),
        excerpt: z.string().optional(),
        featured_image_url: z.string().optional(),
        extra_fields: z.record(z.string(), z.any()).optional(),
        status: z.enum(["publish", "draft"]).optional(),
        collection_id: z.string().optional(),
      },
    },
    wrap(async ({ item_id, use_latest_article, ...rest }) => {
      if (use_latest_article) {
        if (!ctx.article?.html) throw new Error("No Blazly article found in this chat.");
        rest.content = ctx.article.html;
        rest.title = rest.title || ctx.article.title;
      }
      return webflowUpdatePost(ctx.uid, ctx.project, item_id, rest);
    }),
  );

  server.registerTool(
    "list_posts",
    {
      description: "List recent items in the Webflow blog collection.",
      inputSchema: { limit: z.number().int().optional(), collection_id: z.string().optional() },
    },
    wrap(({ limit, collection_id }) => webflowListPosts(ctx.uid, ctx.project, { limit, collectionId: collection_id })),
  );

  server.registerTool(
    "get_post",
    {
      description: "Fetch one Webflow blog item including its body HTML.",
      inputSchema: { item_id: z.string(), collection_id: z.string().optional() },
    },
    wrap(({ item_id, collection_id }) => webflowGetPost(ctx.uid, ctx.project, item_id, collection_id)),
  );

  server.registerTool(
    "describe_collection",
    {
      description:
        "Show the blog collection's fields and how Blazly maps title/body/summary/image. Check this if publishing fails on a required field.",
      inputSchema: { collection_id: z.string().optional() },
    },
    wrap(({ collection_id }) => describeWebflowCollection(ctx.uid, ctx.project, collection_id)),
  );

  server.registerTool(
    "list_collections",
    { description: "List CMS collections on the selected Webflow site.", inputSchema: {} },
    wrap(() => listWebflowCollections(ctx.uid, ctx.project)),
  );

  return server;
}

export function createWebhookServer(ctx) {
  const server = new McpServer({ name: "blazly-custom-site", version: "1.0.0" });

  server.registerTool(
    "publish_post",
    {
      description:
        "Publish a blog post on the user's custom-built website via their signed webhook endpoint. Set use_latest_article=true to publish the most recent Blazly-written article from this chat without re-sending its HTML.",
      inputSchema: {
        use_latest_article: z.boolean().optional().describe("Publish the latest article Blazly wrote in this chat."),
        title: z.string().optional().describe("Post title (required unless use_latest_article)."),
        content: z.string().optional().describe("Post HTML (required unless use_latest_article)."),
        slug: z.string().optional(),
        excerpt: z.string().optional().describe("Meta description / excerpt."),
        categories: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        featured_image_url: z.string().optional(),
        status: z.enum(["publish", "draft"]).optional().describe("Defaults to publish."),
      },
    },
    wrap(async (args) => {
      let { title, content, slug, excerpt } = args;
      if (args.use_latest_article) {
        if (!ctx.article?.html) throw new Error("No Blazly article found in this chat to publish.");
        title = title || ctx.article.title;
        content = ctx.article.html;
        slug = slug || ctx.article.slug;
        excerpt = excerpt || ctx.article.metaDescription;
      }
      if (!title || !content) throw new Error("title and content are required.");
      return webhookPublishPost(ctx.uid, ctx.project, { ...args, title, content, slug, excerpt });
    }),
  );

  server.registerTool(
    "update_post",
    {
      description: "Update a post on the user's custom website via webhook. Identify it by id (as returned on publish) or slug.",
      inputSchema: {
        id: z.union([z.string(), z.number()]).optional(),
        slug: z.string().optional(),
        use_latest_article: z.boolean().optional().describe("Replace the content with the latest Blazly article."),
        title: z.string().optional(),
        content: z.string().optional(),
        excerpt: z.string().optional(),
        categories: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        status: z.enum(["publish", "draft", "unpublish"]).optional(),
      },
    },
    wrap(async ({ use_latest_article, ...rest }) => {
      if (use_latest_article) {
        if (!ctx.article?.html) throw new Error("No Blazly article found in this chat.");
        rest.content = ctx.article.html;
        rest.title = rest.title || ctx.article.title;
      }
      return webhookUpdatePost(ctx.uid, ctx.project, rest);
    }),
  );

  return server;
}

async function selectedGoogle(ctx) {
  return (await getProjectIntegrations(ctx.uid, ctx.project)).google || {};
}

export function createSearchConsoleServer(ctx) {
  const server = new McpServer({ name: "blazly-search-console", version: "1.0.0" });

  const siteFor = async (siteUrl) => {
    const chosen = siteUrl || (await selectedGoogle(ctx)).gscSiteUrl;
    if (!chosen) throw new Error("No Search Console property selected. Pick one under Integrations or pass site_url.");
    return chosen;
  };

  server.registerTool(
    "list_sites",
    { description: "List Search Console properties the user can access.", inputSchema: {} },
    wrap(() => listGscSites(ctx.uid, ctx.project)),
  );

  server.registerTool(
    "search_analytics",
    {
      description:
        "Query Search Console performance (clicks, impressions, CTR, average position). Dimensions: query, page, country, device, date.",
      inputSchema: {
        site_url: z.string().optional().describe("Defaults to the project's selected property."),
        dimensions: z.array(z.enum(["query", "page", "country", "device", "date"])).optional(),
        days: z.number().int().optional().describe("Lookback window, default 28."),
        start_date: z.string().optional().describe("YYYY-MM-DD"),
        end_date: z.string().optional().describe("YYYY-MM-DD"),
        query_contains: z.string().optional(),
        page_contains: z.string().optional(),
        row_limit: z.number().int().optional(),
      },
    },
    wrap(async (a) =>
      gscSearchAnalytics(ctx.uid, ctx.project, await siteFor(a.site_url), {
        dimensions: a.dimensions,
        days: a.days,
        startDate: a.start_date,
        endDate: a.end_date,
        query: a.query_contains,
        page: a.page_contains,
        rowLimit: a.row_limit,
      }),
    ),
  );

  server.registerTool(
    "inspect_url",
    {
      description: "Check Google index status, canonical, and last crawl for a URL.",
      inputSchema: { url: z.string(), site_url: z.string().optional() },
    },
    wrap(async ({ url, site_url }) => gscInspectUrl(ctx.uid, ctx.project, await siteFor(site_url), url)),
  );

  server.registerTool(
    "list_sitemaps",
    { description: "List submitted sitemaps and their status.", inputSchema: { site_url: z.string().optional() } },
    wrap(async ({ site_url }) => gscListSitemaps(ctx.uid, ctx.project, await siteFor(site_url))),
  );

  server.registerTool(
    "submit_sitemap",
    {
      description: "Submit or resubmit a sitemap URL to Google (e.g. after publishing new posts).",
      inputSchema: { sitemap_url: z.string(), site_url: z.string().optional() },
    },
    wrap(async ({ sitemap_url, site_url }) =>
      gscSubmitSitemap(ctx.uid, ctx.project, await siteFor(site_url), sitemap_url),
    ),
  );

  return server;
}

export function createAnalyticsServer(ctx) {
  const server = new McpServer({ name: "blazly-ga4", version: "1.0.0" });

  const propertyFor = async (propertyId) => {
    const chosen = propertyId || (await selectedGoogle(ctx)).ga4PropertyId;
    if (!chosen) throw new Error("No GA4 property selected. Pick one under Integrations or pass property_id.");
    return chosen;
  };

  server.registerTool(
    "list_properties",
    { description: "List GA4 properties the user can access.", inputSchema: {} },
    wrap(() => listGa4Properties(ctx.uid, ctx.project)),
  );

  server.registerTool(
    "run_report",
    {
      description:
        "Run a GA4 report. Common dimensions: pagePath, landingPage, sessionDefaultChannelGroup, sessionSource, country, deviceCategory, date. Common metrics: sessions, totalUsers, newUsers, screenPageViews, engagementRate, averageSessionDuration, conversions, keyEvents, totalRevenue.",
      inputSchema: {
        property_id: z.string().optional().describe("Defaults to the project's selected property."),
        dimensions: z.array(z.string()).optional(),
        metrics: z.array(z.string()).optional(),
        days: z.number().int().optional(),
        start_date: z.string().optional().describe("YYYY-MM-DD or NdaysAgo"),
        end_date: z.string().optional(),
        page_path_contains: z.string().optional(),
        order_by: z.string().optional().describe("Metric to sort by, descending."),
        limit: z.number().int().optional(),
      },
    },
    wrap(async (a) =>
      ga4RunReport(ctx.uid, ctx.project, await propertyFor(a.property_id), {
        dimensions: a.dimensions,
        metrics: a.metrics,
        days: a.days,
        startDate: a.start_date,
        endDate: a.end_date,
        pagePathContains: a.page_path_contains,
        orderBy: a.order_by,
        limit: a.limit,
      }),
    ),
  );

  return server;
}

export const MCP_SERVER_FACTORIES = {
  wordpress: { create: createWordPressServer, connectedWhen: (i) => Boolean(i.wordpress?.appPassword) },
  webflow: { create: createWebflowServer, connectedWhen: (i) => Boolean(i.webflow?.accessToken) },
  site: { create: createWebhookServer, connectedWhen: (i) => Boolean(i.webhook?.secret && i.webhook?.verifiedAt) },
  gsc: { create: createSearchConsoleServer, connectedWhen: (i) => Boolean(i.google?.refreshToken) },
  ga4: { create: createAnalyticsServer, connectedWhen: (i) => Boolean(i.google?.refreshToken) },
};
