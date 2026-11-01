
'use server';
/**
 * @fileOverview Verifies WordPress API credentials.
 */

import {
  VerifyWordPressCredentialsInputSchema,
  type VerifyWordPressCredentialsInput,
  VerifyWordPressCredentialsOutputSchema,
  type VerifyWordPressCredentialsOutput,
} from '../types';
import { verifyWordPressCredentialsCore } from '../../lib/wordpress/credentials';

export async function verifyWordPressCredentials(
  input: VerifyWordPressCredentialsInput,
): Promise<VerifyWordPressCredentialsOutput> {
  const parsed = VerifyWordPressCredentialsInputSchema.parse(input);
  const result = await verifyWordPressCredentialsCore(parsed);
  if (result.success) {
    return VerifyWordPressCredentialsOutputSchema.parse({ success: true });
  }
  return VerifyWordPressCredentialsOutputSchema.parse({
    success: false,
    error: result.error,
  });
}
