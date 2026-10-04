import {
  Asterisk,
  Sparkles,
  Orbit,
  Waves,
  CircleDot,
  Hexagon,
} from "@/components/icons";
export function ModelMark({
  provider,
  small = false,
}: {
  provider: string;
  small?: boolean;
}) {
  const Icon =
    provider === "anthropic"
      ? Asterisk
      : provider === "google"
        ? Sparkles
        : provider === "openai"
          ? Orbit
          : provider === "deepseek"
            ? Waves
            : provider === "meta-llama"
              ? CircleDot
              : Hexagon;
  return (
    <span
      aria-hidden="true"
      className={`model-mark ${small ? "small" : ""} provider-${provider}`}
    >
      <Icon size={small ? 24 : 32} />
    </span>
  );
}
export function providerName(provider: string) {
  return (
    (
      {
        anthropic: "Anthropic",
        openai: "OpenAI",
        google: "Google",
        "meta-llama": "Meta",
        deepseek: "DeepSeek",
        mistralai: "Mistral",
        qwen: "Qwen",
      } as Record<string, string>
    )[provider] || provider
  );
}
