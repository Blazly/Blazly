/** Discover site URLs from common sitemap locations and select important pages to scrape. */

const USER_AGENT = 'BlazlySEO-Bot/1.0';

const IMPORTANT_PATH_HINTS = [
  '/about',
  '/about-us',
  '/company',
  '/our-story',
  '/services',
  '/service',
  '/solutions',
  '/products',
  '/product',
  '/pricing',
  '/plans',
  '/what-we-do',
  '/industries',
  '/features',
  '/platform',
  '/home',
];

const BLOG_PATH_HINTS = ['/blog', '/blogs', '/articles', '/posts', '/news', '/resources', '/insights'];

function normalizeWebsiteUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Website URL is required.');
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  url.hash = '';
  url.search = '';
  // Strip trailing slash except for root
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString().replace(/\/$/, '') || url.origin;
}

function extractLocUrls(xml: string): string[] {
  const matches = xml.match(/<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/gi) || [];
  return matches.map((m) => m.replace(/<\/?loc>/gi, '').trim());
}

async function fetchSitemapUrls(siteOrigin: string): Promise<string[]> {
  const urls: string[] = [];
  const sitemapLocations = [
    `${siteOrigin}/sitemap.xml`,
    `${siteOrigin}/sitemap_index.xml`,
    `${siteOrigin}/wp-sitemap.xml`,
  ];

  for (const sitemapUrl of sitemapLocations) {
    try {
      const res = await fetch(sitemapUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) continue;

      const text = await res.text();

      if (text.includes('<sitemapindex')) {
        const childSitemapUrls = extractLocUrls(text).slice(0, 5);
        for (const childUrl of childSitemapUrls) {
          try {
            const childRes = await fetch(childUrl, {
              headers: { 'User-Agent': USER_AGENT },
              signal: AbortSignal.timeout(10000),
            });
            if (!childRes.ok) continue;
            const childText = await childRes.text();
            urls.push(...extractLocUrls(childText).filter((u) => !u.endsWith('.xml')));
          } catch {
            // skip failed child sitemap
          }
        }
      } else {
        urls.push(...extractLocUrls(text).filter((u) => !u.endsWith('.xml')));
      }

      if (urls.length > 0) break;
    } catch {
      continue;
    }
  }

  return [...new Set(urls)].slice(0, 100);
}

function pathScore(pathname: string): number {
  const path = pathname.toLowerCase();
  if (path === '/' || path === '') return 100;
  if (IMPORTANT_PATH_HINTS.some((hint) => path === hint || path.startsWith(`${hint}/`))) return 90;
  if (BLOG_PATH_HINTS.some((hint) => path === hint || path.startsWith(`${hint}/`))) {
    // Prefer listing roots slightly less than about/services; individual posts lower
    const depth = path.split('/').filter(Boolean).length;
    return depth <= 2 ? 70 : 55;
  }
  const depth = path.split('/').filter(Boolean).length;
  if (depth <= 1) return 40;
  if (depth === 2) return 30;
  return 10;
}

/**
 * Pick a small set of high-signal pages for industry detection.
 * Always includes homepage; prefers about/services/pricing; adds a few blog/content pages.
 */
export function selectImportantPages(homepageUrl: string, sitemapUrls: string[], maxPages = 6): string[] {
  const origin = new URL(homepageUrl).origin;
  const candidates = new Set<string>([homepageUrl, origin]);

  for (const raw of sitemapUrls) {
    try {
      const u = new URL(raw);
      if (u.origin !== origin) continue;
      if (/\.(pdf|jpg|jpeg|png|gif|webp|svg|zip|xml)$/i.test(u.pathname)) continue;
      candidates.add(`${u.origin}${u.pathname}`.replace(/\/$/, '') || u.origin);
    } catch {
      // skip invalid
    }
  }

  // Only guess common paths when sitemap discovery found little/nothing.
  if (sitemapUrls.length < 5) {
    for (const hint of ['/about', '/about-us', '/services', '/pricing', '/products', '/solutions']) {
      candidates.add(`${origin}${hint}`);
    }
  }

  const scored = [...candidates]
    .map((url) => {
      try {
        const pathname = new URL(url).pathname || '/';
        return { url, score: pathScore(pathname), pathname };
      } catch {
        return { url, score: 0, pathname: '/' };
      }
    })
    .sort((a, b) => b.score - a.score || a.pathname.length - b.pathname.length);

  const selected: string[] = [];
  let blogCount = 0;

  for (const item of scored) {
    if (selected.length >= maxPages) break;
    const isBlog = BLOG_PATH_HINTS.some(
      (hint) => item.pathname === hint || item.pathname.startsWith(`${hint}/`),
    );
    if (isBlog && blogCount >= 2) continue;
    if (!selected.includes(item.url)) {
      selected.push(item.url);
      if (isBlog) blogCount += 1;
    }
  }

  return selected;
}

export async function discoverImportantSitePages(
  websiteUrl: string,
  maxPages = 6,
): Promise<{ homepageUrl: string; selectedPages: string[]; sitemapUrlCount: number }> {
  const homepageUrl = normalizeWebsiteUrl(websiteUrl);
  const origin = new URL(homepageUrl).origin;
  const sitemapUrls = await fetchSitemapUrls(origin);
  const selectedPages = selectImportantPages(homepageUrl, sitemapUrls, maxPages);
  return {
    homepageUrl,
    selectedPages,
    sitemapUrlCount: sitemapUrls.length,
  };
}
