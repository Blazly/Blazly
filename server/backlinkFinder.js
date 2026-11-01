import { readJson } from "./readJson.js";
import { normalizeDomain } from "./dataforseo.js";
import { fetchGoogleRankTrackingSerp } from "./searchApi.js";
import { hunterDomainSearch, pickMarketingContact } from "./hunter.js";
import { modelForEffortTier } from "./modelRouter.js";

const CLAUDE_MODEL = () => process.env.ANTHROPIC_MODEL?.trim() || "claude-opus-5-5";
const MAX_QUERIES = 6;
const MAX_BLOGS = 15;
const MAX_SERP_ROWS = 100;

const NON_BLOG_HOST =
  /^(google|youtube|facebook|instagram|linkedin|twitter|x|reddit|quora|pinterest|tiktok|amazon|wikipedia|apple|microsoft|github)\./i;

export function attachBacklinkFinder(server, ctx) {
  server.middlewares.use(async (req, res, next) => {
    const [pathOnly, query = ""] = (req.url || "").split("?");
    if (pathOnly !== "/api/backlink-finder") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      const body = await readJson(req);
      if (!ctx?.searchApiKey) throw new Error("Backlink finder is not available for this workspace yet.");
      if (!ctx?.hunterApiKey) throw new Error("Contact lookup is not available for this workspace yet.");
      if (!ctx?.apiKey) throw new Error("Backlink analysis is not available for this workspace yet.");
      if (stream) {
        await streamBacklinkJob(body, res, ctx);
        return;
      }
      const content = await runBacklinkFinderJob(body, () => {}, ctx);
      sendJson(res, 200, { content });
    } catch (error) {
      if (stream) {
        writeSse(res, { type: "error", error: sanitizeError(error.message) });
        res.end();
        return;
      }
      sendJson(res, 500, { error: sanitizeError(error.message) });
    }
  });
}

async function streamBacklinkJob(body, res, ctx) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (payload) => writeSse(res, payload);
  try {
    const content = await runBacklinkFinderJob(body, emit, ctx);
    emit({ type: "complete", content });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: sanitizeError(error.message) });
    res.end();
  }
}

