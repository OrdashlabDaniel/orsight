import { buildAdminTimeRange, type AdminTimeRange, type AdminTimeRangeInput } from "@/lib/admin-time-range";
import { createAdminClient } from "@/lib/supabase/server";
import {
  getOpenAIModelTokenPrice,
  type OpenAIPricingTier,
} from "@/lib/openai-pricing-basis";
import { conservativeLogCostUsd, type UsageLogLike } from "@/lib/usage-metrics";

const OPENAI_ADMIN_BASE_URL = "https://api.openai.com/v1";
const OPENAI_SAFE_BUCKET_WINDOW_DAYS = 31;
const LOCAL_USAGE_PAGE_SIZE = 1000;
const LOCAL_USAGE_SELECT_LEGACY =
  "id,user_id,action_type,image_count,total_tokens,prompt_tokens,completion_tokens,model_used,created_at";
const LOCAL_USAGE_SELECT_BASE =
  `${LOCAL_USAGE_SELECT_LEGACY},form_id`;
const LOCAL_USAGE_SELECT_WITH_CACHE = LOCAL_USAGE_SELECT_BASE.replace(
  "completion_tokens",
  "cached_input_tokens,completion_tokens",
);
const LOCAL_USAGE_SELECT_FULL = LOCAL_USAGE_SELECT_WITH_CACHE.replace(
  "model_used,created_at,form_id",
  "model_used,request_count,openai_project_id,openai_api_key_id,service_tier,pricing_tier,openai_endpoint,pricing_basis_version,estimated_cost_usd,conservative_cost_usd,created_at,form_id",
);

type LocalUsageSchemaMode = "full" | "with_cache" | "with_form" | "legacy";

type LocalUsageQueryPlan = {
  mode: LocalUsageSchemaMode;
  select: string;
  supportsProjectFilter: boolean;
  supportsApiKeyFilter: boolean;
};

type FetchAllLocalUsageRowsResult = {
  rows: LocalUsageRow[];
  schemaMode: LocalUsageSchemaMode;
  projectFilterApplied: boolean;
  apiKeyFilterApplied: boolean;
};

const LOCAL_USAGE_QUERY_PLANS: LocalUsageQueryPlan[] = [
  { mode: "full", select: LOCAL_USAGE_SELECT_FULL, supportsProjectFilter: true, supportsApiKeyFilter: true },
  { mode: "with_cache", select: LOCAL_USAGE_SELECT_WITH_CACHE, supportsProjectFilter: false, supportsApiKeyFilter: false },
  { mode: "with_form", select: LOCAL_USAGE_SELECT_BASE, supportsProjectFilter: false, supportsApiKeyFilter: false },
  { mode: "legacy", select: LOCAL_USAGE_SELECT_LEGACY, supportsProjectFilter: false, supportsApiKeyFilter: false },
];

type OpenAICostBucketResponse = {
  object?: string;
  data?: Array<{
    object?: string;
    start_time?: number;
    end_time?: number;
    results?: Array<{
      object?: string;
      amount?: { value?: number | string; currency?: string };
      line_item?: string | null;
      project_id?: string | null;
      api_key_id?: string | null;
    }>;
  }>;
  has_more?: boolean;
  next_page?: string | null;
};

type OpenAICompletionsBucketResponse = {
  object?: string;
  data?: Array<{
    object?: string;
    start_time?: number;
    end_time?: number;
    results?: Array<{
      object?: string;
      input_tokens?: number;
      input_cached_tokens?: number;
      output_tokens?: number;
      num_model_requests?: number;
      project_id?: string | null;
      api_key_id?: string | null;
      model?: string | null;
      batch?: boolean | null;
      service_tier?: string | null;
    }>;
  }>;
  has_more?: boolean;
  next_page?: string | null;
};

type OpenAICostRow = {
  date: string;
  amountUsd: number;
  currency: string;
  lineItem: string | null;
  projectId: string | null;
  apiKeyId: string | null;
};

