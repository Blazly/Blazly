'use server';

/**
 * @fileOverview This file defines a Genkit flow for refining AI-generated content based on user input.
 *
 * It exports:
 * - `refineContent`: An asynchronous function that takes RefineContentInput and returns RefineContentOutput.
 * - `RefineContentInput`: The input type for the refineContent function.
 * - `RefineContentOutput`: The output type for the refineContent function.
 */

import {ai} from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import {
  RefineContentInputSchema,
  type RefineContentInput,
  RefineContentOutputSchema,
  type RefineContentOutput,
} from '../types';

export async function refineContent(input: RefineContentInput): Promise<RefineContentOutput> {
  return refineContentFlow(input);
}

const refineContentPrompt = definePromptOnce({
  name: 'refineContentPrompt',
  input: {schema: RefineContentInputSchema},
  output: {schema: RefineContentOutputSchema},
  prompt: `You are an AI content refinement assistant. Your task is to improve the quality and accuracy of AI-generated sentences based on user feedback.

Original Sentence: {{{originalContent}}}
User Feedback: {{{userFeedback}}}

Please provide a refined version of the original sentence that incorporates the user feedback. Focus on improving clarity, accuracy, and overall quality.

Refined Sentence:`, 
});

const refineContentFlow = defineFlowOnce(
  {
    name: 'refineContentFlow',
    inputSchema: RefineContentInputSchema,
    outputSchema: RefineContentOutputSchema,
  },
  async input => {
    const {output} = await refineContentPrompt(input);
    return output!;
  }
);
