
'use server';
/**
 * @fileOverview A Genkit flow to verify Webflow API credentials.
 *
 * - verifyWebflowCredentials - A function that checks if an API key is valid.
 */
import { ai } from '../genkit';
import { definePromptOnce, defineFlowOnce, defineToolOnce } from '../define-once';
import {
    VerifyWebflowCredentialsInputSchema,
    type VerifyWebflowCredentialsInput,
    VerifyWebflowCredentialsOutputSchema,
    type VerifyWebflowCredentialsOutput
} from '../types';


export async function verifyWebflowCredentials(input: VerifyWebflowCredentialsInput): Promise<VerifyWebflowCredentialsOutput> {
  return verifyWebflowCredentialsFlow(input);
}

const verifyWebflowCredentialsFlow = defineFlowOnce(
    {
      name: 'verifyWebflowCredentialsFlow',
      inputSchema: VerifyWebflowCredentialsInputSchema,
      outputSchema: VerifyWebflowCredentialsOutputSchema,
    },
    async (input): Promise<VerifyWebflowCredentialsOutput> => {
        try {
            if (!input.apiKey) {
              throw new Error('API Key is required for verification.');
            }
        
            // A lightweight API endpoint to check if the token is valid.
            const response = await fetch('https://api.webflow.com/v2/sites', {
              method: 'GET',
              headers: {
                'accept': 'application/json',
                'authorization': `Bearer ${input.apiKey}`,
              },
            });
        
            if (response.ok) {
              return { success: true };
            } 
            
            const errorData = await response.json();
            const errorMessage = errorData?.message || `API returned status ${response.status}`;
        
            if (response.status === 401) {
                return { success: false, error: 'The provided API Key is invalid.' };
            }
            
            if (response.status === 403) {
              if (errorMessage.includes('sites:read')) {
                return { success: false, error: "Verification failed. Your API key is missing required permissions. Please ensure the 'sites:read' scope is enabled for your token in your Webflow settings." };
              }
              return { success: false, error: `Permission Denied: ${errorMessage}`};
            }
        
            return { success: false, error: errorMessage };
        
          } catch (error: any) {
            console.error('Webflow credential verification failed:', error);
            return { success: false, error: error.message || 'An unknown error occurred during verification.' };
          }
    }
);

