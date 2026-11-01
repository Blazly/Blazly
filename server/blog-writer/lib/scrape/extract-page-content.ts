import { parse, type HTMLElement } from 'node-html-parser';

const CONTENT_SELECTORS = [
  'article .entry-content',
  'article .post-content',
  'article .article-content',
  '.entry-content',
  '.post-content',
  '.article-content',
  '.blog-post-content',
  '.elementor-widget-theme-post-content',
  '#post-content',
  'article',
  'main',
  '[role="main"]',
  '#main',
  '#content',
];

const JUNK_SELECTORS = [
  'script',
  'style',
  'iframe',
  'nav',
  'footer',
  'aside',
  '.sidebar',
  '.widget',
  '.comments',
  '.comment-form',
  '.related-posts',
  '.share-buttons',
  '.social-share',
  '.cookie-banner',
  '.advertisement',
  '.ad-container',
];

/** Site chrome headers only — do not strip in-article section headers. */
const CHROME_HEADER_SELECTORS = [
  'body > header',
  'header.site-header',
  'header#masthead',
  'header.banner',
  '.site-header',
  '#site-header',
];

function visibleTextLength(el: HTMLElement): number {
  return el.text.replace(/\s+/g, ' ').trim().length;
}

function removeNodes(root: HTMLElement, selectors: string[]): void {
  selectors.forEach((selector) => {
    root.querySelectorAll(selector).forEach((el) => el.remove());
  });
}

function pickBestContentRoot(root: HTMLElement): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLength = 0;

  for (const selector of CONTENT_SELECTORS) {
    root.querySelectorAll(selector).forEach((node) => {
      const length = visibleTextLength(node);
      if (length > bestLength) {
        bestLength = length;
        best = node;
      }
    });
  }

  return best || root.querySelector('body');
}

export type ExtractedPageContent = {
  htmlContent: string;
  textLength: number;
  selectorUsed: string;
};

export function extractMainContentFromHtml(rawHtml: string): ExtractedPageContent | null {
  if (!rawHtml.trim()) return null;

  const root = parse(rawHtml);
  removeNodes(root, CHROME_HEADER_SELECTORS);

  // Drop tracking noscript pixels, but keep crawler-fallback noscript that contains real copy.
  // Note: HTML parsers often treat <noscript> children as raw text, not nested elements.
  root.querySelectorAll('noscript').forEach((node) => {
    const inner = node.innerHTML.trim();
    const textLen = node.text.replace(/\s+/g, ' ').trim().length;
    const looksLikeContent = /<(article|main|section|h1|h2|h3|p)\b/i.test(inner) || textLen >= 80;
    if (!looksLikeContent) {
      node.remove();
      return;
    }
    const fragment = parse(`<div id="noscript-unwrap">${inner}</div>`);
    const wrap = fragment.querySelector('#noscript-unwrap');
    if (wrap && wrap.childNodes.length > 0) {
      node.replaceWith(...wrap.childNodes);
    } else {
      node.replaceWith(inner);
    }
  });

  const contentRoot = pickBestContentRoot(root);
  if (!contentRoot) return null;

  removeNodes(contentRoot, JUNK_SELECTORS);
  // Safety: remove leftover empty noscript wrappers
  removeNodes(contentRoot, ['noscript']);

  let cleanedHtml = contentRoot.innerHTML.trim();
  let textLength = visibleTextLength(contentRoot);

  // SPA shells often leave an empty #root — fall back to meta / JSON-LD / remaining text.
  if (textLength < 80) {
    const fallback = buildSpaFallbackHtml(rawHtml);
    if (fallback.textLength > textLength) {
      cleanedHtml = fallback.html;
      textLength = fallback.textLength;
    }
  }

  if (!cleanedHtml || textLength < 20) return null;

  return {
    htmlContent: cleanedHtml,
    textLength,
    selectorUsed: contentRoot.tagName?.toLowerCase() || 'unknown',
  };
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function buildSpaFallbackHtml(rawHtml: string): { html: string; textLength: number } {
  const parts: string[] = [];
  const title = rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  if (title) parts.push(`<h1>${title.trim()}</h1>`);

  const metaDesc =
    rawHtml.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
    rawHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1] ||
    rawHtml.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (metaDesc) parts.push(`<p>${decodeBasicEntities(metaDesc.trim())}</p>`);

  const ogTitle = rawHtml.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (ogTitle && (!title || !title.includes(ogTitle))) {
    parts.push(`<h2>${decodeBasicEntities(ogTitle.trim())}</h2>`);
  }

  const jsonLdBlocks = [...rawHtml.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of jsonLdBlocks.slice(0, 3)) {
    try {
      const data = JSON.parse(match[1]);
      const nodes = Array.isArray(data) ? data : data['@graph'] ? data['@graph'] : [data];
      for (const node of nodes) {
        if (!node || typeof node !== 'object') continue;
        const name = typeof node.name === 'string' ? node.name : '';
        const description = typeof node.description === 'string' ? node.description : '';
        if (name) parts.push(`<h2>${name}</h2>`);
        if (description) parts.push(`<p>${description}</p>`);
      }
    } catch {
      // ignore invalid json-ld
    }
  }

  const html = parts.join('\n');
  const textLength = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length;
  return { html, textLength };
}

export async function fetchPageHtml(url: string, timeoutMs = 20000): Promise<string | null> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 BlazlySEO/1.0',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) return null;

  const contentType = response.headers.get('content-type');
  if (!contentType || !contentType.toLowerCase().includes('text/html')) {
    return null;
  }

  const rawHtml = await response.text();
  return rawHtml.trim() ? rawHtml : null;
}
