const XAI_MODEL = () => process.env.XAI_MODEL?.trim() || "grok-3-mini";

function toOpenAiMessages({ system, messages }) {
  const out = [];
  if (system) out.push({ role: "system", content: system });
  for (const item of messages || []) {
    const role = item.role === "assistant" ? "assistant" : "user";
    const content =
      typeof item.content === "string" ? item.content : String(item.content || " ").trim() || " ";
    out.push({ role, content });
  }
  return out.length ? out : [{ role: "user", content: " " }];
}

export async function grokCompleteChat({ apiKey, model, system, messages }) {
  if (!apiKey) {
    const error = new Error("Grok is not configured.");
    error.status = 500;
    throw error;
  }

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || XAI_MODEL(),
      messages: toOpenAiMessages({ system, messages }),
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(300_000),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.error || "Grok could not reply.";
    const error = new Error(typeof message === "string" ? message : "Grok could not reply.");
    error.status = response.status >= 400 && response.status < 600 ? response.status : 502;
    throw error;
  }

  const reply = String(data.choices?.[0]?.message?.content || "").trim();
  if (!reply) {
    const error = new Error("Grok returned an empty reply.");
    error.status = 502;
    throw error;
  }
  return reply;
}
