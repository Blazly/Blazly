import { currentPlan } from "./billing/entitlements.js";
import { auditPageLimit } from "../src/plans.js";
import { readJson } from "./readJson.js";
import { blazlyLayoutPrompt } from "./auditLayoutPrompt.js";
import { FETCH_HEADERS, loadPage, normalizeWebsite } from "./analyze.js";
import { executeDataForSeoTool } from "./dataforseo.js";
import { runExtensiveSiteAudit } from "./site-audit-extensive.js";

const maxPages = () => auditPageLimit(currentPlan());
const CRAWL_CONCURRENCY = 4;
const SECONDS_PER_PAGE = 3.5;

export function attachSiteAudit(server, { dataForSeo, apiKey, model }) {
  const anthropic = { apiKey, model };
  server.middlewares.use(async (req, res, next) => {
    const [path, query = ""] = (req.url || "").split("?");
    if (path !== "/api/site-audit") return next();
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "Method not allowed" });
      return;
    }
    const stream = new URLSearchParams(query).get("stream") === "1";
    try {
      const body = await readJson(req);
      const website = normalizeWebsite(body.url || body.website);
      if (stream) {
        await streamSiteAudit(website, dataForSeo, res, anthropic);
        return;
      }
      const report = await runSiteAudit(website, dataForSeo, () => {}, anthropic);
      sendJson(res, 200, report);
    } catch (error) {
      if (stream) {
        writeSse(res, { type: "error", error: error.message || "Site audit failed." });
        res.end();
        return;
      }
      sendJson(res, error.status || 500, { error: error.message || "Site audit failed." });
    }
  });
}

async function streamSiteAudit(website, dataForSeo, res, anthropic = {}) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const emit = (payload) => writeSse(res, payload);

  try {
    const report = await runSiteAudit(website, dataForSeo, emit, anthropic);
    const content = await formatSiteAuditMessage(report, anthropic);
    emit({ type: "complete", content, report });
    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    emit({ type: "error", error: error.message || "Site audit failed." });
    res.end();
  }
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function runSiteAudit(website, dataForSeo, onProgress, anthropic = {}) {
  return runExtensiveSiteAudit(website, {
    dataForSeo,
    apiKey: anthropic.apiKey,
    model: anthropic.model,
    onProgress,
    fetchOffPageScore,
  });
}

function estimateEta(remainingPages) {
  return Math.max(15, Math.ceil(12 + remainingPages * SECONDS_PER_PAGE + 18));
}

async function discoverPageUrls(website, onProgress) {
  const origin = new URL(website).origin;
  const seen = new Set();
  const add = (href) => {
    try {
      const url = new URL(href, origin);
      if (url.origin !== origin) return;
      if (!/^https?:$/i.test(url.protocol)) return;
      url.hash = "";
      const path = url.pathname.toLowerCase();
      if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|mp4|mp3|css|js|xml|json)(\?|$)/i.test(path)) return;
      const normalized = stripSlash(url.toString());
      if (!seen.has(normalized)) seen.add(normalized);
    } catch {
      // skip
    }
  };

  add(website);

  const robotsText = await fetchText(`${origin}/robots.txt`).catch(() => "");
  const sitemapHints = [
    ...robotsText.matchAll(/^sitemap:\s*(.+)$/gim),
  ].map((match) => match[1].trim());

  const sitemapCandidates = unique([
    ...sitemapHints,
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
  ]);

  for (const sitemapUrl of sitemapCandidates.slice(0, 8)) {
    onProgress?.({
      type: "progress",
      phase: "sitemap",
      message: "Parsing sitemap",
      current: seen.size,
      total: seen.size,
      etaSeconds: estimateEta(Math.min(seen.size, maxPages())),
    });
    const xml = await fetchText(sitemapUrl);
    if (!xml || !/<urlset|<sitemapindex/i.test(xml)) continue;
    const locs = parseSitemapLocs(xml);
    if (/<sitemapindex/i.test(xml)) {
      for (const child of locs.slice(0, 24)) {
        const childXml = await fetchText(child);
        for (const loc of parseSitemapLocs(childXml)) add(loc);
        onProgress?.({
          type: "progress",
          phase: "sitemap",
          message: "Parsing sitemap",
          current: seen.size,
          total: seen.size,
          etaSeconds: estimateEta(Math.min(seen.size, maxPages())),
        });
      }
    } else {
      for (const loc of locs) add(loc);
    }
    if (seen.size > 1) break;
  }

  if (seen.size <= 1) {
    try {
      const home = await loadPage(website);
      add(home.url);
      const linkPattern = /<a\b[^>]*href=["']([^"']+)["']/gi;
      let match = linkPattern.exec(home.html);
      while (match) {
        add(new URL(match[1], home.url).toString());
        match = linkPattern.exec(home.html);
      }
    } catch {
      // homepage only
    }
  }

  const total = seen.size;
  onProgress?.({
    type: "progress",
    phase: "sitemap",
    message: `Found ${total} page${total === 1 ? "" : "s"}`,
    current: 0,
    total,
    totalToAudit: Math.min(total, maxPages()),
    etaSeconds: estimateEta(Math.min(total, maxPages())),
  });

  return [...seen];
}

