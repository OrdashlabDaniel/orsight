export const TOKEN_PRICING: Record<
  string,
  { prompt: number; completion: number }
> = {
  "gpt-4o-mini": { prompt: 0.00015 / 1000, completion: 0.0006 / 1000 },
  "gpt-4o": { prompt: 0.005 / 1000, completion: 0.015 / 1000 },
  "gpt-5-mini": { prompt: 0.00015 / 1000, completion: 0.0006 / 1000 },
  "gpt-5": { prompt: 0.005 / 1000, completion: 0.015 / 1000 },
};

export type UsageLogLike = {
  id?: string;
  action_type?: string | null;
  user_id: string;
  image_count?: number | null;
  total_tokens?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  model_used?: string | null;
  created_at?: string | null;
};

export function estimateLogCostUsd(
  log: Pick<UsageLogLike, "model_used" | "prompt_tokens" | "completion_tokens">,
): number {
  const model = (log.model_used || "gpt-4o-mini") as keyof typeof TOKEN_PRICING;
  const rates = TOKEN_PRICING[model] || TOKEN_PRICING["gpt-4o-mini"];
  return (log.prompt_tokens || 0) * rates.prompt + (log.completion_tokens || 0) * rates.completion;
}

export function aggregateUsageLogs(logs: UsageLogLike[]) {
  let totalImages = 0;
  let totalTokens = 0;
  let totalCost = 0;

  for (const log of logs) {
    totalImages += log.image_count || 0;
    totalTokens += log.total_tokens || 0;
    totalCost += estimateLogCostUsd(log);
  }

  const uniqueActiveUsers = new Set(logs.map((l) => l.user_id)).size;

  return {
    totalImages,
    totalTokens,
    totalCost,
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
