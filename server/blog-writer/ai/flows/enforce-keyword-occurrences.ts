'use server';

/**
 * @fileOverview Ensures the primary keyword appears enough times via natural paragraph/heading usage (not H2 stuffing).
 */

import { withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce } from '../define-once';
import { STRATEGY_DEPLOY_LLM_CHAIN } from '../llm-models';
import { finalizeBlogHtml } from '../../lib/blog/sanitize-blog-html';
import { countPrimaryKeywordOccurrences } from '../../lib/blog/count-keyword-occurrences';
import { applyHtmlEdits, HtmlEditSchema, HTML_EDITS_INSTRUCTIONS } from '../../lib/blog/apply-html-edits';
import { z } from 'zod';
import {
  EnforceKeywordOccurrencesInputSchema,
  type EnforceKeywordOccurrencesInput,
  EnforceKeywordOccurrencesOutputSchema,
  type EnforceKeywordOccurrencesOutput,
} from '../types';

export async function enforceKeywordOccurrences(
  input: EnforceKeywordOccurrencesInput,
): Promise<EnforceKeywordOccurrencesOutput> {
  return enforceKeywordOccurrencesFlow(input);
}

const KEYWORD_RULES = `You are an on-page SEO editor. The blog below is short on natural primary keyword usage. Fix it casually — without keyword stuffing in headings.

## REQUIREMENTS
- Primary keyword phrase: "{{{primaryKeyword}}}"
- Target occurrences: about {{{keywordOccurrences}}} (currently only {{{currentOccurrences}}})
- Language: {{language}}

## Placement rules (critical)
- Prefer adding the keyword casually in **body <p> paragraphs** where the topic already fits.
- You may update **at most 1–2 headings** to include the keyword if a heading still reads naturally.
- **Do NOT** put the keyword in most or all <h2> tags. Do NOT rewrite every heading just to insert the phrase.
- Keep existing varied heading language whenever possible.
- Meta title and meta description should include the keyword if missing and if it still reads well.
- Include one natural mention in the introduction if absent.

## What NOT to do
- Do not stuff keywords unnaturally in a single sentence or consecutive sentences.
- Do not remove factual content, examples, or section structure.
- Do not use markdown or asterisks — only valid HTML.
- **DO NOT BOLD THE PRIMARY KEYWORD**: Never wrap "{{{primaryKeyword}}}" in <strong>, <b>, or <em>. Add keyword placements as plain text.
- Preserve existing bullet lists and tables.
- Keep each <p> to 2–3 sentences; do not merge paragraphs into long blocks.
{{#if geoFormat}}
- Keep question-style headings and FAQ questions exactly as they are, with their question marks.
- Keep every id attribute on headings, every <a href> link, the table of contents, tables, sample prompts and FAQ section unchanged.
{{else}}
- Do not add question marks.
{{/if}}

## Current meta title
{{{metaTitle}}}

## Current meta description
{{{metaDescription}}}

## Current HTML
\`\`\`html
{{{htmlContent}}}
\`\`\``;

const enforceKeywordOccurrencesPrompt = definePromptOnce({
  name: 'enforceKeywordOccurrencesPrompt',
  input: { schema: EnforceKeywordOccurrencesInputSchema },
  output: { schema: EnforceKeywordOccurrencesOutputSchema },
  prompt: `${KEYWORD_RULES}

Return the updated meta title, meta description, and HTML with natural keyword usage closer to the target count.`,
  config: {
    temperature: 0.35,
  },
});

const KeywordEditsOutputSchema = z.object({
  edits: z.array(HtmlEditSchema).describe('Sentence-level edits that add the keyword naturally.'),
  metaTitle: z.string().describe('Meta title with keyword included.'),
  metaDescription: z.string().describe('Meta description with keyword included.'),
});

const enforceKeywordEditsPrompt = definePromptOnce({
  name: 'enforceKeywordEditsPrompt',
  input: { schema: EnforceKeywordOccurrencesInputSchema },
  output: { schema: KeywordEditsOutputSchema },
  prompt: `${KEYWORD_RULES}

${HTML_EDITS_INSTRUCTIONS}

Add the missing keyword mentions with one edit per sentence you change, and return the updated meta title and meta description.`,
  config: {
    temperature: 0.35,
  },
});

const enforceKeywordOccurrencesFlow = defineFlowOnce(
  {
    name: 'enforceKeywordOccurrencesFlow',
    inputSchema: EnforceKeywordOccurrencesInputSchema,
    outputSchema: EnforceKeywordOccurrencesOutputSchema,
  },
  async (input) => {
    const currentOccurrences = countPrimaryKeywordOccurrences(
      input.htmlContent,
      input.primaryKeyword,
    );

    const finalizeOptions = { allowQuestions: input.geoFormat };

    if (currentOccurrences >= input.keywordOccurrences) {
      return {
        htmlContent: finalizeBlogHtml(input.htmlContent, input.primaryKeyword, finalizeOptions),
        metaTitle: input.metaTitle,
        metaDescription: input.metaDescription,
        finalOccurrences: currentOccurrences,
        wasAdjusted: false,
      };
    }

    const promptInput = {
      ...input,
      currentOccurrences,
    };

    if (input.geoFormat) {
      const { result } = await withLlmModelFallback(
        async (model) => {
          const response = await enforceKeywordEditsPrompt(promptInput, { model });
          if (!response.output?.metaTitle || !response.output.metaDescription) {
            throw new Error('Keyword enforcement prompt did not return all required fields.');
          }
          return response.output;
        },
        { label: 'enforceKeywordEdits', models: STRATEGY_DEPLOY_LLM_CHAIN },
      );
      const { html, applied } = applyHtmlEdits(input.htmlContent, result.edits);
      return {
        htmlContent: finalizeBlogHtml(html, input.primaryKeyword, finalizeOptions),
        metaTitle: result.metaTitle,
        metaDescription: result.metaDescription,
        finalOccurrences: countPrimaryKeywordOccurrences(html, input.primaryKeyword),
        wasAdjusted: applied.length > 0,
      };
    }

    const { result: output } = await withLlmModelFallback(
      async (model) => {
        const response = await enforceKeywordOccurrencesPrompt(promptInput, { model });
        if (
          !response.output?.htmlContent ||
          !response.output.metaTitle ||
          !response.output.metaDescription
        ) {
          throw new Error('Keyword enforcement prompt did not return all required fields.');
        }
        return response.output;
      },
      { label: 'enforceKeywordOccurrences', models: STRATEGY_DEPLOY_LLM_CHAIN },
    );

    const finalOccurrences = countPrimaryKeywordOccurrences(
      output.htmlContent,
      input.primaryKeyword,
    );

    return {
      htmlContent: finalizeBlogHtml(output.htmlContent, input.primaryKeyword, finalizeOptions),
      metaTitle: output.metaTitle,
      metaDescription: output.metaDescription,
      finalOccurrences,
      wasAdjusted: true,
    };
  },
);
