'use server';

import { withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce } from '../define-once';
import { STRATEGY_DEPLOY_LLM_CHAIN } from '../llm-models';
import { prepareHtmlForAnalysis } from '../../lib/scrape/html-to-analysis-text';
import { z } from 'genkit';

const DetectPagePrimaryKeywordInputSchema = z.object({
  pageUrl: z.string(),
  pageTitle: z.string(),
  metaDescription: z.string().optional(),
  htmlContent: z.string(),
  gscTopQuery: z.string().optional(),
  clickChangePct: z.number().optional(),
});

export type DetectPagePrimaryKeywordInput = z.infer<typeof DetectPagePrimaryKeywordInputSchema>;

const DetectPagePrimaryKeywordOutputSchema = z.object({
  primaryKeyword: z.string().describe('The best primary SEO keyword for this page.'),
  secondaryKeyword: z.string().optional().describe('Optional secondary keyword phrase.'),
  rationale: z.string().describe('One sentence explaining the keyword choice.'),
});

export type DetectPagePrimaryKeywordOutput = z.infer<typeof DetectPagePrimaryKeywordOutputSchema>;

export async function detectPagePrimaryKeyword(
  input: DetectPagePrimaryKeywordInput,
): Promise<DetectPagePrimaryKeywordOutput> {
  return detectPagePrimaryKeywordFlow(input);
}

const detectPagePrimaryKeywordPrompt = definePromptOnce({
  name: 'detectPagePrimaryKeywordPromptV1',
  input: { schema: DetectPagePrimaryKeywordInputSchema },
  output: { schema: DetectPagePrimaryKeywordOutputSchema },
  prompt: `You are an SEO strategist identifying the primary keyword for an existing blog post that needs a full content refresh.

**Page URL:** {{{pageUrl}}}
**Current title:** {{{pageTitle}}}
**Current meta description:** {{{metaDescription}}}
{{#if gscTopQuery}}**Top Google Search Console query for this URL:** "{{{gscTopQuery}}}"{{/if}}
{{#if clickChangePct}}**Traffic change (last 28 days):** {{{clickChangePct}}}% clicks{{/if}}

**Page content:**
\`\`\`
{{{htmlContent}}}
\`\`\`

Identify the single best **primary keyword** to target when completely rewriting this article. Prefer the GSC top query when it matches search intent; otherwise infer from title, headings, and topic.

Return JSON with primaryKeyword, optional secondaryKeyword, and a short rationale.`,
  config: {
    temperature: 0.25,
  },
});

const detectPagePrimaryKeywordFlow = defineFlowOnce(
  {
    name: 'detectPagePrimaryKeywordFlow',
    inputSchema: DetectPagePrimaryKeywordInputSchema,
    outputSchema: DetectPagePrimaryKeywordOutputSchema,
  },
  async (input) => {
    const prepared = prepareHtmlForAnalysis(input.htmlContent);

    const { result: output } = await withLlmModelFallback(
      async (model) => {
        const response = await detectPagePrimaryKeywordPrompt(
          {
            ...input,
            htmlContent: prepared.analysisContent,
          },
          { model },
        );
        if (!response.output?.primaryKeyword) {
          throw new Error('Primary keyword detection did not return a valid result.');
        }
        return response.output;
      },
      { label: 'detectPagePrimaryKeyword', models: STRATEGY_DEPLOY_LLM_CHAIN },
    );

    return output;
  },
);