type OpenAICompletionsUsageRow = {
  date: string;
  model: string | null;
  projectId: string | null;
  apiKeyId: string | null;
  serviceTier: string | null;
  batch: boolean;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  requests: number;
  estimatedCostUsd: number;
};

type LocalUsageRow = UsageLogLike & {
  id: string;
  action_type: string | null;
  created_at: string | null;
};

export type OpenAIProjectSummary = {
  id: string;
  name: string;
  status: string;
};

type OpenAIProjectListResponse = {
  data?: Array<{
    id?: string;
    name?: string | null;
    status?: string | null;
  }>;
};

export type OpenAIReconciliationRange = AdminTimeRange;

export type AdminOpenAIReconciliationSnapshot = {
  enabled: boolean;
  warnings: string[];
  range: OpenAIReconciliationRange;
  syncedAtIso: string;
  officialCostUsd: number;
  officialUsageEstimatedCostUsd: number;
  localEstimatedCostUsd: number;
  varianceUsd: number;
  officialRequests: number;
  localEventCount: number;
  officialInputTokens: number;
  officialCachedInputTokens: number;
  officialOutputTokens: number;
  localPromptTokens: number;
  localCompletionTokens: number;
  localTotalTokens: number;
  tokenCoverageRatio: number | null;
  costCoverageRatio: number | null;
  daily: Array<{
    date: string;
    officialCostUsd: number;
    officialUsageEstimatedCostUsd: number;
    localEstimatedCostUsd: number;
    officialRequests: number;
    localEventCount: number;
    officialInputTokens: number;
    officialCachedInputTokens: number;
    officialOutputTokens: number;
    localPromptTokens: number;
    localCompletionTokens: number;
  }>;
  lineItems: Array<{
    lineItem: string;
    amountUsd: number;
  }>;
  modelComparison: Array<{
    model: string;
    tier: string;
    officialRequests: number;
    localEventCount: number;
    officialInputTokens: number;
    officialCachedInputTokens: number;
    officialOutputTokens: number;
    localPromptTokens: number;
    localCompletionTokens: number;
    officialUsageEstimatedCostUsd: number;
    localEstimatedCostUsd: number;
    costDeltaUsd: number;
    tokenDelta: number;
  }>;
  projectBreakdown: Array<{
    projectId: string;
    amountUsd: number;
  }>;
  apiKeyBreakdown: Array<{
    apiKeyId: string;
    amountUsd: number;
  }>;
};

type OpenAIAdminFilters = {
  projectIds?: string[];
  apiKeyIds?: string[];
};

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function differenceInUtcDays(start: Date, endExclusive: Date) {
  return Math.max(1, Math.round((endExclusive.getTime() - start.getTime()) / 86_400_000));
}

function listUtcDateLabels(range: OpenAIReconciliationRange) {
  const labels: string[] = [];
  for (
    let cursor = new Date(range.startIso);
    cursor < new Date(range.endIso);
    cursor = addUtcDays(cursor, 1)
  ) {
    labels.push(cursor.toISOString().slice(0, 10));
  }
  return labels;
}

