export type OpenAIReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

const OPENAI_REASONING_EFFORT_VALUES = new Set<OpenAIReasoningEffort>([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
]);

export function normalizeOpenAIReasoningEffort(
  value: unknown,
  fallback: OpenAIReasoningEffort = "minimal",
): OpenAIReasoningEffort {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  return OPENAI_REASONING_EFFORT_VALUES.has(normalized as OpenAIReasoningEffort)
    ? (normalized as OpenAIReasoningEffort)
    : fallback;
}

export function openAIReasoningEffortForModel(
  model: string,
  configuredEffort: unknown = process.env.OPENAI_REASONING_EFFORT,
): OpenAIReasoningEffort {
  const effort = normalizeOpenAIReasoningEffort(configuredEffort);
  if (model.trim().toLowerCase().startsWith("gpt-5.5") && effort === "minimal") {
    return "low";
  }
  return effort;
}
