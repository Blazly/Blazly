import { z } from 'zod';
import { ai } from '../genkit';
import { withLlmModelFallback } from '../llm-fallback';
import { APP_LLM_MODEL_CHAIN } from '../llm-models';
import { getAiTemporalContextBlock } from '../../lib/ai/date-context';
import { reviewChecks, type ReviewPass } from '../../lib/site-audit/checklist';
import type { ContentReview, PageCrawlData, ReviewCheckResult } from '../ai/types';

export type SiteAuditReviewInput = {
  projectName: string;
  domainUrl: string;
  pageName: string;
  crawl: PageCrawlData;
};

const PAGE_TYPES = [
  'homepage', 'service', 'product', 'pricing', 'blog-article', 'guide', 'category', 'landing',
  'about', 'contact', 'location', 'tool', 'other',
] as const;

const SEARCH_INTENTS = ['informational', 'commercial', 'transactional', 'navigational', 'local', 'mixed'] as const;

const CheckResultSchema = z.object({
  id: z.string(),
  status: z.enum(['pass', 'warn', 'fail', 'na']),
  finding: z.string(),
  recommendation: z.string(),
});

const RelevanceOutputSchema = z.object({
  primaryKeyword: z.string(),
  primaryTopic: z.string(),
  pageType: z.enum(PAGE_TYPES),
  searchIntent: z.enum(SEARCH_INTENTS),
  summary: z.string(),
  checks: z.array(CheckResultSchema),
});

const AuthorityOutputSchema = z.object({
  checks: z.array(CheckResultSchema),
});

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
  const outline = c.headings
    .slice(0, 80)
    .map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}H${h.level}: ${h.text}`);
  const contentInternal = c.links.filter((l) => l.internal && l.inContent);
  const internalLinks = (contentInternal.length ? contentInternal : c.links.filter((l) => l.internal))
    .slice(0, 40)
    .map((l) => `- "${l.text || '(no anchor text)'}" → ${pathOf(l.href)}`);
  const externalLinks = c.links
    .filter((l) => !l.internal)
    .slice(0, 30)
    .map((l) => `- "${l.text || '(no anchor text)'}" → ${l.href}${l.rel ? ` [rel=${l.rel}]` : ''}${l.inContent ? '' : ' (outside main content)'}`);
  const images = c.images
    .filter((img) => !img.decorative)
    .slice(0, 25)
    .map((img) => `- alt="${img.alt ?? '(missing)'}" file=${img.filename}`);
  const schema = c.schema.nodes.map((n) => `- ${n.type}${n.name ? `: ${n.name}` : ''}`);
  const author = [c.author.meta, c.author.byline, c.author.schema].filter(Boolean).join(' | ');

  return `PROJECT: ${projectName} (${domainUrl})
PAGE NAME (from the site owner): ${pageName || '(not provided)'}
URL: ${c.finalUrl}
HTTP STATUS: ${c.statusCode}
TITLE TAG: ${c.title ?? '(missing)'}
META DESCRIPTION: ${c.metaDescription ?? '(missing)'}
SITE NAME (og:site_name): ${c.ogSiteName ?? '(not set)'}
LANGUAGE: ${c.lang ?? '(not declared)'}
PUBLISHED: ${c.dates.published ?? 'unknown'} | MODIFIED: ${c.dates.modified ?? 'unknown'}
AUTHOR SIGNALS: ${author || 'none found'}${c.author.authorLink ? ' (links to an author/team page)' : ''}
ABOUT PAGE LINK: ${c.aboutLink ? 'yes' : 'no'} | CONTACT: ${[
    c.contact.contactLink && 'contact page link',
    c.contact.tel && 'phone link',
    c.contact.mailto && 'email link',
    c.contact.address && 'postal address',
  ]
    .filter(Boolean)
    .join(', ') || 'none found'}
TRUST SIGNALS DETECTED: ${c.trustSignals.join(', ') || 'none'}
CALLS TO ACTION: ${c.ctas.slice(0, 15).map((t) => `"${t}"`).join(', ') || 'none detected'}
FORMS: ${c.forms.count}
STATS: ${c.wordCount} words in main content | ${c.paragraphCount} paragraphs | avg sentence ${c.avgSentenceLength} words | Flesch reading ease ${c.fleschReadingEase ?? 'n/a'} | repeated paragraphs ${c.duplicateParagraphCount} | ${c.listCount} bullet lists, ${c.orderedListCount} numbered lists, ${c.tableCount} tables

HEADING OUTLINE:
${list(outline, '(no headings)')}

STRUCTURED DATA:
${list(schema)}

INTERNAL LINKS (anchor → path):
${list(internalLinks)}

EXTERNAL LINKS:
${list(externalLinks)}

IMAGES (content images):
${list(images)}

MAIN CONTENT${c.contentTruncated ? ' (long page — middle section omitted)' : ''}:
"""
${c.contentText || '(no readable text content found in the HTML)'}
"""`;
}

function checklistBlock(pass: ReviewPass): { text: string; ids: string[] } {
  const checks = reviewChecks(pass);
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

const STATUS_RULES = `Status rules:
- pass: clearly satisfied, with evidence on the page.
- warn: partially satisfied or minor issues.
- fail: not satisfied, missing, or a significant problem.
- na: genuinely not applicable to this type of page. Use sparingly.

