
'use server';
/**
 * @fileOverview A Genkit tool to fetch a user's CMS collections from Webflow.
 */

import { ai } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import { getIntegrations } from '../../lib/firebase/firestoreService';
import { 
    GetWebflowCollectionsInputSchema, 
    GetWebflowCollectionsOutputSchema,
    type GetWebflowCollectionsOutput
} from '../types';

export const getWebflowCollectionsTool = defineToolOnce(
  {
    name: 'getWebflowCollectionsTool',
    description: "Fetches a user's CMS collections from their integrated Webflow site.",
    inputSchema: GetWebflowCollectionsInputSchema,
    outputSchema: GetWebflowCollectionsOutputSchema,
  },
  async (input): Promise<GetWebflowCollectionsOutput> => {
    try {
      // 1. Fetch Webflow integration credentials for the user
      const integrations = await getIntegrations(input.userId);
      const webflowIntegration = integrations.find(i => i.provider === 'Webflow');

      if (!webflowIntegration) {
        throw new Error('No Webflow integration found for this user.');
      }
      
      const { apiKey, siteId } = webflowIntegration.credentials;
      if (!apiKey || !siteId) {
        throw new Error('Webflow API key or Site ID is missing from credentials.');
      }

      // 2. Fetch collections from Webflow for the specified site
      const response = await fetch(`https://api.webflow.com/v2/sites/${siteId}/collections`, {
        method: 'GET',
        headers: {
            'accept': 'application/json',
            'authorization': `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || `Webflow API Error: ${response.status}`);
      }
      
      const { collections } = await response.json();
      
      // Filter for only CMS collections (type: 'cms')
      const cmsCollections = collections.filter((c: any) => c.type === 'cms');

      return { collections: cmsCollections };

    } catch (error: any) {
      console.error('Error fetching Webflow collections:', error);
      return {
        error: error.message || 'An unknown error occurred while fetching collections.',
      };
    }
  }
);
