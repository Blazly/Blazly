'use server';
/**
 * @fileOverview AI agent that checks for potential plagiarism in a text.
 *
 * - checkPlagiarism - A function that provides an estimated plagiarism score.
 * - CheckPlagiarismInput - The input type.
 * - CheckPlagiarismOutput - The return type.
 */

import {ai} from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import {
  CheckPlagiarismInputSchema,
  type CheckPlagiarismInput,
  CheckPlagiarismOutputSchema,
  type CheckPlagiarismOutput,
} from '../types';


export async function checkPlagiarism(input: CheckPlagiarismInput): Promise<CheckPlagiarismOutput> {
  return checkPlagiarismFlow(input);
}

const plagiarismCheckPrompt = definePromptOnce({
  name: 'plagiarismCheckPrompt',
  input: {schema: CheckPlagiarismInputSchema},
  output: {schema: CheckPlagiarismOutputSchema},
  prompt: `You are an AI-powered plagiarism detection engine. Your task is to analyze the provided text and determine the likelihood that it has been copied from other sources on the internet.

You must differentiate between:
-   **Common knowledge or generic phrases**: These are not plagiarism (e.g., "The sky is blue").
-   **Directly copied, non-trivial sentences or paragraphs**: This is plagiarism.

Analyze the following text word-for-word. Compare it against your vast knowledge base of web content.

Text to Analyze:
{{{textContent}}}

Based on your analysis, provide:
1.  **plagiarismScore**: An estimated score from 0 to 100.
    *   **0-5%**: The content appears to be completely original. No non-trivial sentences match known sources.
    *   **6-20%**: Minor overlap with common phrasing or a few generic sentences that might appear elsewhere, but no direct evidence of copying unique content.
    *   **21-50%**: Some sentences are very similar to known sources, suggesting heavy inspiration or poor paraphrasing. This is a moderate risk.
    *   **51-100%**: Multiple sentences or entire paragraphs appear to be directly copied from specific online sources (like other blogs, news articles, academic papers, etc.). This is a high risk of plagiarism.
2.  **justification**: A brief explanation for your score.
3.  **plagiarizedSegments**: An array of objects for each segment that you are confident is plagiarized. For each segment, provide the exact 'segment' of text and a 'sourceSuggestion' (e.g., "Commonly found in marketing blogs," "Appears to be from a news report on a similar topic," or "Exact match found in multiple online tutorials."). If there are no plagiarized segments, return an empty array.

Focus only on identifying directly copied unique content. Do not flag content for simply being on a similar topic to other articles.
`,
  config: {
    temperature: 0.3,
  },
});

const checkPlagiarismFlow = defineFlowOnce(
  {
    name: 'checkPlagiarismFlow',
    inputSchema: CheckPlagiarismInputSchema,
    outputSchema: CheckPlagiarismOutputSchema,
  },
  async (input) => {
    if (!input.textContent.trim()) {
      return {
        plagiarismScore: 0,
        justification: 'Input text was empty. Score set to 0.',
        plagiarizedSegments: [],
      };
    }
    
    try {
      const {output} = await plagiarismCheckPrompt(input);
      if (output) {
        return output;
      } else {
        throw new Error('Plagiarism check prompt did not return a valid output.');
      }
    } catch (error) {
      console.error('Error during plagiarism check flow:', error);
      return {
        plagiarismScore: 0,
        justification: 'Could not perform plagiarism analysis due to an internal error.',
        plagiarizedSegments: [],
      };
    }
  }
);
