
'use server';
/**
 * @fileOverview An AI agent that discovers relevant SEO keywords for a given topic.
 *
 * - discoverSeoKeywords - A function that returns a list of keyword ideas.
 */

import {ai} from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import {
  DiscoverSeoKeywordsInputSchema,
  DiscoverSeoKeywordsOutputSchema,
  type DiscoverSeoKeywordsInput,
  type DiscoverSeoKeywordsOutput,
} from '../types';


export async function discoverSeoKeywords(input: DiscoverSeoKeywordsInput): Promise<DiscoverSeoKeywordsOutput> {
  return discoverSeoKeywordsFlow(input);
}

const discoverKeywordsPrompt = definePromptOnce({
  name: 'discoverSeoKeywordsPrompt',
  input: {schema: DiscoverSeoKeywordsInputSchema},
  output: {schema: DiscoverSeoKeywordsOutputSchema},
  prompt: `You are an expert SEO keyword analysis tool like Ahrefs or SEMrush.
Your task is to provide a detailed analysis for the given keyword: "{{topic}}".

You must provide the following information:

1.  **keyword**: The keyword being analyzed.
2.  **keywordDifficulty**: An integer score from 0 to 100 representing how hard it is to rank for this keyword.
3.  **globalVolume**: The total estimated monthly search volume for the keyword across all countries.
4.  **intent**: The primary search intent for the keyword. This must be one of: 'Informational', 'Navigational', 'Commercial', or 'Transactional'.
5.  **countryVolumes**: An array of the top 5 countries by search volume, plus an 'Other' category. For each, provide:
    *   'countryCode': The 2-letter ISO country code (e.g., 'US', 'IN', 'GB'). For 'Other', use 'Other'.
    *   'countryName': The full country name. For 'Other', use 'Other'.
    *   'volume': The estimated monthly search volume for that country.
    *   'percentage': The percentage of the global volume this country represents. The sum of all percentages should be 100.
6.  **searchTrend**: An array of 12 data points representing the search trend for the last 12 months. Each point should have:
    *   'month': The month in "MMM" format (e.g., "Jan", "Feb").
    *   'volume': An estimated search volume for that month. The volume should show realistic trends (e.g., seasonality for some keywords). The most recent month in the list should correspond to the last full month from today.
7.  **relatedKeywords**: A list of 30-40 related keyword suggestions. For each, provide:
    *   'keyword': The keyword phrase.
    *   'avgMonthlySearches': An estimated monthly search volume range (e.g., '1K - 10K').
    *   'competition': This MUST be one of: 'Low', 'Medium', or 'High'.

Analyze the keyword "{{topic}}" and return the full analysis in the specified JSON format.
`,
  config: {
    temperature: 0.5,
  },
});

const discoverSeoKeywordsFlow = defineFlowOnce(
  {
    name: 'discoverSeoKeywordsFlow',
    inputSchema: DiscoverSeoKeywordsInputSchema,
    outputSchema: DiscoverSeoKeywordsOutputSchema,
  },
  async (input): Promise<DiscoverSeoKeywordsOutput> => {
    if (!input.topic.trim()) {
        throw new Error("Topic cannot be empty.");
    }
    
    try {
      const {output} = await discoverKeywordsPrompt(input);
      if (output) {
        return output;
      } else {
        throw new Error('Keyword discovery prompt did not return a valid output.');
      }
    } catch (error: any) {
      console.error('Error during keyword discovery flow:', error);
      throw new Error(`Failed to get keyword analysis: ${error.message}`);
    }
  }
);
