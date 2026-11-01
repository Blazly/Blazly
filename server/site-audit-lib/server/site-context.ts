import { parse } from 'node-html-parser';
import { fetchPageAsBrowser, fetchText } from './fetcher';
import { fetchRobotsTxt } from './robots';
import { bareHost, comparableUrl, isSameSite, normalizeDomainUrl } from '../urls';
import { DEFAULT_PROJECT_PAGE_LIMIT } from '../limits';
import type { SiteContext } from './types/site-audit';

const MAX_SITEMAP_FILES = 12;
const MAX_SITEMAP_URLS = 2000;
const NON_PAGE_PATH = /\.(xml|pdf|jpe?g|png|gif|webp|avif|svg|zip|mp4|mp3|css|js|json|txt|ico)$/i;
const LOW_VALUE_PATH =
  /\/(tag|tags|author|category|feed|wp-json|wp-admin|wp-content|cart|checkout|my-account|account|login|signin|sign-in|register|privacy|privacy-policy|terms|terms-of-service|cookie|cookies|legal|search)(\/|$)|\/page\/\d+/i;

function extractLocs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\s\]]+)\s*(?:\]\]>)?\s*<\/loc>/gi)].map((m) =>
    m[1].replace(/&amp;/g, '&').trim(),
  );
}

async function collectSitemapUrls(origin: string, declared: string[]): Promise<{ found: boolean; urls: string[] }> {
  const queue = [
    ...declared,
    `${origin}/sitemap.xml`,
    `${origin}/sitemap_index.xml`,
    `${origin}/sitemap-index.xml`,
    `${origin}/wp-sitemap.xml`,
  ];
  const visited = new Set<string>();
  const urls = new Set<string>();
  let found = false;

  while (queue.length && visited.size < MAX_SITEMAP_FILES && urls.size < MAX_SITEMAP_URLS) {
    const next = queue.shift()!;
    if (visited.has(next)) continue;
    visited.add(next);
    const xml = await fetchText(next, 12_000);
    if (!xml || !/<(urlset|sitemapindex)\b/i.test(xml)) continue;
    found = true;
    const locs = extractLocs(xml);
    if (/<sitemapindex\b/i.test(xml)) {
      // Page and post sitemaps first; skip image/video/tag sitemaps.
      const children = locs
        .filter((loc) => !/(image|video|tag|author|category)/i.test(loc))
        .sort((a, b) => Number(/(page|post)/i.test(b)) - Number(/(page|post)/i.test(a)));
      queue.unshift(...children);
      continue;
    }
    for (const loc of locs) {
      if (urls.size >= MAX_SITEMAP_URLS) break;
      try {
        if (!NON_PAGE_PATH.test(new URL(loc, origin).pathname)) urls.add(loc);
      } catch {
        // skip malformed <loc>
      }
    }
    if (urls.size > 0 && declared.length === 0 && !/<sitemapindex\b/i.test(xml)) break;
  }

  return { found, urls: [...urls] };
}

const PRIORITY_PATHS: Array<[RegExp, number]> = [
  [/^\/$/, 100],
  [/^\/(pricing|plans)(\/|$)/, 92],
  [/^\/(services?|solutions|products?|features|platform|what-we-do)(\/|$)/, 90],
  [/^\/(about|about-us|company|our-story)(\/|$)/, 85],
  [/^\/(contact|contact-us|book|demo)(\/|$)/, 80],
  [/^\/(blog|blogs|resources|articles|insights|guides)\/?$/, 70],
];

function pagePriority(url: string): number {
  const path = new URL(url).pathname.toLowerCase();
  for (const [pattern, score] of PRIORITY_PATHS) if (pattern.test(path)) return score;
  const depth = path.split('/').filter(Boolean).length;
  return depth <= 1 ? 50 : depth === 2 ? 35 : 20;
}

const BLOG_SECTION = /^(blog|blogs|news|articles|insights|guides|posts|post|resources)$/i;

