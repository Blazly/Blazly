'use server';
/**
 * @fileOverview AI agent that analyzes the on-page SEO of a blog post.
 *
 * - analyzeOnPageSEO - A function that provides an SEO score and feedback.
 * - AnalyzeOnPageSEOInput - The input type.
 * - AnalyzeOnPageSEOOutput - The return type.
 */

import { withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce } from '../define-once';
import { STRATEGY_DEPLOY_LLM_CHAIN } from '../llm-models';
import {
  AnalyzeOnPageSEOInputSchema,
  type AnalyzeOnPageSEOInput,
  AnalyzeOnPageSEOOutputSchema,
  type AnalyzeOnPageSEOOutput,
} from '../types';
import { scoreOnPageSeo, stripHtmlToText } from '../../lib/seo/on-page-score';
import { getAiTemporalContextBlock } from '../../lib/ai/date-context';

export async function analyzeOnPageSEO(input: AnalyzeOnPageSEOInput): Promise<AnalyzeOnPageSEOOutput> {
  return analyzeOnPageSEOFlow(input);
}

function normalizeLlmOutput(raw: AnalyzeOnPageSEOOutput): AnalyzeOnPageSEOOutput {
  const score =
    typeof raw.seoScore === 'number' && !Number.isNaN(raw.seoScore)
      ? Math.min(100, Math.max(0, Math.round(raw.seoScore)))
      : 0;

  return {
    seoScore: score,
    scoreJustification: raw.scoreJustification?.trim() || '',
    whatIsDoneWell: Array.isArray(raw.whatIsDoneWell) ? raw.whatIsDoneWell.filter(Boolean) : [],
    areasForImprovement: Array.isArray(raw.areasForImprovement)
      ? raw.areasForImprovement.filter(Boolean)
      : [],
  };
}

function mergeSeoResults(
  baseline: AnalyzeOnPageSEOOutput,
  llm: AnalyzeOnPageSEOOutput | null,
): AnalyzeOnPageSEOOutput {
  if (!llm || llm.seoScore <= 0) {
    return baseline;
  }

  // Rule-based score is primary; LLM adjusts slightly and supplies richer feedback.
  const blendedScore = Math.round(baseline.seoScore * 0.8 + llm.seoScore * 0.2);
  const improvementCount = llm.areasForImprovement.length;
  const feedbackCap =
    improvementCount >= 3 ? 82 : improvementCount >= 2 ? 88 : improvementCount >= 1 ? 94 : 100;
  const finalScore = Math.min(blendedScore, feedbackCap, llm.seoScore + 8);

  return {
    seoScore: Math.min(100, Math.max(0, finalScore)),
    scoreJustification: llm.scoreJustification || baseline.scoreJustification,
    whatIsDoneWell: llm.whatIsDoneWell.length > 0 ? llm.whatIsDoneWell : baseline.whatIsDoneWell,
    areasForImprovement:
      llm.areasForImprovement.length > 0 ? llm.areasForImprovement : baseline.areasForImprovement,
  };
}

const seoAnalysisPrompt = definePromptOnce({
  name: 'analyzeOnPageSEOPrompt',
  input: { schema: AnalyzeOnPageSEOInputSchema },
  output: { schema: AnalyzeOnPageSEOOutputSchema },
  prompt: `${getAiTemporalContextBlock()}

You are an On-Page SEO expert. Analyze the blog post HTML, meta title, and meta description for the primary keyword only.
Do not analyze technical SEO, backlinks, or off-page factors.

**Primary Keyword:** {{{primaryKeyword}}}

**Meta Title:** {{{metaTitle}}}

**Meta Description:** {{{metaDescription}}}

**Blog Post HTML Content:**
\`\`\`html
{{{htmlContent}}}
\`\`\`

**Scoring criteria (total 100):**

1. **Meta title (~22%)** — keyword present, near the start, ~50–60 characters.
2. **Meta description (~20%)** — keyword present, compelling, ~150–160 characters.
3. **Headings (~22%)** — Keyword in some headings; natural usage in H2/H3 (not every subheading).
4. **Body content (~26%)** — Keyword in first 100 words, natural repetition (not stuffing), satisfies search intent.
5. **Penalties** — Deduct 10–25 points for keyword stuffing in subheadings, excessive keyword density (>1.8% of words), or missing meta tags.

**Rules:**
- Return **seoScore** as an integer from 0–100 reflecting real quality. Do not default to 100.
- Keyword in every single H2/H3 is **over-optimization** — cap score at ~85 or lower.
- High keyword density or repetitive exact-match phrases should reduce the score even if basics are met.
- Well-balanced posts with natural keyword use typically score 70–90. Only near-perfect, non-stuffed content should score 95+.

Return JSON with: seoScore, scoreJustification, whatIsDoneWell (2–4 items), areasForImprovement (2–4 items).`,
  config: {
    temperature: 0.3,
  },
});

const analyzeOnPageSEOFlow = defineFlowOnce(
  {
    name: 'analyzeOnPageSEOFlow',
    inputSchema: AnalyzeOnPageSEOInputSchema,
    outputSchema: AnalyzeOnPageSEOOutputSchema,
  },
  async (input) => {
    const plainText = stripHtmlToText(input.htmlContent);
    const keyword = input.primaryKeyword.trim();

    if (!plainText || !keyword) {
      return {
        seoScore: 0,
        scoreJustification: 'Content or primary keyword was empty. SEO analysis could not be performed.',
        whatIsDoneWell: [],
        areasForImprovement: ['Provide blog content and a primary keyword to analyze.'],
      };
    }

    const baseline = scoreOnPageSeo(
      input.htmlContent,
      input.metaTitle,
      input.metaDescription,
      keyword,
    );

    try {
      const { result: output } = await withLlmModelFallback(
        async (model) => {
          const response = await seoAnalysisPrompt(input, { model });
          if (!response.output) {
            throw new Error('On-page SEO analysis prompt did not return a valid output.');
          }
          return response.output;
        },
        { label: 'analyzeOnPageSEO', models: STRATEGY_DEPLOY_LLM_CHAIN },
      );
      return mergeSeoResults(baseline, normalizeLlmOutput(output));
    } catch (error) {
      console.error('Error during on-page SEO analysis flow, using rule-based score:', error);
      return baseline;
    }
  },
);
