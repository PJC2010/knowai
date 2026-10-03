import type { Model, ComparisonResult } from "./types";

export const API = "https://openrouter.ai/api/v1";
export function estimateCost(model: Model, prompt: string, maxTokens: number) {
  return (
    (Math.ceil(prompt.length / 4) * model.inputPrice +
      maxTokens * model.outputPrice) /
    1e6
  );
}
export function apiError(status: number) {
  if (status === 401)
    return "Your key was not accepted. Reconnect your OpenRouter account.";
  if (status === 402)
    return "Your OpenRouter credits or key spending limit are too low. Add credits or adjust your key limit.";
  if (status === 429)
    return "This model is busy or rate-limited. Please try again shortly.";
  if (status === 404)
    return "This model is no longer available. Choose another model.";
  if (status === 403)
    return "Your account cannot access this model. Check your OpenRouter settings.";
  return "The provider could not complete this request. Try again or choose another model.";
}
export function parseCompletion(
  body: Record<string, any>,
  model: Model,
  duration: number,
): ComparisonResult {
  if (body.error) throw new Error(apiError(Number(body.error.code) || 502));
  const message = body.choices?.[0]?.message;
  const text =
    typeof message?.content === "string"
      ? message.content
      : Array.isArray(message?.content)
        ? message.content
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text)
            .join("\n")
        : message?.refusal;
  const usage = body.usage || {};
  const hasReportedCost =
    typeof usage.cost === "number" &&
    Number.isFinite(usage.cost) &&
    usage.cost >= 0;
  const inputTokens =
    typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  const outputTokens =
    typeof usage.completion_tokens === "number"
      ? usage.completion_tokens
      : undefined;
  const estimate =
    inputTokens !== undefined && outputTokens !== undefined
      ? (inputTokens * model.inputPrice + outputTokens * model.outputPrice) /
        1e6
      : undefined;
  const error = !text
    ? "This model returned no visible text. Try a higher output limit or another model. Any reported charge is shown below."
    : undefined;
  return {
    modelId: model.id,
    modelName: model.name,
    text,
    error,
    truncated: body.choices?.[0]?.finish_reason === "length",
    inputTokens,
    outputTokens,
    cost: hasReportedCost ? usage.cost : estimate,
    costType: hasReportedCost
      ? "reported"
      : estimate !== undefined
        ? "estimated"
        : undefined,
    duration,
    status: error ? "error" : "complete",
  };
}
export async function complete(
  key: string,
  model: Model,
  prompt: string,
  maxTokens: number,
  signal: AbortSignal,
): Promise<ComparisonResult> {
  const started = performance.now();
  const response = await fetch(`${API}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": window.location.origin,
      "X-OpenRouter-Title": "knowai",
    },
    body: JSON.stringify({
      model: model.id,
      messages: [{ role: "user", content: prompt }],
      max_tokens: Math.min(maxTokens, model.maxOutput || maxTokens),
      stream: false,
    }),
    signal,
  });
  if (!response.ok) throw new Error(apiError(response.status));
  return parseCompletion(
    await response.json(),
    model,
    (performance.now() - started) / 1000,
  );
}
