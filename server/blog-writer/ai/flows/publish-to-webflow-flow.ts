
'use server';
/**
 * @fileOverview A Genkit flow to orchestrate publishing a blog post to Webflow.
 *
 * This flow takes the blog content and credentials directly and uses the
 * webflowPublisherTool to send it to the Webflow CMS.
 */

import { ai } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { webflowPublisherTool } from '../tools/webflow-publisher-tool';
import { 
  PublishToWebflowInputSchema, 
  type PublishToWebflowInput,
  PublishToWebflowOutputSchema,
  type PublishToWebflowOutput
} from '../types';

// Helper function to create a URL-friendly slug
const createSlug = (title: string): string => {
  return title
    .toLowerCase()
    .replace(/ /g, '-')
    .replace(/[^\w-]+/g, '');
};

export async function publishToWebflow(input: PublishToWebflowInput): Promise<PublishToWebflowOutput> {
  return publishToWebflowFlow(input);
}


const publishToWebflowFlow = defineFlowOnce(
  {
    name: 'publishToWebflowFlow',
    inputSchema: PublishToWebflowInputSchema,
    outputSchema: PublishToWebflowOutputSchema,
  },
  async (input): Promise<PublishToWebflowOutput> => {
    try {
      // 1. Generate a slug from the blog title
      const slug = createSlug(input.title);

      // 2. Call the webflowPublisherTool with all the required data
      const result = await webflowPublisherTool({
        apiKey: input.apiKey,
        collectionId: input.collectionId,
        title: input.title,
        slug: slug,
        content: input.content,
        fieldMappings: input.fieldMappings,
        blogMetaTitle: input.blogMetaTitle,
        blogMetaDescription: input.blogMetaDescription,
      });

      if (result && !result.success) {
        // Pass the specific error from the tool back to the client
        return {
          success: false,
          error: result.error || 'The webflowPublisherTool failed without a specific error.',
        };
      }

      return {
        success: true,
        webflowItemId: result.webflowItemId,
      };

    } catch (error: any) {
      console.error('Error in publishToWebflowFlow:', error);
      return {
        success: false,
        error: error.message || 'An unknown error occurred while publishing the blog.',
      };
    }
  }
);
