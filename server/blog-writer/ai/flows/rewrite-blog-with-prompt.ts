'use server';

/**
 * @fileOverview Rewrites a generated blog post based on a user-provided prompt.
 */

import { withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce } from '../define-once';
import { STRATEGY_DEPLOY_LLM_CHAIN } from '../llm-models';
import {
  RewriteBlogWithPromptInputSchema,
  type RewriteBlogWithPromptInput,
  RewriteBlogWithPromptOutputSchema,
  type RewriteBlogWithPromptOutput,
} from '../types';

export async function rewriteBlogWithPrompt(
  input: RewriteBlogWithPromptInput,
): Promise<RewriteBlogWithPromptOutput> {
  return rewriteBlogWithPromptFlow(input);
}

const rewriteBlogWithPromptPrompt = definePromptOnce({
  name: 'rewriteBlogWithPromptPrompt',
  input: { schema: RewriteBlogWithPromptInputSchema },
  output: { schema: RewriteBlogWithPromptOutputSchema },
  prompt: `You are an expert blog editor. Rewrite the blog post below according to the user's instructions while preserving factual accuracy and SEO value.

## User rewrite instructions (follow precisely)
{{{rewritePrompt}}}

## Context
{{#if blogTitle}}Blog title: {{{blogTitle}}}{{/if}}
{{#if primaryKeyword}}Primary keyword (maintain natural usage): {{{primaryKeyword}}}{{/if}}
{{#if keywordOccurrences}}Target primary keyword appearances: about {{{keywordOccurrences}}} times (casually in paragraphs; only a few headings — never most H2s){{/if}}
{{#if tone}}Tone: {{{tone}}}{{/if}}
**Language:** {{language}} — the entire output must be written exclusively in this language.

## Current meta title
{{{metaTitle}}}

## Current meta description
{{{metaDescription}}}

## Current HTML content
\`\`\`html
{{{htmlContent}}}
\`\`\`

## Rules
1. Apply the user's rewrite instructions throughout the article, meta title, and meta description where relevant.
2. Keep valid HTML structure (<p>, <h2>, <h3>, <ul>, <li>, <strong>, <em>). No markdown or asterisks for formatting.
3. Do not invent false statistics or unverifiable claims.
4. Preserve the core topic and expertise unless the user explicitly asks to change the subject.
5. If the user asks to shorten or lengthen, adjust length accordingly while keeping quality.
6. Output ONLY the JSON object with rewrittenHtmlContent, rewrittenMetaTitle, and rewrittenMetaDescription.`,
  config: {
    temperature: 0.65,
  },
});

const rewriteBlogWithPromptFlow = defineFlowOnce(
  {
    name: 'rewriteBlogWithPromptFlow',
    inputSchema: RewriteBlogWithPromptInputSchema,
    outputSchema: RewriteBlogWithPromptOutputSchema,
  },
  async (input) => {
    const { result: output } = await withLlmModelFallback(
      async (model) => {
        const response = await rewriteBlogWithPromptPrompt(input, { model });
        if (
          !response.output?.rewrittenHtmlContent ||
          !response.output.rewrittenMetaTitle ||
          !response.output.rewrittenMetaDescription
        ) {
          throw new Error('Rewrite prompt did not return all required fields.');
        }
        return response.output;
      },
      { label: 'rewriteBlogWithPrompt', models: STRATEGY_DEPLOY_LLM_CHAIN },
    );
    return output;
  },
);
