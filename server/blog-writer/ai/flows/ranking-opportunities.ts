'use server';

/**
 * @fileOverview Send a website URL to Gemini (URL Context tool) to detect industry
 * and suggest easy-to-rank blog topic headings with estimated traffic — no local scraping.
 */

import { defineFlowOnce } from '../define-once';
import { withLlmModelFallback } from '../llm-fallback';
import { STRATEGY_DEPLOY_LLM_CHAIN } from '../llm-models';
import {
  RankingOpportunitiesInputSchema,
  type RankingOpportunitiesInput,
  RankingOpportunitiesOutputSchema,
  type RankingOpportunitiesOutput,
  type RankingOpportunityHeading,
} from '../types';
import { parseEstimatedTraffic } from '../ai/types';

type GeminiRankingPayload = {
  industry: string;
  niche: string;
  brandSummary: string;
  headings: Array<string | { title?: string; heading?: string; estimatedTraffic?: number; estimated_traffic?: number }>;
};

function getGeminiApiKey(): string {
  const key =
    process.env.GEMINI_API_KEY?.trim() ||
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_GENAI_API_KEY?.trim();
  if (!key) {
    console.error('[rankingOpportunities] GEMINI_API_KEY is not configured.');
    throw new Error('Website analysis is temporarily unavailable. Please try again later.');
  }
  return key;
}

function normalizeWebsiteUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error('Website URL is required.');
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  url.hash = '';
  url.search = '';
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '');
  }
  return url.toString().replace(/\/$/, '') || url.origin;
}

function toGeminiModelId(model: string): string {
  return model.replace(/^googleai\//, '');
}

function normalizeHeadings(
  headings: GeminiRankingPayload['headings'],
): RankingOpportunityHeading[] {
  return headings
    .map((item) => {
      if (typeof item === 'string') {
        const title = item.trim();
        return title ? { title, estimatedTraffic: 0 } : null;
      }
      const title = String(
        item.title ?? item.heading ?? '',
      ).trim();
      if (!title) return null;
      return {
        title,
        estimatedTraffic: parseEstimatedTraffic(
          item.estimatedTraffic ?? item.estimated_traffic ?? 0,
        ),
      };
    })
    .filter((item): item is RankingOpportunityHeading => item !== null)
    .slice(0, 12);
}

function buildPrompt(websiteUrl: string, language: string): string {
  return `You are an expert SEO strategist and industry analyst for Blazly SEO.

Use the URL context tool to read and understand this website:
${websiteUrl}

From the live page content:
1. Identify the business industry and niche.
2. Suggest blog topic HEADINGS this business can realistically rank for quickly by publishing optimized articles with Blazly SEO.
3. For each heading, estimate organic traffic per 30 days if the post ranks well (roughly top 10) for that topic.

## Language for headings
${language}

## Industry rules
- Be specific (e.g. "dental clinics" not just "healthcare"; "B2B SaaS for HR" not just "software").
- brandSummary: 1–2 factual sentences based only on what you find on the page. Do not invent products.

## Blog heading rules (CRITICAL)
- Return 10–12 opportunities ONLY.
- Each item must include:
  - title: publishable blog heading (no descriptions, no body copy)
  - estimatedTraffic: integer estimate of organic visits / 30 days
- Headings must be easy-to-rank opportunities: informational search intent, mid/long-tail, practical for THIS business.
- Prefer guides, how-tos, comparisons, checklists, and niche angles a growing site can win.
- Avoid ultra-competitive bare head terms unless niche-qualified.
- estimatedTraffic should be a realistic INTEGER for organic visits / 30 days (typically 200–5,000 for mid-tail topics; never invent huge or scientific-notation numbers; max 25,000).
- Write headings in ${language}.
- Do not duplicate near-identical titles.

Return JSON with: industry, niche, brandSummary, headings (array of { title, estimatedTraffic }).`;
}

async function generateRankingFromUrl(
  model: string,
  websiteUrl: string,
  language: string,
): Promise<{
  industry: string;
  niche: string;
  brandSummary: string;
  headings: RankingOpportunityHeading[];
}> {
  const apiKey = getGeminiApiKey();
  const modelId = toGeminiModelId(model);
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: buildPrompt(websiteUrl, language) }],
        },
      ],
      tools: [{ url_context: {} }],
      generationConfig: {
        temperature: 0.55,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            industry: { type: 'STRING' },
            niche: { type: 'STRING' },
            brandSummary: { type: 'STRING' },
            headings: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  title: { type: 'STRING' },
                  estimatedTraffic: { type: 'NUMBER' },
                },
                required: ['title', 'estimatedTraffic'],
              },
            },
          },
          required: ['industry', 'niche', 'brandSummary', 'headings'],
        },
      },
    }),
    signal: AbortSignal.timeout(90000),
  });

  const payload = await response.json();
  if (!response.ok) {
    console.error('[rankingOpportunities] URL analysis failed:', response.status, payload?.error?.message);
    throw new Error(`Could not analyze this website right now (${response.status}). Please try again.`);
  }

  const textPart = payload?.candidates?.[0]?.content?.parts?.find(
    (part: { text?: string }) => typeof part?.text === 'string',
  )?.text;

  if (!textPart) {
    throw new Error('No analysis was returned for this URL. Please try again.');
  }

  let parsed: GeminiRankingPayload;
  try {
    parsed = JSON.parse(textPart) as GeminiRankingPayload;
  } catch {
    throw new Error('The website analysis came back incomplete. Please try again.');
  }

  const headings = normalizeHeadings(parsed.headings || []);
  if (!parsed.industry?.trim() || headings.length === 0) {
    throw new Error('Could not detect the industry and topics for this URL. Please try another page.');
  }

  return {
    industry: parsed.industry.trim(),
    niche: (parsed.niche || '').trim(),
    brandSummary: (parsed.brandSummary || '').trim(),
    headings,
  };
}

export async function rankingOpportunities(
  input: RankingOpportunitiesInput,
): Promise<RankingOpportunitiesOutput> {
  return rankingOpportunitiesFlow(input);
}

const rankingOpportunitiesFlow = defineFlowOnce(
  {
    name: 'rankingOpportunitiesFlowV2',
    inputSchema: RankingOpportunitiesInputSchema,
    outputSchema: RankingOpportunitiesOutputSchema,
  },
  async (input): Promise<RankingOpportunitiesOutput> => {
    try {
      const websiteUrl = normalizeWebsiteUrl(input.websiteUrl);
      const language = input.language || 'English';

      const { result } = await withLlmModelFallback(
        (model) => generateRankingFromUrl(model, websiteUrl, language),
        { label: 'rankingOpportunities', models: STRATEGY_DEPLOY_LLM_CHAIN },
      );

      return {
        industry: result.industry,
        niche: result.niche,
        brandSummary: result.brandSummary,
        headings: result.headings,
        scrapedPages: [{ url: websiteUrl, ok: true, title: websiteUrl }],
      };
    } catch (error) {
      console.error('[rankingOpportunities]', error);
      const message =
        error instanceof Error ? error.message : 'Failed to analyze ranking opportunities.';
      return {
        industry: '',
        niche: '',
        brandSummary: '',
        scrapedPages: [],
        headings: [],
        error: message,
      };
    }
  },
);
