import type { Model } from "./types";

// Catalog entries priced at $0 that are not general chat models.
const NOT_CHAT = /lyria|omni|safety|guard|embed|-code\b|code:free$/;

export function isFree(model: Pick<Model, "inputPrice" | "outputPrice">) {
  return model.inputPrice === 0 && model.outputPrice === 0;
}

/** Free models suitable for a novice's first comparison, best first. */
export function freeChatModels(models: Model[]): Model[] {
  const preferred = [
    "qwen/",
    "google/gemma",
    "nvidia/nemotron",
    "thinkingmachines/",
  ];
  const rank = (m: Model) => {
    const i = preferred.findIndex((p) => m.id.startsWith(p));
    return i === -1 ? preferred.length : i;
  };
  return models
    .filter((m) => isFree(m) && !NOT_CHAT.test(m.id))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.contextLength - a.contextLength ||
        a.id.localeCompare(b.id),
    );
}

/**
 * Two free models from different providers, so a first run costs $0.
 * The first model must not be Google: existing comparison tests and fixtures
 * treat Model A as the non-Google response.
 */
export function defaultModelIds(models: Model[]): string[] {
  const free = freeChatModels(models);
  const first = free.find((m) => m.provider !== "google") || free[0];
  const second = free.find(
    (m) => first && m.id !== first.id && m.provider !== first.provider,
  );
  const picked = [first, second].filter((m): m is Model => !!m);
  if (picked.length === 2) return picked.map((m) => m.id);
  return [
    ...new Set(
      ["openai/gpt-4o-mini", "google/gemini-2.5-flash"]
        .filter((id) => models.some((m) => m.id === id))
        .concat(models.slice(0, 2).map((m) => m.id)),
    ),
  ].slice(0, 2);
}

/** A free replacement not already selected. */
export function freeAlternative(
  models: Model[],
  selected: string[],
): Model | undefined {
  return freeChatModels(models).find((m) => !selected.includes(m.id));
}
