// GPT-6 Sol and GPT-6.1 Sol do not advertise temperature support on OpenRouter.
// Match the verified IDs exactly; preserve existing settings for other models.
export function editorialSamplingParameters(model: string): { temperature?: number } {
  return model === 'openai/gpt-6-sol' || model === 'openai/gpt-6.1-sol'
    ? {}
    : { temperature: 0.3 };
}
