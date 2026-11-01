'use server';

import { withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce } from '../define-once';
import { STRATEGY_DEPLOY_LLM_CHAIN } from '../llm-models';
import {
  getSeoAuditRuntimeContext,
  getSeoAuditSystemInstruction,
  sanitizeSeoAuditText,
} from '../../lib/ai/seo-audit-context';
import { z } from 'genkit';

const ApplyKeywordOpportunityFixesInputSchema = z.object({
  pageUrl: z.string(),
  targetKeyword: z.string(),
  position: z.number(),
  ctr: z.number(),
  expectedCtr: z.number(),
  pageTitle: z.string(),
  metaDescription: z.string().optional(),
  htmlContent: z.string(),
  insight: z.string().optional(),
  suggestions: z.array(z.string()).min(1),
  currentYear: z.number(),
  currentDate: z.string(),
});

export type ApplyKeywordOpportunityFixesInput = z.infer<typeof ApplyKeywordOpportunityFixesInputSchema>;

const ApplyKeywordOpportunityFixesOutputSchema = z.object({
  enhancedHtmlContent: z.string().describe('Full updated HTML for the WordPress post body.'),
  enhancedMetaTitle: z.string().describe('Updated post title optimized for CTR.'),
  enhancedMetaDescription: z.string().describe('Updated meta description / excerpt for CTR.'),
  changesSummary: z.string().describe('One sentence summarizing what was changed.'),
});

export type ApplyKeywordOpportunityFixesOutput = z.infer<typeof ApplyKeywordOpportunityFixesOutputSchema>;

export async function applyKeywordOpportunityFixes(
  input: Omit<ApplyKeywordOpportunityFixesInput, 'currentYear' | 'currentDate'> &
    Partial<Pick<ApplyKeywordOpportunityFixesInput, 'currentYear' | 'currentDate'>>,
): Promise<ApplyKeywordOpportunityFixesOutput> {
  const runtime = getSeoAuditRuntimeContext();
  return applyKeywordOpportunityFixesFlow({
    ...input,
    currentYear: input.currentYear ?? runtime.currentYear,
    currentDate: input.currentDate ?? runtime.currentDate,
  });
}

const applyKeywordOpportunityFixesPrompt = definePromptOnce({
  name: 'applyKeywordOpportunityFixesPromptV1',
  input: { schema: ApplyKeywordOpportunityFixesInputSchema },
  output: { schema: ApplyKeywordOpportunityFixesOutputSchema },
  prompt: `${getSeoAuditSystemInstruction()}

You are an SEO copywriter implementing CTR fixes on a live WordPress blog post.

**Authoritative clock:**
- currentDate: {{{currentDate}}}
- currentYear: {{{currentYear}}}

**GSC context:**
- Target keyword: "{{{targetKeyword}}}"
- Page URL: {{{pageUrl}}}
- Position: #{{{position}}}
- CTR: {{{ctr}}}% (expected ~{{{expectedCtr}}}%)

{{#if insight}}**Why CTR is low:** {{{insight}}}{{/if}}

**Required fixes (apply ALL of these):**
{{#each suggestions}}
- {{{this}}}
{{/each}}

**Current title:** {{{pageTitle}}}
**Current meta description:** {{{metaDescription}}}

**Current HTML content:**
\`\`\`html
{{{htmlContent}}}
\`\`\`

**Rules:**
1. Rewrite title (50–60 chars) and meta description (150–160 chars) to improve CTR for "{{{targetKeyword}}}" while staying accurate.
2. Update the HTML body to implement every suggestion above. Preserve facts, structure, and tone — enhance, do not replace the entire article.
3. Use valid HTML only (<strong>, <em>, <h2>, <h3>, <p>, <ul>, <li>, <a>). No markdown, no asterisks.
4. Do NOT change {{{currentYear}}} to an older year or call {{{currentYear}}} futuristic.
5. Return the FULL updated HTML (not a diff).

Return JSON with enhancedHtmlContent, enhancedMetaTitle, enhancedMetaDescription, and changesSummary.`,
  config: {
    temperature: 0.4,
  },
});

const applyKeywordOpportunityFixesFlow = defineFlowOnce(
  {
    name: 'applyKeywordOpportunityFixesFlow',
    inputSchema: ApplyKeywordOpportunityFixesInputSchema,
    outputSchema: ApplyKeywordOpportunityFixesOutputSchema,
  },
  async (input) => {
    const { result: output } = await withLlmModelFallback(
      async (model) => {
        const response = await applyKeywordOpportunityFixesPrompt(input, { model });
        if (!response.output) {
          throw new Error('Keyword opportunity fix application did not return valid output.');
        }
        return response.output;
      },
      { label: 'applyKeywordOpportunityFixes', models: STRATEGY_DEPLOY_LLM_CHAIN },
    );

    return {
      ...output,
      changesSummary: sanitizeSeoAuditText(output.changesSummary, false),
    };
  },
);
