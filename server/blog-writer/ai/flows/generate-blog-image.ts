'use server';

import sharp from 'sharp';
import { BLOG_IMAGE_MAX_SIDE, BLOG_IMAGE_MIN_SIDE } from '../../lib/blog/blog-image-options';
import { getImageAccess, recordImageGeneration } from '../../lib/blog/monthly-image-usage-server';

export type GenerateBlogImageInput = {
  userId: string;
  prompt: string;
  width: number;
  height: number;
};

export type GenerateBlogImageResult =
  | { ok: true; dataUrl: string; width: number; height: number }
  | { ok: false; error: string };

const DEFAULT_IMAGE_MODEL = 'gemini-3.1-flash-image-preview';
const SUPPORTED_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
const GENERIC_ERROR = 'Could not create an image right now. Please try again.';

function nearestAspectRatio(width: number, height: number): string {
  const target = width / height;
  let best: string = SUPPORTED_ASPECT_RATIOS[0];
  let bestDiff = Infinity;
  for (const ratio of SUPPORTED_ASPECT_RATIOS) {
    const [w, h] = ratio.split(':').map(Number);
    const diff = Math.abs(Math.log(w / h) - Math.log(target));
    if (diff < bestDiff) {
      bestDiff = diff;
      best = ratio;
    }
  }
  return best;
}

function imageSizeTier(width: number, height: number): '1K' | '2K' | '4K' {
  const longest = Math.max(width, height);
  if (longest <= 1024) return '1K';
  if (longest <= 2048) return '2K';
  return '4K';
}

/** Images used / allowed this month (limit null = unlimited) for the Create image panel. */
export async function getBlogImageUsage(userId: string): Promise<{ used: number; limit: number | null }> {
  try {
    const access = await getImageAccess(userId);
    return { used: access.used, limit: access.limit };
  } catch (error) {
    console.error('[getBlogImageUsage] Failed:', error);
    return { used: 0, limit: null };
  }
}

/**
 * Generates an image from the user's prompt and returns it resized to exactly width × height as WebP
 * (keeps the response well under Vercel's 4.5 MB limit; the browser uploads it to Storage).
 */
export async function generateBlogImage(input: GenerateBlogImageInput): Promise<GenerateBlogImageResult> {
  const prompt = input.prompt?.trim();
  if (!prompt) return { ok: false, error: 'Describe the image you want to create.' };

  const width = Math.round(Number(input.width));
  const height = Math.round(Number(input.height));
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < BLOG_IMAGE_MIN_SIDE ||
    height < BLOG_IMAGE_MIN_SIDE ||
    width > BLOG_IMAGE_MAX_SIDE ||
    height > BLOG_IMAGE_MAX_SIDE
  ) {
    return {
      ok: false,
      error: `Resolution must be between ${BLOG_IMAGE_MIN_SIDE} and ${BLOG_IMAGE_MAX_SIDE} pixels on each side.`,
    };
  }

  try {
    const access = await getImageAccess(input.userId);
    if (!access.allowed) return { ok: false, error: access.error };

    const apiKey =
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      process.env.GOOGLE_GENAI_API_KEY?.trim();
    if (!apiKey) {
      console.error('[generateBlogImage] Image API key is not configured.');
      return { ok: false, error: GENERIC_ERROR };
    }

    const model = process.env.GEMINI_IMAGE_MODEL?.trim() || DEFAULT_IMAGE_MODEL;
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: {
              aspectRatio: nearestAspectRatio(width, height),
              imageSize: imageSizeTier(width, height),
            },
          },
        }),
      },
    );

    const body = (await response.json().catch(() => null)) as {
      candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
      error?: { message?: string };
    } | null;

    if (!response.ok || !body) {
      console.error('[generateBlogImage] Image request failed:', response.status, body?.error?.message);
      return { ok: false, error: GENERIC_ERROR };
    }

    const base64 = body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData?.data;
    if (!base64) {
      return {
        ok: false,
        error: 'No image was created for this prompt. Try describing it differently.',
      };
    }

    const output = await sharp(Buffer.from(base64, 'base64'))
      .resize(width, height, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();

    await recordImageGeneration(input.userId);

    return { ok: true, dataUrl: `data:image/webp;base64,${output.toString('base64')}`, width, height };
  } catch (error) {
    console.error('[generateBlogImage] Failed:', error);
    return { ok: false, error: GENERIC_ERROR };
  }
}
