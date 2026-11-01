import { AUDIT_CATEGORIES, SCORE_BUCKETS, gradeForScore } from '../checklist';
import { hasType, nodeTypes, schemaPropertyGaps, suggestedSchema } from '../schema-rules';
import {
  countPhrase,
  normalizeText,
  signatureSimilarity,
  tokenSimilarity,
  topicCoverage,
  topicTokens,
} from '../text';
import { bareHost, comparableUrl, displayUrl } from '../urls';
import type {
  AuditCategoryResult,
  AuditCheck,
  AuditCheckStatus,
  ContentReview,
  PageAuditResult,
  PageCrawlData,
  PageSignature,
  ScoreBucketResult,
  SiteContext,
  SpeedSnapshot,
  SpeedStrategyResult,
} from './types/site-audit';

export type SiblingPage = PageSignature & { name: string };

export type EvaluateInput = {
  projectName: string;
  domainUrl: string;
  pageName: string;
  crawl: PageCrawlData;
  speed: SpeedSnapshot | null;
  review: ContentReview | null;
  siteContext: SiteContext | null;
  siblings: SiblingPage[];
};

type Verdict = { status: AuditCheckStatus; detail: string; recommendation?: string };

const pass = (detail: string): Verdict => ({ status: 'pass', detail });
const warn = (detail: string, recommendation: string): Verdict => ({ status: 'warn', detail, recommendation });
const fail = (detail: string, recommendation: string): Verdict => ({ status: 'fail', detail, recommendation });
const na = (detail: string): Verdict => ({ status: 'na', detail });

const POINTS: Record<AuditCheckStatus, number> = { pass: 1, warn: 0.5, fail: 0, na: 0 };

const GENERIC_ANCHOR =
  /^(click here|here|read more|more|learn more|this|link|go|details|continue|view|see more|this page|find out more|more info|read)$/i;
const COMMERCIAL_PATH =
  /\/(pricing|plans|products?|services?|solutions|demo|contact|book|quote|signup|sign-up|register|shop|buy|get-started|trial|features)(\/|$|-)/i;
const AFFILIATE_LINK =
  /([?&](ref|aff|affiliate|aff_id|affid|partner|tag)=)|amzn\.to|shareasale|awin1|clickbank|impact\.com|partnerstack|rstyle\.me|skimresources|go\.redirectingat/i;

function quote(text: string, max = 80): string {
  const trimmed = text.length > max ? `${text.slice(0, max - 1)}…` : text;
  return `"${trimmed}"`;
}

