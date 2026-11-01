'use server';
/**
 * @fileOverview An AI agent that generates a pillar/cluster content strategy for a given keyword.
 *
 * - generateContentStrategy - A function that returns a content strategy.
 * - GenerateContentStrategyInput - The input type.
 * - GenerateContentStrategyOutput - The return type.
 */

import { ai, withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { APP_LLM_MODEL_CHAIN } from '../llm-models';
import { z } from 'zod';
import { GenerateContentStrategyInputSchema, GenerateContentStrategyOutputSchema, type GenerateContentStrategyOutput, type GenerateContentStrategyInput } from '../types';
import { getAppCurrentDateLabel } from '../../lib/ai/date-context';

export async function generateContentStrategy(input: GenerateContentStrategyInput): Promise<GenerateContentStrategyOutput> {
  return generateContentStrategyFlow(input);
}

const strategyGenerationPrompt = definePromptOnce({
    name: 'generateContentStrategyPrompt',
    input: { schema: GenerateContentStrategyInputSchema.extend({ currentDate: z.string() }) },
    output: { schema: GenerateContentStrategyOutputSchema },
    prompt: `You are an expert SEO Content Strategist. Your task is to develop a comprehensive pillar and cluster content model to help a user rank for a specific keyword on Google. 

CRITICAL: THE ENTIRE RESPONSE, INCLUDING ALL TITLES, SUMMARIES, AND KEYWORDS, MUST BE WRITTEN ENTIRELY IN THE TARGET LANGUAGE: {{{language}}}. 
DO NOT USE ANY ENGLISH WORDS OR PHRASES. Every single sentence must be strictly in {{{language}}}.

## FORMATTING MANDATE (CRITICAL)
- **ABSOLUTELY NO ASTERISKS**: NEVER use asterisks (* or **) for emphasis.
- Use only valid HTML tags if necessary, but generally output plain text for summaries.

**Target Keyword:** "{{{keyword}}}"
**Target Language:** {{{language}}}

**Current Date for Scheduling:** {{{currentDate}}}

**Execution Plan:**

1.  **Simulate SERP & Competition Analysis:**
    *   Imagine you have analyzed the top 10 Google search results for the keyword '{{{keyword}}}' in the target language.
    *   First, determine the keyword's likely competition level. This value MUST be one of: 'Low', 'Medium', or 'High'. Consider factors like the authority of ranking domains, the quality of content, and the commercial intent.
    *   Identify the primary user intents (e.g., informational, commercial, transactional), common questions, and key sub-topics being covered in the target language.

2.  **Develop the Pillar Topic:**
    *   Create one central 'pillar' topic. This should be a broad, comprehensive guide that covers the target keyword extensively.
    *   The pillar topic's title MUST be in {{{language}}}.
    *   The summary MUST explain that this is a foundational piece designed to be the ultimate resource on the topic, written in {{{language}}}.
    *   Assign a relevant 'primaryKeyword' in {{{language}}}.
    *   **Crucially, also provide**:
        *   A list of 3-4 semantic 'secondaryKeywords' in {{{language}}}.
        *   A target 'wordCount' (e.g., 2000). This value MUST be an integer, not a string.
        *   A 'publishDate' for the pillar topic, which MUST be today's date ({{{currentDate}}}).

3.  **Develop Cluster Topics & Schedule (Adjust based on Competition):**
    *   Generate a list of 'cluster' topics. Each must be a more specific, in-depth article that links back to the pillar. All titles and summaries must be in {{{language}}}.
    *   **CRITICAL:** Adjust the number of cluster topics based on the competition level you determined:
        *   **Low Competition:** Generate 3-4 cluster topics.
        *   **Medium Competition:** Generate 5-6 cluster topics.
        *   **High Competition:** Generate 7-10+ cluster topics. You must be more comprehensive to compete.
    *   These clusters should address the specific user intents and questions you identified in your analysis for the target language.
    *   For each cluster, create a 'publishDate'. Create a content calendar by spacing out the cluster topics. A good SEO practice is to publish a new cluster article every 3-5 days after the pillar post. Stagger the dates accordingly.
    *   Each summary should clearly state the specific question or sub-topic it addresses in {{{language}}}.
    *   For each cluster, assign a relevant 'primaryKeyword' in {{{language}}}.
    *   **Crucially, for each cluster, also provide**:
        *   A list of 3-4 semantic 'secondaryKeywords' in {{{language}}}.
        *   A target 'wordCount' (e.g., 800). This value MUST be an integer, not a string.

4.  **Estimate Ranking Probability (Dynamic Score):**
    *   Based on the keyword's competition and the comprehensiveness of your proposed strategy, provide a 'rankingProbability' score (an integer from 0 to 100). This value MUST be an integer, not a string.
    *   This score MUST be dynamic. High-competition keywords should have a lower probability (e.g., 20-45%), while low-competition keywords should have a higher probability (e.g., 65-85%).
    *   Provide a brief 'strategySummary' in {{{language}}} to justify this score. It MUST mention the assessed competition level and explain why the proposed strategy is strong enough (or what the challenges will be).

5.  **Final Output:** Return the pillar topic, cluster topics, ranking probability, and summary as a single JSON object matching the defined output schema. Dates must be in "Month Day, Year" format. The language field must be set to the language name provided.`,
    config: {
        temperature: 0.5,
        safetySettings: [
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        ],
      },
});


const generateContentStrategyFlow = defineFlowOnce(
  {
    name: 'generateContentStrategyFlow',
    inputSchema: GenerateContentStrategyInputSchema,
    outputSchema: GenerateContentStrategyOutputSchema,
  },
  async (input) => {
    if (!input.keyword.trim()) {
      throw new Error('Keyword cannot be empty.');
    }
    
    const currentDate = getAppCurrentDateLabel();

    const { result: output } = await withLlmModelFallback(
      async (model) => {
        const response = await strategyGenerationPrompt(
          { ...input, currentDate },
          { model },
        );
        if (!response.output) {
          throw new Error(
            'AI model failed to return a valid strategy response. This might be due to safety filters or a temporary issue. Please try a different keyword.',
          );
        }
        return response.output;
      },
      { label: 'generateContentStrategy', models: APP_LLM_MODEL_CHAIN },
    );

    if (!output) {
        throw new Error('AI model failed to return a valid strategy response. This might be due to safety filters or a temporary issue. Please try a different keyword.');
    }

    let langCode = 'en';
    const langLower = input.language?.toLowerCase() || 'english';
    if (langLower.includes('german')) langCode = 'de';
    else if (langLower.includes('ukrainian')) langCode = 'uk';
    else if (langLower.includes('finnish')) langCode = 'fi';
    else if (langLower.includes('italian')) langCode = 'it';
    else if (langLower.includes('spanish')) langCode = 'es';
    else if (langLower.includes('french')) langCode = 'fr';
    else if (langLower.includes('danish')) langCode = 'da';
    else if (langLower.includes('dutch')) langCode = 'nl';
    else langCode = langLower.substring(0, 2);
    
    return { ...output, language: langCode };
  }
);
