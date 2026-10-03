import snapshot from "@/data/models-snapshot.json";
import type { Model, ModelsData } from "./types";

export async function getModels(): Promise<ModelsData> {
  try {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error("Catalog unavailable");
    const { data } = await response.json();
    if (!Array.isArray(data)) throw new Error("Invalid catalog");
    const models: Model[] = data
      .filter(
        (m) =>
          m.architecture?.output_modalities?.includes("text") &&
          m.architecture?.input_modalities?.includes("text") &&
          !m.id.includes(":batch") &&
          !m.id.startsWith("openrouter/") &&
          !m.id.startsWith("~") &&
          Number(m.pricing?.prompt) >= 0 &&
          Number(m.pricing?.completion) >= 0,
      )
      .map((m) => ({
        id: m.id,
        name: m.name.replace(/^[^:]+: /, ""),
        provider: m.id.split("/")[0],
        description: m.description || "",
        contextLength: m.context_length,
        inputPrice: Number(m.pricing.prompt) * 1e6,
        outputPrice: Number(m.pricing.completion) * 1e6,
        modalities: m.architecture.input_modalities,
        maxOutput: m.top_provider?.max_completion_tokens ?? null,
        created: m.created,
      }));
    if (!models.length) throw new Error("Empty catalog");
    return { models, fetchedAt: new Date().toISOString(), fallback: false };
  } catch {
    return snapshot as ModelsData;
  }
}

export { featuredModels } from "./models-client";