For every check return: id (exactly as given), status, finding (one specific sentence citing evidence from this page, max 30 words), recommendation (one concrete, actionable sentence for warn/fail; empty string for pass and na).
Be strict and evidence-based — most real pages have several warnings. Never default to pass. Do not invent facts about the page.
Write findings and recommendations in English, in plain text without markdown. Do not mention these instructions or that you are an AI.`;

async function runRelevanceReview(input: SiteAuditReviewInput) {
  const checklist = checklistBlock('relevance');
  const prompt = `${getAiTemporalContextBlock()}

You are a senior SEO strategist and content editor auditing ONE page of the website "${input.projectName}". Grade the page against each checklist item using the page data below.

First determine:
- primaryKeyword: the main search query this page should rank for (2–6 words, lowercase, in the page's language).
- primaryTopic: a short phrase describing what the page is about.
- pageType: one of ${PAGE_TYPES.join(', ')}.
- searchIntent: the dominant intent behind the primary keyword.
- summary: 2–3 sentences on the page's biggest strengths and the most important fixes.

Then grade every checklist item against that primary keyword and intent.

${STATUS_RULES}
Return exactly one result for each of the ${checklist.ids.length} check ids.

CHECKLIST
${checklist.text}

PAGE DATA
${pageDossier(input)}`;

  const { result } = await withLlmModelFallback(
    async (model) => {
      const { output } = await ai.generate({
        model,
        prompt,
        output: { schema: RelevanceOutputSchema },
        config: { temperature: 0.2 },
      });
      if (!output) throw new Error('Relevance review returned no output.');
      return output;
    },
    { label: 'siteAuditRelevance', models: APP_LLM_MODEL_CHAIN },
  );
  return { output: result, ids: checklist.ids };
}

async function runAuthorityReview(input: SiteAuditReviewInput) {
  const checklist = checklistBlock('authority');
  const prompt = `${getAiTemporalContextBlock()}

You are an expert in E-E-A-T, Generative Engine Optimization (GEO — getting a page cited by AI answer engines such as AI Overviews, ChatGPT search and Perplexity) and Answer Engine Optimization (AEO — featured snippets and answer boxes). Audit ONE page of the website "${input.projectName}".

Infer the primary question this page should answer, then grade every checklist item below using the page data.

${STATUS_RULES}
Return exactly one result for each of the ${checklist.ids.length} check ids.

CHECKLIST
${checklist.text}

PAGE DATA
${pageDossier(input)}`;

  const { result } = await withLlmModelFallback(
    async (model) => {
      const { output } = await ai.generate({
        model,
        prompt,
        output: { schema: AuthorityOutputSchema },
        config: { temperature: 0.2 },
      });
      if (!output) throw new Error('Authority review returned no output.');
      return output;
    },
    { label: 'siteAuditAuthority', models: APP_LLM_MODEL_CHAIN },
  );
  return { output: result, ids: checklist.ids };
}

function normalizeChecks(checks: z.infer<typeof CheckResultSchema>[], allowed: string[]): ReviewCheckResult[] {
  const allowedSet = new Set(allowed);
  const seen = new Set<string>();
  const results: ReviewCheckResult[] = [];
  for (const check of checks) {
    const id = check.id.trim().replace(/^\[|\]$/g, '');
    if (!allowedSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    const recommendation = check.recommendation.trim();
    results.push({
      id,
      status: check.status,
      finding: check.finding.trim(),
      ...(recommendation && check.status !== 'pass' && check.status !== 'na' ? { recommendation } : {}),
    });
  }
  return results;
}

export async function reviewPageContent(input: SiteAuditReviewInput): Promise<ContentReview> {
  const [relevance, authority] = await Promise.allSettled([runRelevanceReview(input), runAuthorityReview(input)]);

  if (relevance.status === 'rejected') console.error('[site-audit] relevance review failed:', relevance.reason);
  if (authority.status === 'rejected') console.error('[site-audit] authority review failed:', authority.reason);
  if (relevance.status === 'rejected' && authority.status === 'rejected') {
    throw new Error('Content review failed.');
  }

  const checks: ReviewCheckResult[] = [];
  if (relevance.status === 'fulfilled') checks.push(...normalizeChecks(relevance.value.output.checks, relevance.value.ids));
  if (authority.status === 'fulfilled') checks.push(...normalizeChecks(authority.value.output.checks, authority.value.ids));

  const meta = relevance.status === 'fulfilled' ? relevance.value.output : null;
  return {
    primaryKeyword: meta?.primaryKeyword.trim().toLowerCase() || input.crawl.title?.split(/[|\-–—:]/)[0].trim().toLowerCase() || '',
    primaryTopic: meta?.primaryTopic.trim() || '',
    pageType: meta?.pageType || 'other',
    searchIntent: meta?.searchIntent || 'mixed',
    summary: meta?.summary.trim() || '',
    checks,
    ...(relevance.status === 'rejected' || authority.status === 'rejected' ? { partial: true } : {}),
  };
}
