export const PROMPT_LIMIT = 4000;

export function promptFromParams(params: Pick<URLSearchParams, "get">): string {
  return Array.from(
    (params.get("prompt") || "")
      .replace(/\r\n/g, "\n")
      .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "")
      .trim(),
  ).slice(0, PROMPT_LIMIT).join("");
}

export function playgroundHref(options: { models?: string[]; prompt?: string }): string {
  const params = new URLSearchParams();
  const models = options.models?.filter(Boolean).join(",");
  if (models) params.set("models", models);
  if (options.prompt) params.set("prompt", options.prompt);
  const query = params.toString();
  return query ? `/playground?${query}` : "/playground";
}
