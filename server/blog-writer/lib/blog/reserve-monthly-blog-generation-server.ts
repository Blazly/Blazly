import {
  getMonthlyBlogGenerationLimit,
  hasPaidAccess,
} from './access/plan-access';
import {
  buildMonthlyUsageDocId,
  formatMonthlyBlogLimitError,
  getCurrentMonthKey,
  MONTHLY_BLOG_USAGE_COLLECTION,
} from './blog/monthly-blog-usage';
import { getFirestoreDocument, setFirestoreDocument } from './firebase/firestore-rest';
import type { UserProfile } from '../ai/types';

function parseUserProfile(data: Record<string, string | null>): UserProfile {
  return {
    planId: (data.planId as UserProfile['planId']) ?? undefined,
    isPaid: data.isPaid === 'true',
    lifetimeTier: (data.lifetimeTier as UserProfile['lifetimeTier']) ?? undefined,
    email: data.email ?? undefined,
    trialStatus: (data.trialStatus as UserProfile['trialStatus']) ?? undefined,
  };
}

export async function reserveMonthlyBlogGenerationServer(userId: string): Promise<void> {
  const userData = await getFirestoreDocument('users', userId);
  if (!userData) {
    throw new Error('User not found.');
  }

  const profile = parseUserProfile(userData);
  const email = userData.email ?? profile.email ?? null;
  const limit = getMonthlyBlogGenerationLimit(profile, email);

  if (limit === null) {
    if (!hasPaidAccess(profile, email)) {
      throw new Error('A paid plan is required to generate blogs.');
    }
    return;
  }

  const monthKey = getCurrentMonthKey();
  const docId = buildMonthlyUsageDocId(userId, monthKey);
  const usage = await getFirestoreDocument(MONTHLY_BLOG_USAGE_COLLECTION, docId);
  const current = Number.parseInt(usage?.blogGenerations ?? '0', 10) || 0;

  if (current >= limit) {
    throw new Error(formatMonthlyBlogLimitError(limit, current));
  }

  await setFirestoreDocument(MONTHLY_BLOG_USAGE_COLLECTION, docId, {
    userId,
    month: monthKey,
    blogGenerations: current + 1,
    updatedAt: new Date().toISOString(),
  });
}
