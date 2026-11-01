import { createHash, randomUUID } from 'crypto';
import { getSerpResults } from '../ai/flows/get-serp-results';
import { fetchBlogGenerationSources, generateBlogPost } from '../ai/flows/generate-blog-post';
import { analyzeOnPageSEO } from '../ai/flows/analyze-seo-onpage';
import { enhanceSeo } from '../ai/flows/enhance-seo';
import { advancedHumanizeText } from '../ai/flows/advanced-humanize-text';
import { factCheckBlog } from '../ai/flows/fact-check-blog';
import { enforceKeywordOccurrences } from '../ai/flows/enforce-keyword-occurrences';
import { finalizeBlogHtml } from './blog/sanitize-blog-html';
import { pickReferenceUrls } from './blog/reference-urls';
import { getFirestoreDocument, setFirestoreDocument } from './firebase/firestore-rest';
import type {
  AnalyzeOnPageSEOOutput,
  BlogGenerationSources,
  GenerateBlogPostInput,
  GenerateBlogPostOutput,
} from '../ai/types';

/**
 * Blazly Blog Writer runs as a server-side job: each step is its own Vercel invocation (< 800s),
 * progress lives in Firestore, and the browser only polls — so a dropped connection or a
 * backgrounded tab no longer kills the generation.
 */
const JOBS_COLLECTION = 'blog_generation_jobs';
const STEPS = ['researching', 'writing', 'seo_optimizing', 'humanizing', 'fact_checking', 'finalizing'] as const;
type Step = (typeof STEPS)[number];

/** Step routes run with maxDuration 800s (Vercel Pro + Fluid); leave room to save and hand off. */
const STEP_BUDGET_MS = 770_000;
/** A step running longer than the platform limit died with its invocation. */
const DEAD_STEP_MS = 830_000;
/** A queued step that no invocation picked up (failed hand-off) is re-sent after this. */
const UNCLAIMED_STEP_MS = 45_000;
/** First attempt uses the plan's writer model; retries use the fast default model. */
const MAX_STEP_ATTEMPTS = 3;

type DraftFields = Omit<
  GenerateBlogPostOutput,
  'referenceFetchResults' | 'yourProductFetchResult' | 'competitorFetchResults'
>;

type JobState = {
  input: GenerateBlogPostInput;
  presetTitle: string;
  sources?: BlogGenerationSources;
  draft?: DraftFields;
  title?: string;
  html?: string;
  metaTitle?: string;
  metaDescription?: string;
};

export type BlogJobResult = DraftFields & { seoAnalysis?: AnalyzeOnPageSEOOutput | null };

export type BlogJobStatus = {
  status: 'running' | 'done' | 'error';
  stage: string;
  attempts: number;
  skipGatheringReferences: boolean;
  result?: BlogJobResult;
  error?: string;
};

export function blogJobKey(): string {
  const seed = process.env.FIREBASE_SERVICE_ACCOUNT_KEY || process.env.GEMINI_API_KEY || '';
  return createHash('sha256').update(`${seed}:blog-generation-jobs`).digest('hex');
}

const nowIso = () => new Date().toISOString();

async function saveJob(jobId: string, data: Record<string, string | number | boolean | null>) {
  await setFirestoreDocument(JOBS_COLLECTION, jobId, { ...data, updatedAt: nowIso() });
}

/** Hands a step to a fresh invocation; retried because a lost hand-off would stall the job. */
export async function triggerBlogJobStep(jobId: string, origin: string): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(`${origin}/api/blog-jobs/${jobId}/step`, {
        method: 'POST',
        headers: { 'x-blog-job-key': blogJobKey() },
        signal: AbortSignal.timeout(15_000),
      });
      if (response.ok) return true;
      console.error('[blogJob] Step hand-off rejected:', jobId, response.status);
    } catch (error) {
      console.error('[blogJob] Step hand-off failed:', jobId, error);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  return false;
}

export async function createBlogJob(input: GenerateBlogPostInput, presetTitle: string): Promise<string> {
  const jobId = randomUUID();
  const state: JobState = { input, presetTitle };
  await saveJob(jobId, {
    userId: input.userId ?? '',
    status: 'running',
    step: 'researching',
    stage: 'researching',
    attempts: 0,
    skipGatheringReferences: false,
    state: JSON.stringify(state),
    queuedAt: nowIso(),
    runningSince: '',
    createdAt: nowIso(),
  });
  return jobId;
}

