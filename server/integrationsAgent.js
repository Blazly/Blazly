import { withMcpHub } from "./mcp/hub.js";
import { getProjectIntegrations } from "./integrations/store.js";

const MAX_STEPS = 10;

const TOOL_LABELS = {
  "wordpress__publish_post": "Publishing to WordPress",
  "wordpress__update_post": "Updating WordPress post",
  "wordpress__list_posts": "Reading WordPress posts",
  "wordpress__get_post": "Reading WordPress post",
  "webflow__publish_post": "Publishing to Webflow",
  "webflow__update_post": "Updating Webflow item",
  "webflow__list_posts": "Reading Webflow posts",
  "webflow__get_post": "Reading Webflow post",
  "webflow__describe_collection": "Checking Webflow collection fields",
  "webflow__list_collections": "Listing Webflow collections",
  "site__publish_post": "Publishing to your website",
  "site__update_post": "Updating post on your website",
  "gsc__search_analytics": "Reading Search Console performance",
  "gsc__inspect_url": "Inspecting URL index status",
  "gsc__list_sites": "Listing Search Console properties",
  "gsc__list_sitemaps": "Checking sitemaps",
  "gsc__submit_sitemap": "Submitting sitemap to Google",
  "ga4__run_report": "Running GA4 report",
  "ga4__list_properties": "Listing GA4 properties",
};

export async function runIntegrationsAgent(body, onProgress, ctx) {
  const apiKey = ctx?.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Integrations agent is not configured.");
  const uid = String(body.uid || "").trim();
  const project = String(body.project || "").trim() || "default";
  if (!uid) throw new Error("Sign in to use your website integrations.");

  const integrations = await getProjectIntegrations(uid, project);
  const mcpCtx = { uid, project, article: body.article || null };

  return withMcpHub(mcpCtx, async (hub) => {
    if (!hub.tools.length) {
      return [
        "No website or analytics integrations are connected for this project yet.",
        "",
        "Open **Integrations** in the sidebar to connect **WordPress**, **Webflow** or your **custom website**, **Google Search Console**, and **GA4**, then ask again.",
        "",
        "LINK_ACTION|Open Integrations|/integrations",
      ].join("\n");
    }

    const system = buildSystemPrompt({ integrations, project, website: body.website, article: body.article, hub });
    const messages = [
      ...normalizeHistory(body.messages),
      { role: "user", content: String(body.message || "").trim() || "Continue." },
    ];

    const publishedLinks = [];

    for (let step = 0; step < MAX_STEPS; step += 1) {
      onProgress?.({ type: "progress", phase: "integrations", stage: "thinking", message: step ? "Analyzing results" : "Planning" });
      const response = await anthropic(apiKey, ctx?.workspaceId, {
        model: process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5",
        max_tokens: 8000,
        system,
        tools: hub.tools,
        messages,
      });

      const toolUses = (response.content || []).filter((b) => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || !toolUses.length) {
        const text = (response.content || [])
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
        return finalize(text, publishedLinks);
      }

      messages.push({ role: "assistant", content: response.content });
      const results = [];
      for (const use of toolUses) {
        onProgress?.({
          type: "progress",
          phase: "integrations",
          stage: "tool",
          message: TOOL_LABELS[use.name] || `Running ${use.name.replace("__", " · ")}`,
        });
        const result = await hub.call(use.name, use.input);
        if (!result.isError && /(wordpress|site|webflow)__(publish|update)_post/.test(use.name)) {
          try {
            const post = JSON.parse(result.text);
            if (post.link) publishedLinks.push({ title: post.title, link: post.link });
          } catch {
            /* non-JSON tool output */
          }
        }
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: result.text.slice(0, 50_000),
          ...(result.isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: results });
    }

    return finalize("I reached the step limit for this request. Here's what I completed so far — ask me to continue if you need more.", publishedLinks);
  });
}

function buildSystemPrompt({ integrations, project, website, article, hub }) {
  const google = integrations.google || {};
  const wp = integrations.wordpress;
  const hook = integrations.webhook;
  const wf = integrations.webflow;
  const lines = [
    "You are Blazly's website integrations agent. You act on the user's real website and analytics through tools.",
    `Project: ${project}${website ? ` · Website: ${website}` : ""}`,
    `Connected: ${hub.connected.join(", ")}`,
    wp ? `WordPress site: ${wp.siteUrl}` : "WordPress: not connected",
    hook?.verifiedAt
      ? `Custom website (webhook): ${hook.siteUrl || hook.endpointUrl} — publish with site__publish_post. It cannot list or read existing posts.`
      : "Custom website webhook: not connected",
    wf?.accessToken
      ? wf.collectionId
        ? `Webflow site: ${wf.siteName} (${wf.siteDomain}) · blog collection "${wf.collectionName}" — publish with webflow__publish_post.`
        : "Webflow: connected, no blog collection selected (call webflow__list_collections, or ask the user to pick one under Integrations)."
      : "Webflow: not connected",
    [wp, hook?.verifiedAt, wf?.accessToken].filter(Boolean).length > 1
      ? "More than one publishing destination is connected — ask which one if the user doesn't say."
      : "",
    google.gscSiteUrl ? `Search Console property: ${google.gscSiteUrl}` : google.refreshToken ? "Search Console: connected, no property selected (call gsc__list_sites)" : "",
    google.ga4PropertyId ? `GA4 property: ${google.ga4PropertyId}${google.ga4PropertyName ? ` (${google.ga4PropertyName})` : ""}` : google.refreshToken ? "GA4: connected, no property selected (call ga4__list_properties)" : "",
    article?.html
      ? `A Blazly article is available in this chat: "${article.title || "Untitled"}" (${article.html.length} chars). To publish it, call wordpress__publish_post, webflow__publish_post or site__publish_post with use_latest_article=true — do not paste the HTML.`
      : "No Blazly article is in this chat yet.",
    "",
    "Rules:",
    "- Use tools to get real data; never invent metrics.",
    "- When the user asks to publish, publish live (status publish) unless they say draft. Report the live URL.",
    "- After publishing, if Search Console is connected, resubmit the site's sitemap (usually <site>/wp-sitemap.xml or /sitemap_index.xml for WordPress, /sitemap.xml for Webflow and custom sites — check gsc__list_sitemaps first).",
    "- If a Webflow publish fails on a required field, call webflow__describe_collection and retry with extra_fields filled sensibly.",
    "- If a webhook publish returns no link, say the post was delivered and that the site didn't return a URL.",
    "- If a tool returns an error about a missing connection or property, explain what the user should connect under Integrations.",
    "- Final answer: concise markdown. Lead with the outcome. Use markdown tables for data (max ~15 rows) and end with 2–4 concrete recommendations when analyzing data.",
  ];
  return lines.filter(Boolean).join("\n");
}

function finalize(text, publishedLinks) {
  const out = [text || "Done."];
  if (publishedLinks.length) {
    out.push("");
    for (const post of publishedLinks.slice(0, 2)) {
      out.push(`LINK_ACTION|View "${String(post.title || "post").slice(0, 40)}" live|${post.link}`);
    }
  }
  return out.join("\n");
}

function normalizeHistory(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .filter((m) => (m?.role === "user" || m?.role === "assistant") && String(m.content || "").trim())
    .slice(-8)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 6000) }))
    .filter((m, i, arr) => !(i === 0 && m.role === "assistant") && !(i === arr.length - 1 && m.role === "user"));
}

async function anthropic(apiKey, workspaceId, payload) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      ...(workspaceId ? { "anthropic-workspace-id": workspaceId } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(180_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "Integrations agent failed.");
  return data;
}
