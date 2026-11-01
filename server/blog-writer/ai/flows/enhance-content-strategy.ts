
'use server';
/**
 * @fileOverview An AI agent that enhances an existing content strategy to boost ranking potential.
 *
 * - enhanceContentStrategy - A function that returns an enhanced strategy.
 * - EnhanceContentStrategyInput - The input type.
 * - EnhancedContentStrategyOutput - The return type.
 */

import { ai, withLlmModelFallback } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { APP_LLM_MODEL_CHAIN } from '../llm-models';
import { z } from 'zod';
import { 
    EnhanceContentStrategyInputSchema, 
    type EnhanceContentStrategyInput,
    EnhancedContentStrategyOutputSchema,
    type EnhancedContentStrategyOutput,
    type Topic,
} from '../types';

export async function enhanceContentStrategy(input: EnhanceContentStrategyInput): Promise<EnhancedContentStrategyOutput> {
  return enhanceContentStrategyFlow(input);
}

// Define a schema for the prompt's input
const EnhancePromptInputSchema = z.object({
  pillarKeyword: z.string(),
  pillarTitle: z.string(),
  clusterTopicTitles: z.array(z.string()),
  rankingProbability: z.number(),
  strategySummary: z.string(),
  lastPublishDate: z.string(),
});

// Define a schema for the prompt's output (what the AI will generate)
const EnhancePromptOutputSchema = z.object({
    newClusterTopics: z.array(z.object({
        title: z.string().describe('The SEO-friendly title for the blog post.'),
        summary: z.string().describe('A brief summary of what the article will cover.'),
        primaryKeyword: z.string().describe('The primary keyword for this specific article.'),
        secondaryKeywords: z.array(z.string()).optional().describe('A list of 2-4 related secondary keywords.'),
        wordCount: z.number().describe("The estimated target word count for the article (e.g., 800, 1500)."),
        publishDate: z.string().describe('The suggested publish date for this article in "Month Day, Year" format (e.g., "July 26, 2024").'),
    })).min(5).describe("A list of NEW, highly-specific, in-depth cluster topics to add to the strategy. This list must be comprehensive."),
    newRankingProbability: z.number().min(90).max(100).describe("The new, higher estimated probability (90-100%) of ranking on the first page of Google after implementing all the enhancements."),
    newStrategySummary: z.string().describe("A brief justification for the new, higher ranking probability, explaining how the new topics and SEO ideas will drastically improve the chances of success."),
});


const enhanceStrategyPrompt = definePromptOnce({
  name: 'enhanceContentStrategyPrompt',
  input: { schema: EnhancePromptInputSchema },
  output: { schema: EnhancePromptOutputSchema },
  prompt: `You are a world-class SEO Content Strategist, a true 10x expert. A junior strategist has created an initial content plan, but the client needs a high-confidence plan guaranteed to rank. Your task is to take the initial strategy and elevate it to a 90%+ probability of success.

**Initial Content Strategy for Keyword: "{{pillarKeyword}}"**
-   **Pillar Topic:** "{{pillarTitle}}"
-   **Initial Cluster Topics:**
{{#each clusterTopicTitles}}
    - "{{this}}"
{{/each}}
-   **Initial Ranking Probability:** {{rankingProbability}}%
-   **Initial Justification:** "{{strategySummary}}"
-   **Last Publish Date (for scheduling new content after):** {{lastPublishDate}}

**Execution Plan:**

1.  **Analyze the Gap:** Review the initial strategy. The goal is to get from {{rankingProbability}}% to over 90%. This requires overwhelming value and authority. Your plan must be exhaustive.

2.  **Generate NEW Cluster Topics:** You must generate an array of 5 to 10 NEW topic objects. Each object must have a title, summary, primaryKeyword, secondaryKeywords, an integer wordCount, and a publishDate. Schedule the new posts every 3-5 days after the provided 'lastPublishDate'.

3.  **Set the New Ranking Probability & Justify It:**
    *   Set the 'newRankingProbability' to an integer between 90 and 100.
    *   Set the 'newStrategySummary' to a confident explanation for why this enhanced plan will dominate search results.
    
Return only the JSON object containing 'newClusterTopics', 'newRankingProbability', and 'newStrategySummary'.`,
});


const enhanceContentStrategyFlow = defineFlowOnce(
  {
    name: 'enhanceContentStrategyFlow',
    inputSchema: EnhanceContentStrategyInputSchema,
    outputSchema: EnhancedContentStrategyOutputSchema,
  },
  async (input): Promise<EnhancedContentStrategyOutput> => {
    if (!input.currentStrategy) {
      throw new Error('A current strategy is required to enhance.');
    }
    
    try {
        const { pillarTopic, clusterTopics, rankingProbability, strategySummary } = input.currentStrategy;

        const allDates = [
            new Date(pillarTopic.publishDate),
            ...clusterTopics.map((t: Topic) => new Date(t.publishDate))
        ];
        const lastPublishDate = new Date(Math.max.apply(null, allDates.map(d => d.getTime())));
        const lastPublishDateString = lastPublishDate.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });

        const promptInput = {
            pillarKeyword: pillarTopic.primaryKeyword,
            pillarTitle: pillarTopic.title,
            clusterTopicTitles: clusterTopics.map((topic: Topic) => topic.title),
            rankingProbability: rankingProbability,
            strategySummary: strategySummary,
            lastPublishDate: lastPublishDateString,
        };
        
        const { result: output } = await withLlmModelFallback(
          async (model) => {
            const response = await enhanceStrategyPrompt(promptInput, {
              config: { temperature: 0.8 },
              model,
            });
            if (!response.output) {
              throw new Error('Content strategy enhancement failed to return valid output.');
            }
            return response.output;
          },
          { label: 'enhanceContentStrategy', models: APP_LLM_MODEL_CHAIN },
        );

        if (!output) {
            throw new Error('Content strategy enhancement failed to return valid output.');
        }

        const finalOutput: EnhancedContentStrategyOutput = {
            originalPillarTopic: pillarTopic,
            originalClusterTopics: clusterTopics,
            newClusterTopics: output.newClusterTopics,
            newRankingProbability: output.newRankingProbability,
            newStrategySummary: output.newStrategySummary,
        };

        // Final validation with the full schema
        const validationResult = EnhancedContentStrategyOutputSchema.safeParse(finalOutput);
        if (!validationResult.success) {
            console.error("AI Enhancement Response Validation Error:", validationResult.error.errors);
            throw new Error(`The AI returned enhanced data in an unexpected format. Details: ${validationResult.error.errors.map(e => e.message).join(', ')}`);
        }

        return validationResult.data;

    } catch (error: any) {
      console.error('Error during content strategy enhancement flow:', error);
      throw new Error(`Failed to enhance content strategy due to an internal error. Raw error: ${error.message}`);
    }
  }
);
