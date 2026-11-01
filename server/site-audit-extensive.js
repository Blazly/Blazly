import { createJiti } from "jiti";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SITE_AUDIT_AI_REVIEW_PAGES,
  SITE_AUDIT_CHECK_COUNT,
  SITE_AUDIT_CATEGORY_COUNT,
  SITE_AUDIT_MAX_PAGES,
  SITE_AUDIT_PAGE_CONCURRENCY,
  SITE_AUDIT_SPEED_PAGES,
  auditSpecMeta,
  estimateAuditRemainingSeconds,
  estimateAuditTotalSeconds,
} from "./site-audit/constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jiti = createJiti(__dirname, { interopDefault: true, esmResolve: true });

const { crawlPage } = jiti("./site-audit-lib/server/crawl-page.ts");
const { buildSiteContext } = jiti("./site-audit-lib/server/site-context.ts");
const { measurePageSpeed } = jiti("./site-audit-lib/server/pagespeed.ts");
const { evaluatePageAudit, topFixes } = jiti("./site-audit-lib/evaluate.ts");
const { reviewPageContent } = jiti("./site-audit-lib/review-anthropic.ts");
const { normalizeDomainUrl, displayUrl } = jiti("./site-audit-lib/urls.ts");

export {
  SITE_AUDIT_MAX_PAGES as EXTENSIVE_MAX_PAGES,
  SITE_AUDIT_AI_REVIEW_PAGES as EXTENSIVE_AI_REVIEW_PAGES,
  SITE_AUDIT_SPEED_PAGES as EXTENSIVE_SPEED_PAGES,
};

function pageNameFromUrl(url) {
  try {
    const segments = new URL(url).pathname.split("/").filter(Boolean);
    if (!segments.length) return "Homepage";
    return decodeURIComponent(segments[segments.length - 1]).replace(/[-_]/g, " ");
  } catch {
    return displayUrl(url);
  }
}

function bucketScore(result, bucketId) {
  const bucket = result.buckets.find((b) => b.id === bucketId);
  return bucket?.score ?? null;
}

function mapPageResult(auditResult) {
  const onPageIds = ["title", "meta-description", "headings", "content-quality", "keyword-topic"];
  const onScores = auditResult.categories.filter((c) => onPageIds.includes(c.id)).map((c) => c.score);
  const onPageScore = onScores.length
    ? Math.round(onScores.reduce((a, b) => a + (b ?? 0), 0) / onScores.length)
    : auditResult.score;
  const technicalScore =
    bucketScore(auditResult, "technical-indexability") ??
    auditResult.categories.find((c) => c.id === "technical")?.score ??
    auditResult.score;

  return {
    url: auditResult.finalUrl,
    status: auditResult.categories.find((c) => c.id === "url-indexability")?.checks?.[0]?.detail?.includes("200")
      ? 200
      : 0,
    score: auditResult.score,
    grade: auditResult.grade,
    onPageScore,
    technicalScore,
    primaryKeyword: auditResult.primaryKeyword,
    pageType: auditResult.pageType,
    searchIntent: auditResult.searchIntent,
    summary: auditResult.summary,
    counts: auditResult.counts,
    categories: auditResult.categories,
    speed: auditResult.speed,
    checks: auditResult.categories.flatMap((cat) =>
      cat.checks
        .filter((ch) => ch.status === "fail" || ch.status === "warn")
        .map((ch) => ({
          status: ch.status === "fail" ? "fail" : "warn",
          label: ch.label,
          detail: ch.detail,
          fix: ch.recommendation || ch.detail,
          category: cat.label,
        })),
    ),
    title: auditResult.signature.title,
    wordCount: null,
    auditResult,
  };
}

