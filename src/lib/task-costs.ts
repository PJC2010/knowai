import type { Model } from "./types";

export type TaskPreset = {
  id: string;
  label: string;
  inputTokens: number;
  outputTokens: number;
  samplePrompt: string;
};

export const taskPresets: TaskPreset[] = [
  { id: "email", label: "Summarize an email", inputTokens: 600, outputTokens: 120, samplePrompt: "Summarize this email in three bullet points and list any action items for me:\n\n[Paste an email here]" },
  { id: "support", label: "Answer a customer question", inputTokens: 1200, outputTokens: 250, samplePrompt: "You are a friendly support assistant for a small bakery. A customer asks: “Do you have gluten-free options, and can I order a cake for Saturday?” Write a helpful, honest reply." },
  { id: "article", label: "Draft a 1,000-word article", inputTokens: 300, outputTokens: 1400, samplePrompt: "Write a 1,000-word beginner’s article on starting a vegetable garden on a balcony. Use short sections with headings." },
  { id: "document", label: "Ask about a 20-page document", inputTokens: 12000, outputTokens: 400, samplePrompt: "Summarize this document’s main argument and list three questions it leaves unanswered:\n\n[Paste a document here]" },
  { id: "code", label: "Explain or fix some code", inputTokens: 1500, outputTokens: 600, samplePrompt: "Explain what this code does, line by line, and point out any bugs:\n\n[Paste code here]" },
];

export const DAYS_PER_MONTH = 30;

export function perUseCost(model: Pick<Model, "inputPrice" | "outputPrice">, preset: TaskPreset): number {
  return (preset.inputTokens * model.inputPrice + preset.outputTokens * model.outputPrice) / 1_000_000;
}

export function monthlyCost(model: Pick<Model, "inputPrice" | "outputPrice">, preset: TaskPreset, perDay: number): number {
  return perUseCost(model, preset) * perDay * DAYS_PER_MONTH;
}

export function clampPerDay(value: string | number): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(1, Math.min(10000, Math.round(number))) : 1;
}

// A context window includes both the prompt and its reply; an output cap is a separate limit.
function canHandle(model: Model, preset: TaskPreset): boolean {
  return Number.isFinite(model.inputPrice) && model.inputPrice >= 0
    && Number.isFinite(model.outputPrice) && model.outputPrice >= 0
    && Number.isFinite(model.contextLength) && model.contextLength >= preset.inputTokens + preset.outputTokens
    && (model.maxOutput === null || (Number.isFinite(model.maxOutput) && model.maxOutput >= preset.outputTokens));
}

export function cheapestPaid(models: Model[], preset: TaskPreset, count = 3): Model[] {
  return models
    .filter((model) => canHandle(model, preset) && (model.inputPrice > 0 || model.outputPrice > 0) && Number.isFinite(perUseCost(model, preset)))
    .sort((a, b) => perUseCost(a, preset) - perUseCost(b, preset) || a.name.localeCompare(b.name))
    .slice(0, count);
}

export function freeCapableCount(models: Model[], preset: TaskPreset): number {
  return models.filter((model) => canHandle(model, preset) && model.inputPrice === 0 && model.outputPrice === 0).length;
}

export function formatEstimate(value: number, floor: 0.01 | 0.0001): string {
  if (value === 0) return "Free";
  if (value > 0 && value < floor) return `<$${floor === 0.01 ? "0.01" : "0.0001"}`;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: floor === 0.01 ? 2 : 4,
    maximumFractionDigits: floor === 0.01 ? 2 : 4,
  }).format(value);
}
