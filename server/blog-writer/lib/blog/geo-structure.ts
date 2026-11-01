/** Browser-only helpers (DOMParser) for GEO-structured blog HTML. */

const QUESTION_END = /[?？؟]\s*$/;

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
}

function parse(html: string): Document | null {
  if (typeof DOMParser === 'undefined') return null;
  return new DOMParser().parseFromString(html, 'text/html');
}

/** First list whose links are all in-page jump links (the table of contents). */
function findTocList(doc: Document): HTMLUListElement | HTMLOListElement | null {
  const lists = Array.from(doc.body.querySelectorAll<HTMLUListElement | HTMLOListElement>('ul, ol'));
  return (
    lists.find((list) => {
      const links = Array.from(list.querySelectorAll('a'));
      return links.length >= 3 && links.every((a) => (a.getAttribute('href') || '').startsWith('#'));
    }) ?? null
  );
}

/**
 * Gives every <h2> a unique id and rebuilds the table of contents from the H2s that follow it,
 * so jump links stay valid after AI passes rename or reorder sections.
 */
export function syncTableOfContents(html: string): string {
  const doc = parse(html);
  if (!doc) return html;

  const used = new Set<string>();
  const headings = Array.from(doc.body.querySelectorAll('h2'));
  headings.forEach((h2, index) => {
    let id = h2.id || slugifyHeading(h2.textContent || '') || `section-${index + 1}`;
    let suffix = 2;
    const base = id;
    while (used.has(id)) id = `${base}-${suffix++}`;
    used.add(id);
    h2.id = id;
  });

  const toc = findTocList(doc);
  if (toc) {
    const following = headings.filter(
      (h2) => toc.compareDocumentPosition(h2) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    if (following.length > 0) {
      toc.innerHTML = '';
      following.forEach((h2) => {
        const li = doc.createElement('li');
        const a = doc.createElement('a');
        a.setAttribute('href', `#${h2.id}`);
        a.textContent = (h2.textContent || '').trim();
        li.appendChild(a);
        toc.appendChild(li);
      });
    }
  }

  return doc.body.innerHTML;
}

type FaqItem = { question: string; answer: string };

/** FAQs are the H3 questions in the last H2 section that contains at least three of them. */
function extractFaqs(doc: Document): FaqItem[] {
  const blocks = Array.from(doc.body.children);
  const sections: FaqItem[][] = [];
  let current: FaqItem[] = [];
  let pending: FaqItem | null = null;

  const flush = () => {
    if (pending && pending.answer) current.push(pending);
    pending = null;
  };

  for (const el of blocks) {
    const tag = el.tagName;
    if (tag === 'H2') {
      flush();
      sections.push(current);
      current = [];
    } else if (tag === 'H3') {
      flush();
      const question = (el.textContent || '').trim();
      if (QUESTION_END.test(question)) pending = { question, answer: '' };
    } else if (pending && (tag === 'P' || tag === 'UL' || tag === 'OL')) {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      pending.answer = pending.answer ? `${pending.answer} ${text}` : text;
    }
  }
  flush();
  sections.push(current);

  for (let i = sections.length - 1; i >= 0; i--) {
    if (sections[i].length >= 3) return sections[i];
  }
  return [];
}

export type BlogSchemaInput = {
  html: string;
  title: string;
  metaDescription?: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
  brandName?: string;
  landingPageUrl?: string;
  language?: string;
  authorName?: string;
};

/** Article + FAQPage JSON-LD built from the final article content. */
export function buildBlogSchemaJsonLd(input: BlogSchemaInput): string {
  const doc = parse(input.html);
  if (!doc) return '';

  let publisherUrl: string | undefined;
  try {
    publisherUrl = input.landingPageUrl ? new URL(input.landingPageUrl).origin : undefined;
  } catch {
    publisherUrl = undefined;
  }

  const today = new Date().toISOString().slice(0, 10);
  const keywords = [input.primaryKeyword, ...(input.secondaryKeywords ?? [])]
    .map((k) => k?.trim())
    .filter(Boolean);
  const wordCount = (doc.body.textContent || '').trim().split(/\s+/).filter(Boolean).length;

  const article: Record<string, unknown> = {
    '@type': 'Article',
    headline: input.title.slice(0, 110),
    description: input.metaDescription || undefined,
    keywords: keywords.length ? keywords.join(', ') : undefined,
    inLanguage: input.language || undefined,
    wordCount,
    datePublished: today,
    dateModified: today,
    author: input.authorName
      ? { '@type': 'Person', name: input.authorName }
      : input.brandName
        ? { '@type': 'Organization', name: input.brandName }
        : undefined,
    publisher: input.brandName
      ? { '@type': 'Organization', name: input.brandName, url: publisherUrl }
      : undefined,
  };

  const graph: Record<string, unknown>[] = [article];
  const faqs = extractFaqs(doc);
  if (faqs.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: faqs.map((faq) => ({
        '@type': 'Question',
        name: faq.question,
        acceptedAnswer: { '@type': 'Answer', text: faq.answer },
      })),
    });
  }

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2);
}
