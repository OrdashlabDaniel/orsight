export type OpenAIPricingTier = "standard" | "batch" | "flex" | "priority";

export type OpenAITokenPrice = {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number | null;
  outputPerMillionUsd: number;
};

export type OpenAIToolPrice = {
  label: string;
  price: string;
};

export const OPENAI_PRICING_BASIS_VERSION = "2026-05-02";
export const OPENAI_PRICING_BASIS_SOURCE =
  "User-provided OpenAI pricing snapshot captured on 2026-05-02 and retained as a local accounting basis.";

export const OPENAI_FLAGSHIP_TOKEN_PRICING: Record<
  OpenAIPricingTier,
  Record<string, OpenAITokenPrice>
> = {
  standard: {
    "gpt-5.5": { inputPerMillionUsd: 5, cachedInputPerMillionUsd: 0.5, outputPerMillionUsd: 30 },
    "gpt-5.5-pro": { inputPerMillionUsd: 30, cachedInputPerMillionUsd: null, outputPerMillionUsd: 180 },
    "gpt-5.4": { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 0.25, outputPerMillionUsd: 15 },
    "gpt-5.4-mini": { inputPerMillionUsd: 0.75, cachedInputPerMillionUsd: 0.075, outputPerMillionUsd: 4.5 },
    "gpt-5.4-nano": { inputPerMillionUsd: 0.2, cachedInputPerMillionUsd: 0.02, outputPerMillionUsd: 1.25 },
    "gpt-5.4-pro": { inputPerMillionUsd: 30, cachedInputPerMillionUsd: null, outputPerMillionUsd: 180 },
    "gpt-5.2": { inputPerMillionUsd: 1.75, cachedInputPerMillionUsd: 0.175, outputPerMillionUsd: 14 },
    "gpt-5.2-pro": { inputPerMillionUsd: 21, cachedInputPerMillionUsd: null, outputPerMillionUsd: 168 },
    "gpt-5.1": { inputPerMillionUsd: 1.25, cachedInputPerMillionUsd: 0.125, outputPerMillionUsd: 10 },
    "gpt-5": { inputPerMillionUsd: 1.25, cachedInputPerMillionUsd: 0.125, outputPerMillionUsd: 10 },
    "gpt-5-mini": { inputPerMillionUsd: 0.25, cachedInputPerMillionUsd: 0.025, outputPerMillionUsd: 2 },
    "gpt-5-nano": { inputPerMillionUsd: 0.05, cachedInputPerMillionUsd: 0.005, outputPerMillionUsd: 0.4 },
    "gpt-5-pro": { inputPerMillionUsd: 15, cachedInputPerMillionUsd: null, outputPerMillionUsd: 120 },
    "gpt-4.1": { inputPerMillionUsd: 2, cachedInputPerMillionUsd: 0.5, outputPerMillionUsd: 8 },
    "gpt-4.1-mini": { inputPerMillionUsd: 0.4, cachedInputPerMillionUsd: 0.1, outputPerMillionUsd: 1.6 },
    "gpt-4.1-nano": { inputPerMillionUsd: 0.1, cachedInputPerMillionUsd: 0.025, outputPerMillionUsd: 0.4 },
    "gpt-4o": { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 1.25, outputPerMillionUsd: 10 },
    "gpt-4o-2024-05-13": { inputPerMillionUsd: 5, cachedInputPerMillionUsd: null, outputPerMillionUsd: 15 },
    "gpt-4o-mini": { inputPerMillionUsd: 0.15, cachedInputPerMillionUsd: 0.075, outputPerMillionUsd: 0.6 },
    o1: { inputPerMillionUsd: 15, cachedInputPerMillionUsd: 7.5, outputPerMillionUsd: 60 },
    "o1-pro": { inputPerMillionUsd: 150, cachedInputPerMillionUsd: null, outputPerMillionUsd: 600 },
    "o3-pro": { inputPerMillionUsd: 20, cachedInputPerMillionUsd: null, outputPerMillionUsd: 80 },
    o3: { inputPerMillionUsd: 2, cachedInputPerMillionUsd: 0.5, outputPerMillionUsd: 8 },
    "o4-mini": { inputPerMillionUsd: 1.1, cachedInputPerMillionUsd: 0.275, outputPerMillionUsd: 4.4 },
    "o3-mini": { inputPerMillionUsd: 1.1, cachedInputPerMillionUsd: 0.55, outputPerMillionUsd: 4.4 },
    "o1-mini": { inputPerMillionUsd: 1.1, cachedInputPerMillionUsd: 0.55, outputPerMillionUsd: 4.4 },
    "gpt-4-turbo-2024-04-09": { inputPerMillionUsd: 10, cachedInputPerMillionUsd: null, outputPerMillionUsd: 30 },
    "gpt-4-0125-preview": { inputPerMillionUsd: 10, cachedInputPerMillionUsd: null, outputPerMillionUsd: 30 },
    "gpt-4-1106-preview": { inputPerMillionUsd: 10, cachedInputPerMillionUsd: null, outputPerMillionUsd: 30 },
    "gpt-4-1106-vision-preview": {
      inputPerMillionUsd: 10,
      cachedInputPerMillionUsd: null,
      outputPerMillionUsd: 30,
    },
    "gpt-4-0613": { inputPerMillionUsd: 30, cachedInputPerMillionUsd: null, outputPerMillionUsd: 60 },
    "gpt-4-0314": { inputPerMillionUsd: 30, cachedInputPerMillionUsd: null, outputPerMillionUsd: 60 },
    "gpt-4-32k": { inputPerMillionUsd: 60, cachedInputPerMillionUsd: null, outputPerMillionUsd: 120 },
    "gpt-3.5-turbo": { inputPerMillionUsd: 0.5, cachedInputPerMillionUsd: null, outputPerMillionUsd: 1.5 },
    "gpt-3.5-turbo-0125": { inputPerMillionUsd: 0.5, cachedInputPerMillionUsd: null, outputPerMillionUsd: 1.5 },
    "gpt-3.5-turbo-1106": { inputPerMillionUsd: 1, cachedInputPerMillionUsd: null, outputPerMillionUsd: 2 },
    "gpt-3.5-turbo-0613": { inputPerMillionUsd: 1.5, cachedInputPerMillionUsd: null, outputPerMillionUsd: 2 },
    "gpt-3.5-0301": { inputPerMillionUsd: 1.5, cachedInputPerMillionUsd: null, outputPerMillionUsd: 2 },
    "gpt-3.5-turbo-instruct": { inputPerMillionUsd: 1.5, cachedInputPerMillionUsd: null, outputPerMillionUsd: 2 },
    "gpt-3.5-turbo-16k-0613": { inputPerMillionUsd: 3, cachedInputPerMillionUsd: null, outputPerMillionUsd: 4 },
    "davinci-002": { inputPerMillionUsd: 2, cachedInputPerMillionUsd: null, outputPerMillionUsd: 2 },
    "babbage-002": { inputPerMillionUsd: 0.4, cachedInputPerMillionUsd: null, outputPerMillionUsd: 0.4 },
  },
  batch: {
    "gpt-5.5": { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 0.25, outputPerMillionUsd: 15 },
    "gpt-5.5-pro": { inputPerMillionUsd: 15, cachedInputPerMillionUsd: null, outputPerMillionUsd: 90 },
    "gpt-5.4": { inputPerMillionUsd: 1.25, cachedInputPerMillionUsd: 0.13, outputPerMillionUsd: 7.5 },
    "gpt-5.4-mini": { inputPerMillionUsd: 0.375, cachedInputPerMillionUsd: 0.0375, outputPerMillionUsd: 2.25 },
    "gpt-5.4-nano": { inputPerMillionUsd: 0.1, cachedInputPerMillionUsd: 0.01, outputPerMillionUsd: 0.625 },
    "gpt-5.4-pro": { inputPerMillionUsd: 15, cachedInputPerMillionUsd: null, outputPerMillionUsd: 90 },
    "gpt-5.2": { inputPerMillionUsd: 0.875, cachedInputPerMillionUsd: 0.0875, outputPerMillionUsd: 7 },
    "gpt-5.2-pro": { inputPerMillionUsd: 10.5, cachedInputPerMillionUsd: null, outputPerMillionUsd: 84 },
    "gpt-5.1": { inputPerMillionUsd: 0.625, cachedInputPerMillionUsd: 0.0625, outputPerMillionUsd: 5 },
    "gpt-5": { inputPerMillionUsd: 0.625, cachedInputPerMillionUsd: 0.0625, outputPerMillionUsd: 5 },
    "gpt-5-mini": { inputPerMillionUsd: 0.125, cachedInputPerMillionUsd: 0.0125, outputPerMillionUsd: 1 },
    "gpt-5-nano": { inputPerMillionUsd: 0.025, cachedInputPerMillionUsd: 0.0025, outputPerMillionUsd: 0.2 },
    "gpt-5-pro": { inputPerMillionUsd: 7.5, cachedInputPerMillionUsd: null, outputPerMillionUsd: 60 },
    "gpt-4.1": { inputPerMillionUsd: 1, cachedInputPerMillionUsd: null, outputPerMillionUsd: 4 },
    "gpt-4.1-mini": { inputPerMillionUsd: 0.2, cachedInputPerMillionUsd: null, outputPerMillionUsd: 0.8 },
    "gpt-4.1-nano": { inputPerMillionUsd: 0.05, cachedInputPerMillionUsd: null, outputPerMillionUsd: 0.2 },
    "gpt-4o": { inputPerMillionUsd: 1.25, cachedInputPerMillionUsd: null, outputPerMillionUsd: 5 },
    "gpt-4o-2024-05-13": { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: null, outputPerMillionUsd: 7.5 },
    "gpt-4o-mini": { inputPerMillionUsd: 0.075, cachedInputPerMillionUsd: null, outputPerMillionUsd: 0.3 },
    o1: { inputPerMillionUsd: 7.5, cachedInputPerMillionUsd: null, outputPerMillionUsd: 30 },
    "o1-pro": { inputPerMillionUsd: 75, cachedInputPerMillionUsd: null, outputPerMillionUsd: 300 },
    "o3-pro": { inputPerMillionUsd: 10, cachedInputPerMillionUsd: null, outputPerMillionUsd: 40 },
    o3: { inputPerMillionUsd: 1, cachedInputPerMillionUsd: null, outputPerMillionUsd: 4 },
    "o4-mini": { inputPerMillionUsd: 0.55, cachedInputPerMillionUsd: null, outputPerMillionUsd: 2.2 },
    "o3-mini": { inputPerMillionUsd: 0.55, cachedInputPerMillionUsd: null, outputPerMillionUsd: 2.2 },
    "o1-mini": { inputPerMillionUsd: 0.55, cachedInputPerMillionUsd: null, outputPerMillionUsd: 2.2 },
  },
  flex: {
    "gpt-5.5": { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 0.25, outputPerMillionUsd: 15 },
    "gpt-5.5-pro": { inputPerMillionUsd: 15, cachedInputPerMillionUsd: null, outputPerMillionUsd: 90 },
    "gpt-5.4": { inputPerMillionUsd: 1.25, cachedInputPerMillionUsd: 0.13, outputPerMillionUsd: 7.5 },
    "gpt-5.4-mini": { inputPerMillionUsd: 0.375, cachedInputPerMillionUsd: 0.0375, outputPerMillionUsd: 2.25 },
    "gpt-5.4-nano": { inputPerMillionUsd: 0.1, cachedInputPerMillionUsd: 0.01, outputPerMillionUsd: 0.625 },
    "gpt-5.4-pro": { inputPerMillionUsd: 15, cachedInputPerMillionUsd: null, outputPerMillionUsd: 90 },
    "gpt-5.2": { inputPerMillionUsd: 0.875, cachedInputPerMillionUsd: 0.0875, outputPerMillionUsd: 7 },
    "gpt-5.1": { inputPerMillionUsd: 0.625, cachedInputPerMillionUsd: 0.0625, outputPerMillionUsd: 5 },
    "gpt-5": { inputPerMillionUsd: 0.625, cachedInputPerMillionUsd: 0.0625, outputPerMillionUsd: 5 },
    "gpt-5-mini": { inputPerMillionUsd: 0.125, cachedInputPerMillionUsd: 0.0125, outputPerMillionUsd: 1 },
    "gpt-5-nano": { inputPerMillionUsd: 0.025, cachedInputPerMillionUsd: 0.0025, outputPerMillionUsd: 0.2 },
    o3: { inputPerMillionUsd: 1, cachedInputPerMillionUsd: 0.25, outputPerMillionUsd: 4 },
    "o4-mini": { inputPerMillionUsd: 0.55, cachedInputPerMillionUsd: 0.138, outputPerMillionUsd: 2.2 },
  },
  priority: {
    "gpt-5.5": { inputPerMillionUsd: 12.5, cachedInputPerMillionUsd: 1.25, outputPerMillionUsd: 75 },
    "gpt-5.4": { inputPerMillionUsd: 5, cachedInputPerMillionUsd: 0.5, outputPerMillionUsd: 30 },
    "gpt-5.4-mini": { inputPerMillionUsd: 1.5, cachedInputPerMillionUsd: 0.15, outputPerMillionUsd: 9 },
    "gpt-5.2": { inputPerMillionUsd: 3.5, cachedInputPerMillionUsd: 0.35, outputPerMillionUsd: 28 },
    "gpt-5.1": { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 0.25, outputPerMillionUsd: 20 },
    "gpt-5": { inputPerMillionUsd: 2.5, cachedInputPerMillionUsd: 0.25, outputPerMillionUsd: 20 },
    "gpt-5-mini": { inputPerMillionUsd: 0.45, cachedInputPerMillionUsd: 0.045, outputPerMillionUsd: 3.6 },
    "gpt-4.1": { inputPerMillionUsd: 3.5, cachedInputPerMillionUsd: 0.875, outputPerMillionUsd: 14 },
    "gpt-4.1-mini": { inputPerMillionUsd: 0.7, cachedInputPerMillionUsd: 0.175, outputPerMillionUsd: 2.8 },
    "gpt-4.1-nano": { inputPerMillionUsd: 0.2, cachedInputPerMillionUsd: 0.05, outputPerMillionUsd: 0.8 },
    "gpt-4o": { inputPerMillionUsd: 4.25, cachedInputPerMillionUsd: 2.125, outputPerMillionUsd: 17 },
    "gpt-4o-2024-05-13": { inputPerMillionUsd: 8.75, cachedInputPerMillionUsd: null, outputPerMillionUsd: 26.25 },
    "gpt-4o-mini": { inputPerMillionUsd: 0.25, cachedInputPerMillionUsd: 0.125, outputPerMillionUsd: 1 },
    o3: { inputPerMillionUsd: 3.5, cachedInputPerMillionUsd: 0.875, outputPerMillionUsd: 14 },
    "o4-mini": { inputPerMillionUsd: 2, cachedInputPerMillionUsd: 0.5, outputPerMillionUsd: 8 },
  },
};

export const OPENAI_TOOL_PRICING_REFERENCE: OpenAIToolPrice[] = [
  {
    label: "Web search preview (reasoning models, including gpt-5, o-series)",
    price: "$10.00 / 1k calls + search content tokens billed at model rates",
  },
  {
    label: "Web search preview (non-reasoning models)",
    price: "$25.00 / 1k calls + search content tokens free",
  },
  {
    label: "Hosted Shell and Code Interpreter containers",
    price: "1 GB $0.03, 4 GB $0.12, 16 GB $0.48, 64 GB $1.92 per 20-minute session per container",
  },
  {
    label: "File search storage",
    price: "$0.10 / GB per day (1 GB free)",
  },
  {
    label: "File search tool call",
    price: "$2.50 / 1k calls",
  },
  {
    label: "Agent Kit file and image upload storage",
    price: "$0.10 / GB-day after 1 GB free per account per month",
  },
];

export function getOpenAIModelTokenPrice(
  model: string | null | undefined,
  tier: OpenAIPricingTier = "standard",
): OpenAITokenPrice | null {
  const normalized = (model || "").trim();
  if (!normalized) {
    return null;
  }
  return OPENAI_FLAGSHIP_TOKEN_PRICING[tier][normalized] || null;
}