export async function runBacklinkFinderJob(body, onProgress, ctx) {
  const parsed = parseBacklinkBrief(body.message, body.website, body.knowledge);
  const targetKeyword = parsed.targetKeyword;
  const userDomain = normalizeDomain(parsed.website || body.website);
  if (!targetKeyword) {
    throw new Error("Enter a target keyword in the composer (Target keyword:) to find backlink opportunities.");
  }

  const competitorDomains = collectCompetitorDomains(parsed, body.knowledge, userDomain);

  onProgress?.({
    type: "progress",
    phase: "backlink_finder",
    stage: "expand",
    message: "Building keyword variations",
  });

  const queries = await expandSearchQueries(targetKeyword, ctx);
  const queryList = [...new Set([targetKeyword, ...queries])].slice(0, MAX_QUERIES);

  onProgress?.({
    type: "progress",
    phase: "backlink_finder",
    stage: "serp",
    message: "Pulling Google results",
  });

  const serpByUrl = new Map();
  for (const query of queryList) {
    onProgress?.({
      type: "progress",
      phase: "backlink_finder",
      stage: "serp",
      message: `SERP for “${query.slice(0, 48)}”`,
    });
    try {
      const rows = await fetchGoogleRankTrackingSerp({
        apiKey: ctx.searchApiKey,
        query,
        location: ctx.searchApiLocation,
        num: MAX_SERP_ROWS,
      });
      for (const row of rows) {
        if (!row.link) continue;
        const key = row.link.split("#")[0].toLowerCase();
        if (!serpByUrl.has(key)) serpByUrl.set(key, { ...row, matched_queries: [query] });
        else serpByUrl.get(key).matched_queries.push(query);
      }
    } catch {
      // continue other queries
    }
  }

  const serpRows = [...serpByUrl.values()].slice(0, MAX_SERP_ROWS);
  if (!serpRows.length) {
    throw new Error("No search results came back for this keyword. Try a broader phrase.");
  }

  onProgress?.({
    type: "progress",
    phase: "backlink_finder",
    stage: "filter",
    message: "Filtering blogs and removing competitors",
  });

  const blogs = await filterBlogProspectsWithClaude(
    {
      targetKeyword,
      userDomain,
      competitorDomains,
      serpRows: serpRows.map((row) => ({
        title: row.title,
        url: row.link,
        domain: row.domain,
        snippet: row.snippet,
        position: row.position,
      })),
    },
    ctx,
  );

  const blogList = blogs.slice(0, MAX_BLOGS);
  if (!blogList.length) {
    throw new Error(
      "No editorial blog opportunities remained after filtering. Try a more specific keyword or a different niche.",
    );
  }

  onProgress?.({
    type: "progress",
    phase: "backlink_finder",
    stage: "contacts",
    message: "Finding marketing contacts",
  });

  const outreachRows = [];
  for (const blog of blogList) {
    onProgress?.({
      type: "progress",
      phase: "backlink_finder",
      stage: "hunter",
      message: `Contacts at ${blog.company_domain || blog.domain}`,
    });
    const companyDomain = normalizeDomain(blog.company_domain || blog.domain);
    if (!companyDomain) continue;

    let contact = null;
    try {
      const emails = await hunterDomainSearch({
        apiKey: ctx.hunterApiKey,
        domain: companyDomain,
        department: "marketing",
        limit: 8,
      });
      contact = pickMarketingContact(emails);
    } catch {
      contact = null;
    }

    outreachRows.push({
      blog_url: blog.url,
      blog_title: blog.title || "—",
      company: blog.company_name || companyDomain,
      company_domain: companyDomain,
      contact_name: contact
        ? [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "—"
        : "—",
      contact_title: contact?.position || "—",
      contact_email: contact?.email || "—",
      serp_position: blog.position ?? "—",
    });

    await sleep(120);
  }

  return formatBacklinkReply({
    targetKeyword,
    userDomain,
    queryCount: queryList.length,
    serpCount: serpRows.length,
    blogCount: outreachRows.length,
    rows: outreachRows,
  });
}

function collectCompetitorDomains(parsed, knowledge, userDomain) {
  const domains = new Set();
  for (const value of parsed.competitors || []) {
    const d = normalizeDomain(value);
    if (d) domains.add(d);
  }
  if (Array.isArray(knowledge?.competitors)) {
    for (const row of knowledge.competitors) {
      const url = typeof row === "string" ? row : row?.url || row?.website || row?.domain;
      const d = normalizeDomain(url);
      if (d) domains.add(d);
    }
  }
  if (userDomain) domains.delete(userDomain);
  return [...domains];
}

async function expandSearchQueries(keyword, ctx) {
  const heuristic = buildHeuristicQueries(keyword);
  try {
    const fromClaude = await claudeJson(
      ctx,
      `You expand SEO outreach keyword research. Given a target keyword, return JSON only:
{"queries":["6-8 unique Google queries including semantic paraphrases, question forms, and common prefix/suffix variants (best, guide, how to, vs, tools, examples). Do not repeat the exact seed verbatim more than once."]}
Seed keyword: ${keyword}`,
    );
    const list = Array.isArray(fromClaude?.queries) ? fromClaude.queries : [];
    return [...new Set([...list.map((q) => String(q).trim()).filter(Boolean), ...heuristic])].slice(0, 8);
  } catch {
    return heuristic;
  }
}

function buildHeuristicQueries(keyword) {
  const seed = String(keyword || "").trim();
  if (!seed) return [];
  const base = seed.replace(/\?+$/, "").trim();
  const variants = new Set([
    `best ${base}`,
    `${base} guide`,
    `how to ${base}`,
    `${base} tips`,
    `${base} examples`,
    `what is ${base}`,
    `${base} tools`,
    `${base} strategy`,
  ]);
  return [...variants].slice(0, 6);
}

async function filterBlogProspectsWithClaude(payload, ctx) {
  const system = `You are Blazly's Backlink Finder. From Google SERP rows, pick editorial blog/article pages suitable for outreach (guest posts, mentions, resource links).

Remove:
- The user's own domain and obvious commercial competitors (direct SEO/product rivals in the same space).
- Homepages, product landing pages, app stores, docs, forums, social posts, news wires, and pure aggregators.
- Domains listed in competitor_domains.

Keep only blog-style URLs (/blog/, /articles/, /post/, substack, medium articles, editorial guides on company blogs).

Return JSON only:
{"blogs":[{"url":"https://...","title":"...","domain":"example.com","company_name":"Brand name","company_domain":"example.com","position":1,"reason":"short"}]}

Max 18 blogs, best editorial fit first. Never include competitor_domains or user_domain.`;

  const userContent = JSON.stringify(payload, null, 2).slice(0, 48000);
  const parsed = await claudeJson(ctx, userContent, system);
  const blogs = Array.isArray(parsed?.blogs) ? parsed.blogs : [];

  return blogs
    .map((row) => ({
      url: String(row.url || "").trim(),
      title: String(row.title || "").trim(),
      domain: normalizeDomain(row.domain || row.url),
      company_name: String(row.company_name || "").trim(),
      company_domain: normalizeDomain(row.company_domain || row.domain || row.url),
      position: Number(row.position) || null,
      reason: String(row.reason || "").trim(),
    }))
    .filter((row) => row.url && looksLikeBlogUrl(row.url))
    .filter((row) => !payload.competitorDomains.includes(row.company_domain))
    .filter((row) => !payload.userDomain || row.company_domain !== payload.userDomain);
}

function looksLikeBlogUrl(url) {
  const hay = String(url || "").toLowerCase();
  if (!hay.startsWith("http")) return false;
  if (NON_BLOG_HOST.test(hay.replace(/^https?:\/\/(www\.)?/, ""))) return false;
  return (
    /\/(blog|blogs|article|articles|post|posts|news|insights|resources|learn|guides|stories)\//.test(hay) ||
    /medium\.com|substack\.com|wordpress\.com|blogspot\./.test(hay)
  );
}

async function claudeJson(ctx, userContent, systemOverride) {
  const model = modelForEffortTier("max").model || CLAUDE_MODEL();
  const system =
    systemOverride ||
    "Reply with JSON only, no markdown fences.";

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ctx.apiKey,
      "anthropic-version": "2023-06-01",
      ...(ctx.workspaceId ? { "anthropic-workspace-id": ctx.workspaceId } : {}),
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: userContent }],
    }),
    signal: AbortSignal.timeout(240_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || "Analysis failed.");
  }

  const text = (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  return extractJson(text);
}

