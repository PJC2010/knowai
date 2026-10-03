import type { Model } from "./types";
export function featuredModels(models: Model[]): Model[] {
  return ["anthropic", "openai", "google", "deepseek"].flatMap((provider) => {
    const matches = models.filter(
      (m) =>
        m.provider === provider &&
        !m.id.includes(":") &&
        !/preview|exp|pro$/.test(m.id),
    );
    return (
      matches.find((m) =>
        /sonnet|gpt-6\.1-sol$|gemini.*flash$|deepseek.*flash$/.test(m.id),
      ) ||
      matches[0] ||
      []
    );
  });
}
