// GPT-6 Sol does not advertise temperature support on OpenRouter.
// Match the verified ID exactly; preserve existing settings for other models.
export function editorialSamplingParameters(model: string): { temperature?: number } {
  return model === 'openai/gpt-6-sol' ? {} : { temperature: 0.3 };
}
