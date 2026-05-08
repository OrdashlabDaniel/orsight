import { normalizeFormId } from "@/lib/forms";

export type OpenAIPricingTier = "standard" | "batch" | "flex" | "priority";

export type OpenAITokenPrice = {
  inputPerMillionUsd: number;
  cachedInputPerMillionUsd: number | null;
  outputPerMillionUsd: number;
};

export type TrackedOpenAIUsage = {
  prompt_tokens?: number;
  cached_input_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  request_count?: number;
  openai_request_ids?: string[];
  client_request_ids?: string[];
  openai_project_id?: string | null;
  openai_api_key_id?: string | null;
  service_tier?: string | null;
  pricing_tier?: OpenAIPricingTier;
  openai_endpoint?: string;
};

export type OpenAIRequestTracking = {
  headers: Record<string, string>;
  clientRequestId: string;
  formId: string;
  openAIProjectId: string | null;
  openAIApiKeyId: string | null;
  pricingTier: OpenAIPricingTier;
  openAIEndpoint: string;
};

type RawUsagePayload = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  prompt_tokens_details?: {
    cached_tokens?: unknown;
  } | null;
};

type RawOpenAIPayload = {
  usage?: RawUsagePayload | null;
  service_tier?: unknown;
};

export const OPENAI_PRICING_BASIS_VERSION = "2026-05-02";

const OPENAI_FLAGSHIP_TOKEN_PRICING: Record<OpenAIPricingTier, Record<string, OpenAITokenPrice>> = {
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

function normalizeText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function normalizeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeTextMap(raw: string | undefined) {
  if (!raw) {
    return {} as Record<string, string>;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [normalizeFormId(key), normalizeText(value)] as const)
        .filter((entry): entry is [string, string] => Boolean(entry[0] && entry[1])),
    );
  } catch (error) {
    console.error("Failed to parse OpenAI accounting map JSON:", error);
    return {} as Record<string, string>;
  }
}

function resolvePricingTier(serviceTier: string | null | undefined): OpenAIPricingTier {
  const normalized = (serviceTier || "").trim().toLowerCase();
  if (normalized === "priority") {
    return "priority";
  }
  if (normalized === "flex") {
    return "flex";
  }
  if (normalized === "batch") {
    return "batch";
  }
  return "standard";
}

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

export function estimateOpenAITokenCostUsd(input: {
  model: string | null | undefined;
  promptTokens?: number | null;
  cachedInputTokens?: number | null;
  completionTokens?: number | null;
  pricingTier?: OpenAIPricingTier | null;
}) {
  const tier = input.pricingTier || "standard";
  const rates =
    getOpenAIModelTokenPrice(input.model, tier) || getOpenAIModelTokenPrice("gpt-4o-mini", tier);
  if (!rates) {
    return 0;
  }

  const promptTokens = Math.max(0, Number(input.promptTokens || 0));
  const cachedInputTokens = Math.min(promptTokens, Math.max(0, Number(input.cachedInputTokens || 0)));
  const nonCachedInputTokens = Math.max(0, promptTokens - cachedInputTokens);
  const completionTokens = Math.max(0, Number(input.completionTokens || 0));

  const inputCost = (nonCachedInputTokens / 1_000_000) * rates.inputPerMillionUsd;
  const cachedInputCost =
    rates.cachedInputPerMillionUsd == null
      ? 0
      : (cachedInputTokens / 1_000_000) * rates.cachedInputPerMillionUsd;
  const outputCost = (completionTokens / 1_000_000) * rates.outputPerMillionUsd;

  return inputCost + cachedInputCost + outputCost;
}

export function resolveOpenAIProjectId(formId: string) {
  const normalizedFormId = normalizeFormId(formId);
  const scopedMap = normalizeTextMap(process.env.OPENAI_FORM_PROJECT_MAP_JSON);
  return scopedMap[normalizedFormId] || normalizeText(process.env.OPENAI_PROJECT_ID) || null;
}

export function resolveOpenAIApiKeyId(formId: string) {
  const normalizedFormId = normalizeFormId(formId);
  const scopedMap = normalizeTextMap(process.env.OPENAI_FORM_API_KEY_ID_MAP_JSON);
  return scopedMap[normalizedFormId] || normalizeText(process.env.OPENAI_API_KEY_ID) || null;
}

