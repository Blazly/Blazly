
'use server';
/**
 * @fileOverview A Genkit tool to fetch the fields for a specific Webflow CMS collection.
 */

import { ai } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { 
    GetWebflowCollectionFieldsInputSchema, 
    GetWebflowCollectionFieldsOutputSchema,
    type GetWebflowCollectionFieldsInput,
    type GetWebflowCollectionFieldsOutput
} from '../types';

export async function getWebflowCollectionFields(input: GetWebflowCollectionFieldsInput): Promise<GetWebflowCollectionFieldsOutput> {
  return getWebflowCollectionFieldsFlow(input);
}


const getWebflowCollectionFieldsFlow = defineFlowOnce(
  {
    name: 'getWebflowCollectionFieldsFlow',
    inputSchema: GetWebflowCollectionFieldsInputSchema,
    outputSchema: GetWebflowCollectionFieldsOutputSchema,
  },
  async (input): Promise<GetWebflowCollectionFieldsOutput> => {
    try {
      if (!input.apiKey) {
        throw new Error('Webflow API key is required.');
      }
       if (!input.collectionId) {
        throw new Error('Webflow Collection ID is required.');
      }

      const response = await fetch(`https://api.webflow.com/v2/collections/${input.collectionId}`, {
        method: 'GET',
        headers: {
            'accept': 'application/json',
            'authorization': `Bearer ${input.apiKey}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Webflow API Error: ${response.status}`);
      }
      
      const collectionData = await response.json();
      
      const fields = collectionData.fields?.map((field: any) => ({
        id: field.id,
        displayName: field.displayName,
        slug: field.slug,
        type: field.type,
        isRequired: field.isRequired,
      })) || [];

      return { fields };

    } catch (error: any) {
      console.error('Error fetching Webflow collection fields:', error);
      return {
        fields: [],
        error: error.message || 'An unknown error occurred while fetching collection fields.',
      };
    }
  }
);
