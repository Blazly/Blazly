
'use server';
/**
 * @fileOverview A Genkit tool to publish blog content to Webflow.
 *
 * This tool handles connecting to the API and creating a new item in a
 * specified CMS Collection, using provided credentials.
 */

import { ai } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import {
    PublishToWebflowInputSchema as WebflowPublisherInputSchema,
    type PublishToWebflowInput as WebflowPublisherInput,
    PublishToWebflowOutputSchema as WebflowPublisherOutputSchema,
    type PublishToWebflowOutput
} from '../types';


export const webflowPublisherTool = defineToolOnce(
  {
    name: 'webflowPublisherTool',
    description: 'Publishes a blog post to a Webflow CMS collection using dynamic field mappings.',
    inputSchema: WebflowPublisherInputSchema,
    outputSchema: WebflowPublisherOutputSchema,
  },
  async (input): Promise<PublishToWebflowOutput> => {
    try {
      if (!input.apiKey || !input.collectionId || !input.content || !input.fieldMappings.content) {
        throw new Error('API Key, Collection ID, Content, and Content Field Slug are required.');
      }

      // 1. Prepare the base fields for the new CMS item.
      const fieldData: { [key: string]: any } = {
        name: input.title,
        slug: input.slug,
        [input.fieldMappings.content]: input.content,
        _archived: false,
        _draft: true, // Always publish as a draft first
      };
      
      // 2. Conditionally add meta title if mapping and value are provided
      if (input.fieldMappings.metaTitle && input.blogMetaTitle) {
        fieldData[input.fieldMappings.metaTitle] = input.blogMetaTitle;
      }

      // 3. Conditionally add meta description if mapping and value are provided
      if (input.fieldMappings.metaDescription && input.blogMetaDescription) {
        fieldData[input.fieldMappings.metaDescription] = input.blogMetaDescription;
      }

      const payload = { fieldData };
      
      // 4. Create the new item in the specified collection using fetch
      const response = await fetch(`https://api.webflow.com/v2/collections/${input.collectionId}/items`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'accept': 'application/json',
            'authorization': `Bearer ${input.apiKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json();
        let errorMessage = `Webflow API Error (${response.status}): ${errorData.message || 'An unknown error occurred.'}`;
        
        if (errorData.details?.[0]?.message) {
           errorMessage += ` Details: ${errorData.details[0].message}`;
        } else if (errorData.details) {
          errorMessage += ` Details: ${JSON.stringify(errorData.details)}`;
        } else if (errorData.problems) {
            errorMessage += ` Problems: ${errorData.problems.join(', ')}`;
        }
        
        throw new Error(errorMessage);
      }

      const newItem = await response.json();

      if (!newItem || !newItem.id) {
          throw new Error('Failed to create item in Webflow, no item returned from API.');
      }

      return {
        success: true,
        webflowItemId: newItem.id,
      };

    } catch (error: any) {
      console.error('Error publishing to Webflow:', error);
      return {
        success: false,
        error: error.message || 'An unknown error occurred while publishing to Webflow.',
      };
    }
  }
);
