
'use server';
/**
 * @fileOverview A Genkit flow to orchestrate publishing a blog post to WordPress.
 *
 * This flow takes the blog content and credentials directly and uses the
 * wordpressPublisherTool to send it to the WordPress REST API.
 */

import { ai } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { wordpressPublisherTool } from '../tools/wordpress-publisher-tool';
import { 
  PublishToWordPressInputSchema, 
  type PublishToWordPressInput,
  PublishToWordPressOutputSchema,
  type PublishToWordPressOutput
} from '../types';


export async function publishToWordPress(input: PublishToWordPressInput): Promise<PublishToWordPressOutput> {
  return publishToWordPressFlow(input);
}

const publishToWordPressFlow = defineFlowOnce(
  {
    name: 'publishToWordPressFlow',
    inputSchema: PublishToWordPressInputSchema,
    outputSchema: PublishToWordPressOutputSchema,
  },
  async (input): Promise<PublishToWordPressOutput> => {
    try {
      // 1. Call the wordpressPublisherTool with all the required data
      const result = await wordpressPublisherTool({
        credentials: input.credentials,
        title: input.title,
        content: input.content,
        status: input.status,
        date: input.date,
        excerpt: input.excerpt,
        slug: input.slug,
      });

      if (result && !result.success) {
        // Pass the specific error from the tool back to the client
        return {
          success: false,
          error: result.error || 'The wordpressPublisherTool failed without a specific error.',
        };
      }

      return {
        success: true,
        postId: result.postId,
        postUrl: result.postUrl,
      };

    } catch (error: any) {
      console.error('Error in publishToWordPressFlow:', error);
      return {
        success: false,
        error: error.message || 'An unknown error occurred while publishing the blog to WordPress.',
      };
    }
  }
);
