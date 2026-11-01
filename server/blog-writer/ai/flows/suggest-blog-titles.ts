'use server';

/**
 * @fileOverview This file defines a Genkit flow for suggesting blog titles based on a user-provided prompt.
 *
 * The flow takes a prompt as input and returns an array of suggested blog titles.
 * - suggestBlogTitles - A function that handles the blog title suggestion process.
 * - SuggestBlogTitlesInput - The input type for the suggestBlogTitles function.
 * - SuggestBlogTitlesOutput - The return type for the suggestBlogTitles function.
 */

import {ai} from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import {
  SuggestBlogTitlesInputSchema,
  type SuggestBlogTitlesInput,
  SuggestBlogTitlesOutputSchema,
  type SuggestBlogTitlesOutput,
} from '../types';


export async function suggestBlogTitles(input: SuggestBlogTitlesInput): Promise<SuggestBlogTitlesOutput> {
  return suggestBlogTitlesFlow(input);
}

const prompt = definePromptOnce({
  name: 'suggestBlogTitlesPrompt',
  input: {schema: SuggestBlogTitlesInputSchema},
  output: {schema: SuggestBlogTitlesOutputSchema},
  prompt: `You are a blog title generation expert. Given a prompt, you will generate 5 possible blog titles.

Prompt: {{{prompt}}}

Titles:`, // Output must be JSON array of strings
  config: {
    temperature: 0.7,
    maxTokens: 200,
    safetySettings: [
      {
        category: 'HARM_CATEGORY_HATE_SPEECH',
        threshold: 'BLOCK_ONLY_HIGH',
      },
      {
        category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
        threshold: 'BLOCK_NONE',
      },
      {
        category: 'HARM_CATEGORY_HARASSMENT',
        threshold: 'BLOCK_MEDIUM_AND_ABOVE',
      },
      {
        category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
        threshold: 'BLOCK_LOW_AND_ABOVE',
      },
    ],
  },
});

const suggestBlogTitlesFlow = defineFlowOnce(
  {
    name: 'suggestBlogTitlesFlow',
    inputSchema: SuggestBlogTitlesInputSchema,
    outputSchema: SuggestBlogTitlesOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
