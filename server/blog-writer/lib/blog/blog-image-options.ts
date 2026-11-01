export const BLOG_IMAGE_MIN_SIDE = 256;
export const BLOG_IMAGE_MAX_SIDE = 4096;

export const BLOG_IMAGE_PRESETS = [
  { label: 'Blog 16:9', width: 1600, height: 900 },
  { label: 'Full HD', width: 1920, height: 1080 },
  { label: 'Social share', width: 1200, height: 630 },
  { label: 'Square', width: 1080, height: 1080 },
  { label: 'Portrait 4:5', width: 1080, height: 1350 },
] as const;

export const DEFAULT_BLOG_IMAGE_SIZE = { width: 1600, height: 900 };