function names(pages: SiblingPage[], max = 3): string {
  const list = pages.slice(0, max).map((p) => p.name || displayUrl(p.url));
  return pages.length > max ? `${list.join(', ')} +${pages.length - max} more` : list.join(', ');
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`;
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function ratio(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Lowest score across the first available Lighthouse audits; null when none apply. */
function auditScore(result: SpeedStrategyResult | null | undefined, ids: string[]): { score: number | null; label: string; display?: string } {
  if (!result) return { score: null, label: '' };
  let lowest: { score: number | null; label: string; display?: string } = { score: null, label: '' };
  for (const id of ids) {
    const audit = result.audits[id];
    if (!audit) continue;
    const score = audit.mode === 'notApplicable' ? 1 : audit.score;
    if (score === null) continue;
    if (lowest.score === null || score < lowest.score) {
      lowest = { score, label: audit.title, display: audit.displayValue };
    }
  }
  return lowest;
}

function speedVerdict(
  result: { score: number | null; label: string; display?: string },
  goodDetail: string,
  recommendation: string,
): Verdict {
  if (result.score === null) return na('Not reported by the speed test for this page.');
  const suffix = result.display ? ` (${result.display})` : '';
  if (result.score >= 0.9) return pass(goodDetail);
  if (result.score >= 0.5) return warn(`${result.label}${suffix}`, recommendation);
  return fail(`${result.label}${suffix}`, recommendation);
}

function thresholdVerdict(value: number, good: number, poor: number, detail: string, recommendation: string): Verdict {
  if (value <= good) return pass(detail);
  if (value <= poor) return warn(detail, recommendation);
  return fail(detail, recommendation);
}

export function evaluatePageAudit(input: EvaluateInput): PageAuditResult {
  const { crawl: c, speed, review, siteContext } = input;
  const finalUrl = new URL(c.finalUrl);
  const path = finalUrl.pathname;
  const isHome = path === '/' || path === '';
  const depth = path.split('/').filter(Boolean).length;
  const keyword = review?.primaryKeyword?.trim() || '';
  const hasKeyword = topicTokens(keyword).length > 0;
  const pageType = review?.pageType || (isHome ? 'homepage' : 'other');
  const title = c.title?.trim() || '';
  const meta = c.metaDescription?.trim() || '';
  const h1s = c.headings.filter((h) => h.level === 1 && h.text);
  const h1 = h1s[0]?.text || '';
  const subheadings = c.headings.filter((h) => (h.level === 2 || h.level === 3) && h.text);
  const selfKey = comparableUrl(c.finalUrl);
  const others = input.siblings.filter((s) => comparableUrl(s.url) !== selfKey);
  const robotsDirectives = `${c.metaRobots || ''} ${c.xRobotsTag || ''}`.toLowerCase();
  const noindex = /\b(noindex|none)\b/.test(robotsDirectives);
  const nofollow = /\b(nofollow|none)\b/.test(robotsDirectives);
  const canonicalKey = c.canonical ? comparableUrl(c.canonical) : null;
  const canonicalSelf = canonicalKey === selfKey;
  const internalLinks = c.links.filter((l) => l.internal && comparableUrl(l.href) !== selfKey);
  const contentInternal = internalLinks.filter((l) => l.inContent);
  const contentInternalTargets = new Set(contentInternal.map((l) => comparableUrl(l.href)));
  const externalContent = c.links.filter((l) => !l.internal && l.inContent);
  const contentImages = c.images.filter((img) => !img.decorative);
  const rasterImages = contentImages.filter((img) => img.format !== 'svg');
  const mobile = speed?.mobile ?? null;
  const desktop = speed?.desktop ?? null;
  const primarySpeed = mobile ?? desktop;
  const noSpeed = na(speed?.error || 'Speed test unavailable for this page.');
  const viewport = (c.viewport || '').toLowerCase();
  const viewportOk = viewport.includes('width=device-width');
  const zoomDisabled = /user-scalable\s*=\s*(no|0)|maximum-scale\s*=\s*1(\.0)?\b/.test(viewport);
  const homepageLinked = !!siteContext?.homepageLinks.some((link) => comparableUrl(link) === selfKey);
  const inSitemap = !!siteContext?.sitemapUrls.some((link) => comparableUrl(link) === selfKey);
  const linkingSiblings = others.filter((s) => s.internalTargets.includes(selfKey));
  const sameKeywordSiblings = hasKeyword
    ? others.filter((s) => s.primaryKeyword && tokenSimilarity(s.primaryKeyword, keyword) >= 0.75)
    : [];
  const sameTitleSiblings = title ? others.filter((s) => s.title && normalizeText(s.title) === normalizeText(title)) : [];
  const sameMetaSiblings = meta
    ? others.filter((s) => s.metaDescription && normalizeText(s.metaDescription) === normalizeText(meta))
    : [];
  const sameH1Siblings = h1 ? others.filter((s) => s.h1 && normalizeText(s.h1) === normalizeText(h1)) : [];
  const similarities = others
    .map((s) => ({ page: s, similarity: signatureSimilarity(c.minhash, s.minhash) }))
    .sort((a, b) => b.similarity - a.similarity);
  const topSimilar = similarities[0];

  const projectHostLabel = bareHost(new URL(input.domainUrl).hostname).split('.')[0];
  const brandNames = [input.projectName, c.ogSiteName, projectHostLabel].filter(
    (value): value is string => !!value && value.trim().length > 1,
  );
  const squash = (value: string) => normalizeText(value).replace(/\s+/g, '');
  const hasBrand = (text: string) => brandNames.some((brand) => squash(text).includes(squash(brand)));

  const topicIn = (text: string | null | undefined, goodAt = 0.6): Verdict | null => {
    if (!hasKeyword) return na('Primary keyword could not be determined.');
    const coverage = topicCoverage(text, keyword);
    if (coverage >= goodAt) return pass(`Contains the topic "${keyword}".`);
    if (coverage > 0) return warn(`Only partly reflects "${keyword}" (${pct(coverage)} of key terms).`, `Work the main topic "${keyword}" in naturally.`);
    return null;
  };

  // --- Rule-based checks ---
  const rules: Record<string, () => Verdict> = {
    // 1. URL & Indexability
    'url-readable': () => {
      if (isHome) return pass('Homepage URL.');
      const issues: string[] = [];
      if (c.finalUrl.length > 100) issues.push(`${c.finalUrl.length} characters long`);
      if (depth > 4) issues.push(`${depth} folders deep`);
      if (/[A-Z]/.test(path)) issues.push('uppercase letters');
      if (path.split('/').some((segment) => /^[a-z0-9]{20,}$/i.test(segment) && /\d/.test(segment))) issues.push('random-looking ID');
      if (!issues.length) return pass(`${displayUrl(c.finalUrl)} is short and readable.`);
      const rec = 'Use a short, lowercase slug made of a few descriptive words, and 301-redirect the old URL.';
      return c.finalUrl.length > 115 || issues.length > 2 ? fail(`URL has ${issues.join(', ')}.`, rec) : warn(`URL has ${issues.join(', ')}.`, rec);
    },
    'url-topic': () => {
      if (isHome) return na('Homepage — a keyword in the URL is not expected.');
      const acronym = topicTokens(keyword).map((token) => token[0]).join('');
      if (acronym.length >= 2 && path.toLowerCase().split('/').includes(acronym)) {
        return pass(`Slug uses the abbreviation "${acronym}" for "${keyword}".`);
      }
      return topicIn(path.replace(/[/_-]+/g, ' '), 0.5) ?? warn(`URL slug does not reflect "${keyword}".`, `Use a slug based on the topic, e.g. /${topicTokens(keyword).join('-')}.`);
    },
    'url-hyphens': () =>
      path.includes('_')
        ? fail('URL uses underscores between words.', 'Use hyphens instead of underscores and 301-redirect the old URL.')
        : pass('Words are separated with hyphens.'),
    'url-clean': () => {
      const issues: string[] = [];
      if (finalUrl.search) issues.push('query parameters');
      if (/\/(19|20)\d{2}\/\d{1,2}\//.test(path)) issues.push('date folders');
      if (path.split('/').some((segment) => /\d{5,}/.test(segment))) issues.push('numeric IDs');
      if (/(sid|sessionid|phpsessid|jsessionid)=/i.test(finalUrl.search)) issues.push('session IDs');
      if (/\/\//.test(path)) issues.push('double slashes');
      return issues.length
        ? warn(`URL contains ${issues.join(', ')}.`, 'Use a clean, static URL without parameters, IDs or dates.')
        : pass('No parameters, IDs or dates in the URL.');
    },
    'status-200': () => {
      if (c.statusCode !== 200) {
        return fail(`Page returns HTTP ${c.statusCode}.`, 'Make the page return 200, or redirect/remove it and update internal links.');
      }
      if (c.redirectChain.length) {
        return warn(
          `The entered URL redirects (${c.redirectChain.map((hop) => hop.status).join(' → ')}) to ${displayUrl(c.finalUrl)}.`,
          'Link to and submit the final URL directly so crawlers skip the redirect.',
        );
      }
      return pass(`Returns 200 OK in ${formatMs(c.responseTimeMs)}.`);
    },
    indexable: () => {
      const blockers: string[] = [];
      if (c.statusCode !== 200) blockers.push(`returns ${c.statusCode}`);
      if (noindex) blockers.push('has a noindex directive');
      if (c.blockedByRobotsTxt) blockers.push('is blocked by robots.txt');
      if (blockers.length) return fail(`Page ${blockers.join(', ')}.`, 'Remove the blocking directive if this page should appear in search.');
      if (canonicalKey && !canonicalSelf) {
        return warn(`Page is canonicalised to ${displayUrl(c.canonical!)}.`, 'Use a self-referencing canonical if this page should rank on its own.');
      }
      return pass('Returns 200, no noindex, allowed by robots.txt.');
    },
    'no-noindex': () =>
      noindex
        ? fail(`noindex found in ${c.xRobotsTag && /noindex|none/i.test(c.xRobotsTag) ? 'the X-Robots-Tag header' : 'the robots meta tag'}.`, 'Remove noindex unless you intentionally want this page out of search.')
        : pass('No noindex directive.'),
    'no-nofollow': () =>
      nofollow
        ? fail('A page-level nofollow stops link equity flowing from this page.', 'Remove nofollow from the robots meta tag / X-Robots-Tag header.')
        : pass('No page-level nofollow.'),
    'canonical-exists': () => {
      if (c.canonicalCount === 0) return warn('No canonical tag found.', 'Add a self-referencing <link rel="canonical"> to the page head.');
      if (c.canonicalCount > 1) return fail(`${c.canonicalCount} canonical tags found.`, 'Keep exactly one canonical tag.');
      return pass(`Canonical: ${displayUrl(c.canonical || '')}`);
    },
    'canonical-correct': () => {
      if (!c.canonical) return na('No canonical tag.');
      const canonical = new URL(c.canonical);
      if (canonicalSelf) {
        if (canonical.protocol !== finalUrl.protocol) return fail(`Canonical uses ${canonical.protocol}// while the page is served over ${finalUrl.protocol}//.`, 'Point the canonical to the HTTPS URL.');
        if (canonical.hostname !== finalUrl.hostname) return fail(`Canonical points to ${canonical.hostname} but the page is served on ${finalUrl.hostname}.`, 'Use the same www/non-www host in the canonical as the live URL.');
        return pass('Self-referencing canonical.');
      }
      const probe = c.canonicalProbe;
      if (probe && (probe.status !== 200 || probe.redirected)) {
        return fail(`Canonical points to ${displayUrl(c.canonical)}, which ${probe.status ? `returns ${probe.status}` : 'is unreachable'}${probe.redirected ? ' and redirects' : ''}.`, 'Point the canonical to a live, non-redirecting URL — normally this page itself.');
      }
      return warn(`Canonical points to a different URL: ${displayUrl(c.canonical)}.`, 'If this page should rank on its own, make the canonical self-referencing.');
    },
    'canonical-indexable': () => {
      if (!c.canonical) return na('No canonical tag.');
      if (canonicalSelf) {
        return c.statusCode === 200 && !noindex && !c.blockedByRobotsTxt
          ? pass('Canonical URL (this page) is indexable.')
          : fail('Canonical URL (this page) is not indexable.', 'Make the canonical target return 200 with no noindex.');
      }
      const probe = c.canonicalProbe;
      if (!probe) return na('Canonical target was not checked.');
      if (probe.status === 200 && !probe.redirected && !probe.noindex) return pass('Canonical target returns 200 and is indexable.');
      return fail(
        `Canonical target ${probe.status ? `returns ${probe.status}` : 'is unreachable'}${probe.redirected ? ', redirects' : ''}${probe.noindex ? ', is noindex' : ''}.`,
        'Canonicals must point to an indexable, 200-status URL.',
      );
    },
    'https-redirect': () => {
      if (finalUrl.protocol === 'http:') return fail('Page is served over insecure HTTP.', 'Serve the site over HTTPS and 301-redirect every HTTP URL.');
      const probe = c.httpProbe;
      if (!probe) return na('HTTP version not checked.');
      if (probe.status === null) return warn('The HTTP version did not respond.', 'Configure port 80 to 301-redirect to HTTPS.');
      if (probe.redirected && probe.finalUrl?.startsWith('https://')) return pass('HTTP redirects to HTTPS.');
      if (!probe.redirected && probe.status === 200) return fail('The HTTP version loads without redirecting to HTTPS.', 'Add a site-wide 301 redirect from HTTP to HTTPS.');
      return warn(`HTTP version returns ${probe.status}${probe.finalUrl ? ` (ends at ${displayUrl(probe.finalUrl)})` : ''}.`, 'Make HTTP URLs 301-redirect straight to the HTTPS version.');
    },
    'host-consistent': () => {
      const probe = c.hostVariantProbe;
      if (!probe) return na('Subdomain page — no www variant to compare.');
      const altHost = new URL(probe.url).hostname;
      if (probe.status === null) return warn(`${altHost} does not resolve.`, `Add a DNS record for ${altHost} and 301-redirect it to ${finalUrl.hostname}.`);
      if (probe.redirected && probe.finalUrl && new URL(probe.finalUrl).hostname === finalUrl.hostname) {
        return pass(`${altHost} redirects to ${finalUrl.hostname}.`);
      }
      if (!probe.redirected && probe.status === 200) {
        return fail(`Both ${altHost} and ${finalUrl.hostname} load without redirecting.`, `301-redirect ${altHost} to ${finalUrl.hostname} site-wide.`);
      }
      return warn(`${altHost} returns ${probe.status}${probe.finalUrl ? ` and ends at ${displayUrl(probe.finalUrl)}` : ''}.`, `301-redirect ${altHost} to ${finalUrl.hostname}.`);
    },
    'no-duplicate-url': () => {
      const twins = others.filter((s) => s.title && s.h1 && normalizeText(s.title) === normalizeText(title) && normalizeText(s.h1) === normalizeText(h1));
      if (twins.length) return fail(`Same title and H1 as ${names(twins)}.`, 'Consolidate the duplicates with a 301 redirect or canonical.');
      const probe = c.slashVariantProbe;
      if (probe && probe.status === 200 && !probe.redirected) {
        return canonicalSelf
          ? warn('Both the trailing-slash and non-slash versions load (canonical consolidates them).', 'Add a 301 redirect to one consistent trailing-slash format.')
          : fail('Both the trailing-slash and non-slash versions load without a redirect or canonical.', 'Redirect one version to the other and add a self-referencing canonical.');
      }
      return pass(probe ? 'URL variants redirect to this URL.' : 'No competing URL variants found.');
    },

    // 2. Title
    'title-exists': () => {
      if (!title) return fail('No title tag.', 'Add a unique, descriptive <title> to the page head.');
      if (c.titleCount > 1) return warn(`${c.titleCount} title tags found; using ${quote(title)}.`, 'Keep a single <title> tag.');
      return pass(quote(title));
    },
    'title-topic': () => (title ? topicIn(title) ?? fail(`Title does not mention "${keyword}".`, `Include "${keyword}" naturally in the title.`) : fail('No title tag.', 'Add a title that includes the primary topic.')),
    'title-topic-early': () => {
      if (!title || !hasKeyword) return na('Not applicable.');
      if (topicCoverage(title, keyword) < 0.4) return na('Primary topic is not in the title.');
      const words = normalizeText(title).split(' ');
      const tokens = new Set(topicTokens(keyword));
      const index = words.findIndex((w) => tokens.has(w) || tokens.has(w.replace(/s$/, '')));
      return index >= 0 && (index <= 3 || index / words.length <= 0.5)
        ? pass('Topic appears in the first half of the title.')
        : warn('Topic appears late in the title.', `Move "${keyword}" closer to the start of the title.`);
    },
    'title-unique': () => {
      if (!title) return na('No title tag.');
      if (sameTitleSiblings.length) return fail(`Same title as ${names(sameTitleSiblings)}.`, 'Write a unique title for each page.');
      return pass(others.length ? `Unique across ${others.length} other audited page${others.length === 1 ? '' : 's'}.` : 'No other audited pages to compare yet.');
    },
    'title-not-repetitive': () => {
      if (!title) return na('No title tag.');
      const counts = new Map<string, number>();
      normalizeText(title).split(' ').filter((w) => w.length > 2).forEach((w) => counts.set(w, (counts.get(w) || 0) + 1));
      const repeated = [...counts.entries()].filter(([, n]) => n >= 2).map(([w]) => w);
      if (repeated.length >= 2 || [...counts.values()].some((n) => n >= 3)) {
        return warn(`Repeats ${repeated.map((w) => `"${w}"`).join(', ')}.`, 'Remove repeated words so the title reads naturally.');
      }
      return pass('No repeated words.');
    },
    'title-no-stuffing': () => {
      if (!title) return na('No title tag.');
      const separators = (title.match(/[|,•·]/g) || []).length;
      if (hasKeyword && countPhrase(title, keyword) >= 2) return fail(`"${keyword}" appears more than once.`, 'Use the keyword once and add a benefit or differentiator instead.');
      if (separators >= 4) return warn('Title reads like a keyword list.', 'Write the title as a natural phrase with one main keyword.');
      return pass('No keyword stuffing.');
    },
    'title-brand': () => {
      if (!title) return na('No title tag.');
      if (hasBrand(title)) return pass('Brand name included.');
      return isHome
        ? fail('Homepage title does not include the brand name.', `Add your brand, e.g. "${title} | ${input.projectName}".`)
        : warn('Brand name not in the title.', `Consider appending " | ${input.projectName}" if space allows.`);
    },
    'title-length': () => {
      if (!title) return na('No title tag.');
      const length = title.length;
      if (length > 70) return fail(`${length} characters — will be truncated in search results.`, 'Keep titles around 50–60 characters.');
      if (length > 60) return warn(`${length} characters — may be truncated.`, 'Trim the title to about 50–60 characters.');
      if (length < 30) return warn(`Only ${length} characters.`, 'Use the space to add the topic and a benefit (about 50–60 characters).');
      return pass(`${length} characters.`);
    },

    // 3. Meta description
    'meta-exists': () => {
      if (!meta) return fail('No meta description.', 'Write a 140–160 character meta description that summarises the page.');
      if (c.metaDescriptionCount > 1) return warn(`${c.metaDescriptionCount} meta description tags found.`, 'Keep a single meta description tag.');
      return pass(quote(meta, 120));
    },
    'meta-topic': () => (meta ? topicIn(meta) ?? warn(`Does not mention "${keyword}".`, `Include "${keyword}" naturally — matching terms are bolded in results.`) : na('No meta description.')),
    'meta-no-stuffing': () => {
      if (!meta) return na('No meta description.');
      return hasKeyword && countPhrase(meta, keyword) >= 3
        ? fail(`"${keyword}" repeated ${countPhrase(meta, keyword)} times.`, 'Mention the keyword once and focus on the benefit.')
        : pass('No keyword stuffing.');
    },
    'meta-not-duplicated': () => {
      if (!meta) return na('No meta description.');
      if (sameMetaSiblings.length) return fail(`Same meta description as ${names(sameMetaSiblings)}.`, 'Write a unique meta description for each page.');
      return pass(others.length ? 'Unique across audited pages.' : 'No other audited pages to compare yet.');
    },
    'meta-length': () => {
      if (!meta) return na('No meta description.');
      const length = meta.length;
      if (length >= 120 && length <= 160) return pass(`${length} characters.`);
      if ((length >= 70 && length < 120) || (length > 160 && length <= 180)) {
        return warn(`${length} characters.`, 'Aim for 120–160 characters so it is neither cut off nor too thin.');
      }
      return fail(`${length} characters.`, 'Rewrite to 120–160 characters.');
    },

    // 4. Headings
    'h1-single': () => {
      if (h1s.length === 0) return fail('No H1 heading.', 'Add one H1 that states the page topic.');
      if (h1s.length > 1) return warn(`${h1s.length} H1s: ${h1s.slice(0, 3).map((h) => quote(h.text, 40)).join(', ')}.`, 'Keep one H1 and turn the others into H2s.');
      return pass(quote(h1));
    },
    'h1-topic': () => (h1 ? topicIn(h1) ?? fail(`H1 does not reflect "${keyword}".`, `Include "${keyword}" naturally in the H1.`) : fail('No H1 heading.', 'Add an H1 that includes the primary topic.')),
    'h1-descriptive': () => {
      if (!h1) return fail('No H1 heading.', 'Add a descriptive H1.');
      if (sameH1Siblings.length) return fail(`Same H1 as ${names(sameH1Siblings)}.`, 'Give each page a unique H1.');
      if (h1.length < 10 || /^(home|welcome|blog|untitled|page|services?|products?|about( us)?|hello|menu)$/i.test(h1)) {
        return warn(`H1 ${quote(h1)} is too generic.`, 'Make the H1 describe what this specific page offers.');
      }
      if (h1.length > 90) return warn(`H1 is ${h1.length} characters long.`, 'Shorten the H1 to one clear statement.');
      return pass('H1 is specific and descriptive.');
    },
    'h2-sections': () => {
      const h2Count = c.headings.filter((h) => h.level === 2).length;
      if (c.wordCount < 300) return h2Count ? pass(`${h2Count} H2s.`) : na('Short page — sections are optional.');
      if (h2Count >= 2) return pass(`${h2Count} H2 sections.`);
      if (h2Count === 1) return warn('Only one H2 on a long page.', 'Break the content into clear H2 sections.');
      return fail(`No H2s across ${c.wordCount} words.`, 'Organise the content into H2 sections for each major subtopic.');
    },
    'h3-logical': () => {
      let seenH2 = false;
      let seenH3 = false;
      const problems: string[] = [];
      for (const heading of c.headings) {
        if (heading.level === 2) {
          seenH2 = true;
          seenH3 = false;
        }
        if (heading.level === 3) {
          if (!seenH2) problems.push(`H3 ${quote(heading.text, 40)} appears before any H2`);
          seenH3 = true;
        }
        if (heading.level === 4 && !seenH3) problems.push(`H4 ${quote(heading.text, 40)} has no parent H3`);
      }
      if (!c.headings.some((h) => h.level >= 3)) return pass('No H3/H4 nesting needed.');
      return problems.length
        ? warn(`${problems.length} nesting issue${problems.length === 1 ? '' : 's'}: ${problems[0]}.`, 'Nest H3s under H2s and H4s under H3s.')
        : pass('H3/H4s are nested under the right parents.');
    },
    'heading-levels': () => {
      let skips = 0;
      let example = '';
      for (let i = 1; i < c.headings.length; i++) {
        if (c.headings[i].level > c.headings[i - 1].level + 1) {
          skips += 1;
          example ||= `H${c.headings[i - 1].level} → H${c.headings[i].level}`;
        }
      }
      if (skips >= 3) return fail(`${skips} skipped heading levels (e.g. ${example}).`, "Don't skip levels — go H1 → H2 → H3.");
      if (skips > 0) return warn(`${skips} skipped heading level${skips === 1 ? '' : 's'} (${example}).`, "Don't skip levels — go H1 → H2 → H3.");
      return pass('Heading levels follow in order.');
    },
    'heading-not-styling': () => {
      const empty = c.headings.filter((h) => !h.text).length;
      const long = c.headings.filter((h) => h.text.length > 120).length;
      const ui = c.headings.filter((h) =>
        /^(menu|search|cart|follow us|subscribe|newsletter|share( this)?|quick links|categories|recent posts|tags|related posts|social|navigation|footer)$/i.test(h.text),
      ).length;
      const issues = [empty && `${empty} empty`, long && `${long} paragraph-length`, ui && `${ui} UI-label`].filter(Boolean);
      return issues.length
        ? warn(`Found ${issues.join(', ')} heading${empty + long + ui === 1 ? '' : 's'}.`, 'Use heading tags only for content structure; style other text with CSS.')
        : pass('Headings are used for structure.');
    },
    'heading-questions': () => {
      const questions = c.headings.filter((h) => /\?$/.test(h.text) || /^(what|how|why|when|where|which|who|can|does|do|is|are|should)\b/i.test(h.text));
      if (questions.length) return pass(`${questions.length} question heading${questions.length === 1 ? '' : 's'}, e.g. ${quote(questions[0].text, 60)}.`);
      if (c.wordCount < 400 || ['contact', 'about', 'pricing'].includes(pageType)) return na('Short or non-informational page.');
      return warn('No question-style headings.', 'Add H2/H3s for the key questions searchers ask about this topic.');
    },

    // 7. Keyword / topic
    'kw-in-title': () => rules['title-topic'](),
    'kw-in-h1': () => rules['h1-topic'](),
    'kw-in-intro': () => topicIn(c.introText) ?? fail(`Introduction does not mention "${keyword}".`, `Mention "${keyword}" in the first 100 words.`),
    'kw-in-subheadings': () => {
      if (!hasKeyword) return na('Primary keyword could not be determined.');
      if (!subheadings.length) return na('No H2/H3 headings.');
      const matching = subheadings.filter((h) => topicCoverage(h.text, keyword) >= 0.5).length;
      if (!matching) return warn('Topic does not appear in any H2/H3.', `Use "${keyword}" or a close variation in one or two subheadings.`);
      if (subheadings.length >= 4 && matching / subheadings.length > 0.8) {
        return warn(`Topic is in ${matching} of ${subheadings.length} subheadings — over-optimised.`, 'Vary subheadings with related terms instead of repeating the keyword.');
      }
      return pass(`Topic appears in ${matching} of ${subheadings.length} subheadings.`);
    },
    'kw-in-body': () => {
      if (!hasKeyword) return na('Primary keyword could not be determined.');
      const coverage = topicCoverage(c.contentText, keyword);
      const exact = countPhrase(c.contentText, keyword);
      if (exact >= 2 || coverage >= 0.9) return pass(`Topic is used throughout the content (${exact} exact mention${exact === 1 ? '' : 's'}).`);
      if (coverage >= 0.5) return warn(`Body only partly covers "${keyword}".`, 'Use the main topic and its variations naturally in the body.');
      return fail(`Body content rarely mentions "${keyword}".`, 'Make the main topic clear throughout the content.');
    },
    'kw-in-url': () => rules['url-topic'](),
    'kw-in-alt': () => {
      if (!hasKeyword) return na('Primary keyword could not be determined.');
      if (!contentImages.length) return na('No content images.');
      return contentImages.some((img) => topicCoverage(img.alt, keyword) >= 0.5)
        ? pass('At least one image alt text reflects the topic.')
        : warn('No image alt text reflects the topic.', `Describe the most relevant image with alt text that naturally includes "${keyword}".`);
    },
    'kw-no-repetition': () => {
      if (!hasKeyword || c.wordCount < 100) return na('Not enough content to measure.');
      const exact = countPhrase(c.contentText, keyword);
      const density = (exact * topicTokens(keyword).length * 100) / Math.max(c.wordCount, 1);
      if (exact < 4) return pass(`"${keyword}" appears ${exact} time${exact === 1 ? '' : 's'} as an exact phrase.`);
      if (density > 3) return fail(`Keyword density ${density.toFixed(1)}% (${exact} mentions).`, 'Replace repeated exact matches with synonyms and natural phrasing.');
      if (density > 2) return warn(`Keyword density ${density.toFixed(1)}%.`, 'Reduce exact-match repetition.');
      return pass(`Natural usage (${density.toFixed(1)}% density).`);
    },
    'kw-no-overlap': () => {
      if (!hasKeyword) return na('Primary keyword could not be determined.');
      if (sameKeywordSiblings.length) {
        return warn(`${names(sameKeywordSiblings)} also target${sameKeywordSiblings.length === 1 ? 's' : ''} "${keyword}".`, 'Differentiate the pages or merge them so one URL owns this topic.');
      }
      return pass(others.length ? 'No other audited page targets this topic.' : 'No other audited pages to compare yet.');
    },

    // 8. Internal links
    'il-has-links': () => {
      const count = contentInternalTargets.size;
      if (count >= 3) return pass(`${count} internal links in the main content.`);
      if (count > 0) return warn(`Only ${count} internal link${count === 1 ? '' : 's'} in the main content.`, 'Add contextual links to related pages on your site.');
      if (internalLinks.length) return warn('Only navigation/footer links — none inside the content.', 'Add contextual internal links inside the body copy.');
      return fail('No internal links found.', 'Link to related pages on your site.');
    },
    'il-inbound': () => {
      if (isHome) return pass('Homepage.');
      if (homepageLinked) return pass(`Linked from the homepage${linkingSiblings.length ? ` and ${names(linkingSiblings)}` : ''}.`);
      if (linkingSiblings.length) return pass(`Linked from ${names(linkingSiblings)}.`);
      if (!siteContext) return na('Site links not available.');
      return warn('Not linked from the homepage or other audited pages.', 'Link to this page from the homepage, main navigation or related high-traffic pages.');
    },
    'il-outbound': () => {
      const supporting = [...contentInternalTargets].filter((key) => {
        const pathPart = key.slice(key.indexOf('/'));
        return pathPart !== '/' && !/\/(contact|privacy|terms|legal|cookie)/.test(pathPart);
      }).length;
      if (supporting >= 2) return pass(`Links to ${supporting} supporting pages.`);
      if (supporting === 1) return warn('Links to only one supporting page.', 'Link to related guides, services or articles that go deeper.');
      return warn('No links to supporting pages in the content.', 'Link to related guides, services or articles that go deeper.');
    },
    'il-anchor-descriptive': () => {
      const anchors = (contentInternal.length ? contentInternal : internalLinks).map((l) => l.text.trim());
      if (!anchors.length) return na('No internal links.');
      const generic = anchors.filter((text) => !text || GENERIC_ANCHOR.test(text));
      const share = ratio(generic.length, anchors.length);
      const example = generic.find(Boolean);
      const detail = `${generic.length} of ${anchors.length} anchors are generic or empty${example ? ` (e.g. ${quote(example, 30)})` : ''}.`;
      if (share <= 0.15) return pass(generic.length ? detail : 'Anchors describe their target pages.');
      const rec = 'Replace generic anchors like "click here" with text that describes the target page.';
      return share <= 0.35 ? warn(detail, rec) : fail(detail, rec);
    },
    'il-anchor-not-exact': () => {
      if (!contentInternal.length) return na('No internal links in the content.');
      const byTarget = new Map<string, string[]>();
      contentInternal.forEach((l) => {
        const key = comparableUrl(l.href);
        byTarget.set(key, [...(byTarget.get(key) || []), normalizeText(l.text)]);
      });
      const repeated = [...byTarget.entries()].find(([, texts]) => texts.length >= 3 && new Set(texts).size === 1 && texts[0]);
      if (repeated) {
        return warn(`The same anchor ${quote(repeated[1][0], 40)} is used ${repeated[1].length}× for one page.`, 'Vary anchor text naturally instead of repeating one exact phrase.');
      }
      return pass('Anchor text is varied.');
    },
    'il-no-broken': () => {
      const scan = c.linkScan;
      if (!scan.checkedInternal) return na('No internal links to check.');
      if (scan.brokenInternal.length) {
        return fail(
          `${scan.brokenInternal.length} broken: ${scan.brokenInternal.slice(0, 3).map((b) => `${displayUrl(b.url)} (${b.status ?? 'error'})`).join(', ')}.`,
          'Fix or remove broken links, or redirect the missing pages.',
        );
      }
      if (scan.redirectedInternal) {
        return warn(`${scan.redirectedInternal} internal link${scan.redirectedInternal === 1 ? '' : 's'} point to redirects.`, 'Update links to point straight to the final URLs.');
      }
      return pass(`Checked ${scan.checkedInternal} internal links — none broken.`);
    },
    'il-not-orphaned': () => {
      if (isHome) return pass('Homepage.');
      if (!siteContext) return na('Site links not available.');
      if (homepageLinked || linkingSiblings.length) return pass('Reachable through internal links.');
      if (inSitemap) return warn('Only found in the sitemap — no links from the homepage or other audited pages.', 'Add internal links from related pages so crawlers and users can reach it.');
      return fail('Not in the sitemap and not linked from the homepage or other audited pages.', 'Add the page to your sitemap and link to it from related pages.');
    },
    'il-topical': () => {
      if (c.breadcrumbs.present) return pass('Breadcrumbs connect the page to its section.');
      if (isHome) return contentInternalTargets.size + internalLinks.length >= 3 ? pass('Homepage links out to site sections.') : warn('Homepage links to few sections.', 'Link to your main category and service pages.');
      const parent = path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/';
      const linksParent = parent !== '/' && internalLinks.some((l) => comparableUrl(l.href) === comparableUrl(`${finalUrl.origin}${parent}`));
      return linksParent
        ? pass(`Links back to its parent section ${parent}.`)
        : warn('No breadcrumb or link back to a parent hub page.', 'Link to the parent category/hub page (or add breadcrumbs) to reinforce topic clusters.');
    },
    'il-commercial': () => {
      const commercialPage = COMMERCIAL_PATH.test(path) || ['product', 'service', 'pricing', 'landing'].includes(pageType);
      if (commercialPage) {
        if (isHome || homepageLinked || linkingSiblings.length) return pass('This conversion page receives internal links.');
        return warn('This conversion page is not linked from the homepage or audited pages.', 'Link to it from the homepage, navigation and relevant articles.');
      }
      return internalLinks.some((l) => COMMERCIAL_PATH.test(new URL(l.href).pathname))
        ? pass('Links to a conversion page (pricing, services, contact…).')
        : warn('No links to a conversion page.', 'Link to a relevant product, service or contact page.');
    },

    // 9. External links
    'el-not-excessive': () => {
      const count = externalContent.length;
      if (!count) return pass('No external links in the content.');
      const per100 = (count * 100) / Math.max(c.wordCount, 1);
      return per100 > 3 || count > 60
        ? warn(`${count} external links (${per100.toFixed(1)} per 100 words).`, 'Keep only the external links that genuinely help the reader.')
        : pass(`${count} external link${count === 1 ? '' : 's'} in the content.`);
    },
    'el-no-broken': () => {
      const scan = c.linkScan;
      if (!scan.checkedExternal) return na('No external links to check.');
      const broken = scan.brokenExternal;
      if (!broken.length) return pass(`Checked ${scan.checkedExternal} external links — none broken.`);
      const detail = `${broken.length} broken: ${broken.slice(0, 3).map((b) => displayUrl(b.url)).join(', ')}.`;
      return broken.length >= 2 ? fail(detail, 'Replace or remove broken external links.') : warn(detail, 'Replace or remove the broken external link.');
    },
    'el-rel': () => {
      const unmarked = c.links.filter((l) => !l.internal && AFFILIATE_LINK.test(l.href) && !/sponsored|nofollow/.test(l.rel));
      return unmarked.length
        ? warn(`${unmarked.length} affiliate-style link${unmarked.length === 1 ? '' : 's'} without rel="sponsored" (e.g. ${displayUrl(unmarked[0].href).slice(0, 60)}).`, 'Add rel="sponsored" (or nofollow) to paid and affiliate links.')
        : pass('No unmarked sponsored/affiliate links found.');
    },

    // 10. Images
    'img-filenames': () => {
      if (!contentImages.length) return na('No content images.');
      const generic = contentImages.filter((img) => {
        const base = img.filename.replace(/\.[a-z0-9]+$/i, '').replace(/-\d+x\d+$/, '');
        return /^(img|image|dsc|dcim|photo|pic|screenshot|screen-shot|untitled|unnamed|file|wp-image|pexels|unsplash)[-_ ]?[\d-]*$/i.test(base) || /^[a-f0-9-]{16,}$/i.test(base) || /^[\d_-]+$/.test(base) || !base;
      });
      const good = 1 - ratio(generic.length, contentImages.length);
      const detail = `${contentImages.length - generic.length} of ${contentImages.length} filenames are descriptive${generic[0] ? ` (e.g. "${generic[0].filename}" is not)` : ''}.`;
      if (good >= 0.7) return pass(detail);
      return good >= 0.4 ? warn(detail, 'Rename images with short, descriptive, hyphenated filenames.') : fail(detail, 'Rename images with short, descriptive, hyphenated filenames.');
    },
    'img-alt': () => {
      if (!contentImages.length) return na('No content images.');
      const withAlt = contentImages.filter((img) => (img.alt || '').trim().length > 0).length;
      const share = ratio(withAlt, contentImages.length);
      const detail = `${withAlt} of ${contentImages.length} content images have alt text.`;
      if (share >= 0.9) return pass(detail);
      return share >= 0.6 ? warn(detail, 'Add concise, descriptive alt text to every meaningful image.') : fail(detail, 'Add concise, descriptive alt text to every meaningful image.');
    },
    'img-alt-not-stuffed': () => {
      if (!contentImages.length) return na('No content images.');
      const stuffed = contentImages.filter((img) => {
        const alt = img.alt || '';
        return alt.length > 125 || (hasKeyword && countPhrase(alt, keyword) >= 2) || (alt.match(/,/g) || []).length >= 4;
      });
      return stuffed.length
        ? warn(`${stuffed.length} alt text${stuffed.length === 1 ? ' looks' : 's look'} stuffed or overly long.`, 'Describe the image in one short, natural sentence.')
        : pass('Alt text is natural.');
    },
    'img-decorative': () => {
      const decorative = c.images.filter((img) => img.decorative);
      if (!decorative.length) return na('No decorative images detected.');
      const noisy = decorative.filter((img) => (img.alt || '').trim().length > 15);
      return noisy.length
        ? warn(`${noisy.length} decorative image${noisy.length === 1 ? ' has' : 's have'} descriptive alt text.`, 'Use alt="" for purely decorative images and icons.')
        : pass('Decorative images use empty or minimal alt text.');
    },
    'img-compressed': () => {
      const audit = auditScore(primarySpeed, ['image-delivery-insight', 'uses-optimized-images']);
      const huge = c.imageScan.large.filter((img) => img.bytes > 1024 * 1024);
      if (huge.length) return fail(`${huge.length} image${huge.length === 1 ? ' is' : 's are'} over 1 MB (e.g. ${formatBytes(huge[0].bytes)}).`, 'Compress images (aim for under 200 KB) and serve WebP/AVIF.');
      if (audit.score !== null && audit.score < 0.9) return speedVerdict(audit, '', 'Compress images and serve them in WebP/AVIF at the displayed size.');
      if (c.imageScan.large.length) return warn(`${c.imageScan.large.length} image${c.imageScan.large.length === 1 ? ' is' : 's are'} over 300 KB.`, 'Compress large images to under ~200 KB.');
      if (audit.score === null && !c.imageScan.checked) return na('No images to check.');
      return pass('Images are reasonably compressed.');
    },
    'img-modern': () => {
      const fromScan = Object.entries(c.imageScan.formats).filter(([format]) => format !== 'svg');
      const counts = fromScan.length
        ? fromScan
        : Object.entries(
            rasterImages.reduce<Record<string, number>>((acc, img) => {
              acc[img.format] = (acc[img.format] || 0) + 1;
              return acc;
            }, {}),
          ).filter(([format]) => format !== 'unknown');
      const total = counts.reduce((sum, [, n]) => sum + n, 0);
      if (!total) return na('No raster images to check.');
      const modern = counts.filter(([format]) => format === 'webp' || format === 'avif').reduce((sum, [, n]) => sum + n, 0);
      const share = ratio(modern, total);
      const detail = `${modern} of ${total} images use WebP/AVIF.`;
      if (share >= 0.6) return pass(detail);
      return share >= 0.25 ? warn(detail, 'Serve images as WebP or AVIF.') : fail(detail, 'Serve images as WebP or AVIF — typically 25–50% smaller than JPEG/PNG.');
    },
    'img-dimensions': () => {
      if (!rasterImages.length) return na('No content images.');
      const sized = rasterImages.filter((img) => img.width && img.height).length;
      const share = ratio(sized, rasterImages.length);
      const audit = auditScore(primarySpeed, ['unsized-images']);
      const detail = `${sized} of ${rasterImages.length} images declare width and height.`;
      if (audit.score !== null && audit.score < 0.5) return fail(`${detail} The speed test flagged unsized images.`, 'Add width and height attributes so the browser reserves space.');
      if (share >= 0.8) return pass(detail);
      return share >= 0.5 ? warn(detail, 'Add width and height attributes to images to prevent layout shifts.') : fail(detail, 'Add width and height attributes to images to prevent layout shifts.');
    },
    'img-responsive': () => {
      if (!rasterImages.length) return na('No content images.');
      const responsive = rasterImages.filter((img) => img.hasSrcset || img.inPicture).length;
      const share = ratio(responsive, rasterImages.length);
      const audit = auditScore(mobile, ['uses-responsive-images', 'image-delivery-insight']);
      const detail = `${responsive} of ${rasterImages.length} images use srcset/picture.`;
      if (share >= 0.5) return pass(detail);
      if (audit.score !== null && audit.score >= 0.9) return pass(`${detail} The speed test found no oversized images.`);
      return warn(detail, 'Use srcset/sizes (or <picture>) so mobile devices download smaller files.');
    },
    'img-not-large': () => {
      const large = c.imageScan.large;
      const audit = auditScore(mobile, ['uses-responsive-images', 'image-delivery-insight']);
      if (large.some((img) => img.bytes > 1024 * 1024)) return fail(`Largest image is ${formatBytes(Math.max(...large.map((img) => img.bytes)))}.`, 'Resize images to the size they are displayed at and compress them.');
      if (large.length) return warn(`${large.length} image${large.length === 1 ? ' is' : 's are'} over 300 KB.`, 'Resize and compress large images.');
      if (audit.score !== null && audit.score < 0.5) return speedVerdict(audit, '', 'Serve images at the size they are displayed.');
      if (!c.imageScan.checked && audit.score === null) return na('No images to check.');
      return pass('No oversized images found.');
    },
    'img-lazy': () => {
      if (contentImages.length <= 2) return na('Only a couple of images — lazy loading not needed.');
      const below = contentImages.slice(2);
      const lazy = below.filter((img) => img.loading === 'lazy').length;
      const audit = auditScore(mobile, ['offscreen-images']);
      if (ratio(lazy, below.length) >= 0.5) return pass(`${lazy} of ${below.length} below-the-fold images lazy-load.`);
      if (audit.score !== null && audit.score >= 0.9) return pass('The speed test found no offscreen images loading early.');
      return warn(`Only ${lazy} of ${below.length} below-the-fold images use loading="lazy".`, 'Add loading="lazy" to images below the first screen.');
    },
    'img-hero-eager': () => {
      const audit = auditScore(mobile, ['lcp-lazy-loaded', 'lcp-discovery-insight', 'prioritize-lcp-image']);
      if (audit.score !== null && audit.score < 0.5) return fail(`${audit.label}.`, 'Remove loading="lazy" from the hero/LCP image and add fetchpriority="high".');
      if (!contentImages.length) return na('No content images.');
      if (contentImages[0].loading === 'lazy') return warn('The first content image is lazy-loaded.', 'Load the hero image eagerly (no loading="lazy") with fetchpriority="high".');
      return pass('Above-the-fold image loads eagerly.');
    },
    'img-no-broken': () => {
      if (!c.imageScan.checked) return na('No images to check.');
      return c.imageScan.broken.length
        ? fail(`${c.imageScan.broken.length} broken image${c.imageScan.broken.length === 1 ? '' : 's'}: ${c.imageScan.broken.slice(0, 2).map((b) => displayUrl(b.url).slice(0, 60)).join(', ')}.`, 'Fix the image URLs or remove the images.')
        : pass(`Checked ${c.imageScan.checked} images — none broken.`);
    },

    // 11. Page speed
    'ps-lcp': () => {
      if (!primarySpeed) return noSpeed;
      const field = primarySpeed.field.lcpMs;
      const value = field ?? primarySpeed.lcpMs;
      if (value === null) return na('LCP not reported.');
      const source = field !== null ? `real users (${primarySpeed.field.source === 'url' ? 'this page' : 'site-wide'})` : 'lab test';
      return thresholdVerdict(value, 2500, 4000, `LCP ${formatMs(value)} on ${mobile ? 'mobile' : 'desktop'} — ${source}.`, 'Speed up the largest element: compress the hero image, preload it and cut render-blocking resources.');
    },
    'ps-inp': () => {
      if (!primarySpeed) return noSpeed;
      if (primarySpeed.field.inpMs !== null) {
        return thresholdVerdict(primarySpeed.field.inpMs, 200, 500, `INP ${formatMs(primarySpeed.field.inpMs)} from real users.`, 'Break up long JavaScript tasks and defer non-critical scripts.');
      }
      if (primarySpeed.tbtMs === null) return na('INP not reported.');
      return thresholdVerdict(primarySpeed.tbtMs, 200, 600, `No real-user INP yet; Total Blocking Time ${formatMs(primarySpeed.tbtMs)} used as a lab proxy.`, 'Reduce main-thread work: defer non-critical JavaScript and split long tasks.');
    },
    'ps-cls': () => {
      if (!primarySpeed) return noSpeed;
      const value = primarySpeed.field.cls ?? primarySpeed.cls;
      if (value === null) return na('CLS not reported.');
      return thresholdVerdict(value, 0.1, 0.25, `CLS ${value.toFixed(2)} (${primarySpeed.field.cls !== null ? 'real users' : 'lab test'}).`, 'Reserve space for images, embeds and banners so content does not jump.');
    },
    'ps-mobile': () => {
      if (!mobile) return speed?.mobile === null && speed?.desktop ? na('Mobile test unavailable.') : noSpeed;
      return thresholdVerdict(100 - mobile.performance, 10, 50, `Mobile performance score ${mobile.performance}/100.`, 'Work through the speed items below — mobile is what Google uses for ranking.');
    },
    'ps-desktop': () => {
      if (!desktop) return mobile ? na('Desktop test unavailable.') : noSpeed;
      return thresholdVerdict(100 - desktop.performance, 10, 50, `Desktop performance score ${desktop.performance}/100.`, 'Optimise images, scripts and fonts to raise the desktop score.');
    },
    'ps-images': () => (primarySpeed ? speedVerdict(auditScore(mobile ?? desktop, ['image-delivery-insight', 'uses-optimized-images', 'modern-image-formats', 'uses-responsive-images']), 'Images are delivered efficiently.', 'Compress, resize and convert large images to WebP/AVIF.') : noSpeed),
    'ps-render-blocking': () => (primarySpeed ? speedVerdict(auditScore(primarySpeed, ['render-blocking-insight', 'render-blocking-resources']), 'No significant render-blocking resources.', 'Inline critical CSS and defer or async non-critical CSS/JS.') : noSpeed),
    'ps-js': () => (primarySpeed ? speedVerdict(auditScore(primarySpeed, ['unused-javascript', 'legacy-javascript-insight', 'legacy-javascript', 'unminified-javascript', 'bootup-time']), 'JavaScript is lean.', 'Remove unused JavaScript, code-split bundles and defer non-critical scripts.') : noSpeed),
    'ps-css': () => (primarySpeed ? speedVerdict(auditScore(primarySpeed, ['unused-css-rules', 'unminified-css']), 'CSS is optimised.', 'Remove unused CSS and minify stylesheets.') : noSpeed),
    'ps-fonts': () => (primarySpeed ? speedVerdict(auditScore(primarySpeed, ['font-display-insight', 'font-display']), 'Fonts display without blocking text.', 'Use font-display: swap, preload key fonts and self-host where possible.') : noSpeed),
    'ps-third-party': () => (primarySpeed ? speedVerdict(auditScore(primarySpeed, ['third-parties-insight', 'third-party-summary']), 'Third-party code has limited impact.', 'Audit third-party tags (chat, analytics, ads) and delay or remove the heaviest.') : noSpeed),
    'ps-above-fold': () => {
      if (!primarySpeed) return noSpeed;
      if (primarySpeed.fcpMs === null) return na('First Contentful Paint not reported.');
      return thresholdVerdict(primarySpeed.fcpMs, 1800, 3000, `First content appears after ${formatMs(primarySpeed.fcpMs)}.`, 'Reduce server response time and render-blocking resources so content paints sooner.');
    },
    'ps-layout-shifts': () => {
      if (!primarySpeed) return noSpeed;
      const audit = auditScore(primarySpeed, ['cls-culprits-insight', 'layout-shifts', 'layout-shift-elements']);
      if (audit.score !== null) return speedVerdict(audit, 'No major layout shifts.', 'Set dimensions on images/embeds and avoid inserting content above existing content.');
      return primarySpeed.cls === null ? na('Not reported.') : thresholdVerdict(primarySpeed.cls, 0.1, 0.25, `Lab CLS ${primarySpeed.cls.toFixed(2)}.`, 'Set dimensions on media and avoid late-loading banners.');
    },

    // 12. Mobile UX
    'mx-responsive': () => {
      if (!viewportOk) return fail('No responsive viewport meta tag.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
      const audit = auditScore(mobile, ['viewport', 'viewport-insight']);
      if (audit.score !== null && audit.score < 0.9) return warn(audit.label, 'Fix the viewport configuration for mobile.');
      return pass('Responsive viewport configured.');
    },
    'mx-no-hscroll': () => {
      const audit = auditScore(mobile, ['content-width']);
      if (audit.score !== null) return speedVerdict(audit, 'Content fits the mobile viewport.', 'Make wide elements (tables, images, embeds) fit the screen width.');
      return viewportOk ? pass('Viewport is device-width; no overflow reported.') : fail('Without a viewport tag, mobile users must scroll sideways.', 'Add a responsive viewport meta tag.');
    },
    'mx-readable': () => {
      if (!viewportOk) return fail('No viewport tag — text renders at desktop size on phones.', 'Add a responsive viewport meta tag.');
      const audit = auditScore(mobile, ['font-size']);
      if (audit.score !== null && audit.score < 0.9) return warn(audit.label, 'Use at least 16px body text on mobile.');
      if (zoomDisabled) return warn('Pinch-zoom is disabled in the viewport tag.', 'Remove maximum-scale=1 / user-scalable=no so users can zoom.');
      return pass('Text scales to the device width.');
    },
    'mx-tap-targets': () => speedVerdict(auditScore(mobile, ['target-size']), 'Tap targets are large enough.', 'Make buttons and links at least 24×24px with spacing between them.'),
    'mx-navigation': () => {
      if (!c.navPresent) return warn('No <nav> element found.', 'Wrap the main menu in a <nav> element that works on mobile.');
      return c.mobileMenuToggle ? pass('Navigation with a mobile menu toggle.') : warn('Navigation found but no mobile menu toggle detected.', 'Make sure the menu collapses into an accessible toggle on small screens.');
    },
    'mx-popups': () =>
      c.popupSignals.length
        ? warn(`Detected: ${c.popupSignals.join(', ')}.`, 'Avoid full-screen popups on mobile, especially on page load.')
        : pass('No popup scripts or interstitial markup detected.'),
    'mx-sticky': () =>
      c.stickySignals > 3
        ? warn(`${c.stickySignals} fixed/sticky elements.`, 'Keep only one slim sticky bar on mobile so content stays visible.')
        : pass(c.stickySignals ? `${c.stickySignals} sticky element${c.stickySignals === 1 ? '' : 's'}.` : 'No sticky elements.'),
    'mx-forms': () => {
      if (!c.forms.count) return na('No forms on the page.');
      const issues = [
        c.forms.inputsWithoutLabel && `${c.forms.inputsWithoutLabel} field${c.forms.inputsWithoutLabel === 1 ? '' : 's'} without a label`,
        c.forms.withoutSubmit && `${c.forms.withoutSubmit} form${c.forms.withoutSubmit === 1 ? '' : 's'} without a submit button`,
      ].filter(Boolean);
      return issues.length ? warn(`${issues.join(', ')}.`, 'Label every field and give each form a clear submit button.') : pass(`${c.forms.count} form${c.forms.count === 1 ? '' : 's'} with labelled fields and submit buttons.`);
    },
    'mx-images-scale': () => {
      const audit = auditScore(mobile, ['image-size-responsive']);
      if (audit.score !== null) return speedVerdict(audit, 'Images are served at an appropriate resolution.', 'Serve images sized for the device using srcset.');
      if (!rasterImages.length) return na('No content images.');
      const fixed = rasterImages.filter((img) => Number(img.width) > 600 && !img.hasSrcset && !img.inPicture).length;
      return fixed ? warn(`${fixed} wide image${fixed === 1 ? '' : 's'} without srcset.`, 'Use srcset/sizes so images scale on small screens.') : pass('Images can scale to the screen.');
    },
    'mx-parity': () => {
      if (!c.mobileParity) return na('Mobile version could not be fetched.');
      if (c.wordCount < 50) return na('Too little text to compare.');
      const share = ratio(c.mobileParity.wordCount, c.wordCount);
      const detail = `Mobile HTML has ${c.mobileParity.wordCount} words vs ${c.wordCount} on desktop.`;
      if (share >= 0.8) return pass(detail);
      return share >= 0.5 ? warn(detail, 'Serve the same main content to mobile users — Google indexes the mobile version.') : fail(detail, 'Serve the same main content to mobile users — Google indexes the mobile version.');
    },

    // 13. Structured data
    'sd-identified': () => {
      const types = [...new Set([...c.schema.nodes.flatMap(nodeTypes), ...c.schema.microdataTypes])];
      if (!types.length) return fail('No structured data found.', `Add ${suggestedSchema(pageType, isHome)} in JSON-LD.`);
      return pass(`Found: ${types.slice(0, 8).join(', ')}.`);
    },
    'sd-implemented': () => {
      if (!c.schema.jsonLdBlocks && !c.schema.microdataTypes.length) return na('No structured data.');
      if (c.schema.parseErrors) return fail(`${c.schema.parseErrors} JSON-LD block${c.schema.parseErrors === 1 ? '' : 's'} contain invalid JSON.`, 'Fix the JSON syntax (validate with the Rich Results Test).');
      return pass(c.schema.jsonLdBlocks ? `${c.schema.jsonLdBlocks} JSON-LD block${c.schema.jsonLdBlocks === 1 ? '' : 's'} parse correctly.` : 'Microdata found.');
    },
    'sd-matches': () => {
      const nodes = c.schema.nodes;
      if (!nodes.length) return na('No JSON-LD structured data.');
      const mismatches: string[] = [];
      const pageText = normalizeText(`${title} ${h1} ${c.contentText}`);
      for (const node of nodes) {
        if (node.name && hasType([node], /^(Article|BlogPosting|NewsArticle|Product|Service|Event|Recipe|Course)$/) && tokenSimilarity(node.name, `${title} ${h1}`) < 0.2 && !pageText.includes(normalizeText(node.name).slice(0, 40))) {
          mismatches.push(`${nodeTypes(node)[0]} name ${quote(node.name, 50)}`);
        }
        node.questions.forEach((q) => {
          const question = normalizeText(q.replace(' [no answer]', '')).slice(0, 50);
          if (question && !pageText.includes(question)) mismatches.push(`FAQ ${quote(q, 50)}`);
        });
      }
      return mismatches.length
        ? warn(`Not visible on the page: ${mismatches.slice(0, 2).join('; ')}.`, 'Structured data must describe content users can see on the page.')
        : pass('Structured data matches the visible content.');
    },
    'sd-not-misleading': () => {
      const nodes = c.schema.nodes;
      if (!nodes.length) return na('No JSON-LD structured data.');
      const pageText = normalizeText(c.contentText);
      const hiddenFaq = nodes.flatMap((n) => n.questions).filter((q) => !pageText.includes(normalizeText(q.replace(' [no answer]', '')).slice(0, 50)));
      if (hiddenFaq.length >= 2) return fail(`${hiddenFaq.length} FAQ questions in schema are not on the page.`, 'Only mark up FAQs that are visible on the page.');
      if (nodes.some((n) => n.props.includes('aggregateRating') || /Review/.test(n.type)) && !/(review|rating|stars|testimonial)/.test(pageText)) {
        return warn('Rating/review markup without visible reviews on the page.', 'Show the reviews on the page or remove the rating markup.');
      }
      return pass('No misleading markup found.');
    },
    'sd-required': () => {
      if (!c.schema.nodes.length) return na('No JSON-LD structured data.');
      const { missingRequired } = schemaPropertyGaps(c.schema.nodes);
      return missingRequired.length
        ? fail(`Missing: ${missingRequired.slice(0, 4).join('; ')}.`, 'Add the required properties so the markup is eligible for rich results.')
        : pass('Required properties present.');
    },
    'sd-recommended': () => {
      if (!c.schema.nodes.length) return na('No JSON-LD structured data.');
      const { missingRecommended } = schemaPropertyGaps(c.schema.nodes);
      return missingRecommended.length
        ? warn(`Could add: ${missingRecommended.slice(0, 5).join('; ')}.`, 'Add recommended properties to strengthen the markup.')
        : pass('Recommended properties included.');
    },
    'sd-validates': () => {
      if (!c.schema.jsonLdBlocks && !c.schema.microdataTypes.length) return na('No structured data.');
      if (c.schema.parseErrors) return fail('Invalid JSON-LD syntax.', 'Fix the JSON-LD and re-test with the Rich Results Test.');
      const empty = c.schema.nodes.filter((n) => n.props.length === 0);
      return empty.length ? warn(`${empty.length} schema node${empty.length === 1 ? ' has' : 's have'} no properties.`, 'Fill in the schema properties or remove empty nodes.') : pass('Structured data parses without errors.');
    },
    'sd-no-conflicts': () => {
      if (!c.schema.nodes.length) return na('No JSON-LD structured data.');
      const groups = new Map<string, Set<string>>();
      c.schema.nodes.forEach((node) => {
        const type = nodeTypes(node)[0];
        if (!/^(Organization|WebSite|Article|BlogPosting|NewsArticle|Product|BreadcrumbList|FAQPage|LocalBusiness)$/.test(type)) return;
        const set = groups.get(type) || new Set<string>();
        set.add(node.name || `#${set.size}`);
        groups.set(type, set);
      });
      const conflicts = [...groups.entries()].filter(([, values]) => values.size > 1).map(([type]) => type);
      return conflicts.length
        ? warn(`Multiple conflicting ${conflicts.join(', ')} nodes.`, 'Keep one node per entity (often caused by a theme and an SEO plugin both adding schema).')
        : pass('No conflicting schema.');
    },
    'sd-site-basics': () => {
      const nodes = c.schema.nodes;
      if (isHome) {
        const org = hasType(nodes, /^(Organization|Corporation|OnlineBusiness|LocalBusiness|NGO)$/) || c.schema.microdataTypes.includes('Organization');
        const site = hasType(nodes, /^WebSite$/);
        if (org && site) return pass('Organization and WebSite schema present.');
        if (org || site) return warn(`Missing ${org ? 'WebSite' : 'Organization'} schema.`, 'Add both Organization and WebSite schema to the homepage.');
        return fail('No Organization or WebSite schema on the homepage.', 'Add Organization (logo, sameAs, contact) and WebSite schema.');
      }
      if (hasType(nodes, /^BreadcrumbList$/) || c.schema.microdataTypes.includes('BreadcrumbList')) return pass('BreadcrumbList schema present.');
      return depth >= 1 ? warn('No BreadcrumbList schema.', 'Add BreadcrumbList schema that mirrors the page path.') : na('Not applicable.');
    },
    'sd-appropriate': () => {
      const nodes = c.schema.nodes;
      if (!nodes.length) return na('No JSON-LD structured data.');
      const issues: string[] = [];
      if (hasType(nodes, /^Product$/) && ['blog-article', 'guide', 'about', 'contact'].includes(pageType)) issues.push(`Product schema on a ${pageType} page`);
      if (hasType(nodes, /^(Article|BlogPosting|NewsArticle)$/) && ['product', 'pricing', 'homepage', 'contact'].includes(pageType)) issues.push(`Article schema on a ${pageType} page`);
      if (hasType(nodes, /^FAQPage$/) && !c.headings.some((h) => /\?$/.test(h.text)) && !/faq|frequently asked/i.test(c.contentText)) issues.push('FAQPage schema without a visible FAQ section');
      if (hasType(nodes, /^HowTo$/)) issues.push('HowTo schema (no longer shown as a rich result)');
      return issues.length ? warn(`${issues.join('; ')}.`, 'Use schema types that match what the page actually is.') : pass('Schema types fit the page.');
    },

    // 15. Conversion / UX
    'cx-visible': () => {
      if (!c.ctas.length) return warn('No call-to-action detected.', 'Add a clear CTA button that matches what the visitor wants next.');
      return c.ctaInFirstScreen ? pass(`First CTA appears early (${quote(c.ctas[0], 30)}).`) : warn('The first CTA appears far down the page.', 'Place a primary CTA in the first screen.');
    },
    'cx-forms': () => rules['mx-forms'](),
    'cx-contact': () => {
      const found = [c.contact.contactLink && 'contact page link', c.contact.tel && 'phone', c.contact.mailto && 'email', c.contact.address && 'address'].filter(Boolean);
      return found.length ? pass(`Found: ${found.join(', ')}.`) : warn('No contact link, phone, email or address found.', 'Link to your contact page from the header or footer.');
    },
    'cx-trust': () =>
      c.trustSignals.length
        ? pass(`Found: ${c.trustSignals.join(', ')}.`)
        : warn('No trust signals detected (reviews, testimonials, logos, certifications, guarantees).', 'Add proof such as testimonials, client logos, ratings or certifications near the CTA.'),
    'cx-not-overwhelming': () =>
      c.ctas.length > 15
        ? warn(`${c.ctas.length} different calls-to-action compete for attention.`, 'Focus on one primary CTA and one secondary option.')
        : pass(c.ctas.length ? `${c.ctas.length} call${c.ctas.length === 1 ? '' : 's'}-to-action.` : 'No competing CTAs.'),

    // 16. Duplicates & cannibalization
    'dup-content': () => {
      if (c.wordCount < 50 || !c.minhash.length) return na('Too little text to compare.');
      if (topSimilar && topSimilar.similarity >= 0.8) return fail(`~${pct(topSimilar.similarity)} of the content overlaps with ${topSimilar.page.name || displayUrl(topSimilar.page.url)}.`, 'Rewrite one page or consolidate them with a 301 redirect/canonical.');
      if (topSimilar && topSimilar.similarity >= 0.5) return warn(`~${pct(topSimilar.similarity)} overlap with ${topSimilar.page.name || displayUrl(topSimilar.page.url)}.`, 'Make each page substantially unique.');
      if (c.duplicateParagraphCount >= 3) return warn(`${c.duplicateParagraphCount} paragraphs are repeated within the page.`, 'Remove repeated blocks of text.');
      return pass(others.length ? `Content is unique across ${others.length} audited page${others.length === 1 ? '' : 's'}.` : 'No repeated paragraphs; no other audited pages to compare yet.');
    },
    'dup-title': () => (title ? (sameTitleSiblings.length ? fail(`Same title as ${names(sameTitleSiblings)}.`, 'Give each page a unique title.') : pass('Title is not duplicated.')) : na('No title tag.')),
    'dup-h1': () => (h1 ? (sameH1Siblings.length ? fail(`Same H1 as ${names(sameH1Siblings)}.`, 'Give each page a unique H1.') : pass('H1 is not duplicated.')) : na('No H1.')),
    'dup-meta': () => (meta ? (sameMetaSiblings.length ? warn(`Same meta description as ${names(sameMetaSiblings)}.`, 'Write a unique meta description for each page.') : pass('Meta description is not duplicated.')) : na('No meta description.')),
    'dup-intent': () => {
      if (!hasKeyword) return na('Primary keyword could not be determined.');
      return sameKeywordSiblings.length
        ? warn(`Shares its search intent ("${keyword}") with ${names(sameKeywordSiblings)}.`, 'Give each page a distinct intent or merge them.')
        : pass(others.length ? 'Unique search intent among audited pages.' : 'No other audited pages to compare yet.');
    },
    'dup-better-url': () => {
      if (!hasKeyword) return na('Primary keyword could not be determined.');
      if (!sameKeywordSiblings.length) return pass(others.length ? 'No other audited URL targets this topic.' : 'No other audited pages to compare yet.');
      return warn(`${names(sameKeywordSiblings)} compete${sameKeywordSiblings.length === 1 ? 's' : ''} for "${keyword}".`, 'Decide which URL should rank, then consolidate or re-target the others.');
    },
    'dup-canonical': () => {
      if (c.canonicalCount > 1) return fail(`${c.canonicalCount} canonical tags.`, 'Keep exactly one canonical tag.');
      if (!c.canonical) return warn('No canonical tag.', 'Add a self-referencing canonical to protect against parameter duplicates.');
      return rules['canonical-correct']();
    },
    'dup-differentiated': () => {
      const similar = others.filter((s) => (title && s.title && tokenSimilarity(s.title, title) >= 0.6) || signatureSimilarity(c.minhash, s.minhash) >= 0.3);
      return similar.length
        ? warn(`Similar to ${names(similar)}.`, 'Make the differences (audience, use case, angle) explicit in the title, H1 and intro.')
        : pass(others.length ? 'Clearly different from other audited pages.' : 'No other audited pages to compare yet.');
    },

    // 17. Technical on-page
    'tech-lang': () => {
      if (!c.lang) return fail('No lang attribute on <html>.', 'Add the page language, e.g. <html lang="en">.');
      return /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(c.lang) ? pass(`lang="${c.lang}"`) : warn(`Invalid lang value "${c.lang}".`, 'Use a valid language code such as "en" or "en-US".');
    },
    'tech-charset': () => {
      if (!c.charset) return warn('No charset declared.', 'Add <meta charset="utf-8"> at the top of the head.');
      return /utf-?8/i.test(c.charset) ? pass('UTF-8.') : warn(`Charset is ${c.charset}.`, 'Use UTF-8.');
    },
    'tech-viewport': () => {
      if (!viewportOk) return fail(c.viewport ? `Viewport "${c.viewport}" is not responsive.` : 'No viewport meta tag.', 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.');
      return zoomDisabled ? warn('Viewport disables zooming.', 'Remove maximum-scale=1 / user-scalable=no.') : pass(c.viewport!);
    },
    'tech-breadcrumbs': () => {
      if (isHome) return na('Homepage.');
      if (c.breadcrumbs.present) return pass('Breadcrumbs present.');
      return depth >= 2 ? warn('No breadcrumbs on a nested page.', 'Add breadcrumbs (with BreadcrumbList schema) to show where the page sits.') : na('Top-level page — breadcrumbs optional.');
    },
    'tech-breadcrumb-links': () => {
      if (!c.breadcrumbs.links.length) return na('No breadcrumb links.');
      const broken = c.linkScan.brokenInternal.filter((b) => c.breadcrumbs.links.includes(b.url));
      return broken.length ? fail(`${broken.length} breadcrumb link${broken.length === 1 ? ' is' : 's are'} broken.`, 'Fix the breadcrumb URLs.') : pass(`${c.breadcrumbs.links.length} breadcrumb links work.`);
    },
    'tech-pagination': () => {
      const p = c.pagination;
      if (!p.paginatedUrl && !p.relNext && !p.relPrev) return na('Not a paginated page.');
      if (p.paginatedUrl && canonicalKey && !canonicalSelf) return warn('Paginated page canonicalises to another page.', 'Give each paginated page a self-referencing canonical.');
      if (p.paginatedUrl && noindex) return warn('Paginated page is noindex.', 'Keep paginated pages indexable so deeper items are discovered.');
      return pass('Pagination uses crawlable, self-canonical URLs.');
    },
    'tech-faceted': () => {
      if (!c.facetedUrl) return na('No filter/sort parameters in this URL.');
      if (noindex || (c.canonical && !new URL(c.canonical).search)) return pass('Filtered URL is canonicalised or noindexed.');
      return warn('Filtered/sorted URL is indexable without a clean canonical.', 'Canonicalise filter URLs to the main category or block crawl-wasting combinations.');
    },
    'tech-infinite-scroll': () => {
      if (!c.pagination.loadMore) return na('No infinite scroll / load-more detected.');
      const hasPageLinks = c.pagination.relNext || c.links.some((l) => /\/page\/2\b|[?&]page=2\b/.test(l.href));
      return hasPageLinks ? pass('"Load more" is backed by crawlable paginated URLs.') : warn('"Load more" without crawlable paginated URLs.', 'Back infinite scroll with real /page/2 links so crawlers can reach every item.');
    },
    'tech-js-content': () => {
      if (c.spaShell) return fail('The HTML is an empty JavaScript shell — content only appears after scripts run.', 'Use server-side rendering or pre-rendering so the content is in the HTML.');
      if (c.wordCount < 100) return warn(`Only ${c.wordCount} words in the raw HTML.`, 'If content loads via JavaScript, render it server-side so search engines see it.');
      return pass(`${c.wordCount} words available in the raw HTML.`);
    },
    'tech-hidden-content': () =>
      c.hiddenContentRatio > 0.4
        ? warn(`About ${pct(c.hiddenContentRatio)} of the text is hidden in tabs, accordions or collapsed sections.`, 'Keep the most important content visible by default.')
        : pass('Important content is visible by default.'),
    'tech-no-cloaking': () => {
      const bot = c.crawlerParity;
      if (!bot) return na('Crawler view could not be fetched.');
      if (bot.status !== null && bot.status >= 400 && c.statusCode < 400) {
        return warn(`The site returns ${bot.status} to a Googlebot user agent.`, 'Often bot protection — confirm with URL Inspection in Search Console that Google sees the page.');
      }
      const share = ratio(bot.wordCount, Math.max(c.wordCount, 1));
      const titleDiffers = !!bot.title && !!title && normalizeText(bot.title) !== normalizeText(title);
      if ((c.wordCount >= 50 && (share < 0.6 || share > 1.6)) || titleDiffers) {
        return warn(`Crawlers receive different content${titleDiffers ? ' (different title)' : ` (${bot.wordCount} vs ${c.wordCount} words)`}.`, 'Serve the same content to search engines and users.');
      }
      return pass('Crawlers and users receive the same content.');
    },
    'tech-interstitials': () =>
      c.popupSignals.length
        ? warn(`Possible interstitials: ${c.popupSignals.join(', ')}.`, 'Avoid popups that cover the main content right after landing from search.')
        : pass('No intrusive interstitials detected.'),
  };

  const reviewMap = new Map((review?.checks || []).map((check) => [check.id, check]));
  const reviewMissing = review ? 'Not assessed in this run — re-audit the page.' : 'Content review unavailable — re-audit the page.';

  const categories: AuditCategoryResult[] = AUDIT_CATEGORIES.map((category) => {
    const checks: AuditCheck[] = category.checks.map((def) => {
      let verdict: Verdict;
      if (def.review) {
        const result = reviewMap.get(def.id);
        verdict = result
          ? { status: result.status, detail: result.finding, ...(result.recommendation ? { recommendation: result.recommendation } : {}) }
          : na(reviewMissing);
      } else {
        try {
          verdict = rules[def.id]?.() ?? na('Not evaluated.');
        } catch {
          verdict = na('Could not be evaluated for this page.');
        }
      }
      return {
        id: def.id,
        label: def.label,
        status: verdict.status,
        weight: def.weight ?? 1,
        detail: verdict.detail,
        ...(verdict.recommendation && verdict.status !== 'pass' && verdict.status !== 'na' ? { recommendation: verdict.recommendation } : {}),
      };
    });
    const scored = checks.filter((check) => check.status !== 'na');
    const totalWeight = scored.reduce((sum, check) => sum + check.weight, 0);
    const score = totalWeight
      ? Math.round((scored.reduce((sum, check) => sum + POINTS[check.status] * check.weight, 0) / totalWeight) * 100)
      : null;
    return { id: category.id, label: category.label, score, checks };
  });

  const categoryScore = new Map(categories.map((category) => [category.id, category.score]));
  const buckets: ScoreBucketResult[] = SCORE_BUCKETS.map((bucket) => {
    const scores = bucket.categories.map((id) => categoryScore.get(id)).filter((s): s is number => typeof s === 'number');
    return {
      id: bucket.id,
      label: bucket.label,
      weight: bucket.weight,
      score: scores.length ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length) : null,
    };
  });
  const scoredBuckets = buckets.filter((bucket) => bucket.score !== null);
  const bucketWeight = scoredBuckets.reduce((sum, bucket) => sum + bucket.weight, 0);
  const score = bucketWeight
    ? Math.round(scoredBuckets.reduce((sum, bucket) => sum + (bucket.score as number) * bucket.weight, 0) / bucketWeight)
    : 0;

  const allChecks = categories.flatMap((category) => category.checks);
  const counts = { pass: 0, warn: 0, fail: 0, na: 0 };
  allChecks.forEach((check) => {
    counts[check.status] += 1;
  });

  const notices: string[] = [];
  if (speed?.error) notices.push(speed.error);
  if (!review) notices.push('The content review could not run, so search intent, content quality, E-E-A-T, GEO and AEO were skipped.');
  else if (review.partial) notices.push('Part of the content review could not run — re-audit this page for complete results.');
  if (c.redirectChain.length) notices.push(`The entered URL redirects to ${displayUrl(c.finalUrl)}; that page was audited.`);

  const speedSummary = (result: SpeedStrategyResult | null) =>
    result
      ? { performance: result.performance, lcpMs: result.field.lcpMs ?? result.lcpMs, cls: result.field.cls ?? result.cls, inpMs: result.field.inpMs }
      : null;

  return {
    url: c.requestedUrl,
    finalUrl: c.finalUrl,
    score,
    grade: gradeForScore(score),
    buckets,
    categories,
    summary: review?.summary || '',
    primaryKeyword: keyword,
    pageType,
    searchIntent: review?.searchIntent || '',
    counts,
    speed: { mobile: speedSummary(mobile), desktop: speedSummary(desktop) },
    notices,
    signature: {
      url: c.finalUrl,
      title: c.title,
      h1: h1 || null,
      metaDescription: c.metaDescription,
      primaryKeyword: keyword,
      minhash: c.minhash,
      internalTargets: c.internalTargets,
    },
    analyzedAt: new Date().toISOString(),
  };
}

/** Highest-impact failing checks first: bucket weight × check weight, fails before warnings. */
export function topFixes(result: PageAuditResult, limit = 8): Array<AuditCheck & { category: string }> {
  const bucketWeightByCategory = new Map<string, number>();
  SCORE_BUCKETS.forEach((bucket) => bucket.categories.forEach((id) => bucketWeightByCategory.set(id, bucket.weight / bucket.categories.length)));
  return result.categories
    .flatMap((category) =>
      category.checks
        .filter((check) => check.status === 'fail' || check.status === 'warn')
        .map((check) => ({
          ...check,
          category: category.label,
          impact: (bucketWeightByCategory.get(category.id) || 1) * check.weight * (check.status === 'fail' ? 2 : 1),
        })),
    )
    .sort((a, b) => b.impact - a.impact)
    .slice(0, limit)
    .map(({ impact: _impact, ...check }) => check);
}
