'use server';
/**
 * @fileOverview AI agent that enhances on-page SEO of a blog post based on analysis feedback.
 *
 * - enhanceSeo - A function that rewrites content to improve SEO score.
 * - EnhanceSeoInput - The input type.
 * - EnhanceSeoOutput - The return type.
 */

import {ai, withLlmModelFallback} from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { STRATEGY_DEPLOY_LLM_CHAIN } from '../llm-models';
import { finalizeBlogHtml } from '../../lib/blog/sanitize-blog-html';
import {
  EnhanceSeoInputSchema,
  type EnhanceSeoInput,
  EnhanceSeoOutputSchema,
  type EnhanceSeoOutput
} from '../types';
import { getAiTemporalContextBlock } from '../../lib/ai/date-context';
import { applyHtmlEdits, HtmlEditSchema, HTML_EDITS_INSTRUCTIONS } from '../../lib/blog/apply-html-edits';
import { z } from 'zod';


export async function enhanceSeo(input: EnhanceSeoInput): Promise<EnhanceSeoOutput> {
  return enhanceSeoFlow(input);
}


const enhanceSeoPrompt = definePromptOnce({
    name: 'enhanceSeoPrompt',
    input: {schema: EnhanceSeoInputSchema},
    output: {schema: EnhanceSeoOutputSchema},
    prompt: `${getAiTemporalContextBlock()}

You are an On-Page SEO expert and an expert copywriter. Your task is to rewrite the provided blog post content, meta title, and meta description to specifically fix every single issue listed in the "areas for improvement" section from a previous SEO analysis. Your goal is to achieve a perfect 100 SEO score while maintaining the blog's original tone and core message.

## STRICT LANGUAGE MANDATE (CRITICAL)
- **YOUR ENTIRE OUTPUT MUST BE WRITTEN EXCLUSIVELY IN {{language}}.** 
- **ABSOLUTELY NO ENGLISH**: Do not use English words or phrases if {{language}} is not English.
- Every single sentence, word, and character must be strictly in {{language}}.
- **NO BILINGUAL OUTPUT**: Never mix languages.

**Primary Keyword:** {{{primaryKeyword}}}
{{#if keywordOccurrences}}
**KEYWORD TARGET (NATURAL):** Aim for about {{{keywordOccurrences}}} appearances of "{{{primaryKeyword}}}". Place them casually in paragraphs and in only a few headings — never force the keyword into most H2s.
{{/if}}
**Target Language:** {{language}}

**Analysis of current SEO issues (What you MUST fix):**
- **Score Justification:** "{{seoAnalysis.scoreJustification}}"
- **Areas for Improvement:**
{{#each seoAnalysis.areasForImprovement}}
  - {{{this}}}
{{/each}}

**Original Meta Title:** {{{metaTitle}}}
**Original Meta Description:** {{{metaDescription}}}
**Original HTML Content:**
\`\`\`html
{{{htmlContent}}}
\`\`\`

{{#if knowledgeBase}}
**BRAIN / KNOWLEDGE BASE — SOURCE OF TRUTH (MANDATORY):**
Facts in this Brain content (pricing, plan names, product details, numbers, features) MUST remain exactly correct in the rewritten HTML and meta tags. Do not change, round, omit, or replace them with vague language.
Example: if Brain says "$100 / month", keep "$100 / month" — never "$99", "affordable", or a different amount.
<knowledge_base>
{{{knowledgeBase}}}
</knowledge_base>
{{/if}}

{{#if geoFormat}}
**GEO STRUCTURE — PRESERVE (OVERRIDES THE REWRITE RULES BELOW):**
This article is built for Google and AI answer engines. Make targeted edits only — never shorten it or drop sections.
- Keep the TL;DR, Key takeaways, table of contents, major deep-dive sections (examples, case studies, or topic-specific structure — not forced framework blocks), comparison tables, checklist, 30/60/90-day roadmap, sample AI prompts (<blockquote>), FAQ section and conclusion with CTA.
- Keep question-style <h2>/<h3> headings and FAQ questions exactly as questions, with their question marks.
- Keep every id attribute on headings and every <a href> link (table of contents jump links, sources, landing page). If you rename an <h2>, keep its id unchanged.
- Meta title under 60 characters; meta description under 155 characters.
{{/if}}

**Execution Plan:**

1.  **Analyze and Strategize**: Carefully review each point in the "Areas for Improvement". Create a clear mental plan on how to address every single point by modifying the content, title, and description.
2.  **FORMATTING RULES (CRITICAL)**: 
    *   **ABSOLUTELY NO ASTERISKS**: NEVER use asterisks (* or **) for formatting bold or italics.
    *   **DO NOT BOLD THE PRIMARY KEYWORD**: Never wrap "{{{primaryKeyword}}}" in <strong>, <b>, or <em>. Keywords must appear as plain text.
    *   Use <strong> and <em> sparingly for non-keyword emphasis only.
    *   **PRESERVE STRUCTURE**: Keep and improve scannable formatting — short paragraphs, <ul>/<ol> bullet lists, and <table> elements where appropriate. Do not collapse lists or tables into long paragraph blocks.
3.  **Rewrite Meta Title**: Rewrite the meta title in {{language}} to be between 50-60 characters and include the primary keyword, ideally near the beginning. It must be compelling and resolve any title-related issues from the feedback.
4.  **Rewrite Meta Description**: Rewrite the meta description in {{language}} to be between 150-160 characters. It must include the primary keyword naturally and be highly compelling to encourage clicks from search results, resolving any description-related issues.
5.  **Rewrite HTML Content**: Rewrite the full HTML content in {{language}}. This is a deep rewrite, not just minor edits.
    *   **Integrate Keywords**: Weave "{{{primaryKeyword}}}" casually into the meta title, meta description, opening paragraphs, and body text. Use it in **only a few** <h2>/<h3> headings where it fits naturally — never in 80% or most headings. Prefer paragraph mentions over heading stuffing. Aim for about {{{keywordOccurrences}}} total occurrences when specified.
    *   **Satisfy Search Intent**: Make sure the content comprehensively answers the likely questions a user searching for the primary keyword would have.
    *   **Improve Readability**: Use short <p> tags (2–3 sentences each), headings (H2, H3), bullet lists (<ul><li>), and tables (<table>, <thead>, <tbody>, <tr>, <th>, <td>) where they aid scanning.
    *   **Preserve Meaning**: Do NOT change the core message, facts, or tone of the original blog post. The goal is to enhance its SEO, not write a new article.
    *   **Preserve Brain Facts**: If Brain/knowledge base content was provided, keep every pricing figure, product name, and concrete claim exactly as stated.
6.  **Final Review**: Before generating the output, re-read your rewritten content, title, and description. Ensure every single point has been fully resolved and NO ASTERISKS remain.
7.  **Final Output**: Provide the rewritten, perfectly optimized content in the specified JSON format.

Provide ONLY the JSON output, nothing else.`,
    config: {
      temperature: 0.6,
    },
  });
  

