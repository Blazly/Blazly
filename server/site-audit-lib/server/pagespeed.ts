import type { SpeedAuditSnapshot, SpeedSnapshot, SpeedStrategyResult } from '../types/site-audit';

const PAGESPEED_API_URL = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

/** Legacy Lighthouse audit IDs plus their Lighthouse 12/13 "insight" replacements. */
const KEPT_AUDITS = [
  'render-blocking-insight', 'render-blocking-resources',
  'image-delivery-insight', 'uses-optimized-images', 'modern-image-formats', 'uses-responsive-images',
  'unused-javascript', 'legacy-javascript-insight', 'legacy-javascript', 'bootup-time', 'unminified-javascript',
  'unused-css-rules', 'unminified-css',
  'font-display-insight', 'font-display',
  'third-parties-insight', 'third-party-summary',
  'cls-culprits-insight', 'layout-shifts', 'layout-shift-elements', 'unsized-images',
  'lcp-discovery-insight', 'lcp-lazy-loaded', 'prioritize-lcp-image',
  'offscreen-images',
  'viewport', 'viewport-insight', 'content-width', 'target-size', 'font-size', 'image-size-responsive',
  'document-latency-insight', 'server-response-time', 'total-byte-weight',
];

type PsiAudit = {
  title?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  displayValue?: string;
  numericValue?: number;
};

type PsiMetric = { percentile?: number };

type PsiResponse = {
  lighthouseResult?: {
    categories?: Record<string, { score?: number | null }>;
    audits?: Record<string, PsiAudit>;
  };
  loadingExperience?: { metrics?: Record<string, PsiMetric>; origin_fallback?: boolean };
  originLoadingExperience?: { metrics?: Record<string, PsiMetric> };
};

async function resolveAuth(_userId?: string): Promise<{ key?: string; token?: string }> {
  const key = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_PAGESPEED_API_KEY;
  return key ? { key } : {};
}

function numeric(audit: PsiAudit | undefined): number | null {
  return typeof audit?.numericValue === 'number' ? Math.round(audit.numericValue * 1000) / 1000 : null;
}

function mapStrategy(data: PsiResponse): SpeedStrategyResult | null {
  const lighthouse = data.lighthouseResult;
  if (!lighthouse?.audits) return null;
  const audits = lighthouse.audits;

  const kept: Record<string, SpeedAuditSnapshot> = {};
  for (const id of KEPT_AUDITS) {
    const audit = audits[id];
    if (!audit) continue;
    kept[id] = {
      score: typeof audit.score === 'number' ? audit.score : null,
      mode: audit.scoreDisplayMode || 'unknown',
      title: audit.title || id,
      ...(audit.displayValue ? { displayValue: audit.displayValue } : {}),
    };
  }

  const urlMetrics = data.loadingExperience?.metrics;
  const originMetrics = data.originLoadingExperience?.metrics;
  const fieldSource = urlMetrics && Object.keys(urlMetrics).length ? urlMetrics : originMetrics;
  const fieldValue = (key: string) => {
    const value = fieldSource?.[key]?.percentile;
    return typeof value === 'number' ? value : null;
  };
  const fieldCls = fieldValue('CUMULATIVE_LAYOUT_SHIFT_SCORE');

  return {
    performance: Math.round((lighthouse.categories?.performance?.score ?? 0) * 100),
    fcpMs: numeric(audits['first-contentful-paint']),
    lcpMs: numeric(audits['largest-contentful-paint']),
    tbtMs: numeric(audits['total-blocking-time']),
    cls: numeric(audits['cumulative-layout-shift']),
    speedIndexMs: numeric(audits['speed-index']),
    field: {
      lcpMs: fieldValue('LARGEST_CONTENTFUL_PAINT_MS'),
      inpMs: fieldValue('INTERACTION_TO_NEXT_PAINT'),
      cls: fieldCls === null ? null : fieldCls / 100,
      source: fieldSource
        ? fieldSource === urlMetrics && !data.loadingExperience?.origin_fallback
          ? 'url'
          : 'origin'
        : null,
    },
    audits: kept,
  };
}

async function runStrategy(
  url: string,
  strategy: 'mobile' | 'desktop',
  auth: { key?: string; token?: string },
): Promise<SpeedStrategyResult> {
  const params = new URLSearchParams({ url, strategy });
  ['performance', 'accessibility', 'best-practices'].forEach((category) => params.append('category', category));
  if (auth.key) params.set('key', auth.key);
  const headers: Record<string, string> = auth.token ? { Authorization: `Bearer ${auth.token}` } : {};

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${PAGESPEED_API_URL}?${params.toString()}`, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(100_000),
    });
    if (res.ok) {
      const mapped = mapStrategy((await res.json()) as PsiResponse);
      if (mapped) return mapped;
      lastError = 'No Lighthouse data returned';
      break;
    }
    lastError = `${res.status} ${(await res.text()).slice(0, 300)}`;
    if (res.status !== 429 && res.status < 500) break;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  throw new Error(lastError || 'PageSpeed request failed');
}

export async function measurePageSpeed(url: string, userId: string): Promise<SpeedSnapshot> {
  const auth = await resolveAuth(userId);
  const [mobile, desktop] = await Promise.allSettled([
    runStrategy(url, 'mobile', auth),
    runStrategy(url, 'desktop', auth),
  ]);

  if (mobile.status === 'rejected') console.error('[site-audit] mobile speed test failed:', mobile.reason);
  if (desktop.status === 'rejected') console.error('[site-audit] desktop speed test failed:', desktop.reason);

  const snapshot: SpeedSnapshot = {
    mobile: mobile.status === 'fulfilled' ? mobile.value : null,
    desktop: desktop.status === 'fulfilled' ? desktop.value : null,
  };
  if (!snapshot.mobile && !snapshot.desktop) {
    const reason = mobile.status === 'rejected' ? String(mobile.reason) : '';
    snapshot.error = /429|quota|rate/i.test(reason)
      ? 'The speed test is busy right now. Re-run this page in a few minutes.'
      : 'The speed test could not load this page.';
  }
  return snapshot;
}