function parseSitemapLocs(xml) {
  return [...String(xml || "").matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/gi)].map((match) => match[1].trim());
}

async function auditPageUrl(url) {
  const checks = { onPage: [], technical: [] };
  let status = 0;
  let finalUrl = url;
  let html = "";

  try {
    const page = await loadPage(url);
    status = page.status;
    finalUrl = page.url;
    html = page.html || "";
  } catch {
    status = 0;
    html = "";
  }

  const onPage = scoreOnPage(html, finalUrl, checks);
  const technical = scoreTechnical(html, finalUrl, status, checks);
  const score = Math.round(onPage.score * 0.5 + technical.score * 0.5);

  return {
    url: stripSlash(finalUrl),
    status,
    score,
    onPageScore: onPage.score,
    technicalScore: technical.score,
    checks: [...checks.onPage, ...checks.technical],
    title: onPage.title,
    wordCount: onPage.wordCount,
  };
}

function scoreOnPage(html, pageUrl, checks) {
  let earned = 0;
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const titleLen = title.length;
  if (titleLen >= 30 && titleLen <= 60) {
    earned += 12;
    pass(checks, "onPage", "Title length", "Title is in a healthy length range (30–60 characters).");
  } else if (titleLen > 0) {
    earned += 5;
    warn(checks, "onPage", "Title length", `Title is ${titleLen} characters. Aim for 30–60.`, "Rewrite the title tag to 30–60 characters with the primary topic and brand.");
  } else {
    fail(checks, "onPage", "Title tag", "Missing <title>.", "Add a unique title tag describing this page.");
  }

  const description = metaContent(html, "description") || metaContent(html, "og:description");
  const descLen = description.length;
  if (descLen >= 120 && descLen <= 160) {
    earned += 12;
    pass(checks, "onPage", "Meta description", "Length looks good (120–160 characters).");
  } else if (descLen > 0) {
    earned += 6;
    warn(checks, "onPage", "Meta description", `Meta description is ${descLen} characters.`, "Adjust meta description to ~120–160 characters with a clear value prop and CTA.");
  } else {
    fail(checks, "onPage", "Meta description", "Missing meta description.", "Add a unique meta description for this URL.");
  }

  const h1s = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => stripTags(m[1]).trim()).filter(Boolean);
  if (h1s.length === 1) {
    earned += 14;
    pass(checks, "onPage", "H1", "Exactly one H1 on the page.");
  } else if (h1s.length > 1) {
    earned += 6;
    warn(checks, "onPage", "H1", `${h1s.length} H1 tags found.`, "Use a single H1; demote extras to H2/H3.");
  } else {
    fail(checks, "onPage", "H1", "No H1 found.", "Add one descriptive H1 matching the page intent.");
  }

  const h2Count = (html.match(/<h2\b/gi) || []).length;
  if (h2Count >= 2) {
    earned += 8;
    pass(checks, "onPage", "Subheadings", "Page uses H2 structure for sections.");
  } else {
    earned += 3;
    warn(checks, "onPage", "Subheadings", "Few or no H2 tags.", "Break content into sections with keyword-aware H2s.");
  }

  const bodyText = htmlToText(html);
  const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 400) {
    earned += 14;
    pass(checks, "onPage", "Content depth", `${wordCount} words — solid depth.`);
  } else if (wordCount >= 150) {
    earned += 8;
    warn(checks, "onPage", "Content depth", `Only ~${wordCount} words.`, "Expand useful copy (FAQs, proof, specifics) to at least ~400 words where appropriate.");
  } else {
    earned += 2;
    fail(checks, "onPage", "Content depth", `Thin content (~${wordCount} words).`, "Add substantive copy or consolidate thin URLs.");
  }

  const images = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  const missingAlt = images.filter((tag) => !/\balt=["'][^"']+["']/i.test(tag)).length;
  if (!images.length) {
    earned += 6;
    pass(checks, "onPage", "Images", "No images to check.");
  } else if (missingAlt === 0) {
    earned += 10;
    pass(checks, "onPage", "Image alt text", "All images include alt text.");
  } else {
    earned += 4;
    warn(checks, "onPage", "Image alt text", `${missingAlt} image(s) missing alt.`, "Add descriptive alt text to every meaningful image.");
  }

  const internalLinks = countInternalLinks(html, pageUrl);
  if (internalLinks >= 5) {
    earned += 10;
    pass(checks, "onPage", "Internal links", `${internalLinks} internal links found.`);
  } else if (internalLinks >= 1) {
    earned += 5;
    warn(checks, "onPage", "Internal links", `Only ${internalLinks} internal link(s).`, "Link to related pages, docs, and money pages from this URL.");
  } else {
    fail(checks, "onPage", "Internal links", "No internal links detected.", "Add contextual internal links to important site pages.");
  }

  return { score: Math.min(100, earned), title, wordCount };
}