function splitOpenAIQueryRanges(
  range: OpenAIReconciliationRange,
  maxDays: number = OPENAI_SAFE_BUCKET_WINDOW_DAYS,
): OpenAIReconciliationRange[] {
  const chunks: OpenAIReconciliationRange[] = [];
  const finalExclusiveEnd = new Date(range.endIso);

  for (
    let cursor = new Date(range.startIso);
    cursor < finalExclusiveEnd;
    cursor = addUtcDays(cursor, maxDays)
  ) {
    const chunkStart = new Date(cursor);
    const chunkExclusiveEnd = new Date(
      Math.min(addUtcDays(chunkStart, maxDays).getTime(), finalExclusiveEnd.getTime()),
    );
    const chunkInclusiveEnd = new Date(chunkExclusiveEnd.getTime() - 1);
    const startDateLabel = chunkStart.toISOString().slice(0, 10);
    const endDateLabel = chunkInclusiveEnd.toISOString().slice(0, 10);
    chunks.push({
      mode: "custom",
      days: differenceInUtcDays(chunkStart, chunkExclusiveEnd),
      startIso: chunkStart.toISOString(),
      endIso: chunkExclusiveEnd.toISOString(),
      startUnix: Math.floor(chunkStart.getTime() / 1000),
      endUnix: Math.floor(chunkExclusiveEnd.getTime() / 1000),
      startDateLabel,
      endDateLabel,
      rangeLabel: `${startDateLabel} to ${endDateLabel}`,
    });
  }

  return chunks;
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

function normalizeText(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function isMissingCachedInputTokensColumnMessage(message: string) {
  return /cached_input_tokens/i.test(message) && /(column|schema cache|does not exist)/i.test(message);
}

function isMissingExtendedUsageLogColumnsMessage(message: string) {
  return /(request_count|openai_project_id|openai_api_key_id|service_tier|pricing_tier|estimated_cost_usd|conservative_cost_usd|form_id)/i.test(
    message,
  ) && /(column|schema cache|does not exist)/i.test(message);
}

function isRetryableUsageLogSchemaMessage(message: string) {
  return isMissingExtendedUsageLogColumnsMessage(message) || isMissingCachedInputTokensColumnMessage(message);
}

function tierForUsageRow(row: Pick<OpenAICompletionsUsageRow, "batch" | "serviceTier">): OpenAIPricingTier {
  if (row.batch) {
    return "batch";
  }
  const serviceTier = (row.serviceTier || "").toLowerCase();
  if (serviceTier === "priority") {
    return "priority";
  }
  if (serviceTier === "flex") {
    return "flex";
  }
  return "standard";
}

function estimateOfficialUsageCost(row: OpenAICompletionsUsageRow) {
  const tier = tierForUsageRow(row);
  const rates =
    getOpenAIModelTokenPrice(row.model || "gpt-4o-mini", tier) ||
    getOpenAIModelTokenPrice("gpt-4o-mini", tier);
  if (!rates) {
    return 0;
  }

  const cachedInputTokens = Math.min(row.inputTokens, row.cachedInputTokens);
  const nonCachedInputTokens = Math.max(0, row.inputTokens - cachedInputTokens);
  const inputCost = (nonCachedInputTokens / 1_000_000) * rates.inputPerMillionUsd;
  const cachedInputCost =
    rates.cachedInputPerMillionUsd == null
      ? 0
      : (cachedInputTokens / 1_000_000) * rates.cachedInputPerMillionUsd;
  const outputCost = (row.outputTokens / 1_000_000) * rates.outputPerMillionUsd;

  return inputCost + cachedInputCost + outputCost;
}

async function openAIAdminGet<T>(
  path: string,
  query: Record<string, string | number | boolean | null | undefined | string[]>,
): Promise<T> {
  const adminKey = (process.env.OPENAI_ADMIN_KEY || "").trim();
  if (!adminKey) {
    throw new Error("Missing OPENAI_ADMIN_KEY. Create an OpenAI admin key and add it to admin-webapp/.env.local.");
  }

  const search = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue == null) {
      continue;
    }
    if (Array.isArray(rawValue)) {
      for (const item of rawValue) {
        search.append(key, item);
      }
      continue;
    }
    search.set(key, String(rawValue));
  }

  const response = await fetch(`${OPENAI_ADMIN_BASE_URL}${path}?${search.toString()}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${adminKey}`,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI ${path} failed (${response.status}): ${body.slice(0, 300)}`);
  }

  return (await response.json()) as T;
}

export async function listOpenAIProjects(): Promise<OpenAIProjectSummary[]> {
  if (!(process.env.OPENAI_ADMIN_KEY || "").trim()) {
    return [];
  }

  const payload: OpenAIProjectListResponse = await openAIAdminGet("/organization/projects", {
    limit: 100,
  });

  return (payload.data || [])
    .map((row) => ({
      id: String(row.id || "").trim(),
      name: String(row.name || row.id || "").trim(),
      status: String(row.status || "unknown").trim(),
    }))
    .filter((row) => row.id)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchAllCostRowsWithFilters(
  range: OpenAIReconciliationRange,
  filters: OpenAIAdminFilters,
): Promise<OpenAICostRow[]> {
  const rows: OpenAICostRow[] = [];
  for (const chunk of splitOpenAIQueryRanges(range)) {
    const payload: OpenAICostBucketResponse = await openAIAdminGet("/organization/costs", {
      start_time: chunk.startUnix,
      end_time: chunk.endUnix,
      bucket_width: "1d",
      limit: chunk.days,
      group_by: ["project_id", "line_item", "api_key_id"],
      project_ids: filters.projectIds,
      api_key_ids: filters.apiKeyIds,
    });

    if (payload.has_more) {
      throw new Error(
        `OpenAI /organization/costs returned unexpected paginated data for ${chunk.rangeLabel}.`,
      );
    }

    for (const bucket of payload.data || []) {
      const date = new Date(normalizeNumber(bucket.start_time) * 1000).toISOString().slice(0, 10);
      for (const result of bucket.results || []) {
        rows.push({
          date,
          amountUsd: normalizeNumber(result.amount?.value),
          currency: (result.amount?.currency || "usd").toLowerCase(),
          lineItem: normalizeText(result.line_item),
          projectId: normalizeText(result.project_id),
          apiKeyId: normalizeText(result.api_key_id),
        });
      }
    }
  }

  return rows;
}

async function fetchAllCompletionsUsageRows(
  range: OpenAIReconciliationRange,
  filters: OpenAIAdminFilters,
): Promise<OpenAICompletionsUsageRow[]> {
  const rows: OpenAICompletionsUsageRow[] = [];
  for (const chunk of splitOpenAIQueryRanges(range)) {
    const payload: OpenAICompletionsBucketResponse = await openAIAdminGet("/organization/usage/completions", {
      start_time: chunk.startUnix,
      end_time: chunk.endUnix,
      bucket_width: "1d",
      limit: chunk.days,
      group_by: ["project_id", "api_key_id", "model", "service_tier", "batch"],
      project_ids: filters.projectIds,
      api_key_ids: filters.apiKeyIds,
    });

    if (payload.has_more) {
      throw new Error(
        `OpenAI /organization/usage/completions returned unexpected paginated data for ${chunk.rangeLabel}.`,
      );
    }

    for (const bucket of payload.data || []) {
      const date = new Date(normalizeNumber(bucket.start_time) * 1000).toISOString().slice(0, 10);
      for (const result of bucket.results || []) {
        const row: OpenAICompletionsUsageRow = {
          date,
          model: normalizeText(result.model),
          projectId: normalizeText(result.project_id),
          apiKeyId: normalizeText(result.api_key_id),
          serviceTier: normalizeText(result.service_tier),
          batch: Boolean(result.batch),
          inputTokens: normalizeNumber(result.input_tokens),
          cachedInputTokens: normalizeNumber(result.input_cached_tokens),
          outputTokens: normalizeNumber(result.output_tokens),
          requests: normalizeNumber(result.num_model_requests),
          estimatedCostUsd: 0,
        };
        row.estimatedCostUsd = estimateOfficialUsageCost(row);
        rows.push(row);
      }
    }
  }

  return rows;
}

function normalizeLocalUsageRow(row: Partial<LocalUsageRow>): LocalUsageRow {
  return {
    id: String(row.id || ""),
    user_id: String(row.user_id || ""),
    form_id: typeof row.form_id === "string" ? row.form_id : null,
    action_type: typeof row.action_type === "string" ? row.action_type : null,
    image_count: typeof row.image_count === "number" ? row.image_count : row.image_count ?? null,
    request_count: typeof row.request_count === "number" ? row.request_count : row.request_count ?? null,
    total_tokens: typeof row.total_tokens === "number" ? row.total_tokens : row.total_tokens ?? null,
    prompt_tokens: typeof row.prompt_tokens === "number" ? row.prompt_tokens : row.prompt_tokens ?? null,
    cached_input_tokens:
      typeof row.cached_input_tokens === "number" ? row.cached_input_tokens : row.cached_input_tokens ?? null,
    completion_tokens:
      typeof row.completion_tokens === "number" ? row.completion_tokens : row.completion_tokens ?? null,
    model_used: typeof row.model_used === "string" ? row.model_used : null,
    openai_project_id: typeof row.openai_project_id === "string" ? row.openai_project_id : null,
    openai_api_key_id: typeof row.openai_api_key_id === "string" ? row.openai_api_key_id : null,
    service_tier: typeof row.service_tier === "string" ? row.service_tier : null,
    pricing_tier: typeof row.pricing_tier === "string" ? row.pricing_tier : null,
    openai_endpoint: typeof row.openai_endpoint === "string" ? row.openai_endpoint : null,
    pricing_basis_version: typeof row.pricing_basis_version === "string" ? row.pricing_basis_version : null,
    estimated_cost_usd:
      typeof row.estimated_cost_usd === "number" ? row.estimated_cost_usd : row.estimated_cost_usd ?? null,
    conservative_cost_usd:
      typeof row.conservative_cost_usd === "number" ? row.conservative_cost_usd : row.conservative_cost_usd ?? null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
  };
}

async function fetchAllLocalUsageRows(
  range: OpenAIReconciliationRange,
  filters: OpenAIAdminFilters,
): Promise<FetchAllLocalUsageRowsResult> {
  const sb = await createAdminClient();
  const rows: LocalUsageRow[] = [];
  let activePlanIndex = 0;
  let activePlan = LOCAL_USAGE_QUERY_PLANS[0]!;

  for (let start = 0; ; start += LOCAL_USAGE_PAGE_SIZE) {
    let pageRows: Partial<LocalUsageRow>[] | null = null;
    let lastSchemaError: string | null = null;

    for (let planIndex = activePlanIndex; planIndex < LOCAL_USAGE_QUERY_PLANS.length; planIndex += 1) {
      const plan = LOCAL_USAGE_QUERY_PLANS[planIndex]!;
      let query = sb
        .from("usage_logs")
        .select(plan.select)
        .neq("action_type", "billing_reservation")
        .gte("created_at", range.startIso)
        .lt("created_at", range.endIso)
        .order("created_at", { ascending: false })
        .range(start, start + LOCAL_USAGE_PAGE_SIZE - 1);

      if (filters.projectIds?.length === 1 && plan.supportsProjectFilter) {
        query = query.eq("openai_project_id", filters.projectIds[0]!);
      }
      if (filters.apiKeyIds?.length === 1 && plan.supportsApiKeyFilter) {
        query = query.eq("openai_api_key_id", filters.apiKeyIds[0]!);
      }

      const result = await query;
      if (!result.error) {
        pageRows = result.data as Partial<LocalUsageRow>[] | null;
        activePlanIndex = planIndex;
        activePlan = plan;
        break;
      }

      if (!isRetryableUsageLogSchemaMessage(result.error.message)) {
        throw new Error(`usage_logs: ${result.error.message}`);
      }

      lastSchemaError = result.error.message;
    }

    if (!pageRows) {
      throw new Error(`usage_logs: ${lastSchemaError || "No compatible usage_logs schema was found."}`);
    }

    const normalizedRows = ((pageRows ?? []) as Partial<LocalUsageRow>[]).map(normalizeLocalUsageRow);
    rows.push(...normalizedRows);

    if (normalizedRows.length < LOCAL_USAGE_PAGE_SIZE) {
      break;
    }
  }

  return {
    rows,
    schemaMode: activePlan.mode,
    projectFilterApplied: !(filters.projectIds?.length === 1) || activePlan.supportsProjectFilter,
    apiKeyFilterApplied: !(filters.apiKeyIds?.length === 1) || activePlan.supportsApiKeyFilter,
  };
}

function sumBy<T>(items: T[], getter: (item: T) => number) {
  return items.reduce((sum, item) => sum + getter(item), 0);
}

function ratio(numerator: number, denominator: number) {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return numerator / denominator;
}

function topEntries(map: Map<string, number>, label: string) {
  return [...map.entries()]
    .map(([key, amountUsd]) => ({
      [label]: key,
      amountUsd,
    }))
    .sort((a, b) => b.amountUsd - a.amountUsd);
}

export async function loadAdminOpenAIReconciliationSnapshot(
  rangeInput: AdminTimeRangeInput,
  filters: OpenAIAdminFilters = {},
): Promise<AdminOpenAIReconciliationSnapshot> {
  const range = buildAdminTimeRange(rangeInput);
  const warnings: string[] = [];

  if (!(process.env.OPENAI_ADMIN_KEY || "").trim()) {
    return {
      enabled: false,
      warnings: [
        "Missing OPENAI_ADMIN_KEY. Create an OpenAI admin key from the OpenAI admin console and add it to admin-webapp/.env.local.",
      ],
      range,
      syncedAtIso: new Date().toISOString(),
      officialCostUsd: 0,
      officialUsageEstimatedCostUsd: 0,
      localEstimatedCostUsd: 0,
      varianceUsd: 0,
      officialRequests: 0,
      localEventCount: 0,
      officialInputTokens: 0,
      officialCachedInputTokens: 0,
      officialOutputTokens: 0,
      localPromptTokens: 0,
      localCompletionTokens: 0,
      localTotalTokens: 0,
      tokenCoverageRatio: null,
      costCoverageRatio: null,
      daily: [],
      lineItems: [],
      modelComparison: [],
      projectBreakdown: [],
      apiKeyBreakdown: [],
    };
  }

  const [costRows, usageRows, localUsageResult] = await Promise.all([
    fetchAllCostRowsWithFilters(range, filters),
    fetchAllCompletionsUsageRows(range, filters),
    fetchAllLocalUsageRows(range, filters),
  ]);
  const localRows = localUsageResult.rows;

  warnings.push(
    "Official invoice-aligned cost comes from OpenAI Costs API. Model-level cost tables below are derived from OpenAI Usage + the retained pricing basis, so they remain analytical rather than invoice-authoritative.",
  );
  if (localUsageResult.schemaMode !== "full") {
    warnings.push(
      "Local attribution is running in compatibility mode because the current Supabase usage_logs schema has not been fully migrated yet.",
    );
  }
  if (filters.projectIds?.length === 1 && !localUsageResult.projectFilterApplied) {
    warnings.push(
      "The selected OpenAI project filter is applied to official OpenAI spend, but not to local attribution yet because the current usage_logs table does not store openai_project_id.",
    );
  }
  if (filters.apiKeyIds?.length === 1 && !localUsageResult.apiKeyFilterApplied) {
    warnings.push(
      "The selected OpenAI API key filter is applied to official OpenAI spend, but not to local attribution yet because the current usage_logs table does not store openai_api_key_id.",
    );
  }
  if (localUsageResult.schemaMode === "legacy" || localUsageResult.schemaMode === "with_form") {
    warnings.push(
      "Local compatibility mode currently estimates cost from prompt and completion tokens only because cached_input_tokens are not available in this usage_logs schema.",
    );
  }

  const officialCostUsd = sumBy(costRows, (row) => row.amountUsd);
  const officialUsageEstimatedCostUsd = sumBy(usageRows, (row) => row.estimatedCostUsd);
  const localEstimatedCostUsd = sumBy(localRows, (row) => conservativeLogCostUsd(row));

  const officialInputTokens = sumBy(usageRows, (row) => row.inputTokens);
  const officialCachedInputTokens = sumBy(usageRows, (row) => row.cachedInputTokens);
  const officialOutputTokens = sumBy(usageRows, (row) => row.outputTokens);
  const officialRequests = sumBy(usageRows, (row) => row.requests);

  const localPromptTokens = sumBy(localRows, (row) => normalizeNumber(row.prompt_tokens));
  const localCompletionTokens = sumBy(localRows, (row) => normalizeNumber(row.completion_tokens));
  const localTotalTokens = sumBy(localRows, (row) => normalizeNumber(row.total_tokens));

  const dailyCostMap = new Map<
    string,
    {
      officialCostUsd: number;
      officialUsageEstimatedCostUsd: number;
      localEstimatedCostUsd: number;
      officialRequests: number;
      localEventCount: number;
      officialInputTokens: number;
      officialCachedInputTokens: number;
      officialOutputTokens: number;
      localPromptTokens: number;
      localCompletionTokens: number;
    }
  >();

  const ensureDaily = (date: string) => {
    const current =
      dailyCostMap.get(date) || {
        officialCostUsd: 0,
        officialUsageEstimatedCostUsd: 0,
        localEstimatedCostUsd: 0,
        officialRequests: 0,
        localEventCount: 0,
        officialInputTokens: 0,
        officialCachedInputTokens: 0,
        officialOutputTokens: 0,
        localPromptTokens: 0,
        localCompletionTokens: 0,
      };
    dailyCostMap.set(date, current);
    return current;
  };

  for (const date of listUtcDateLabels(range)) {
    ensureDaily(date);
  }

  for (const row of costRows) {
    ensureDaily(row.date).officialCostUsd += row.amountUsd;
  }
  for (const row of usageRows) {
    const current = ensureDaily(row.date);
    current.officialUsageEstimatedCostUsd += row.estimatedCostUsd;
    current.officialRequests += row.requests;
    current.officialInputTokens += row.inputTokens;
    current.officialCachedInputTokens += row.cachedInputTokens;
    current.officialOutputTokens += row.outputTokens;
  }
  for (const row of localRows) {
    const date = (row.created_at || "").slice(0, 10);
    if (!date) {
      continue;
    }
    const current = ensureDaily(date);
    current.localEstimatedCostUsd += conservativeLogCostUsd(row);
    current.localEventCount += 1;
    current.localPromptTokens += normalizeNumber(row.prompt_tokens);
    current.localCompletionTokens += normalizeNumber(row.completion_tokens);
  }

  const lineItemMap = new Map<string, number>();
  const projectCostMap = new Map<string, number>();
  const apiKeyCostMap = new Map<string, number>();
  for (const row of costRows) {
    const lineItem = row.lineItem || "Unspecified";
    lineItemMap.set(lineItem, (lineItemMap.get(lineItem) || 0) + row.amountUsd);
    if (row.projectId) {
      projectCostMap.set(row.projectId, (projectCostMap.get(row.projectId) || 0) + row.amountUsd);
    }
    if (row.apiKeyId) {
      apiKeyCostMap.set(row.apiKeyId, (apiKeyCostMap.get(row.apiKeyId) || 0) + row.amountUsd);
    }
  }

  const usageModelMap = new Map<
    string,
    {
      model: string;
      tier: string;
      officialRequests: number;
      officialInputTokens: number;
      officialCachedInputTokens: number;
      officialOutputTokens: number;
      officialUsageEstimatedCostUsd: number;
      localEventCount: number;
      localPromptTokens: number;
      localCompletionTokens: number;
      localEstimatedCostUsd: number;
    }
  >();

  const localRowsByModel = new Map<string, LocalUsageRow[]>();
  for (const row of localRows) {
    const model = row.model_used || "unknown";
    const list = localRowsByModel.get(model) || [];
    list.push(row);
    localRowsByModel.set(model, list);
  }

  for (const row of usageRows) {
    const model = row.model || "unknown";
    const tier = row.batch ? "batch" : row.serviceTier || "standard";
    const key = `${model}@@${tier}`;
    const current =
      usageModelMap.get(key) || {
        model,
        tier,
        officialRequests: 0,
        officialInputTokens: 0,
        officialCachedInputTokens: 0,
        officialOutputTokens: 0,
        officialUsageEstimatedCostUsd: 0,
        localEventCount: 0,
        localPromptTokens: 0,
        localCompletionTokens: 0,
        localEstimatedCostUsd: 0,
      };

    current.officialRequests += row.requests;
    current.officialInputTokens += row.inputTokens;
    current.officialCachedInputTokens += row.cachedInputTokens;
    current.officialOutputTokens += row.outputTokens;
    current.officialUsageEstimatedCostUsd += row.estimatedCostUsd;
    usageModelMap.set(key, current);
  }

  for (const [model, rows] of localRowsByModel.entries()) {
    const preferredKey =
      usageModelMap.has(`${model}@@standard`) ||
      ![...usageModelMap.keys()].some((key) => key.startsWith(`${model}@@`))
        ? `${model}@@standard`
        : [...usageModelMap.keys()].find((key) => key.startsWith(`${model}@@`))!;

    const current =
      usageModelMap.get(preferredKey) || {
        model,
        tier: "standard",
        officialRequests: 0,
        officialInputTokens: 0,
        officialCachedInputTokens: 0,
        officialOutputTokens: 0,
        officialUsageEstimatedCostUsd: 0,
        localEventCount: 0,
        localPromptTokens: 0,
        localCompletionTokens: 0,
        localEstimatedCostUsd: 0,
      };

    current.localEventCount += rows.length;
    current.localPromptTokens += sumBy(rows, (row) => normalizeNumber(row.prompt_tokens));
    current.localCompletionTokens += sumBy(rows, (row) => normalizeNumber(row.completion_tokens));
    current.localEstimatedCostUsd += sumBy(rows, (row) => conservativeLogCostUsd(row));
    usageModelMap.set(preferredKey, current);
  }

  return {
    enabled: true,
    warnings,
    range,
    syncedAtIso: new Date().toISOString(),
    officialCostUsd,
    officialUsageEstimatedCostUsd,
    localEstimatedCostUsd,
    varianceUsd: localEstimatedCostUsd - officialCostUsd,
    officialRequests,
    localEventCount: localRows.length,
    officialInputTokens,
    officialCachedInputTokens,
    officialOutputTokens,
    localPromptTokens,
    localCompletionTokens,
    localTotalTokens,
    tokenCoverageRatio: ratio(localPromptTokens + localCompletionTokens, officialInputTokens + officialOutputTokens),
    costCoverageRatio: ratio(localEstimatedCostUsd, officialCostUsd),
    daily: [...dailyCostMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, values]) => ({ date, ...values })),
    lineItems: [...lineItemMap.entries()]
      .map(([lineItem, amountUsd]) => ({ lineItem, amountUsd }))
      .sort((a, b) => b.amountUsd - a.amountUsd),
    modelComparison: [...usageModelMap.values()]
      .map((entry) => ({
        ...entry,
        costDeltaUsd: entry.localEstimatedCostUsd - entry.officialUsageEstimatedCostUsd,
        tokenDelta:
          entry.localPromptTokens + entry.localCompletionTokens - (entry.officialInputTokens + entry.officialOutputTokens),
      }))
      .sort((a, b) => b.officialUsageEstimatedCostUsd - a.officialUsageEstimatedCostUsd),
    projectBreakdown: topEntries(projectCostMap, "projectId").map((entry) => ({
      projectId: entry.projectId as string,
      amountUsd: entry.amountUsd,
    })),
    apiKeyBreakdown: topEntries(apiKeyCostMap, "apiKeyId").map((entry) => ({
      apiKeyId: entry.apiKeyId as string,
      amountUsd: entry.amountUsd,
    })),
  };
}
