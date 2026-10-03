export type NewsCategory = "Models" | "Research" | "Industry" | "Tools";
export type Article = {
  id: string;
  title: string;
  description: string;
  url: string;
  source: string;
  publishedAt: string;
  category: NewsCategory;
  image?: string;
};
export type NewsData = {
  articles: Article[];
  fetchedAt: string;
  sources: { name: string; ok: boolean }[];
  fallback: boolean;
};
export type Model = {
  id: string;
  name: string;
  provider: string;
  description: string;
  contextLength: number;
  inputPrice: number;
  outputPrice: number;
  modalities: string[];
  maxOutput: number | null;
  created: number;
};
export type ModelsData = {
  models: Model[];
  fetchedAt: string;
  fallback: boolean;
};
export type ComparisonResult = {
  modelId: string;
  modelName: string;
  text?: string;
  error?: string;
  truncated?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  cost?: number;
  costType?: "reported" | "estimated";
  duration?: number;
  status: "waiting" | "complete" | "error";
};
