import { googleFetch } from "./google.js";

const WEBMASTERS = "https://www.googleapis.com/webmasters/v3";
const INSPECTION = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

export async function listGscSites(uid, project) {
  const data = await googleFetch(uid, project, `${WEBMASTERS}/sites`);
  return (data.siteEntry || []).map((site) => ({
    siteUrl: site.siteUrl,
    permissionLevel: site.permissionLevel,
  }));
}

function isoDate(daysAgo) {
  const d = new Date(Date.now() - daysAgo * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export async function gscSearchAnalytics(uid, project, siteUrl, options = {}) {
  const body = {
    startDate: options.startDate || isoDate(options.days || 28),
    endDate: options.endDate || isoDate(2),
    dimensions: options.dimensions?.length ? options.dimensions : ["query"],
    rowLimit: Math.min(Number(options.rowLimit) || 25, 250),
    ...(options.query || options.page
      ? {
          dimensionFilterGroups: [
            {
              filters: [
                ...(options.query ? [{ dimension: "query", operator: "contains", expression: options.query }] : []),
                ...(options.page ? [{ dimension: "page", operator: "contains", expression: options.page }] : []),
              ],
            },
          ],
        }
      : {}),
  };
  const data = await googleFetch(
    uid,
    project,
    `${WEBMASTERS}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
    { method: "POST", body },
  );
  return {
    range: { startDate: body.startDate, endDate: body.endDate },
    dimensions: body.dimensions,
    rows: (data.rows || []).map((row) => ({
      keys: row.keys,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: Number((row.ctr * 100).toFixed(2)),
      position: Number(row.position.toFixed(1)),
    })),
  };
}

export async function gscInspectUrl(uid, project, siteUrl, inspectionUrl) {
  const data = await googleFetch(uid, project, INSPECTION, {
    method: "POST",
    body: { inspectionUrl, siteUrl },
  });
  const r = data.inspectionResult?.indexStatusResult || {};
  return {
    verdict: r.verdict,
    coverageState: r.coverageState,
    indexingState: r.indexingState,
    lastCrawlTime: r.lastCrawlTime,
    googleCanonical: r.googleCanonical,
    userCanonical: r.userCanonical,
    robotsTxtState: r.robotsTxtState,
    pageFetchState: r.pageFetchState,
  };
}

export async function gscListSitemaps(uid, project, siteUrl) {
  const data = await googleFetch(uid, project, `${WEBMASTERS}/sites/${encodeURIComponent(siteUrl)}/sitemaps`);
  return (data.sitemap || []).map((s) => ({
    path: s.path,
    lastSubmitted: s.lastSubmitted,
    lastDownloaded: s.lastDownloaded,
    isPending: s.isPending,
    errors: s.errors,
    warnings: s.warnings,
  }));
}

export async function gscSubmitSitemap(uid, project, siteUrl, sitemapUrl) {
  await googleFetch(
    uid,
    project,
    `${WEBMASTERS}/sites/${encodeURIComponent(siteUrl)}/sitemaps/${encodeURIComponent(sitemapUrl)}`,
    { method: "PUT" },
  );
  return { submitted: sitemapUrl };
}