async function executeStep(
  step: Step,
  state: JobState,
  attempt: number,
  deadlineAt: number,
  setStage: (stage: string, extra?: Record<string, boolean>) => Promise<void>,
): Promise<JobState> {
  const { input } = state;
  const primaryKeyword = input.primaryKeyword ?? '';
  const language = input.language || 'English';
  const keywordOccurrences = input.keywordOccurrences;
  // A retry usually means the plan's writer model ran out of time, so retries use the fast default.
  const useDefaultModels = attempt > 0;

  switch (step) {
    case 'researching': {
      let referenceUrls: string[] = [];
      try {
        const serp = await getSerpResults({ query: primaryKeyword });
        referenceUrls = pickReferenceUrls(serp.results);
      } catch {
        // SERP research is supplementary; continue generation if it fails.
      }
      let sources: BlogGenerationSources = {};
      if (referenceUrls.length > 0 || input.productUrl) {
        await setStage('gathering_references');
        try {
          const fetched = await fetchBlogGenerationSources({ ...input, referenceUrls });
          // Only the cleaned HTML is needed downstream; raw fetch results would bloat the job doc.
          sources = {
            yourProductHtmlContent: fetched.yourProductHtmlContent,
            yourProductFetchError: fetched.yourProductFetchError,
            referenceBlogsHtml: fetched.referenceBlogsHtml,
            competitorsHtml: fetched.competitorsHtml,
          };
        } catch {
          sources = {};
        }
      } else {
        await setStage('researching', { skipGatheringReferences: true });
      }
      return { ...state, sources };
    }

    case 'writing': {
      const draft = await generateBlogPost({
        ...input,
        skipInternalHumanization: true,
        skipUrlFetching: true,
        prefetchedSources: state.sources ?? {},
        forceDefaultModels: useDefaultModels,
        deadlineAt,
      });
      if (!draft.blogPost) throw new Error('Blog generation failed to produce content.');
      const { referenceFetchResults, yourProductFetchResult, competitorFetchResults, ...draftFields } = draft;
      return {
        ...state,
        sources: undefined,
        draft: draftFields,
        title: draft.blogTitle?.trim() || state.presetTitle.trim() || draft.metaTitle,
        html: draft.blogPost,
        metaTitle: draft.metaTitle,
        metaDescription: draft.metaDescription,
      };
    }

    case 'seo_optimizing': {
      const seoAnalysis = await analyzeOnPageSEO({
        htmlContent: state.html!,
        metaTitle: state.metaTitle!,
        metaDescription: state.metaDescription!,
        primaryKeyword,
      });
      const enhanced = await enhanceSeo({
        htmlContent: state.html!,
        metaTitle: state.metaTitle!,
        metaDescription: state.metaDescription!,
        primaryKeyword,
        keywordOccurrences,
        seoAnalysis,
        language,
        knowledgeBase: input.knowledgeBase,
        geoFormat: true,
      });
      return {
        ...state,
        html: enhanced.enhancedHtmlContent,
        metaTitle: enhanced.enhancedMetaTitle,
        metaDescription: enhanced.enhancedMetaDescription,
      };
    }

    case 'humanizing': {
      const humanized = await advancedHumanizeText({
        htmlContent: state.html!,
        blogTitle: state.title,
        primaryKeyword,
        keywordOccurrences,
        secondaryKeyword: input.secondaryKeyword,
        tone: input.tone,
        targetWordCount: input.targetWordCount,
        language,
        humanizationLevel: 2,
        knowledgeBase: input.knowledgeBase,
        preserveExactFormat: true,
        blogWriterUserId: useDefaultModels ? undefined : input.userId,
        deadlineAt,
      });
      return { ...state, html: humanized.humanizedHtmlContent || state.html };
    }

    case 'fact_checking': {
      const checked = await factCheckBlog({
        htmlContent: state.html!,
        metaTitle: state.metaTitle!,
        metaDescription: state.metaDescription!,
        blogTitle: state.title ?? primaryKeyword,
        primaryKeyword,
        keywordOccurrences,
        language,
        knowledgeBase: input.knowledgeBase,
        geoFormat: true,
      });
      return {
        ...state,
        html: checked.correctedHtmlContent,
        metaTitle: checked.correctedMetaTitle,
        metaDescription: checked.correctedMetaDescription,
      };
    }

    case 'finalizing': {
      const enforced = await enforceKeywordOccurrences({
        htmlContent: state.html!,
        metaTitle: state.metaTitle!,
        metaDescription: state.metaDescription!,
        primaryKeyword,
        keywordOccurrences: keywordOccurrences ?? 4,
        language,
        geoFormat: true,
      });
      return {
        ...state,
        html: finalizeBlogHtml(enforced.htmlContent, primaryKeyword, { allowQuestions: true }),
        metaTitle: enforced.metaTitle,
        metaDescription: enforced.metaDescription,
      };
    }
  }
}

