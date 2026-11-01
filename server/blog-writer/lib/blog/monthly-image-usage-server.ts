import { canCreateBlogImages, getMonthlyImageGenerationLimit } from './access/plan-access';
import { buildMonthlyUsageDocId, getCurrentMonthKey } from './blog/monthly-blog-usage';
import { getFirestoreDocument, setFirestoreDocument } from './firebase/firestore-rest';
import type { UserProfile } from '../ai/types';

/** Written only by the server (the browser can write monthly_blog_usage, so counts live separately). */
const MONTHLY_IMAGE_USAGE_COLLECTION = 'monthly_image_usage';

export type ImageAccess =
  | { allowed: true; limit: number | null; used: number }
  | { allowed: false; limit: number | null; used: number; error: string };

function parseUserProfile(data: Record<string, string | null>): UserProfile {
  return {
    planId: (data.planId as UserProfile['planId']) ?? undefined,
    isPaid: data.isPaid === 'true',
    lifetimeTier: (data.lifetimeTier as UserProfile['lifetimeTier']) ?? undefined,
    email: data.email ?? undefined,
    trialStatus: (data.trialStatus as UserProfile['trialStatus']) ?? undefined,
  };
}

async function readMonthlyImageCount(userId: string): Promise<number> {
  const usage = await getFirestoreDocument(MONTHLY_IMAGE_USAGE_COLLECTION, buildMonthlyUsageDocId(userId));
  return Number.parseInt(usage?.imageGenerations ?? '0', 10) || 0;
}

/** Plan + monthly allowance check for AI image generation. */
export async function getImageAccess(userId: string): Promise<ImageAccess> {
  const userData = userId ? await getFirestoreDocument('users', userId) : null;
  const profile = userData ? parseUserProfile(userData) : null;
  const email = userData?.email ?? null;

  if (!canCreateBlogImages(profile, email)) {
    return {
      allowed: false,
      limit: 0,
      used: 0,
      error: 'Image generation is available on the Standard, Pro and Enterprise plans.',
    };
  }

  const limit = getMonthlyImageGenerationLimit(profile, email);
  const used = await readMonthlyImageCount(userId);
  if (limit !== null && used >= limit) {
    return {
      allowed: false,
      limit,
      used,
      error: `You've used all ${limit} images for this month. Your image limit resets at the start of next month.`,
    };
  }
  return { allowed: true, limit, used };
}

/** Counts one successful image; call only after the image was actually created. */
export async function recordImageGeneration(userId: string): Promise<void> {
  const monthKey = getCurrentMonthKey();
  const used = await readMonthlyImageCount(userId);
  await setFirestoreDocument(MONTHLY_IMAGE_USAGE_COLLECTION, buildMonthlyUsageDocId(userId, monthKey), {
    userId,
    month: monthKey,
    imageGenerations: used + 1,
    updatedAt: new Date().toISOString(),
  });
}
