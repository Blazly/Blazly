import { parse, type HTMLElement } from 'node-html-parser';
import { extractMainContentFromHtml } from '../../scrape-lib/extract-page-content';
import { prepareHtmlForAnalysis } from '../../scrape-lib/html-to-analysis-text';
import {
  fetchDocument,
  fetchPageAsBrowser,
  mapWithConcurrency,
  probeUrl,
  type ProbeResult,
} from './fetcher';
import { fetchRobotsTxt, isAllowedByRobots } from './robots';
import { bareHost, comparableUrl, isSameSite } from '../urls';
import { minhashSignature, wordList } from '../text';
import type {
  CrawlImage,
  CrawlLink,
  CrawlSchemaNode,
  LinkCheckIssue,
  PageCrawlData,
  UrlProbe,
} from './types/site-audit';

const CONTENT_TEXT_LIMIT = 24_000;
const MAX_STORED_LINKS = 250;
const MAX_STORED_IMAGES = 80;
const INTERNAL_LINK_CHECKS = 30;
const EXTERNAL_LINK_CHECKS = 20;
const IMAGE_CHECKS = 16;
const LARGE_IMAGE_BYTES = 300 * 1024;

const CTA_TEXT =
  /\b(get started|start (now|free|today|your)|try|book|schedule|request|contact( us)?|call (us|now)|buy|shop|order|subscribe|sign ?up|register|join|download|get (a |an |your )?(quote|demo|started|access|offer|proposal|estimate|free)|demo|free trial|talk to|apply|enroll|claim|add to cart|checkout|hire)\b/i;

const TRUST_PATTERNS: Array<[string, RegExp]> = [
  ['Testimonials', /\btestimonials?\b/],
  ['Customer reviews', /\b(customer reviews?|reviews from|\d(\.\d)? ?(\/ ?5|out of 5|stars?))\b/],
  ['Case studies', /\bcase stud(y|ies)\b/],
  ['Trusted-by / client logos', /\b(trusted by|our clients|used by|loved by|customers include)\b/],
  ['Certifications', /\b(certified|certification|accredited|iso \d{4,5}|soc ?2|hipaa|gdpr compliant)\b/],
  ['Awards', /\b(award[- ]winning|awards?)\b/],
  ['Guarantee', /\b(money[- ]back|guarantee[d]?|risk[- ]free)\b/],
  ['Security', /\b(secure (checkout|payment)|ssl|encrypted|256-bit)\b/],
  ['Experience', /\b(\d{1,3}\+? years? of experience|since (19|20)\d{2}|founded in (19|20)\d{2})\b/],
  ['Partners', /\b(official partner|partnered with|google partner|hubspot partner)\b/],
];

const FACET_KEYS = new Set([
  'sort', 'order', 'orderby', 'filter', 'filters', 'color', 'colour', 'size', 'price', 'min_price', 'max_price',
  'brand', 'category', 'cat', 'tag', 'view', 'limit', 'per_page', 'material', 'rating',
]);

const POPUP_VENDOR_PATTERNS: Array<[string, RegExp]> = [
  ['OptinMonster', /optinmonster|omappapi/i],
  ['Sumo', /load\.sumo\.com|sumome/i],
  ['Privy', /privy\.com/i],
  ['Poptin', /poptin/i],
  ['Sleeknote', /sleeknote/i],
  ['Wisepops', /wisepops/i],
  ['Justuno', /justuno/i],
  ['Hustle', /hustle-popup|wpmudev-hustle/i],
  ['Popup Maker', /popmake|pum-overlay/i],
  ['Elementor popup', /elementor-popup-modal/i],
];

