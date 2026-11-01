export type LlmErrorKind = "missing_key" | "quota" | "model" | "generic";

export function classifyLlmError(raw: string): LlmErrorKind {
  const msg = raw.trim();
  if (/api key|not configured|missing key|invalid.*key|401|403/i.test(msg)) return "missing_key";
  if (/quota|rate limit|429|resource exhausted/i.test(msg)) return "quota";
  if (/model|404|not found|unsupported/i.test(msg)) return "model";
  return "generic";
}

export function getUserFacingLlmErrorMessage(raw: string): string {
  const kind = classifyLlmError(raw);
  if (kind === "missing_key") return "AI is not configured. Add API keys in your environment.";
  if (kind === "quota") return "The AI service is busy or out of quota. Try again in a few minutes.";
  if (kind === "model") return "The AI model is unavailable. Try again or check model settings.";
  return raw.length > 200 ? `${raw.slice(0, 197)}…` : raw;
}