function collectFixesFromResults(pages, offPage) {
  const fixes = [];
  for (const page of pages) {
    const top = topFixes(page.auditResult, 6);
    for (const check of top) {
      fixes.push({
        severity: check.status === "fail" ? "high" : "medium",
        page: page.url,
        issue: check.label,
        detail: check.detail,
        fix: check.recommendation || check.detail,
      });
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
  const seen = new Set();
  return fixes
    .filter((f) => {
      const key = `${f.page}|${f.issue}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 50);
}

async function mapPool(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length || 1) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export async function runExtensiveSiteAudit(website, { dataForSeo, apiKey, model, onProgress, fetchOffPageScore }) {
  const domainUrl = normalizeDomainUrl(website);
  const domain = new URL(domainUrl).hostname.replace(/^www\./, "");
  const projectName = domain;

  const hasPageSpeedKey = !!(process.env.PAGESPEED_API_KEY || process.env.GOOGLE_PAGESPEED_API_KEY);
  const etaOptions = { hasAnthropicKey: !!apiKey, hasPageSpeedKey };

  onProgress?.({
    type: "progress",
    phase: "sitemap",
    message: `Mapping site (up to ${SITE_AUDIT_MAX_PAGES} pages · ${SITE_AUDIT_CHECK_COUNT} checks each)`,
    current: 0,
    total: 0,
    totalToAudit: SITE_AUDIT_MAX_PAGES,
    etaSeconds: estimateAuditTotalSeconds(SITE_AUDIT_MAX_PAGES, etaOptions),
  });

  const siteContext = await buildSiteContext(domainUrl, SITE_AUDIT_MAX_PAGES);
  const origin = siteContext.origin || domainUrl;
  let urls = siteContext.projectPages.length ? siteContext.projectPages : [origin];
  if (!urls.some((u) => new URL(u).pathname === "/" || new URL(u).pathname === "")) {
    urls = [origin, ...urls];
  }
  urls = [...new Set(urls.map((u) => u.replace(/\/$/, "") || origin))].slice(0, SITE_AUDIT_MAX_PAGES);

  const totalDiscovered = Math.max(siteContext.sitemapUrls.length, urls.length);
  const totalToAudit = urls.length;
  const aiPages = apiKey ? Math.min(totalToAudit, SITE_AUDIT_AI_REVIEW_PAGES) : 0;
  const speedPages = hasPageSpeedKey ? Math.min(totalToAudit, SITE_AUDIT_SPEED_PAGES) : 0;

  onProgress?.({
    type: "progress",
    phase: "crawl",
    message: `${SITE_AUDIT_CHECK_COUNT} checks × ${SITE_AUDIT_CATEGORY_COUNT} categories · ${totalToAudit} pages`,
    current: 0,
    total: totalDiscovered,
    totalToAudit,
    etaSeconds: estimateAuditTotalSeconds(totalToAudit, etaOptions),
  });

  const offPagePromise = fetchOffPageScore(domain, dataForSeo);

  const siblings = urls.map((url) => ({
    url,
    name: pageNameFromUrl(url),
    title: null,
    h1: null,
    metaDescription: null,
    primaryKeyword: "",
    minhash: [],
    internalTargets: [],
  }));

  const pages = [];
  let completed = 0;

  const emitProgress = (message) => {
    onProgress?.({
      type: "progress",
      phase: "crawl",
      message,
      current: completed,
      total: totalDiscovered,
      totalToAudit,
      etaSeconds: estimateAuditRemainingSeconds(completed, totalToAudit, etaOptions),
    });
  };

  await mapPool(urls, SITE_AUDIT_PAGE_CONCURRENCY, async (pageUrl) => {
    const idx = urls.indexOf(pageUrl);
    const pageName = pageNameFromUrl(pageUrl);
    const withAi = apiKey && idx < aiPages;
    const withSpeed = hasPageSpeedKey && idx < speedPages;

    emitProgress(
      withAi
        ? `${SITE_AUDIT_CHECK_COUNT} checks · crawl + AI + speed · ${displayUrl(pageUrl)}`
        : `${SITE_AUDIT_CHECK_COUNT} checks · crawl · ${displayUrl(pageUrl)}`,
    );

    let crawl;
    try {
      crawl = await crawlPage(pageUrl, origin);
    } catch (error) {
      completed += 1;
      emitProgress(`Skipped ${displayUrl(pageUrl)} (${error.message || "crawl failed"})`);
      return;
    }

    const speedPromise = withSpeed
      ? measurePageSpeed(crawl.finalUrl, "").catch(() => ({
          mobile: null,
          desktop: null,
          error: "Speed test unavailable.",
        }))
      : Promise.resolve({ mobile: null, desktop: null });

    let review = null;
    if (withAi) {
      try {
        review = await reviewPageContent(
          { projectName, domainUrl: origin, pageName, crawl },
          { apiKey, model },
        );
      } catch {
        review = null;
      }
    }

    const speed = await speedPromise;
    const pageSiblings = siblings.filter((s) => s.url !== pageUrl);

    const auditResult = evaluatePageAudit({
      projectName,
      domainUrl: origin,
      pageName,
      crawl,
      speed,
      review,
      siteContext,
      siblings: pageSiblings,
    });

    const mapped = mapPageResult(auditResult);
    pages.push(mapped);

    const sibling = siblings.find((s) => s.url === pageUrl);
    if (sibling && auditResult.signature) {
      Object.assign(sibling, auditResult.signature, { name: pageName });
    }

    completed += 1;
    emitProgress(`Scored page ${completed}/${totalToAudit} · weighted buckets + duplicates`);
  });

  pages.sort((a, b) => a.url.localeCompare(b.url));
  const offPage = await offPagePromise;

  const pageScores = pages.map((p) => p.score);
  const avgPageScore = pageScores.length
    ? Math.round(pageScores.reduce((sum, v) => sum + v, 0) / pageScores.length)
    : 0;
  const siteScore = Math.round(avgPageScore * 0.7 + offPage.score * 0.3);
  const fixes = collectFixesFromResults(pages, offPage);

  return {
    website: origin,
    domain,
    auditedAt: new Date().toISOString(),
    pageCount: pages.length,
    totalDiscovered,
    auditCap: SITE_AUDIT_MAX_PAGES,
    siteScore,
    avgPageScore,
    offPageScore: offPage.score,
    offPage,
    pages,
    fixes,
    engine: "extensive",
    auditSpec: auditSpecMeta(),
    estimatedDurationSeconds: estimateAuditTotalSeconds(totalToAudit, etaOptions),
    siteContextSummary: {
      sitemapFound: siteContext.sitemapFound,
      projectPages: totalToAudit,
      aiReviewPages: aiPages,
      speedPages,
    },
  };
}
