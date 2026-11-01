import { reviewChecks } from './checklist';
import type { ContentReview, PageCrawlData, ReviewCheckResult } from './types/site-audit';

export type SiteAuditReviewInput = {
  projectName: string;
  domainUrl: string;
  pageName: string;
  crawl: PageCrawlData;
};

export type ReviewAnthropicConfig = {
  apiKey: string;
  model?: string;
};

const PAGE_TYPES = [
  'homepage',
  'service',
  'product',
  'pricing',
  'blog-article',
  'guide',
  'category',
  'landing',
  'about',
  'contact',
  'location',
  'tool',
  'other',
] as const;

const SEARCH_INTENTS = ['informational', 'commercial', 'transactional', 'navigational', 'local', 'mixed'] as const;

function pathOf(href: string): string {
  try {
    const url = new URL(href);
    return `${url.pathname}${url.search}` || '/';
  } catch {
    return href;
  }
}

function list(items: string[], empty = 'None'): string {
  return items.length ? items.join('\n') : empty;
}

function pageDossier({ projectName, domainUrl, pageName, crawl: c }: SiteAuditReviewInput): string {
  const outline = c.headings.slice(0, 80).map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}H${h.level}: ${h.text}`);
  const contentInternal = c.links.filter((l) => l.internal && l.inContent);
  const internalLinks = (contentInternal.length ? contentInternal : c.links.filter((l) => l.internal))
    .slice(0, 40)
    .map((l) => `- "${l.text || '(no anchor text)'}" → ${pathOf(l.href)}`);
  const externalLinks = c.links
    .filter((l) => !l.internal)
    .slice(0, 30)
    .map(
      (l) =>
        `- "${l.text || '(no anchor text)'}" → ${l.href}${l.rel ? ` [rel=${l.rel}]` : ''}${l.inContent ? '' : ' (outside main content)'}`,
    );
  const images = c.images
    .filter((img) => !img.decorative)
    .slice(0, 25)
    .map((img) => `- alt="${img.alt ?? '(missing)'}" file=${img.filename}`);
  const schema = c.schema.nodes.map((n) => `- ${n.type}${n.name ? `: ${n.name}` : ''}`);
  const author = [c.author.meta, c.author.byline, c.author.schema].filter(Boolean).join(' | ');

  return `PROJECT: ${projectName} (${domainUrl})
PAGE NAME: ${pageName || '(not provided)'}
URL: ${c.finalUrl}
HTTP STATUS: ${c.statusCode}
TITLE TAG: ${c.title ?? '(missing)'}
META DESCRIPTION: ${c.metaDescription ?? '(missing)'}
LANGUAGE: ${c.lang ?? '(not declared)'}
AUTHOR SIGNALS: ${author || 'none found'}
TRUST SIGNALS: ${c.trustSignals.join(', ') || 'none'}
CTAs: ${c.ctas.slice(0, 15).map((t) => `"${t}"`).join(', ') || 'none'}
STATS: ${c.wordCount} words | Flesch ${c.fleschReadingEase ?? 'n/a'}

HEADING OUTLINE:
${list(outline, '(no headings)')}

STRUCTURED DATA:
${list(schema)}

INTERNAL LINKS:
${list(internalLinks)}

EXTERNAL LINKS:
${list(externalLinks)}

IMAGES:
${list(images)}

MAIN CONTENT:
"""
${c.contentText || '(no readable text)'}
"""`;
}

function checklistText(): { text: string; ids: string[] } {
  const relevance = reviewChecks('relevance');
  const authority = reviewChecks('authority');
  const checks = [...relevance, ...authority];
  let category = '';
  const lines: string[] = [];
  for (const check of checks) {
    if (check.category !== category) {
      category = check.category;
      lines.push('', `${category}:`);
    }
    lines.push(`- [${check.id}] ${check.label}${check.hint ? ` — ${check.hint}` : ''}`);
  }
  return { text: lines.join('\n').trim(), ids: checks.map((c) => c.id) };
}

function parseJsonBlock(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const raw = fenced || text.trim();
  return JSON.parse(raw);
}

function normalizeChecks(
  checks: Array<{ id: string; status: string; finding: string; recommendation?: string }>,
  allowed: string[],
): ReviewCheckResult[] {
  const allowedSet = new Set(allowed);
  const seen = new Set<string>();
  const results: ReviewCheckResult[] = [];
  for (const check of checks) {
    const id = check.id.trim().replace(/^\[|\]$/g, '');
    if (!allowedSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    const recommendation = (check.recommendation || '').trim();
    const status = check.status as ReviewCheckResult['status'];
    results.push({
      id,
      status,
      finding: check.finding.trim(),
      ...(recommendation && status !== 'pass' && status !== 'na' ? { recommendation } : {}),
    });
  }
  return results;
}

export async function reviewPageContent(
  input: SiteAuditReviewInput,
  config: ReviewAnthropicConfig,
): Promise<ContentReview> {
  if (!config.apiKey) {
    throw new Error('Content review requires ANTHROPIC_API_KEY.');
  }

  const checklist = checklistText();
  const prompt = `You are a senior SEO strategist auditing ONE page. Grade every checklist item using the page data.

First set:
- primaryKeyword (2–6 words, lowercase)
- primaryTopic (short phrase)
- pageType: one of ${PAGE_TYPES.join(', ')}
- searchIntent: one of ${SEARCH_INTENTS.join(', ')}
- summary: 2–3 sentences on strengths and top fixes

For each checklist id return: id, status (pass|warn|fail|na), finding (max 30 words, evidence-based), recommendation (actionable for warn/fail, else "").

Be strict — most pages have several warnings. Never invent facts.

CHECKLIST (${checklist.ids.length} ids):
${checklist.text}

PAGE DATA:
${pageDossier(input)}

Reply with ONLY valid JSON:
{
  "primaryKeyword": "",
  "primaryTopic": "",
  "pageType": "",
  "searchIntent": "",
  "summary": "",
  "checks": [{"id":"","status":"","finding":"","recommendation":""}]
}`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model || 'claude-sonnet-4-20250514',
      max_tokens: 8192,
      temperature: 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(180000),
  });

  const data = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    content?: Array<{ type: string; text?: string }>;
  };
  if (!response.ok) throw new Error(data.error?.message || 'Content review failed.');

  const text = (data.content || [])
    .filter((block) => block.type === 'text' && block.text)
    .map((block) => block.text)
    .join('\n');
  const parsed = parseJsonBlock(text) as {
    primaryKeyword?: string;
    primaryTopic?: string;
    pageType?: string;
    searchIntent?: string;
    summary?: string;
    checks?: Array<{ id: string; status: string; finding: string; recommendation?: string }>;
  };

  const checks = normalizeChecks(parsed.checks || [], checklist.ids);
  return {
    primaryKeyword:
      parsed.primaryKeyword?.trim().toLowerCase() ||
      input.crawl.title?.split(/[|\-–—:]/)[0].trim().toLowerCase() ||
      '',
    primaryTopic: parsed.primaryTopic?.trim() || '',
    pageType: parsed.pageType || 'other',
    searchIntent: parsed.searchIntent || 'mixed',
    summary: parsed.summary?.trim() || '',
    checks,
    ...(checks.length < checklist.ids.length * 0.5 ? { partial: true } : {}),
  };
}