/** Runs the job's current step, then hands off to a fresh invocation for the next one. */
export async function runBlogJobStep(jobId: string, origin: string): Promise<void> {
  const startedAt = Date.now();
  const job = await getFirestoreDocument(JOBS_COLLECTION, jobId);
  if (!job || job.status !== 'running') return;

  // Another invocation is already working on this step (duplicate hand-off or poll re-send).
  const runningSince = Date.parse(job.runningSince ?? '') || 0;
  if (runningSince && startedAt - runningSince < DEAD_STEP_MS) return;

  const step = job.step as Step;
  const attempts = Number(job.attempts ?? '0') || 0;
  const state = JSON.parse(job.state ?? '{}') as JobState;
  await saveJob(jobId, { stage: step, runningSince: new Date(startedAt).toISOString() });

  try {
    const nextState = await executeStep(step, state, attempts, startedAt + STEP_BUDGET_MS, (stage, extra) =>
      saveJob(jobId, { stage, ...extra }),
    );
    const nextStep = STEPS[STEPS.indexOf(step) + 1];

    if (!nextStep) {
      const seoAnalysis = await analyzeOnPageSEO({
        htmlContent: nextState.html!,
        metaTitle: nextState.metaTitle!,
        metaDescription: nextState.metaDescription!,
        primaryKeyword: nextState.input.primaryKeyword ?? '',
      }).catch(() => null);
      const result: BlogJobResult = {
        ...nextState.draft!,
        blogTitle: nextState.title,
        blogPost: nextState.html!,
        metaTitle: nextState.metaTitle!,
        metaDescription: nextState.metaDescription!,
        seoAnalysis,
      };
      await saveJob(jobId, { status: 'done', result: JSON.stringify(result), state: '', runningSince: '' });
      return;
    }

    await saveJob(jobId, {
      step: nextStep,
      stage: nextStep,
      attempts: 0,
      state: JSON.stringify(nextState),
      queuedAt: nowIso(),
      runningSince: '',
    });
    await triggerBlogJobStep(jobId, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[blogJob] ${jobId} step ${step} failed (attempt ${attempts + 1}):`, message);
    if (attempts + 1 < MAX_STEP_ATTEMPTS) {
      await saveJob(jobId, { attempts: attempts + 1, queuedAt: nowIso(), runningSince: '' });
      await triggerBlogJobStep(jobId, origin);
    } else {
      await saveJob(jobId, { status: 'error', error: `[${step}] ${message}`, runningSince: '' });
    }
  }
}

/** Status for the polling client; also recovers lost hand-offs and steps whose invocation died. */
export async function getBlogJobStatus(
  jobId: string,
  userId: string,
  origin: string,
): Promise<BlogJobStatus | null> {
  const job = await getFirestoreDocument(JOBS_COLLECTION, jobId);
  if (!job || job.userId !== userId) return null;

  let status = (job.status as BlogJobStatus['status']) ?? 'running';
  let error = job.status === 'error' ? job.error ?? 'Blog generation failed.' : undefined;
  let attempts = Number(job.attempts ?? '0') || 0;

  if (status === 'running') {
    const now = Date.now();
    const runningSince = Date.parse(job.runningSince ?? '') || 0;
    const queuedAt = Date.parse(job.queuedAt ?? '') || 0;

    if (!runningSince && queuedAt && now - queuedAt > UNCLAIMED_STEP_MS) {
      await saveJob(jobId, { queuedAt: nowIso() });
      await triggerBlogJobStep(jobId, origin);
    } else if (runningSince && now - runningSince > DEAD_STEP_MS) {
      attempts += 1;
      if (attempts >= MAX_STEP_ATTEMPTS) {
        status = 'error';
        error = 'This blog took longer than expected and was stopped. Please try again.';
        await saveJob(jobId, { status, error, runningSince: '' });
      } else {
        await saveJob(jobId, { attempts, queuedAt: nowIso(), runningSince: '' });
        await triggerBlogJobStep(jobId, origin);
      }
    }
  }

  return {
    status,
    stage: job.stage ?? 'researching',
    attempts,
    skipGatheringReferences: job.skipGatheringReferences === 'true',
    result: status === 'done' && job.result ? (JSON.parse(job.result) as BlogJobResult) : undefined,
    error,
  };
}