function clean(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function resolveUrl(href: string | undefined, base: string): string | null {
  if (!href) return null;
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || /^(javascript|data|mailto|tel|sms|whatsapp):/i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed, base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

function attr(el: HTMLElement, name: string): string {
  return (el.getAttribute(name) || '').trim();
}

function classAndId(el: HTMLElement): string {
  return `${attr(el, 'class')} ${attr(el, 'id')}`.toLowerCase();
}

function toProbe(result: ProbeResult | null): UrlProbe | null {
  if (!result) return null;
  return {
    url: result.url,
    status: result.status,
    finalUrl: result.finalUrl,
    redirected: result.redirected,
    ...(result.error ? { error: result.error } : {}),
  };
}

function hasNoindex(value: string | null | undefined): boolean {
  return /\b(noindex|none)\b/i.test(value || '');
}

function syllableCount(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  return Math.max(1, (trimmed.match(/[aeiouy]{1,2}/g) || []).length);
}

function readingStats(text: string, lang: string | null) {
  const sentences = text.split(/(?<=[.!?])\s+/).map((s) => wordList(s)).filter((words) => words.length >= 3);
  const totalWords = sentences.reduce((sum, words) => sum + words.length, 0);
  const avgSentenceLength = sentences.length ? Math.round((totalWords / sentences.length) * 10) / 10 : 0;
  const english = !lang || lang.toLowerCase().startsWith('en');
  if (!english || totalWords < 50) return { avgSentenceLength, fleschReadingEase: null };
  const syllables = sentences.flat().reduce((sum, word) => sum + syllableCount(word), 0);
  const flesch = 206.835 - 1.015 * (totalWords / sentences.length) - 84.6 * (syllables / totalWords);
  return { avgSentenceLength, fleschReadingEase: Math.round(Math.max(0, Math.min(100, flesch))) };
}

/** Main content HTML: the extracted article/main block, or the cleaned body when that block misses most of the page. */
function mainContentHtml(html: string, body: HTMLElement): string {
  const extracted = extractMainContentFromHtml(html)?.htmlContent ?? '';
  const cleanedBody = parse(body.innerHTML);
  cleanedBody
    .querySelectorAll('script, style, noscript, svg, nav, footer, header, aside, iframe, template')
    .forEach((el) => el.remove());
  const extractedWords = extracted ? wordList(parse(`<div>${extracted}</div>`).structuredText).length : 0;
  const bodyWords = wordList(cleanedBody.structuredText).length;
  return extractedWords >= bodyWords * 0.5 ? extracted : cleanedBody.innerHTML;
}

function decodedText(fragment: string | undefined): string | null {
  return fragment ? clean(parse(`<p>${fragment}</p>`).text) || null : null;
}

/** Light-weight content stats for the mobile / crawler parity fetches. */
function quickStats(html: string): { wordCount: number; title: string | null; h1: string | null } {
  const root = parse(html, { comment: false });
  const text = parse(`<div>${mainContentHtml(html, root.querySelector('body') ?? root)}</div>`).structuredText;
  const title = decodedText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]);
  const h1 = decodedText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]);
  return { wordCount: wordList(text).length, title, h1 };
}

type SchemaExtraction = {
  jsonLdBlocks: number;
  parseErrors: number;
  nodes: CrawlSchemaNode[];
  microdataTypes: string[];
  author: string | null;
  published: string | null;
  modified: string | null;
  hasAddress: boolean;
};

function authorName(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return clean(value) || null;
  if (Array.isArray(value)) return authorName(value[0]);
  if (typeof value === 'object' && 'name' in (value as Record<string, unknown>)) {
    return authorName((value as Record<string, unknown>).name);
  }
  return null;
}

function extractSchema(root: HTMLElement): SchemaExtraction {
  const result: SchemaExtraction = {
    jsonLdBlocks: 0,
    parseErrors: 0,
    nodes: [],
    microdataTypes: [],
    author: null,
    published: null,
    modified: null,
    hasAddress: false,
  };

  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Record<string, unknown>;
    if (Array.isArray(node['@graph'])) visit(node['@graph']);
    const rawType = node['@type'];
    if (!rawType) return;
    const type = Array.isArray(rawType) ? rawType.map(String).join(', ') : String(rawType);
    const props = Object.keys(node).filter((key) => !key.startsWith('@'));
    const name = typeof node.name === 'string' ? node.name : typeof node.headline === 'string' ? node.headline : null;
    const questions: string[] = [];
    if (/FAQPage/i.test(type)) {
      const entities = Array.isArray(node.mainEntity) ? node.mainEntity : node.mainEntity ? [node.mainEntity] : [];
      for (const entity of entities) {
        const q = entity as Record<string, unknown>;
        const answer = q?.acceptedAnswer as Record<string, unknown> | undefined;
        if (typeof q?.name === 'string') questions.push(answer?.text ? q.name : `${q.name} [no answer]`);
      }
    }
    result.nodes.push({ type, props, name: name ? clean(name).slice(0, 160) : null, questions: questions.slice(0, 20) });
    result.author ||= authorName(node.author);
    if (typeof node.datePublished === 'string') result.published ||= node.datePublished;
    if (typeof node.dateModified === 'string') result.modified ||= node.dateModified;
    if (node.address) result.hasAddress = true;
  };

  root.querySelectorAll('script').forEach((script) => {
    if (!/ld\+json/i.test(attr(script, 'type'))) return;
    result.jsonLdBlocks += 1;
    const raw = script.rawText
      .replace(/^\s*<!--/, '')
      .replace(/-->\s*$/, '')
      .replace(/^\s*\/\/\s*<!\[CDATA\[/, '')
      .replace(/\/\/\s*\]\]>\s*$/, '')
      .trim();
    try {
      visit(JSON.parse(raw));
    } catch {
      result.parseErrors += 1;
    }
  });

  const microdata = new Set<string>();
  root.querySelectorAll('[itemtype]').forEach((el) => {
    attr(el, 'itemtype')
      .split(/\s+/)
      .forEach((type) => {
        const name = type.split('/').filter(Boolean).pop();
        if (name) microdata.add(name);
      });
  });
  result.microdataTypes = [...microdata].slice(0, 20);
  result.nodes = result.nodes.slice(0, 40);
  return result;
}

