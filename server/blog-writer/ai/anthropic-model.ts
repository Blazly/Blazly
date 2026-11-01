import type { Genkit, GenerateRequest, GenerateResponseData, MessageData } from 'genkit';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_OUTPUT_TOKENS = 32000;
const REQUEST_TIMEOUT_MS = 540_000;

export const CLAUDE_OPUS_MODEL_ID = process.env.ANTHROPIC_MODEL?.trim() || 'claude-opus-5-5';
export const CLAUDE_OPUS_GENKIT_MODEL = `anthropic/${CLAUDE_OPUS_MODEL_ID}` as const;

/** @deprecated Blog writing no longer uses Sonnet; classifier may use ANTHROPIC_BLOG_MODEL in modelRouter. */
export const CLAUDE_BLOG_MODEL_ID = CLAUDE_OPUS_MODEL_ID;
export const CLAUDE_BLOG_MODEL = CLAUDE_OPUS_GENKIT_MODEL;

export function isClaudeConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY?.trim();
}

type AnthropicMessage = { role: 'user' | 'assistant'; content: string };

function textOf(message: MessageData): string {
  return message.content
    .map((part) => part.text ?? '')
    .join('')
    .trim();
}

function toAnthropicMessages(messages: MessageData[]): { system: string; messages: AnthropicMessage[] } {
  const systemParts: string[] = [];
  const out: AnthropicMessage[] = [];

  for (const message of messages) {
    const text = textOf(message);
    if (!text) continue;
    if (message.role === 'system') {
      systemParts.push(text);
      continue;
    }
    const role: AnthropicMessage['role'] = message.role === 'model' ? 'assistant' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n\n${text}`;
    else out.push({ role, content: text });
  }

  if (out.length === 0 || out[0].role !== 'user') out.unshift({ role: 'user', content: 'Begin.' });
  return { system: systemParts.join('\n\n'), messages: out };
}

function finishReasonOf(stopReason: string | undefined): GenerateResponseData['finishReason'] {
  if (stopReason === 'max_tokens') return 'length';
  if (stopReason === 'refusal') return 'blocked';
  return 'stop';
}

function modelIdFromRequest(request: GenerateRequest): string {
  const name = String(request.model ?? '');
  if (name.startsWith('anthropic/')) return name.slice('anthropic/'.length);
  return CLAUDE_OPUS_MODEL_ID;
}

async function callClaude(request: GenerateRequest, modelId: string): Promise<GenerateResponseData> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error('Claude is not configured (ANTHROPIC_API_KEY missing).');

  const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  const { system, messages } = toAnthropicMessages(request.messages);
  const config = (request.config ?? {}) as { maxOutputTokens?: number };

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      ...(workspaceId ? { 'anthropic-workspace-id': workspaceId } : {}),
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      ...(system ? { system } : {}),
      messages,
    }),
  });

  const body = (await response.json().catch(() => null)) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
    error?: { type?: string; message?: string };
  } | null;

  if (!response.ok || !body) {
    const detail = body?.error?.message || response.statusText || 'Unknown error';
    throw new Error(`Claude request failed (${response.status} ${body?.error?.type ?? ''}): ${detail}`);
  }

  const text = (body.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('');

  return {
    message: { role: 'model', content: [{ text }] },
    finishReason: finishReasonOf(body.stop_reason),
    usage: {
      inputTokens: body.usage?.input_tokens,
      outputTokens: body.usage?.output_tokens,
    },
  };
}

export function registerClaudeModel(ai: Genkit): void {
  ai.defineModel(
    {
      name: CLAUDE_OPUS_GENKIT_MODEL,
      label: `Anthropic - ${CLAUDE_OPUS_MODEL_ID}`,
      supports: {
        multiturn: true,
        systemRole: true,
        media: false,
        tools: false,
        output: ['text', 'json'],
      },
    },
    async (request) => callClaude(request, modelIdFromRequest(request)),
  );
}
