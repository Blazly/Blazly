import { ai } from './genkit';
import type { z } from 'zod';

type GenkitAi = typeof ai;

const globalRegistry = globalThis as typeof globalThis & {
  __blazlyGenkitDefs?: Map<string, unknown>;
};

function getOrCreate<T>(key: string, factory: () => T): T {
  if (!globalRegistry.__blazlyGenkitDefs) {
    globalRegistry.__blazlyGenkitDefs = new Map();
  }
  const existing = globalRegistry.__blazlyGenkitDefs.get(key);
  if (existing) return existing as T;
  const created = factory();
  globalRegistry.__blazlyGenkitDefs.set(key, created);
  return created;
}

function nameFromConfig(
  config: string | { name?: string },
  fallback: string,
): string {
  return typeof config === 'string' ? config : config.name ?? fallback;
}

/** Register a Genkit prompt once — safe across Next.js hot reloads. */
export function definePromptOnce(...args: Parameters<GenkitAi['definePrompt']>) {
  const name = nameFromConfig(args[0], 'anonymousPrompt');
  return getOrCreate(`prompt:${name}`, () => ai.definePrompt(...args));
}

type FlowConfig<I extends z.ZodTypeAny, O extends z.ZodTypeAny> = {
  name: string;
  inputSchema: I;
  outputSchema: O;
};

/** Register a Genkit flow once — safe across Next.js hot reloads. */
export function defineFlowOnce<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  config: FlowConfig<I, O>,
  handler: (input: z.infer<I>) => Promise<z.infer<O>> | z.infer<O>,
) {
  const name = nameFromConfig(config, 'anonymousFlow');
  return getOrCreate(`flow:${name}`, () => ai.defineFlow(config, handler));
}

/** Register a Genkit tool once — safe across Next.js hot reloads. */
export function defineToolOnce(...args: Parameters<GenkitAi['defineTool']>) {
  const name = nameFromConfig(args[0], 'anonymousTool');
  return getOrCreate(`tool:${name}`, () => ai.defineTool(...args));
}