function scoreTechnical(html, pageUrl, status, checks) {
  let earned = 0;
  const url = new URL(pageUrl);

  if (status >= 200 && status < 300) {
    earned += 18;
    pass(checks, "technical", "HTTP status", `Returns ${status}.`);
  } else if (status >= 300 && status < 400) {
    earned += 10;
    warn(checks, "technical", "HTTP status", `Redirect (${status}).`, "Ensure final URL is canonical and returns 200.");
  } else {
    fail(checks, "technical", "HTTP status", status ? `Error status ${status}.` : "Could not fetch page.", "Fix server errors or broken URLs.");
  }

  if (url.protocol === "https:") {
    earned += 12;
    pass(checks, "technical", "HTTPS", "Served over HTTPS.");
  } else {
    fail(checks, "technical", "HTTPS", "Not HTTPS.", "Force HTTPS across the site.");
  }

  const canonical = metaContent(html, "canonical") || linkRel(html, "canonical");
  if (canonical) {
    earned += 10;
    pass(checks, "technical", "Canonical", "Canonical URL is set.");
  } else {
    earned += 4;
    warn(checks, "technical", "Canonical", "No canonical tag.", "Add rel=canonical pointing to the preferred URL.");
  }

  if (metaContent(html, "viewport")) {
    earned += 10;
    pass(checks, "technical", "Mobile viewport", "Viewport meta present.");
  } else {
    fail(checks, "technical", "Mobile viewport", "Missing viewport meta.", "Add `<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">`.");
  }

  const robotsMeta = metaContent(html, "robots");
  if (robotsMeta && /noindex/i.test(robotsMeta)) {
    earned += 0;
    fail(checks, "technical", "Indexability", "Page is noindex.", "Remove noindex if this page should rank.");
  } else {
    earned += 12;
    pass(checks, "technical", "Indexability", "Not blocked by noindex.");
  }

  if (/<html[^>]*\blang=/i.test(html)) {
    earned += 8;
    pass(checks, "technical", "Language", "HTML lang attribute set.");
  } else {
    warn(checks, "technical", "Language", "Missing lang on <html>.", "Set lang=\"en\" (or appropriate locale) on the html element.");
    earned += 3;
  }

  if (/<script[^>]*type=["']application\/ld\+json["']/i.test(html)) {
    earned += 10;
    pass(checks, "technical", "Structured data", "JSON-LD detected.");
  } else {
    earned += 4;
    warn(checks, "technical", "Structured data", "No JSON-LD found.", "Add Organization, WebPage, or Product schema where relevant.");
  }

  if (/<meta[^>]+charset=/i.test(html)) {
    earned += 8;
    pass(checks, "technical", "Charset", "Charset declared.");
  } else {
    earned += 3;
    warn(checks, "technical", "Charset", "Charset not found.", "Declare UTF-8 charset in the head.");
  }

  const htmlSizeKb = Math.round(html.length / 1024);
  if (htmlSizeKb <= 800) {
    earned += 12;
    pass(checks, "technical", "HTML weight", `~${htmlSizeKb} KB HTML.`);
  } else {
    earned += 5;
    warn(checks, "technical", "HTML weight", `Heavy HTML (~${htmlSizeKb} KB).`, "Trim unused scripts/markup and defer non-critical JS.");
  }

  return { score: Math.min(100, earned) };
}

async function fetchOffPageScore(domain, config) {
  const empty = {
    score: 50,
    domain,
    domainRank: null,
    backlinks: null,
    referringDomains: null,
    spamScore: null,
    note: "Off-page score uses site defaults (backlink data unavailable).",
  };
  if (!config?.login || !config?.password || !domain) return empty;

  try {
    const raw = await executeDataForSeoTool("dataforseo_backlinks_summary_live", { target: domain }, config);
    const data = JSON.parse(raw);
    if (data?.error) return empty;
    const rank = num(data?.rank) ?? num(data?.domain_rank);
    const backlinks = num(data?.backlinks);
    const referringDomains = num(data?.referring_domains);
    const spamScore = num(data?.backlinks_spam_score ?? data?.spam_score);

    let score = 35;
    if (rank != null) score += Math.min(40, Math.round((rank / 1000) * 40));
    if (referringDomains != null) score += Math.min(15, Math.round(Math.log10(referringDomains + 1) * 5));
    if (backlinks != null) score += Math.min(10, Math.round(Math.log10(backlinks + 1) * 3));
    if (spamScore != null && spamScore > 30) score -= Math.min(15, Math.round((spamScore - 30) / 2));

    return {
      score: Math.max(0, Math.min(100, Math.round(score))),
      domain,
      domainRank: rank,
      backlinks,
      referringDomains,
      spamScore,
      note: "",
    };
  } catch {
    return empty;
  }
}

function collectFixes(pages, offPage) {
  const fixes = [];
  for (const page of pages) {
    for (const check of page.checks) {
      if (check.status === "fail" || check.status === "warn") {
        fixes.push({
          severity: check.status === "fail" ? "high" : "medium",
          page: page.url,
          issue: check.label,
          detail: check.detail,
          fix: check.fix || check.detail,
        });
      }
    }
  }
  if (offPage.domainRank != null && offPage.domainRank < 200) {
    fixes.push({
      severity: "medium",
      page: offPage.domain || "Site-wide",
      issue: "Domain strength",
      detail: `Domain strength score is ${offPage.domainRank} (0–1000 scale).`,
      fix: "Earn links from relevant publications, directories, and partners; fix unlinked brand mentions.",
    });
  }
  fixes.sort((a, b) => (a.severity === "high" ? -1 : 1) - (b.severity === "high" ? -1 : 1));
  return fixes.slice(0, 40);
}

function auditSummarySentence(report) {
  const discovered = report.totalDiscovered ?? report.pageCount;
  const audited = report.pageCount;
  const cap = report.auditCap ?? 100;
  const checks = report.auditSpec?.checkCount ?? 209;
  const categories = report.auditSpec?.categoryCount ?? 19;
  const aiNote = report.siteContextSummary
    ? ` **${checks} checks** in **${categories} categories** per page; Claude review on **${report.siteContextSummary.aiReviewPages}** priority URLs; PageSpeed (mobile + desktop) on **${report.siteContextSummary.speedPages}** URLs.`
    : "";
  if (discovered > audited) {
    return `Found **${discovered}** URLs · audited **${audited}** (cap **${cap}**).${aiNote} Site score **${report.siteScore}/100** — weighted page buckets (Excellent 90+, Good 75+, Needs work 50+) plus off-page authority.`;
  }
  return `Audited **${audited}** page${audited === 1 ? "" : "s"} (max **${cap}** per run).${aiNote} Site score **${report.siteScore}/100**.`;
}

function themeRowsFromFixes(fixes) {
  const counts = new Map();
  for (const fix of fixes) {
    counts.set(fix.issue, (counts.get(fix.issue) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([issue, count]) => `${issue}|${count} page${count === 1 ? "" : "s"} affected`);
}

function buildPagesScoreTableBlock(report) {
  const pages = [...(report.pages || [])].sort(
    (a, b) => a.score - b.score || String(a.url).localeCompare(String(b.url)),
  );
  if (!pages.length) return "";
  const lines = ["TABLE_START", "Page|Score|Grade|On-page|Technical"];
  for (const page of pages) {
    lines.push(
      `${page.url}|${page.score}|${page.grade || "—"}|${page.onPageScore}|${page.technicalScore}`,
    );
  }
  lines.push("TABLE_END");
  return lines.join("\n");
}

function injectFullPageTable(text, report) {
  const block = buildPagesScoreTableBlock(report);
  if (!block) return text;
  if (/TABLE_START[\s\S]*?TABLE_END/.test(text)) {
    return text.replace(/TABLE_START[\s\S]*?TABLE_END/, block);
  }
  if (/^ACTION\|/m.test(text)) {
    return text.replace(/^ACTION\|/m, `${block}\n\nACTION|`);
  }
  return `${text.trim()}\n\n${block}`;
}

function buildAuditCenterBlock(report) {
  const domain = report.domain;
  const lines = [];
  if (report.fixes?.length) {
    lines.push(`WORKPANE|audit|Site audit — ${domain}`);
    lines.push("");
  }
  lines.push(auditSummarySentence(report));
  lines.push("");
  lines.push("METRICS_START");
  lines.push(`Site score|${report.siteScore}/100`);
  lines.push(`Avg page score|${report.avgPageScore}/100`);
  lines.push(`Off-page score|${report.offPageScore}/100`);
  if (report.auditSpec) {
    lines.push(`Checks per page|${report.auditSpec.checkCount} (${report.auditSpec.categoryCount} categories)`);
    lines.push(`Pages this run|${report.pageCount}/${report.auditCap}`);
  }
  if (report.offPage.domainRank != null) lines.push(`Domain strength|${report.offPage.domainRank}`);
  if (report.offPage.referringDomains != null) lines.push(`Referring domains|${report.offPage.referringDomains}`);
  if (report.offPage.backlinks != null) lines.push(`Backlinks|${report.offPage.backlinks}`);
  lines.push("METRICS_END");
  lines.push("");
  const themes = themeRowsFromFixes(report.fixes);
  if (themes.length) {
    lines.push("CARD_START|What's holding SEO & GEO back");
    for (const row of themes) lines.push(row);
    lines.push("CARD_END");
    lines.push("");
  }
  const table = buildPagesScoreTableBlock(report);
  if (table) {
    lines.push(table);
    lines.push("");
  }
  lines.push(`ACTION|Re-run audit after fixes|Audit ${report.website}`);
  return lines.join("\n");
}

function buildAuditSidebarBlock(report) {
  if (!report.fixes?.length) return "";
  const lines = ["SIDEBAR_START"];
  lines.push("CHECKLIST_START");
  for (const fix of report.fixes.slice(0, 20)) {
    const short = fix.fix.length > 120 ? `${fix.fix.slice(0, 117)}…` : fix.fix;
    lines.push(`pending|${short}`);
  }
  lines.push("CHECKLIST_END");
  lines.push("");
  lines.push("CARD_START|Priority fixes");
  for (const fix of report.fixes.slice(0, 8)) {
    lines.push(`${fix.severity.toUpperCase()} · ${fix.issue}|${fix.fix}`);
  }
  lines.push("CARD_END");
  lines.push("");
  lines.push("TABLE_START");
  lines.push("Severity|Page|Issue|Recommended fix");
  for (const fix of report.fixes) {
    lines.push(`${fix.severity}|${fix.page}|${fix.issue}|${fix.fix}`);
  }
  lines.push("TABLE_END");
  lines.push("SIDEBAR_END");
  return lines.join("\n");
}

function auditPayloadForClaude(report) {
  const auditedPages = [...report.pages].sort(
    (a, b) => a.score - b.score || String(a.url).localeCompare(String(b.url)),
  );
  return {
    website: report.website,
    domain: report.domain,
    totalDiscovered: report.totalDiscovered,
    pageCount: report.pageCount,
    siteScore: report.siteScore,
    avgPageScore: report.avgPageScore,
    offPageScore: report.offPageScore,
    offPage: report.offPage,
    themes: themeRowsFromFixes(report.fixes).map((row) => {
      const pipe = row.indexOf("|");
      return { issue: row.slice(0, pipe), count: row.slice(pipe + 1) };
    }),
    auditedPages: auditedPages.map((p) => ({
      url: p.url,
      score: p.score,
      grade: p.grade,
      onPageScore: p.onPageScore,
      technicalScore: p.technicalScore,
      status: p.status,
    })),
    auditSpec: report.auditSpec,
    hasFixes: report.fixes.length > 0,
  };
}

async function claudeFormatAuditCenter(report, { apiKey, model }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: model || "claude-opus-5-5",
      max_tokens: 4096,
      temperature: 0.2,
      system: [
        "You format a completed Blazly site audit for the CENTER chat column only.",
        "Do NOT output SIDEBAR_START or fix checklists — the server adds fixes separately.",
        "Use exact numeric scores from the JSON. Follow Blazly block markers exactly.",
        blazlyLayoutPrompt(),
      ].join("\n\n"),
      messages: [
        {
          role: "user",
          content: `Write the center-column audit reply only.\n\nAudit JSON:\n${JSON.stringify(auditPayloadForClaude(report), null, 2)}`,
        },
      ],
    }),
    signal: AbortSignal.timeout(120000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "Claude could not format the audit.");
  const text = (data.content || [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!text) throw new Error("Empty audit format from Claude.");
  return text;
}

export async function formatSiteAuditMessage(report, { apiKey, model } = {}) {
  const sidebar = buildAuditSidebarBlock(report);
  let center;
  if (apiKey) {
    try {
      center = await claudeFormatAuditCenter(report, { apiKey, model });
    } catch {
      center = buildAuditCenterBlock(report);
    }
  } else {
    center = buildAuditCenterBlock(report);
  }
  if (report.fixes?.length && !/^WORKPANE\|audit/m.test(center)) {
    center = `WORKPANE|audit|Site audit — ${report.domain}\n\n${center}`;
  }
  center = injectFullPageTable(center, report);
  if (!sidebar) return center.trim();
  return `${center.trim()}\n\n${sidebar}`;
}

export function formatAuditReply(report) {
  return buildAuditCenterBlock(report) + (buildAuditSidebarBlock(report) ? `\n\n${buildAuditSidebarBlock(report)}` : "");
}

function pass(checks, group, label, detail) {
  checks[group].push({ status: "pass", label, detail, fix: "" });
}

function warn(checks, group, label, detail, fix) {
  checks[group].push({ status: "warn", label, detail, fix });
}

function fail(checks, group, label, detail, fix) {
  checks[group].push({ status: "fail", label, detail, fix });
}

function metaContent(html, name) {
  const pattern = new RegExp(
    `<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${name}["']`,
    "i"
  );
  const match = html.match(pattern);
  return (match?.[1] || match?.[2] || "").replace(/\s+/g, " ").trim();
}

function linkRel(html, rel) {
  const pattern = new RegExp(`<link[^>]+rel=["'][^"']*\\b${rel}\\b[^"']*["'][^>]+href=["']([^"']+)["']`, "i");
  return html.match(pattern)?.[1]?.trim() || "";
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function htmlToText(html) {
  return stripTags(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
  );
}

function countInternalLinks(html, pageUrl) {
  const origin = new URL(pageUrl).origin;
  let count = 0;
  const pattern = /<a\b[^>]*href=["']([^"']+)["']/gi;
  let match = pattern.exec(html);
  while (match) {
    try {
      const href = new URL(match[1], pageUrl);
      if (href.origin === origin) count += 1;
    } catch {
      // skip
    }
    match = pattern.exec(html);
  }
  return count;
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: FETCH_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) return "";
  return (await response.text()).slice(0, 3_000_000);
}

async function mapPool(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function stripSlash(value) {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/+$/, "") || "";
    return `${url.origin}${path}${url.search}`;
  } catch {
    return value;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}


function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}