export function buildTrackedOpenAIHeaders(input: {
  apiKey: string;
  formId: string;
  endpoint?: string;
  serviceTier?: string | null;
  contentType?: string | null;
}) {
  const formId = normalizeFormId(input.formId);
  const clientRequestId = crypto.randomUUID();
  const openAIProjectId = resolveOpenAIProjectId(formId);
  const openAIApiKeyId = resolveOpenAIApiKeyId(formId);
  const contentType = normalizeText(input.contentType) || "application/json";
  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.apiKey}`,
    "Content-Type": contentType,
    "X-Client-Request-Id": clientRequestId,
  };

  if (openAIProjectId) {
    headers["OpenAI-Project"] = openAIProjectId;
  }

  return {
    headers,
    clientRequestId,
    formId,
    openAIProjectId,
    openAIApiKeyId,
    pricingTier: resolvePricingTier(input.serviceTier),
    openAIEndpoint: normalizeText(input.endpoint) || "/v1/chat/completions",
  } satisfies OpenAIRequestTracking;
}

export function extractTrackedOpenAIUsage(
  payload: unknown,
  response: Response,
  tracking: OpenAIRequestTracking,
): TrackedOpenAIUsage {
  const usage = ((payload as RawOpenAIPayload | null)?.usage || null) as RawUsagePayload | null;
  const serviceTier = normalizeText((payload as RawOpenAIPayload | null)?.service_tier);
  const openAIRequestId = normalizeText(response.headers.get("x-request-id"));

  return {
    prompt_tokens: normalizeNumber(usage?.prompt_tokens),
    cached_input_tokens: normalizeNumber(usage?.prompt_tokens_details?.cached_tokens),
    completion_tokens: normalizeNumber(usage?.completion_tokens),
    total_tokens: normalizeNumber(usage?.total_tokens),
    request_count: 1,
    openai_request_ids: openAIRequestId ? [openAIRequestId] : [],
    client_request_ids: tracking.clientRequestId ? [tracking.clientRequestId] : [],
    openai_project_id: tracking.openAIProjectId,
    openai_api_key_id: tracking.openAIApiKeyId,
    service_tier: serviceTier,
    pricing_tier: resolvePricingTier(serviceTier || tracking.pricingTier),
    openai_endpoint: tracking.openAIEndpoint,
  };
}

export function mergeTrackedOpenAIUsage(
  base: TrackedOpenAIUsage,
  add?: TrackedOpenAIUsage | null,
): TrackedOpenAIUsage {
  if (!add) {
    return base;
  }

  const openAIRequestIds = [...(base.openai_request_ids || []), ...(add.openai_request_ids || [])];
  const clientRequestIds = [...(base.client_request_ids || []), ...(add.client_request_ids || [])];
  const serviceTier = normalizeText(add.service_tier) || normalizeText(base.service_tier);

  return {
    prompt_tokens: normalizeNumber(base.prompt_tokens) + normalizeNumber(add.prompt_tokens),
    cached_input_tokens: normalizeNumber(base.cached_input_tokens) + normalizeNumber(add.cached_input_tokens),
    completion_tokens: normalizeNumber(base.completion_tokens) + normalizeNumber(add.completion_tokens),
    total_tokens: normalizeNumber(base.total_tokens) + normalizeNumber(add.total_tokens),
    request_count: Math.max(0, normalizeNumber(base.request_count)) + Math.max(0, normalizeNumber(add.request_count)),
    openai_request_ids: [...new Set(openAIRequestIds)],
    client_request_ids: [...new Set(clientRequestIds)],
    openai_project_id: normalizeText(base.openai_project_id) || normalizeText(add.openai_project_id),
    openai_api_key_id: normalizeText(base.openai_api_key_id) || normalizeText(add.openai_api_key_id),
    service_tier: serviceTier,
    pricing_tier: serviceTier ? resolvePricingTier(serviceTier) : add.pricing_tier || base.pricing_tier || "standard",
    openai_endpoint: normalizeText(base.openai_endpoint) || normalizeText(add.openai_endpoint) || "/v1/chat/completions",
  };
}
