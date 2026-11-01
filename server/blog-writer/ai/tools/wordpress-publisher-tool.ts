
'use server';
/**
 * @fileOverview A Genkit tool to publish blog content to WordPress.
 *
 * This tool handles connecting to the REST API and creating a new post
 * using the provided credentials.
 */

import { ai } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import {
    WordPressPublisherInputSchema,
    type WordPressPublisherInput,
    WordPressPublisherOutputSchema,
    type WordPressPublisherOutput
} from '../types';
import {
  buildWordPressAuthHeader,
  isWordPressHtmlResponse,
  isWordPressRestIndexPayload,
  normalizeWordPressSiteUrlInput,
  sanitizeWordPressUserError,
  wordPressRestApiBlockedMessage,
} from '../../lib/wordpress/credentials';

export const wordpressPublisherTool = defineToolOnce(
  {
    name: 'wordpressPublisherTool',
    description: 'Publishes a blog post to a WordPress site.',
    inputSchema: WordPressPublisherInputSchema,
    outputSchema: WordPressPublisherOutputSchema,
  },
  async (input): Promise<WordPressPublisherOutput> => {
    try {
      const { siteUrl, username, applicationPassword } = input.credentials;
      if (!siteUrl || !username || !applicationPassword) {
        throw new Error('WordPress Site URL, Username, or Application Password missing from credentials.');
      }

      const baseUrl = normalizeWordPressSiteUrlInput(siteUrl);
      const headers = {
        'Content-Type': 'application/json',
        Authorization: buildWordPressAuthHeader(username, applicationPassword),
      };

      // 2. Prepare the post payload
      const payload: any = {
        title: input.title,
        content: input.content,
        status: input.status, // 'draft', 'publish', or 'future'
      };

      // Add excerpt if it exists
      if(input.excerpt) {
        payload.excerpt = input.excerpt;
      }
      
      // Add date if it exists (for scheduling)
      if (input.date) {
        payload.date = input.date;
      }

      if (input.slug) {
        payload.slug = input.slug;
      }
      const response = await fetch(`${baseUrl}/wp-json/wp/v2/posts`, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type') || '';
        const text = await response.text();
        let errorMessage = `WordPress API Error (${response.status}).`;
        if (isWordPressHtmlResponse(text, contentType) || isWordPressRestIndexPayload(null, text)) {
          errorMessage = wordPressRestApiBlockedMessage(response.status);
        } else if (contentType.includes('application/json') || text.trim().startsWith('{')) {
          try {
            const errorData = JSON.parse(text) as { message?: string };
            const apiMessage = errorData.message || errorMessage;
            errorMessage =
              isWordPressHtmlResponse(apiMessage) ||
              isWordPressRestIndexPayload(null, apiMessage) ||
              /<!doctype|<html/i.test(apiMessage)
                ? wordPressRestApiBlockedMessage(response.status)
                : apiMessage;
          } catch {
            // keep default
          }
        }
        throw new Error(sanitizeWordPressUserError(errorMessage, response.status));
      }

      const newPost = (await response.json()) as { id?: number; link?: string };

      if (!newPost || !newPost.id) {
          throw new Error('Failed to create post in WordPress, no post data returned from API.');
      }

      return {
        success: true,
        postId: newPost.id,
        postUrl: newPost.link,
      };

    } catch (error: any) {
      console.error('Error publishing to WordPress:', error);
      return {
        success: false,
        error: sanitizeWordPressUserError(
          error.message || 'An unknown error occurred while publishing to WordPress.',
        ),
      };
    }
  }
);