/** True for individual blog/post URLs (not section index pages like /blog). */
function isBlogOrPostUrl(url: string): boolean {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  if (segments.length >= 2 && BLOG_SECTION.test(segments[0]!)) return true;
  return /\/\d{4}\/\d{2}\//.test(new URL(url).pathname);
}

function dedupeSiteUrls(origin: string, candidates: string[]): string[] {
  const host = bareHost(new URL(origin).hostname);
  const unique = new Map<string, string>();
  for (const raw of [origin, ...candidates]) {
    try {
      const url = new URL(raw, origin);
      if (bareHost(url.hostname) !== host) continue;
      if (NON_PAGE_PATH.test(url.pathname) || LOW_VALUE_PATH.test(url.pathname) || url.search) continue;
      url.hash = '';
      const key = comparableUrl(url.toString());
      if (!unique.has(key)) unique.set(key, url.toString());
    } catch {
      // ignore invalid candidate
    }
  }
  return [...unique.values()];
}

function rankUrls(urls: string[]): string[] {
  return urls
    .map((url) => ({ url, score: pagePriority(url) }))
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length)
    .map(({ url }) => url);
}

/** URLs for a new project: marketing/site pages first, then blog posts. `max: null` = no cap. */
export function selectProjectPages(
  origin: string,
  candidates: string[],
  max: number | null = DEFAULT_PROJECT_PAGE_LIMIT,
): string[] {
  const all = dedupeSiteUrls(origin, candidates);
  const webpages = all.filter((url) => !isBlogOrPostUrl(url));
  const posts = all.filter((url) => isBlogOrPostUrl(url));
  const ordered = [...rankUrls(webpages), ...rankUrls(posts)];
  return max === null ? ordered : ordered.slice(0, max);
}

/** Picks up to `max` high-value pages: homepage, money pages, then shallow pages and a few articles. */
export function suggestPages(origin: string, candidates: string[], max = 10): string[] {
  const ranked = rankUrls(dedupeSiteUrls(origin, candidates)).map((url) => ({ url, score: pagePriority(url) }));
  ranked.sort((a, b) => b.score - a.score || a.url.length - b.url.length);

  // At most 3 pages per top-level section so suggestions cover the whole site.
  const perSection = new Map<string, number>();
  const picked: string[] = [];
  for (const { url } of ranked) {
    const section = new URL(url).pathname.split('/').filter(Boolean)[0] ?? '';
    const count = perSection.get(section) ?? 0;
    if (section && count >= 3) continue;
    perSection.set(section, count + 1);
    picked.push(url);
    if (picked.length >= max) break;
  }
  return picked;
}

export async function buildSiteContext(
  domainUrl: string,
  maxProjectPages: number | null = DEFAULT_PROJECT_PAGE_LIMIT,
): Promise<SiteContext & { suggestedPages: string[]; projectPages: string[] }> {
  const requestedOrigin = normalizeDomainUrl(domainUrl);
  let origin = requestedOrigin;
  let homepageLinks: string[] = [];

  try {
    const home = await fetchPageAsBrowser(requestedOrigin, 20_000);
    origin = new URL(home.finalUrl).origin;
    const root = parse(home.body, { comment: false });
    const links = new Set<string>();
    root.querySelectorAll('a').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href || href.startsWith('#') || /^(mailto|tel|javascript):/i.test(href)) return;
      try {
        const url = new URL(href, home.finalUrl);
        url.hash = '';
        if (isSameSite(url.toString(), requestedOrigin)) links.add(url.toString());
      } catch {
        // ignore invalid href
      }
    });
    homepageLinks = [...links].slice(0, 400);
  } catch {
    // Homepage unreachable — sitemap may still work.
  }

  const robots = await fetchRobotsTxt(origin);
  const sitemap = await collectSitemapUrls(origin, robots.sitemaps);

  const pool = [...sitemap.urls, ...homepageLinks];
  return {
    origin,
    sitemapFound: sitemap.found,
    sitemapUrls: sitemap.urls,
    homepageLinks,
    suggestedPages: suggestPages(origin, pool),
    projectPages: selectProjectPages(origin, pool, maxProjectPages),
  };
}
