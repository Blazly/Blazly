
'use server';
/**
 * @fileOverview Generates a single blog hero illustration from the blog title.
 */

import { ai } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { z } from 'zod';
import {
  BLOG_IMAGE_MODEL,
  BLOG_IMAGE_MODEL_FALLBACK,
} from './image-models';
import { getImageAccess, recordImageGeneration } from '../../lib/blog/monthly-image-usage-server';

const GenerateIllustrationInputSchema = z.object({
  userId: z.string().describe('Requesting user; image generation is limited to Standard / Pro / Enterprise plans.'),
  prompt: z.string().describe('Description of the image to create (defaults to the blog title in the UI).'),
  width: z.number().optional().describe('The desired width of the image in pixels.'),
  height: z.number().optional().describe('The desired height of the image in pixels.'),
});
type GenerateIllustrationInput = z.infer<typeof GenerateIllustrationInputSchema>;

const GenerateIllustrationOutputSchema = z.object({
  imageUrl: z.string().describe('The generated image URL or data URI.'),
  error: z.string().optional().describe('An error message if generation failed.'),
});
type GenerateIllustrationOutput = z.infer<typeof GenerateIllustrationOutputSchema>;

export async function generateIllustration(input: GenerateIllustrationInput): Promise<GenerateIllustrationOutput> {
  return generateIllustrationFlow(input);
}

function buildImagePrompt(title: string, width?: number, height?: number): string {
  let fullPrompt = `Create a modern, high-quality, professional image for a blog article. Image description: "${title}". Avoid text in the image unless the description asks for it.`;
  if (width && height) {
    fullPrompt += ` The image should have an aspect ratio of ${width} by ${height}.`;
  }
  return fullPrompt;
}

async function generateWithModel(model: string, prompt: string, useImageModality: boolean): Promise<string | null> {
  const { media } = await ai.generate({
    model,
    prompt,
    ...(useImageModality ? { config: { responseModalities: ['IMAGE'] } } : {}),
  });
  return media?.url ?? null;
}

const generateIllustrationFlow = defineFlowOnce(
  {
    name: 'generateIllustrationFlow',
    inputSchema: GenerateIllustrationInputSchema,
    outputSchema: GenerateIllustrationOutputSchema,
  },
  async ({ userId, prompt, width, height }) => {
    const title = prompt.trim();
    if (!title) {
      return { imageUrl: '', error: 'Blog title is required to generate an illustration.' };
    }

    try {
      const access = await getImageAccess(userId);
      if (!access.allowed) return { imageUrl: '', error: access.error };

      const fullPrompt = buildImagePrompt(title, width, height);
      let url: string | null = null;
      try {
        url = await generateWithModel(BLOG_IMAGE_MODEL, fullPrompt, true);
      } catch (primaryError) {
        console.warn('[generateIllustration] Primary model failed, trying fallback:', primaryError);
      }
      if (!url) url = await generateWithModel(BLOG_IMAGE_MODEL_FALLBACK, fullPrompt, false);

      if (url) {
        await recordImageGeneration(userId);
        return { imageUrl: url };
      }

      throw new Error('Image generation failed to return a valid image URL.');
    } catch (error: unknown) {
      console.error('Error in generateIllustrationFlow:', error);
      return { imageUrl: '', error: 'Could not create an illustration right now. Please try again.' };
    }
  },
);
