import type { BriefStory } from "./brief";

export const PROMPT_LIMIT = 4000;

export function storyPrompt(story: Pick<BriefStory, "one_liner" | "short_version" | "source_name">): string {
  return `I just read this AI news summary from knowai (source: ${story.source_name}):\n\n"${story.one_liner} ${story.short_version}"\n\nIn plain English:\n1. What does this change for an ordinary person or small business?\n2. What questions should I ask before believing or acting on it?\n3. What, if anything, here might be overstated or uncertain?\nKeep it under 200 words.`;
}

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
