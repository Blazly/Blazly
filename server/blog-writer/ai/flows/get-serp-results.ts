
'use server';

import { ai, withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { APP_LLM_MODEL_CHAIN } from '../llm-models';
import { getUserFacingLlmErrorMessage } from '../../lib/utils';
import { z } from 'zod';
import { SerpSearchOutputSchema, type SerpSearchOutput } from '../types';

const SerpSearchInputSchema = z.object({
    query: z.string().describe('The search query.'),
});
type SerpSearchInput = z.infer<typeof SerpSearchInputSchema>;

export async function getSerpResults(input: SerpSearchInput): Promise<SerpSearchOutput> {
    return getSerpResultsFlow(input);
}

const serpPrompt = definePromptOnce({
    name: 'serpSearchPrompt',
    input: { schema: SerpSearchInputSchema },
    output: { schema: SerpSearchOutputSchema },
    prompt: `You are a search engine simulator. For the given query, generate a realistic-looking list of the top 10 search engine results. Each result must include a compelling title, a valid-looking but fictional URL, and a short, descriptive snippet.

    Query: "{{query}}"
    
    Return the 10 results in the specified JSON format.`,
    config: {
      temperature: 0.7,
    },
});

const getSerpResultsFlow = defineFlowOnce(
    {
        name: 'getSerpResultsFlow',
        inputSchema: SerpSearchInputSchema,
        outputSchema: SerpSearchOutputSchema,
    },
    async (input) => {
        try {
            const { result: output } = await withLlmModelFallback(
                async (model) => {
                    const response = await serpPrompt(input, { model });
                    if (!response.output?.results) {
                        throw new Error('Failed to generate SERP results.');
                    }
                    return response.output;
                },
                { label: 'getSerpResults', models: APP_LLM_MODEL_CHAIN },
            );
            return output;
        } catch (error: any) {
            console.error("Error in getSerpResultsFlow: ", error);
            const msg = typeof error?.message === 'string' ? error.message : String(error);
            return { results: [], error: getUserFacingLlmErrorMessage(msg) };
        }
    }
);
