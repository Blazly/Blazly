'use server';

import { withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce } from '../define-once';
import { STRATEGY_DEPLOY_LLM_CHAIN } from '../llm-models';
import {
  getSeoAuditRuntimeContext,
  getSeoAuditSystemInstruction,
  sanitizeSeoAuditAiOutput,
} from '../../lib/ai/seo-audit-context';
import { prepareHtmlForAnalysis } from '../../lib/scrape/html-to-analysis-text';
import { z } from 'genkit';

const AnalyzeKeywordOpportunityInputSchema = z.object({
  pageUrl: z.string(),
  targetKeyword: z.string(),
  position: z.number(),
  ctr: z.number(),
  expectedCtr: z.number(),
  impressions: z.number(),
  clicks: z.number(),
  potentialGain: z.string().optional(),
  pageTitle: z.string(),
  metaDescription: z.string().optional(),
  htmlContent: z.string(),
  contentSource: z.enum(['wordpress', 'webflow', 'scrape']),
  fullTextLength: z.number().optional(),
  contentTruncated: z.boolean().optional(),
  currentYear: z.number().describe('Authoritative current calendar year for this SEO audit.'),
  currentDate: z.string().describe('Authoritative current date for this SEO audit.'),
});

export type AnalyzeKeywordOpportunityInput = z.infer<typeof AnalyzeKeywordOpportunityInputSchema>;

const AnalyzeKeywordOpportunityOutputSchema = z.object({
  insight: z
    .string()
    .describe('One short sentence (max 25 words) on why CTR is low for this keyword.'),
  suggestions: z
    .array(z.string())
    .min(3)
    .max(5)
    .describe('Short bullet-style actions — max 15 words each, start with a verb, no paragraphs.'),
});

export type AnalyzeKeywordOpportunityOutput = z.infer<typeof AnalyzeKeywordOpportunityOutputSchema>;

export async function analyzeKeywordOpportunityContent(
  input: Omit<AnalyzeKeywordOpportunityInput, 'currentYear' | 'currentDate'> &
    Partial<Pick<AnalyzeKeywordOpportunityInput, 'currentYear' | 'currentDate'>>,
): Promise<AnalyzeKeywordOpportunityOutput> {
  const runtime = getSeoAuditRuntimeContext();
  return analyzeKeywordOpportunityContentFlow({
    ...input,
    currentYear: input.currentYear ?? runtime.currentYear,
    currentDate: input.currentDate ?? runtime.currentDate,
  });
}

const keywordOpportunityPrompt = definePromptOnce({
  name: 'analyzeKeywordOpportunityContentPromptV3',
  input: { schema: AnalyzeKeywordOpportunityInputSchema },
  output: { schema: AnalyzeKeywordOpportunityOutputSchema },
  prompt: `${getSeoAuditSystemInstruction()}

You are an SEO strategist reviewing a real blog page that ranks in Google but underperforms on click-through rate.

**Authoritative clock (use this, not your training cutoff):**
- currentDate: {{{currentDate}}}
- currentYear: {{{currentYear}}}

**GSC performance for this page + keyword:**
- Target keyword: "{{{targetKeyword}}}"
- Page URL: {{{pageUrl}}}
- Ranking position: #{{{position}}}
- CTR: {{{ctr}}}% (expected ~{{{expectedCtr}}}% for this position)
- Impressions: {{{impressions}}}
- Clicks: {{{clicks}}}
{{#if potentialGain}}- Estimated upside: {{{potentialGain}}}{{/if}}

**Page content source:** {{{contentSource}}} (wordpress/webflow = fetched via CMS integration; scrape = live page HTML)

**Current page title:** {{{pageTitle}}}
**Current meta description:** {{{metaDescription}}}

**Full page text length captured:** {{#if fullTextLength}}{{{fullTextLength}}} characters{{else}}unknown{{/if}}
**Content truncated for this prompt:** {{#if contentTruncated}}yes — only analyze what is shown; do not claim the live article ends abruptly unless you see an explicit truncation notice{{else}}no — you have the complete article text{{/if}}

**Page content (structured text from the full article — do NOT give generic advice):**
\`\`\`
{{{htmlContent}}}
\`\`\`

**Your task:**
1. Read the actual title, headings, intro, and body. Identify specific gaps vs. search intent for "{{{targetKeyword}}}".
2. Explain why searchers may skip this result despite the #{{{position}}} ranking (title mismatch, weak hook, missing proof, intent gap, etc.).
3. Give 3–5 concrete improvements referencing what is actually on the page.
4. Do NOT default to "add FAQs" or "update title" unless the content analysis supports it. Each suggestion must reference something specific you observed in the content.
5. **Never claim the article is incomplete, cut off, or missing sections** unless contentTruncated is true AND you see the explicit truncation notice.
6. **Forbidden recommendations:** changing {{{currentYear}}} to 2025, calling {{{currentYear}}} a future/futuristic year, or blaming CTR on {{{currentYear}}} being "wrong" in the title.
7. Keep suggestions actionable and ordered by likely CTR impact.
8. **Output style:** insight = ONE crisp sentence (max 25 words). Each suggestion = ONE short bullet (max 15 words), imperative verb first. No paragraphs, no multi-sentence bullets.

Return JSON with "insight" (one short sentence) and "suggestions" (array of 3–5 short bullet strings).`,
  config: {
    temperature: 0.35,
  },
});

const analyzeKeywordOpportunityContentFlow = defineFlowOnce(
  {
    name: 'analyzeKeywordOpportunityContentFlow',
    inputSchema: AnalyzeKeywordOpportunityInputSchema,
    outputSchema: AnalyzeKeywordOpportunityOutputSchema,
  },
  async (input) => {
    const prepared = prepareHtmlForAnalysis(input.htmlContent);

    const { result: output } = await withLlmModelFallback(
      async (model) => {
        const response = await keywordOpportunityPrompt(
          {
            ...input,
            htmlContent: prepared.analysisContent,
            fullTextLength: prepared.fullTextLength,
            contentTruncated: prepared.truncated,
          },
          { model },
        );
        if (!response.output) {
          throw new Error('Keyword opportunity analysis did not return a valid output.');
        }
        return response.output;
      },
      { label: 'analyzeKeywordOpportunityContent', models: STRATEGY_DEPLOY_LLM_CHAIN },
    );

    return sanitizeSeoAuditAiOutput(output, prepared.truncated);
  },
);
