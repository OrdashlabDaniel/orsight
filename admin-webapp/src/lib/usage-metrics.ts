import { getOpenAIModelTokenPrice } from "@/lib/openai-pricing-basis";

export type UsageLogLike = {
  id?: string;
  action_type?: string | null;
  user_id: string;
  form_id?: string | null;
  image_count?: number | null;
  request_count?: number | null;
  total_tokens?: number | null;
  prompt_tokens?: number | null;
  cached_input_tokens?: number | null;
  completion_tokens?: number | null;
  model_used?: string | null;
  openai_project_id?: string | null;
  openai_api_key_id?: string | null;
  service_tier?: string | null;
  pricing_tier?: string | null;
  openai_endpoint?: string | null;
  pricing_basis_version?: string | null;
  estimated_cost_usd?: number | null;
  conservative_cost_usd?: number | null;
  created_at?: string | null;
};

function normalizeMoney(value: number | null | undefined) {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) && normalized > 0 ? normalized : 0;
}

export function estimateLogCostUsd(
  log: Pick<UsageLogLike, "model_used" | "prompt_tokens" | "cached_input_tokens" | "completion_tokens">,
): number {
  const rates =
    getOpenAIModelTokenPrice(log.model_used || "gpt-4o-mini", "standard") ||
    getOpenAIModelTokenPrice("gpt-4o-mini", "standard");
  if (!rates) {
    return 0;
  }

  const promptTokens = Math.max(0, Number(log.prompt_tokens || 0));
  const cachedInputTokens = Math.min(promptTokens, Math.max(0, Number(log.cached_input_tokens || 0)));
  const nonCachedPromptTokens = Math.max(0, promptTokens - cachedInputTokens);
  const completionTokens = Math.max(0, Number(log.completion_tokens || 0));

  const promptCost = (nonCachedPromptTokens / 1_000_000) * rates.inputPerMillionUsd;
  const cachedPromptCost =
    rates.cachedInputPerMillionUsd == null
      ? 0
      : (cachedInputTokens / 1_000_000) * rates.cachedInputPerMillionUsd;
  const completionCost = (completionTokens / 1_000_000) * rates.outputPerMillionUsd;

  return promptCost + cachedPromptCost + completionCost;
}

export function estimatedLogCostUsd(
  log: Pick<
    UsageLogLike,
    "estimated_cost_usd" | "model_used" | "prompt_tokens" | "cached_input_tokens" | "completion_tokens"
  >,
) {
  return Math.max(normalizeMoney(log.estimated_cost_usd), estimateLogCostUsd(log));
}

export function conservativeLogCostUsd(
  log: Pick<
    UsageLogLike,
    | "conservative_cost_usd"
    | "estimated_cost_usd"
    | "model_used"
    | "prompt_tokens"
    | "cached_input_tokens"
    | "completion_tokens"
  >,
) {
  return Math.max(normalizeMoney(log.conservative_cost_usd), estimatedLogCostUsd(log));
}

export function aggregateUsageLogs(logs: UsageLogLike[]) {
  let totalImages = 0;
  let totalTokens = 0;
  let totalEstimatedCost = 0;
  let totalConservativeCost = 0;

  for (const log of logs) {
    totalImages += log.image_count || 0;
    totalTokens += log.total_tokens || 0;
    totalEstimatedCost += estimatedLogCostUsd(log);
    totalConservativeCost += conservativeLogCostUsd(log);
  }

  const uniqueActiveUsers = new Set(logs.map((l) => l.user_id)).size;

  return {
    totalImages,
    totalTokens,
    totalEstimatedCost,
    totalConservativeCost,
    totalCost: totalConservativeCost,
    uniqueActiveUsers,
    recordCount: logs.length,
  };
}

export function dailyTokenBuckets(logs: UsageLogLike[]) {
  const map = new Map<string, number>();
  for (const log of logs) {
    const raw = log.created_at;
    if (!raw) continue;
    const day = raw.slice(0, 10);
    map.set(day, (map.get(day) || 0) + (log.total_tokens || 0));
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, tokens]) => ({ date, tokens }));
}

export function modelTokenShares(logs: UsageLogLike[]) {
  const map = new Map<string, number>();
  for (const log of logs) {
    const m = log.model_used?.trim() || "unknown";
    map.set(m, (map.get(m) || 0) + (log.total_tokens || 0));
  }
  return [...map.entries()]
    .map(([name, tokens]) => ({ name, tokens }))
    .sort((a, b) => b.tokens - a.tokens);
}