const EnhanceSeoEditsOutputSchema = z.object({
  edits: z.array(HtmlEditSchema).describe('Targeted edits that fix the listed SEO issues.'),
  enhancedMetaTitle: z.string().describe('Meta title under 60 characters including the primary keyword.'),
  enhancedMetaDescription: z.string().describe('Meta description under 155 characters including the primary keyword.'),
});

const enhanceSeoEditsPrompt = definePromptOnce({
  name: 'enhanceSeoEditsPrompt',
  input: { schema: EnhanceSeoInputSchema },
  output: { schema: EnhanceSeoEditsOutputSchema },
  prompt: `${getAiTemporalContextBlock()}

You are an on-page SEO editor. Fix every issue listed in the SEO analysis below with small, targeted edits. The article is already structured for Google and AI answer engines — do not restructure it, shorten it or remove sections.

## STRICT LANGUAGE MANDATE
Everything you write must be in {{language}}.

**Primary Keyword:** {{{primaryKeyword}}}
{{#if keywordOccurrences}}Aim for about {{{keywordOccurrences}}} natural appearances of the keyword in total — mostly in paragraphs, only a few headings.{{/if}}

**SEO issues to fix:**
- {{seoAnalysis.scoreJustification}}
{{#each seoAnalysis.areasForImprovement}}
- {{{this}}}
{{/each}}

## Rules
- Keep the TL;DR, Key takeaways, table of contents, major deep-dive body sections, comparison tables, checklist, roadmap, sample AI prompts (<blockquote>), FAQ section and conclusion with CTA.
- Keep question-style headings and FAQ questions as questions, with their question marks.
- Keep every id attribute on headings and every <a href> link. If you edit an <h2>, keep its id unchanged.
- Never bold the primary keyword. No markdown, no asterisks.
- Meta title under 60 characters and meta description under 155 characters, both including the primary keyword.
{{#if knowledgeBase}}
- Brain facts below (pricing, product names, numbers) must stay exactly as written.
<knowledge_base>
{{{knowledgeBase}}}
</knowledge_base>
{{/if}}

${HTML_EDITS_INSTRUCTIONS}

**Current Meta Title:** {{{metaTitle}}}
**Current Meta Description:** {{{metaDescription}}}
**Current HTML:**
\`\`\`html
{{{htmlContent}}}
\`\`\``,
  config: {
    temperature: 0.4,
  },
});

const enhanceSeoFlow = defineFlowOnce(
  {
    name: 'enhanceSeoFlow',
    inputSchema: EnhanceSeoInputSchema,
    outputSchema: EnhanceSeoOutputSchema,
  },
  async (input) => {
    try {
      if (input.geoFormat) {
        const { result } = await withLlmModelFallback(
          async (model) => {
            const response = await enhanceSeoEditsPrompt(input, { model });
            if (!response.output?.enhancedMetaTitle || !response.output.enhancedMetaDescription) {
              throw new Error('SEO enhancement prompt did not return a valid output.');
            }
            return response.output;
          },
          { label: 'enhanceSeoEdits', models: STRATEGY_DEPLOY_LLM_CHAIN },
        );
        const { html } = applyHtmlEdits(input.htmlContent, result.edits);
        return {
          enhancedHtmlContent: finalizeBlogHtml(html, input.primaryKeyword, { allowQuestions: true }),
          enhancedMetaTitle: result.enhancedMetaTitle,
          enhancedMetaDescription: result.enhancedMetaDescription,
        };
      }

      const { result: output } = await withLlmModelFallback(
        async (model) => {
          const response = await enhanceSeoPrompt(input, { model });
          if (!response.output) {
            throw new Error('SEO enhancement prompt did not return a valid output.');
          }
          return response.output;
        },
        { label: 'enhanceSeo', models: STRATEGY_DEPLOY_LLM_CHAIN },
      );
      return {
        ...output,
        enhancedHtmlContent: finalizeBlogHtml(output.enhancedHtmlContent, input.primaryKeyword, {
          allowQuestions: input.geoFormat,
        }),
      };
    } catch (error: unknown) {
      console.error('Error during SEO enhancement flow:', error);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to enhance SEO: ${message}`);
    }
  }
);
