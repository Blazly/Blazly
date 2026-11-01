'use server';

/**
 * @fileOverview AI agent that fact-checks blog content and corrects inaccurate claims.
 */

import { ai, withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { STRATEGY_DEPLOY_LLM_CHAIN } from '../llm-models';
import {
  FactCheckBlogInputSchema,
  type FactCheckBlogInput,
  FactCheckBlogOutputSchema,
  type FactCheckBlogOutput,
} from '../types';
import { APP_CURRENT_YEAR, getAiTemporalContextBlock } from '../../lib/ai/date-context';
import { finalizeBlogHtml } from '../../lib/blog/sanitize-blog-html';
import { applyHtmlEdits, HtmlEditSchema, HTML_EDITS_INSTRUCTIONS } from '../../lib/blog/apply-html-edits';
import { z } from 'zod';

export async function factCheckBlog(input: FactCheckBlogInput): Promise<FactCheckBlogOutput> {
  return factCheckBlogFlow(input);
}

const FACT_CHECK_RULES = `${getAiTemporalContextBlock()}

You are a meticulous fact-checking editor and subject-matter researcher. Your job is to review a blog post and fix any factual errors while preserving the article's structure, tone, SEO value, and HTML formatting.

## STRICT LANGUAGE MANDATE (CRITICAL)
- **The corrected content MUST remain entirely in {{language}}.**
- Do not translate or mix languages.

## Blog Context
Title: {{{blogTitle}}}
{{#if primaryKeyword}}Primary Keyword: {{{primaryKeyword}}}{{/if}}
{{#if keywordOccurrences}}
**KEYWORD USAGE:** Keep about {{{keywordOccurrences}}} natural appearances of "{{{primaryKeyword}}}". Prefer body paragraphs; do not stuff most <h2> headings with the keyword. If the count drops a bit while correcting facts, restore it with casual paragraph mentions — not by rewriting every heading.
{{/if}}

## What to verify and fix
1. **Statistics and percentages** — Replace vague or likely incorrect numbers with accurate, defensible figures. If a specific statistic cannot be verified, rewrite the sentence to avoid an unverifiable claim (use qualitative language instead of invented numbers). **Exception:** numbers and prices from the user's Brain/knowledge base are authoritative — keep them exactly.
2. **Named entities** — Verify company names, product names, tool names, and technical terms are real and used correctly. Prefer Brain naming when provided.
3. **Cause-and-effect claims** — Ensure causal statements are reasonable and not overstated.
4. **Dates, timelines, and "studies show" claims** — Either cite a real, well-known source in the text or rewrite to remove the unsupported reference. References to the current year (${APP_CURRENT_YEAR}) are correct and must not be "corrected" to an earlier year.
5. **Technical accuracy** — Fix incorrect definitions, outdated advice, or wrong best practices. Do not override Brain product/pricing facts.

## What NOT to change
- Do NOT rewrite the entire article from scratch.
- Do NOT change the overall structure, heading hierarchy, or paragraph count unless a section contains a critical factual error.
- Do NOT remove HTML tags or convert HTML to markdown.
{{#if geoFormat}}
- Keep question-style headings and FAQ questions exactly as questions, with their question marks. Do not add rhetorical questions to body paragraphs.
- Keep every id attribute on headings and every <a href> link (table of contents jump links, sources, landing page). If a cited source or statistic is wrong, fix the claim and its link together rather than deleting the link.
- Keep the TL;DR, Key takeaways, table of contents, major deep-dive body sections, comparison tables, checklist, roadmap, sample AI prompts, FAQ section and CTA.
{{else}}
- Do NOT add question marks — keep declarative tone.
{{/if}}
- Do NOT use asterisks for formatting — use <strong> and <em> only for non-keyword emphasis.
- **DO NOT BOLD THE PRIMARY KEYWORD**: Never wrap "{{{primaryKeyword}}}" in <strong>, <b>, or <em>.
- Preserve bullet lists (<ul>/<ol>) and <table> elements — do not convert them to paragraphs.
- Keep paragraphs short: each <p> should have at most 3 sentences.
- Preserve keyword placement and natural SEO flow.
{{#if knowledgeBase}}
- **BRAIN IS SOURCE OF TRUTH**: Facts from the user's Brain (pricing, product names, plan details, numbers, features) MUST stay exactly as written. Never "correct", replace, round, or remove Brain facts — even if they look unusual. Example: Brain "$100 / month" must remain "$100 / month".
{{/if}}

{{#if knowledgeBase}}
## User Brain / Knowledge Base (authoritative brand & product facts)
<knowledge_base>
{{{knowledgeBase}}}
</knowledge_base>
{{/if}}

## Original Meta Title
{{{metaTitle}}}

## Original Meta Description
{{{metaDescription}}}

## Original HTML Content
\`\`\`html
{{{htmlContent}}}
\`\`\``;

const factCheckBlogPrompt = definePromptOnce({
  name: 'factCheckBlogPrompt',
  input: { schema: FactCheckBlogInputSchema },
  output: { schema: FactCheckBlogOutputSchema },
  prompt: `${FACT_CHECK_RULES}

## Output requirements
Return the corrected meta title, meta description, and HTML content. List each factual correction you made in correctionsSummary (empty array if none needed). Only include genuine factual fixes — not stylistic edits.`,
});

const FactCheckEditsOutputSchema = z.object({
  edits: z.array(HtmlEditSchema).describe('Targeted factual corrections. Empty when nothing is wrong.'),
  correctedMetaTitle: z.string().describe('The fact-checked meta title (unchanged if already correct).'),
  correctedMetaDescription: z.string().describe('The fact-checked meta description (unchanged if already correct).'),
});

const factCheckBlogEditsPrompt = definePromptOnce({
  name: 'factCheckBlogEditsPrompt',
  input: { schema: FactCheckBlogInputSchema },
  output: { schema: FactCheckEditsOutputSchema },
  prompt: `${FACT_CHECK_RULES}

${HTML_EDITS_INSTRUCTIONS}

## Output requirements
Return only genuine factual fixes as edits (not stylistic changes), each with a short reason, plus the corrected meta title and meta description.`,
});

const factCheckBlogFlow = defineFlowOnce(
  {
    name: 'factCheckBlogFlow',
    inputSchema: FactCheckBlogInputSchema,
    outputSchema: FactCheckBlogOutputSchema,
  },
  async (input) => {
    const finalizeOptions = { allowQuestions: input.geoFormat };

    // Long Blog Writer articles: re-emitting the whole HTML is the slowest part of the pipeline.
    if (input.geoFormat) {
      const { result } = await withLlmModelFallback(
        async (model) => {
          const response = await factCheckBlogEditsPrompt(input, {
            config: { temperature: 0.2 },
            model,
          });
          if (!response.output?.correctedMetaTitle || !response.output.correctedMetaDescription) {
            throw new Error('Fact-check did not return all required fields.');
          }
          return response.output;
        },
        { label: 'factCheckBlogEdits', models: STRATEGY_DEPLOY_LLM_CHAIN },
      );
      const { html, applied } = applyHtmlEdits(input.htmlContent, result.edits);
      return {
        correctedHtmlContent: finalizeBlogHtml(html, input.primaryKeyword, finalizeOptions),
        correctedMetaTitle: result.correctedMetaTitle,
        correctedMetaDescription: result.correctedMetaDescription,
        correctionsSummary: applied.map((edit) => edit.reason || edit.replace).filter(Boolean),
      };
    }

    const { result } = await withLlmModelFallback(
      async (model) => {
        const response = await factCheckBlogPrompt(input, {
          config: { temperature: 0.2 },
          model,
        });
        if (
          !response.output?.correctedHtmlContent ||
          !response.output.correctedMetaTitle ||
          !response.output.correctedMetaDescription
        ) {
          throw new Error('Fact-check did not return all required fields.');
        }
        return response.output;
      },
      { label: 'factCheckBlog', models: STRATEGY_DEPLOY_LLM_CHAIN },
    );

    return {
      ...result,
      correctedHtmlContent: finalizeBlogHtml(result.correctedHtmlContent, input.primaryKeyword, finalizeOptions),
    };
  },
);