function formatBacklinkReply({ targetKeyword, userDomain, queryCount, serpCount, blogCount, rows }) {
  const lines = [];
  lines.push(
    `Backlink outreach list for “${targetKeyword}”: editorial blogs from live Google results (competitors removed), with a marketing contact when available.`,
  );
  lines.push("");
  lines.push("METRICS_START");
  lines.push(`Target keyword|${targetKeyword.replace(/\|/g, "/")}`);
  if (userDomain) lines.push(`Your domain|${userDomain}`);
  lines.push(`Search queries scanned|${queryCount}`);
  lines.push(`Unique SERP URLs|${serpCount}`);
  lines.push(`Blog prospects|${blogCount}`);
  lines.push(
    `Contacts found|${rows.filter((row) => row.contact_email && row.contact_email !== "—").length}`,
  );
  lines.push("METRICS_END");
  lines.push("");
  lines.push("TABLE_START");
  lines.push("Blog URL|Article title|Company|Marketing contact|Email|Role");
  for (const row of rows) {
    lines.push(
      `${row.blog_url}|${row.blog_title.replace(/\|/g, "/")}|${row.company.replace(/\|/g, "/")}|${row.contact_name}|${row.contact_email}|${row.contact_title.replace(/\|/g, "/")}`,
    );
  }
  lines.push("TABLE_END");
  lines.push("");
  lines.push(
    "Use these contacts for polite, personalized outreach: reference their article, explain why your resource helps their readers, and ask for a contextual link—not a bulk template blast.",
  );
  return lines.join("\n");
}

function parseBacklinkBrief(message, explicitWebsite, knowledge) {
  const raw = String(message || "").trim();
  let website = String(explicitWebsite || "").trim();
  let targetKeyword = "";
  const competitors = [];

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const siteMatch = trimmed.match(/^website\s*url\s*:\s*(.*)$/i);
    if (siteMatch) {
      website = siteMatch[1].trim() || website;
      continue;
    }
    const kwMatch =
      trimmed.match(/^target\s*keyword\s*:\s*(.+)$/i) || trimmed.match(/^keyword\s*:\s*(.+)$/i);
    if (kwMatch) targetKeyword = kwMatch[1].trim();
  }

  if (!targetKeyword && raw && !/^target\s*keyword\s*:/im.test(raw)) {
    const first = raw.split("\n")[0]?.trim();
    if (first && first.length >= 3) targetKeyword = first;
  }

  if (!website) {
    const urlMatch = raw.match(/https?:\/\/[^\s<>"']+/i);
    if (urlMatch) website = urlMatch[0];
  }

  return { website, targetKeyword: targetKeyword.slice(0, 120), competitors };
}

function extractJson(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeError(message) {
  return String(message || "Backlink finder failed.")
    .replace(/searchapi|hunter\.io|hunter/gi, "provider")
    .replace(/anthropic|claude/gi, "assistant");
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}


function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}