function isInsideAny(el: HTMLElement, counted: Set<HTMLElement>): boolean {
  let parent = el.parentNode as HTMLElement | null;
  while (parent) {
    if (counted.has(parent)) return true;
    parent = parent.parentNode as HTMLElement | null;
  }
  return false;
}

export async function crawlPage(pageUrl: string, domainUrl: string): Promise<PageCrawlData> {
  const projectOrigin = new URL(domainUrl).origin;
  const robotsPromise = fetchRobotsTxt(new URL(pageUrl).origin);

  let doc;
  try {
    doc = await fetchPageAsBrowser(pageUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed';
    if (/cannot be audited|Only http/.test(message)) throw error;
    if (/ENOTFOUND|getaddrinfo/i.test(message)) throw new Error('This domain could not be found. Check the URL.');
    if (/timeout|aborted/i.test(message)) throw new Error('The page took too long to respond.');
    throw new Error('We could not reach this page. Check the URL and that the site is online.');
  }

  if (doc.contentType && !/html|xml/i.test(doc.contentType)) {
    throw new Error('This URL does not return an HTML page.');
  }
  if (!doc.body.trim()) {
    throw new Error(`The page returned an empty response (status ${doc.status}).`);
  }

  const finalUrl = doc.finalUrl;
  const final = new URL(finalUrl);
  const html = doc.body;
  const root = parse(html, { comment: false });
  const body = root.querySelector('body') ?? root;
  const metas = root.querySelectorAll('meta');
  const metaBy = (key: 'name' | 'property' | 'http-equiv', value: string) =>
    metas.filter((m) => attr(m, key).toLowerCase() === value).map((m) => clean(m.getAttribute('content')));

  // --- Head ---
  const titles = root.querySelectorAll('title').filter((t) => !t.closest('svg'));
  const title = clean(titles[0]?.text) || null;
  const descriptions = metaBy('name', 'description');
  const robotsMeta = [...metaBy('name', 'robots'), ...metaBy('name', 'googlebot')].filter(Boolean).join(', ') || null;
  const canonicalLinks = root
    .querySelectorAll('link')
    .filter((l) => attr(l, 'rel').toLowerCase().split(/\s+/).includes('canonical'));
  const canonical = resolveUrl(canonicalLinks[0]?.getAttribute('href'), finalUrl);
  const viewport = metaBy('name', 'viewport')[0] || null;
  const charsetMeta =
    metas.map((m) => attr(m, 'charset')).find(Boolean) ||
    metaBy('http-equiv', 'content-type')[0]?.match(/charset=([\w-]+)/i)?.[1] ||
    doc.contentType.match(/charset=([\w-]+)/i)?.[1] ||
    null;
  const lang = attr(root.querySelector('html') ?? root, 'lang') || null;
  const relLink = (rel: string) =>
    resolveUrl(
      root.querySelectorAll('link').find((l) => attr(l, 'rel').toLowerCase() === rel)?.getAttribute('href'),
      finalUrl,
    );

  const scriptCount = root.querySelectorAll('script').length;
  const schema = extractSchema(root);
  // Inline script/style text would otherwise leak into headings, CTAs and body text.
  root.querySelectorAll('script, style, noscript, template').forEach((el) => el.remove());

  // --- Main content ---
  const mainHtml = mainContentHtml(html, body);
  const mainRoot = parse(`<div>${mainHtml}</div>`);
  const mainText = mainRoot.structuredText;
  const mainWords = wordList(mainText);
  const prepared = prepareHtmlForAnalysis(mainHtml, CONTENT_TEXT_LIMIT);
  const plainText = mainText.replace(/\n{3,}/g, '\n\n').trim();
  const useStructured = prepared.analysisContent.length >= Math.min(plainText.length, CONTENT_TEXT_LIMIT) * 0.5;
  const contentText = useStructured ? prepared.analysisContent : plainText.slice(0, CONTENT_TEXT_LIMIT);

  const paragraphs = mainRoot.querySelectorAll('p').map((p) => clean(p.text)).filter((t) => t.length >= 40);
  const paragraphCounts = new Map<string, number>();
  paragraphs.forEach((p) => paragraphCounts.set(p.toLowerCase(), (paragraphCounts.get(p.toLowerCase()) || 0) + 1));
  const duplicateParagraphCount = [...paragraphCounts.values()].filter((count) => count > 1).length;
  const stats = readingStats(clean(mainText), lang);

  // --- Headings ---
  const headings = body
    .querySelectorAll('h1, h2, h3, h4, h5, h6')
    .map((h) => ({ level: Number(h.rawTagName.slice(1)), text: clean(h.text).slice(0, 200) }))
    .slice(0, 200);

  // --- Links ---
  const contentHrefs = new Set(
    mainRoot
      .querySelectorAll('a')
      .map((a) => resolveUrl(a.getAttribute('href'), finalUrl))
      .filter((href): href is string => !!href),
  );
  const contact = { tel: false, mailto: false, contactLink: false, address: false };
  let aboutLink = false;
  let authorLink = false;
  const allLinks: CrawlLink[] = [];
  body.querySelectorAll('a').forEach((a) => {
    const rawHref = attr(a, 'href');
    if (/^tel:/i.test(rawHref)) contact.tel = true;
    if (/^mailto:/i.test(rawHref)) contact.mailto = true;
    const href = resolveUrl(rawHref, finalUrl);
    if (!href) return;
    const text =
      clean(a.text) ||
      clean(a.querySelector('img')?.getAttribute('alt')) ||
      attr(a, 'aria-label') ||
      attr(a, 'title');
    const rel = attr(a, 'rel').toLowerCase();
    const internal = isSameSite(href, projectOrigin);
    const path = internal ? new URL(href).pathname.toLowerCase() : '';
    if (internal && (/\/contact/.test(path) || /^contact/i.test(text))) contact.contactLink = true;
    if (internal && (/\/(about|our-story|company|who-we-are|team)(\/|$|-)/.test(path) || /^about\b/i.test(text))) aboutLink = true;
    if (rel.split(/\s+/).includes('author') || /\/(author|authors|team|people|experts?)\//.test(path)) authorLink = true;
    allLinks.push({ href, text: text.slice(0, 120), rel, internal, inContent: contentHrefs.has(href) });
  });
  const seenLinks = new Set<string>();
  const storedLinks = [...allLinks.filter((l) => l.inContent), ...allLinks.filter((l) => !l.inContent)]
    .filter((l) => {
      const key = `${l.href}|${l.text}`;
      if (seenLinks.has(key)) return false;
      seenLinks.add(key);
      return true;
    })
    .slice(0, MAX_STORED_LINKS);

  // --- Images ---
  const images: CrawlImage[] = [];
  let imageCount = 0;
  body.querySelectorAll('img').forEach((img) => {
    const srcset = attr(img, 'srcset') || attr(img, 'data-srcset');
    let src = attr(img, 'src');
    if (!src || src.startsWith('data:')) {
      src = attr(img, 'data-src') || attr(img, 'data-lazy-src') || attr(img, 'data-original') || srcset.split(/\s+/)[0] || src;
    }
    const width = img.getAttribute('width') ?? null;
    const height = img.getAttribute('height') ?? null;
    if (width === '1' || height === '1') return;
    imageCount += 1;
    const resolved = src && !src.startsWith('data:') ? resolveUrl(src, finalUrl) : null;
    if (!resolved || images.length >= MAX_STORED_IMAGES) return;
    const resolvedUrl = new URL(resolved);
    // Image CDNs and Next.js (/_next/image?url=...) carry the original file in a query parameter.
    const originalPath = resolvedUrl.searchParams.get('url') || resolvedUrl.searchParams.get('src') || resolvedUrl.pathname;
    let filename = '';
    try {
      filename = decodeURIComponent(originalPath.split('?')[0].split('/').pop() || '');
    } catch {
      filename = originalPath.split('/').pop() || '';
    }
    const format = (filename.match(/\.([a-z0-9]+)$/i)?.[1] || 'unknown').toLowerCase().replace('jpeg', 'jpg');
    const numericWidth = Number(width);
    const numericHeight = Number(height);
    const decorative =
      ['presentation', 'none'].includes(attr(img, 'role').toLowerCase()) ||
      attr(img, 'aria-hidden') === 'true' ||
      (numericWidth > 0 && numericWidth <= 48) ||
      (numericHeight > 0 && numericHeight <= 48) ||
      /(icon|arrow|divider|spacer|separator|bullet|chevron|pattern|shape|decor|bg[-_]|background)/i.test(filename);
    images.push({
      src: resolved,
      alt: img.getAttribute('alt') ?? null,
      width,
      height,
      loading: img.getAttribute('loading')?.toLowerCase() ?? null,
      hasSrcset: !!srcset || !!attr(img, 'sizes'),
      inPicture: !!img.closest('picture'),
      filename: filename.slice(0, 120),
      format,
      decorative,
    });
  });

  if (schema.hasAddress) contact.address = true;

  // --- DOM signals ---
  const popupSignals = new Set<string>();
  let stickySignals = 0;
  let navPresent = false;
  let mobileMenuToggle = false;
  let breadcrumbEl: HTMLElement | null = null;
  let firstCtaOffset: number | null = null;
  let loadMore = false;
  const ctas = new Set<string>();
  const hiddenEls: HTMLElement[] = [];
  let byline: string | null = null;
  let spaRoot = false;
  const bodyStart = body.range?.[0] ?? 0;
  const bodyLength = Math.max(1, (body.range?.[1] ?? html.length) - bodyStart);

  body.querySelectorAll('*').forEach((el) => {
    const tag = el.rawTagName?.toLowerCase() || '';
    const marker = classAndId(el);
    const style = attr(el, 'style').toLowerCase();
    const role = attr(el, 'role').toLowerCase();

    if (/(popup|pop-up|exit-intent|optin|opt-in|interstitial|newsletter-modal|subscribe-modal|lead-modal)/.test(marker)) {
      popupSignals.add('Popup / opt-in markup on page');
    }
    if (
      /position\s*:\s*(fixed|sticky)/.test(style) ||
      /\b(sticky|is-sticky|fixed-top|fixed-bottom|sticky-top|sticky-header|sticky-footer|position-fixed)\b/.test(marker)
    ) {
      stickySignals += 1;
    }
    if (tag === 'nav' || role === 'navigation') navPresent = true;
    if (
      (tag === 'button' || role === 'button' || tag === 'a') &&
      (el.getAttribute('aria-expanded') !== undefined ||
        /(hamburger|menu-toggle|nav-toggle|navbar-toggler|mobile-menu|menu-button|burger|menu-trigger|toggle-menu|offcanvas)/.test(marker))
    ) {
      mobileMenuToggle = true;
    }
    if (!breadcrumbEl && (/breadcrumb/i.test(attr(el, 'aria-label')) || /breadcrumb/.test(marker) || /BreadcrumbList/.test(attr(el, 'itemtype')))) {
      breadcrumbEl = el;
    }
    if (['root', 'app', '__next', '___gatsby', '__nuxt'].includes(attr(el, 'id'))) spaRoot = true;
    if (tag === 'address') contact.address = true;

    if (
      el.hasAttribute('hidden') ||
      /display\s*:\s*none/.test(style) ||
      (tag === 'details' && !el.hasAttribute('open')) ||
      (/\b(tab-pane|accordion-collapse|collapse)\b/.test(marker) && !/\b(show|active|in|open)\b/.test(marker))
    ) {
      hiddenEls.push(el);
    }

    if (tag === 'a' || tag === 'button' || (tag === 'input' && /submit|button/.test(attr(el, 'type')))) {
      const text = clean(tag === 'input' ? attr(el, 'value') : el.text);
      if (/^(load|show|view) more\b/i.test(text)) loadMore = true;
      if (text.length >= 2 && text.length <= 40 && (CTA_TEXT.test(text) || /\b(btn|button|cta)\b/.test(marker))) {
        ctas.add(text);
        if (firstCtaOffset === null && el.range) firstCtaOffset = (el.range[0] - bodyStart) / bodyLength;
      }
    }

    if (!byline && (attr(el, 'rel').includes('author') || /\b(author|byline|posted-by|written-by)\b/.test(marker) || attr(el, 'itemprop') === 'author')) {
      const text = clean(el.text);
      if (text.length >= 3 && text.length <= 80) byline = text;
    }
  });

  const counted = new Set<HTMLElement>();
  let hiddenLength = 0;
  for (const el of hiddenEls) {
    if (isInsideAny(el, counted)) continue;
    counted.add(el);
    hiddenLength += clean(el.text).length;
  }
  const bodyTextLength = Math.max(1, clean(body.structuredText).length);

  const bodyHtmlLower = html.toLowerCase();
  POPUP_VENDOR_PATTERNS.forEach(([name, pattern]) => {
    if (pattern.test(bodyHtmlLower)) popupSignals.add(`${name} popup script`);
  });

  const bodyTextLower = clean(body.structuredText).toLowerCase();
  const trustSignals = TRUST_PATTERNS.filter(([, pattern]) => pattern.test(bodyTextLower)).map(([label]) => label);

  // --- Forms ---
  const labelFor = new Set(root.querySelectorAll('label').map((l) => attr(l, 'for')).filter(Boolean));
  let inputsWithoutLabel = 0;
  let withoutSubmit = 0;
  const forms = body.querySelectorAll('form');
  forms.forEach((form) => {
    form.querySelectorAll('input, select, textarea').forEach((field) => {
      const type = attr(field, 'type').toLowerCase();
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) return;
      const labelled =
        attr(field, 'aria-label') ||
        attr(field, 'aria-labelledby') ||
        attr(field, 'title') ||
        attr(field, 'placeholder') ||
        (attr(field, 'id') && labelFor.has(attr(field, 'id'))) ||
        field.closest('label');
      if (!labelled) inputsWithoutLabel += 1;
    });
    const hasSubmit =
      form.querySelectorAll('button').some((b) => !['button', 'reset'].includes(attr(b, 'type').toLowerCase())) ||
      form.querySelectorAll('input').some((i) => ['submit', 'image'].includes(attr(i, 'type').toLowerCase()));
    if (!hasSubmit) withoutSubmit += 1;
  });

  // --- Breadcrumbs ---
  const breadcrumbLinks = breadcrumbEl
    ? (breadcrumbEl as HTMLElement)
        .querySelectorAll('a')
        .map((a) => resolveUrl(a.getAttribute('href'), finalUrl))
        .filter((href): href is string => !!href)
        .slice(0, 10)
    : [];
  const breadcrumbSchema = schema.nodes.some((n) => /BreadcrumbList/i.test(n.type));

  // --- Dates / author ---
  const timeEl = body.querySelector('time[datetime]');
  const published =
    metaBy('property', 'article:published_time')[0] || schema.published || timeEl?.getAttribute('datetime') || null;
  const modified =
    metaBy('property', 'article:modified_time')[0] || metaBy('property', 'og:updated_time')[0] || schema.modified || null;

  // --- Network probes (run together) ---
  const robots = await robotsPromise;
  const deadline = Date.now() + 25_000;
  const pagePath = final.pathname;

  const httpProbePromise =
    final.protocol === 'https:'
      ? probeUrl(`http://${final.host}${final.pathname}${final.search}`, { timeoutMs: 8_000 })
      : Promise.resolve(null);

  const projectApex = bareHost(new URL(projectOrigin).hostname);
  const canToggleHost = final.hostname.startsWith('www.') || bareHost(final.hostname) === projectApex;
  const altHost = final.hostname.startsWith('www.') ? final.hostname.slice(4) : `www.${final.hostname}`;
  const hostProbePromise = canToggleHost
    ? probeUrl(`${final.protocol}//${altHost}${final.pathname}${final.search}`, { timeoutMs: 8_000 })
    : Promise.resolve(null);

  const canToggleSlash = pagePath !== '/' && !/\.[a-z0-9]{2,5}$/i.test(pagePath);
  const slashVariant = pagePath.endsWith('/') ? pagePath.replace(/\/+$/, '') : `${pagePath}/`;
  const slashProbePromise = canToggleSlash
    ? probeUrl(`${final.origin}${slashVariant}${final.search}`, { timeoutMs: 8_000 })
    : Promise.resolve(null);

  const canonicalProbePromise: Promise<(UrlProbe & { noindex: boolean }) | null> =
    canonical && comparableUrl(canonical) !== comparableUrl(finalUrl)
      ? fetchDocument(canonical, { timeoutMs: 12_000, maxBytes: 1024 * 1024 })
          .then((canonDoc) => {
            const metaRobots = canonDoc.body.match(/<meta[^>]+name=["'](?:robots|googlebot)["'][^>]*>/gi)?.join(' ') || '';
            return {
              url: canonical,
              status: canonDoc.status,
              finalUrl: canonDoc.finalUrl,
              redirected: canonDoc.chain.length > 0,
              noindex: hasNoindex(metaRobots) || hasNoindex(canonDoc.headers.get('x-robots-tag')),
            };
          })
          .catch((error: unknown) => ({
            url: canonical,
            status: null,
            finalUrl: null,
            redirected: false,
            noindex: false,
            error: error instanceof Error ? error.message : 'Request failed',
          }))
      : Promise.resolve(null);

  const mobilePromise = fetchDocument(finalUrl, { agent: 'mobile', timeoutMs: 15_000 })
    .then((mobileDoc) => (mobileDoc.status < 400 ? quickStats(mobileDoc.body) : null))
    .catch(() => null);

  const crawlerPromise = fetchDocument(finalUrl, { agent: 'crawler', timeoutMs: 15_000 })
    .then((crawlerDoc) => {
      const quick = quickStats(crawlerDoc.body);
      return { status: crawlerDoc.status, wordCount: quick.wordCount, title: quick.title };
    })
    .catch(() => null);

  const selfKey = comparableUrl(finalUrl);
  const uniqueTargets = (internal: boolean, cap: number) => {
    const seen = new Set<string>();
    const ordered = [...allLinks.filter((l) => l.inContent), ...allLinks.filter((l) => !l.inContent)];
    const targets: string[] = [];
    for (const link of ordered) {
      if (link.internal !== internal) continue;
      const key = internal ? comparableUrl(link.href) : link.href;
      if (key === selfKey || seen.has(key)) continue;
      seen.add(key);
      targets.push(link.href);
      if (targets.length >= cap) break;
    }
    return targets;
  };

  const probeBeforeDeadline = (url: string, accept?: string) =>
    Date.now() > deadline ? Promise.resolve(null) : probeUrl(url, { timeoutMs: 6_000, accept });

  const internalTargets = uniqueTargets(true, INTERNAL_LINK_CHECKS);
  const externalTargets = uniqueTargets(false, EXTERNAL_LINK_CHECKS);
  const breadcrumbTargets = breadcrumbLinks.filter((href) => !internalTargets.includes(href));
  const imageTargets = [...new Set(images.map((img) => img.src))].slice(0, IMAGE_CHECKS);

  const [httpProbe, hostProbe, slashProbe, canonicalProbe, mobileParity, crawlerParity, internalResults, externalResults, imageResults] =
    await Promise.all([
      httpProbePromise,
      hostProbePromise,
      slashProbePromise,
      canonicalProbePromise,
      mobilePromise,
      crawlerPromise,
      mapWithConcurrency([...internalTargets, ...breadcrumbTargets], 6, (url) => probeBeforeDeadline(url)),
      mapWithConcurrency(externalTargets, 6, (url) => probeBeforeDeadline(url)),
      mapWithConcurrency(imageTargets, 6, (url) =>
        probeBeforeDeadline(url, 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'),
      ),
    ]);

  const isBroken = (result: ProbeResult) =>
    result.status === 404 || result.status === 410 || (result.status !== null && result.status >= 500 && result.status !== 999);

  const brokenInternal: LinkCheckIssue[] = [];
  let redirectedInternal = 0;
  let checkedInternal = 0;
  internalResults.forEach((result) => {
    if (!result) return;
    checkedInternal += 1;
    if (isBroken(result)) brokenInternal.push({ url: result.url, status: result.status });
    else if (result.firstStatus && result.firstStatus >= 300 && result.firstStatus < 400) redirectedInternal += 1;
  });

  const brokenExternal: LinkCheckIssue[] = [];
  let checkedExternal = 0;
  externalResults.forEach((result) => {
    if (!result) return;
    checkedExternal += 1;
    if (isBroken(result) || (result.status === null && /ENOTFOUND|getaddrinfo/i.test(result.error || ''))) {
      brokenExternal.push({ url: result.url, status: result.status });
    }
  });

  const brokenImages: LinkCheckIssue[] = [];
  const largeImages: Array<{ url: string; bytes: number }> = [];
  const formats: Record<string, number> = {};
  let checkedImages = 0;
  imageResults.forEach((result) => {
    if (!result) return;
    checkedImages += 1;
    if (isBroken(result) || (result.status === 200 && /text\/html/i.test(result.contentType || ''))) {
      brokenImages.push({ url: result.url, status: result.status });
      return;
    }
    const format = result.contentType?.match(/image\/([\w+.-]+)/i)?.[1]?.toLowerCase().replace('jpeg', 'jpg').replace('svg+xml', 'svg');
    if (format) formats[format] = (formats[format] || 0) + 1;
    if (result.contentLength && result.contentLength > LARGE_IMAGE_BYTES) {
      largeImages.push({ url: result.url, bytes: result.contentLength });
    }
  });

  const queryKeys = [...final.searchParams.keys()].map((k) => k.toLowerCase());

  return {
    requestedUrl: pageUrl,
    finalUrl,
    statusCode: doc.status,
    redirectChain: doc.chain,
    responseTimeMs: doc.elapsedMs,
    htmlBytes: doc.bytes,
    xRobotsTag: doc.headers.get('x-robots-tag'),
    robotsTxtFound: robots.found,
    blockedByRobotsTxt: !isAllowedByRobots(robots, `${final.pathname}${final.search}`),
    lang,
    charset: charsetMeta,
    viewport,
    title,
    titleCount: titles.length,
    metaDescription: descriptions[0] || null,
    metaDescriptionCount: descriptions.length,
    metaRobots: robotsMeta,
    canonical,
    canonicalCount: canonicalLinks.length,
    canonicalProbe,
    ogSiteName: metaBy('property', 'og:site_name')[0] || null,
    headings,
    wordCount: mainWords.length,
    introText: mainWords.slice(0, 150).join(' '),
    contentText,
    contentTruncated: prepared.truncated || plainText.length > CONTENT_TEXT_LIMIT,
    paragraphCount: paragraphs.length,
    duplicateParagraphCount,
    avgSentenceLength: stats.avgSentenceLength,
    fleschReadingEase: stats.fleschReadingEase,
    listCount: mainRoot.querySelectorAll('ul').length,
    orderedListCount: mainRoot.querySelectorAll('ol').length,
    tableCount: mainRoot.querySelectorAll('table').length,
    links: storedLinks,
    internalLinkCount: allLinks.filter((l) => l.internal).length,
    externalLinkCount: allLinks.filter((l) => !l.internal).length,
    images,
    imageCount,
    schema: {
      jsonLdBlocks: schema.jsonLdBlocks,
      parseErrors: schema.parseErrors,
      nodes: schema.nodes,
      microdataTypes: schema.microdataTypes,
    },
    breadcrumbs: { present: !!breadcrumbEl || breadcrumbSchema, links: breadcrumbLinks },
    pagination: {
      relNext: relLink('next'),
      relPrev: relLink('prev'),
      paginatedUrl: /\/page\/\d+\/?$/i.test(final.pathname) || /[?&](page|p|pg|paged)=\d+/i.test(final.search),
      loadMore,
    },
    facetedUrl: queryKeys.some((key) => FACET_KEYS.has(key) || key.includes('[')),
    forms: { count: forms.length, inputsWithoutLabel, withoutSubmit },
    ctas: [...ctas].slice(0, 25),
    ctaInFirstScreen: firstCtaOffset !== null && firstCtaOffset <= 0.3,
    contact,
    aboutLink,
    trustSignals,
    author: { meta: metaBy('name', 'author')[0] || null, byline, schema: schema.author, authorLink },
    dates: { published, modified },
    popupSignals: [...popupSignals],
    stickySignals,
    hiddenContentRatio: Math.round((hiddenLength / bodyTextLength) * 100) / 100,
    spaShell: spaRoot && mainWords.length < 80 && scriptCount >= 3,
    navPresent,
    mobileMenuToggle,
    httpProbe: toProbe(httpProbe),
    hostVariantProbe: toProbe(hostProbe),
    slashVariantProbe: toProbe(slashProbe),
    mobileParity,
    crawlerParity,
    linkScan: { checkedInternal, checkedExternal, brokenInternal, brokenExternal, redirectedInternal },
    imageScan: { checked: checkedImages, broken: brokenImages, large: largeImages, formats },
    minhash: minhashSignature(mainText),
    internalTargets: [...new Set(allLinks.filter((l) => l.internal).map((l) => comparableUrl(l.href)))].slice(0, 300),
  };
}
