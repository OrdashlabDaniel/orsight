import {
  billingMigrationHint,
  computePlanUsage,
  getEffectivePlan,
  getFallbackBillingPlanConfigs,
  getPlanConfigMap,
  isAdminOverrideSubscription,
  isMissingBillingTableErrorMessage,
  isSubscriptionUsable,
  listBillingPlanConfigs,
  monthStartIso,
  pickEffectiveSubscription,
  type BillingPlanConfig,
  type BillingPlanId,
  type BillingSubscriptionRow,
} from "@/lib/billing-admin";
import { createAdminClient } from "@/lib/supabase/server";
import {
  aggregateUsageLogs,
  conservativeLogCostUsd,
  dailyTokenBuckets,
  modelTokenShares,
  type UsageLogLike,
} from "@/lib/usage-metrics";
import {
  getRegisteredUserById,
  listRegisteredUsersWithStatus,
  type VizAuthUserRow,
} from "@/lib/viz-auth-user-rpc";
import { type AdminTimeRange } from "@/lib/admin-time-range";

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const DASHBOARD_LOG_LIMIT = 10000;
const USER_DETAIL_LOG_LIMIT = 500;
const USAGE_LOG_PAGE_SIZE = 2000;
const DEFAULT_LIFETIME_FREE_USER_IDS = new Set([
  "618aa87b-9cab-482d-9fa0-fda3558c2a42",
  "6fe48ae3-9c72-4be2-a731-2822969928a7",
  "980a56ab-d479-4fd2-b2c3-13dde4c74cbd",
]);
const USAGE_LOG_SELECT_LEGACY =
  "id,user_id,action_type,image_count,total_tokens,prompt_tokens,completion_tokens,model_used,created_at";
const USAGE_LOG_SELECT_BASE =
  `${USAGE_LOG_SELECT_LEGACY},form_id`;
const USAGE_LOG_SELECT_WITH_CACHE = USAGE_LOG_SELECT_BASE.replace("completion_tokens", "cached_input_tokens,completion_tokens");
const USAGE_LOG_SELECT_FULL = USAGE_LOG_SELECT_WITH_CACHE.replace(
  "model_used,created_at,form_id",
  "model_used,request_count,openai_project_id,openai_api_key_id,service_tier,pricing_tier,openai_endpoint,pricing_basis_version,estimated_cost_usd,conservative_cost_usd,created_at,form_id",
);

type UsageLogSchemaMode = "full" | "with_cache" | "with_form" | "legacy";

type UsageLogQueryPlan = {
  mode: UsageLogSchemaMode;
  select: string;
  supportsProjectFilter: boolean;
};

type LoadRecentUsageLogsResult = {
  rows: AdminUsageLogRow[];
  schemaMode: UsageLogSchemaMode;
  projectFilterApplied: boolean;
};

const USAGE_LOG_QUERY_PLANS: UsageLogQueryPlan[] = [
  { mode: "full", select: USAGE_LOG_SELECT_FULL, supportsProjectFilter: true },
  { mode: "with_cache", select: USAGE_LOG_SELECT_WITH_CACHE, supportsProjectFilter: false },
  { mode: "with_form", select: USAGE_LOG_SELECT_BASE, supportsProjectFilter: false },
  { mode: "legacy", select: USAGE_LOG_SELECT_LEGACY, supportsProjectFilter: false },
];

export type AdminUsageLogRow = UsageLogLike & {
  id: string;
  action_type: string | null;
  created_at: string | null;
};

export type AdminUserUsageSummary = {
  images: number;
  tokens: number;
  costUsd: number;
  requestCount: number;
  lastSeenAt: string | null;
};

export type AdminUserSummary = {
  user: VizAuthUserRow;
  label: string;
  isAdmin: boolean;
  isSuspended: boolean;
  usage: AdminUserUsageSummary;
  effectiveSubscription: BillingSubscriptionRow | null;
  realStripeSubscription: BillingSubscriptionRow | null;
  effectivePlan: BillingPlanId;
  lifetimeFree: boolean;
  freeQuotaBlocked: boolean;
  freeQuotaResetAfterIso: string | null;
  planConfig: BillingPlanConfig;
  planUsage: ReturnType<typeof computePlanUsage>;
};

export type AdminDashboardSnapshot = {
  warnings: string[];
  usageLogs: AdminUsageLogRow[];
  users: AdminUserSummary[];
  totals: ReturnType<typeof aggregateUsageLogs> & {
    totalUsers: number;
    adminUsers: number;
    suspendedUsers: number;
    paidUsers: number;
    liveSubscriptions: number;
    adminOverrides: number;
    projectedMonthlyRevenueCents: number;
  };
  dailyTokens: ReturnType<typeof dailyTokenBuckets>;
  modelShares: ReturnType<typeof modelTokenShares>;
  topUsers: AdminUserSummary[];
  newestUsers: AdminUserSummary[];
  planBreakdown: Array<{ planId: BillingPlanId; count: number }>;
};

export type AdminUsersSnapshot = {
  warnings: string[];
  users: AdminUserSummary[];
  totals: {
    totalUsers: number;
    adminUsers: number;
    suspendedUsers: number;
    paidUsers: number;
  };
};

export type AdminBillingSnapshot = {
  warnings: string[];
  planConfigs: BillingPlanConfig[];
  users: AdminUserSummary[];
  totals: {
    paidUsers: number;
    liveSubscriptions: number;
    adminOverrides: number;
    projectedMonthlyRevenueCents: number;
  };
};

export type AdminUsageBoardSnapshot = {
  warnings: string[];
  user: AdminUserSummary | null;
  userLabelMap: Record<string, string>;
  usageLogs: AdminUsageLogRow[];
  totals: ReturnType<typeof aggregateUsageLogs>;
  dailyTokens: ReturnType<typeof dailyTokenBuckets>;
  modelShares: ReturnType<typeof modelTokenShares>;
  topUsers: AdminUserSummary[];
};

export type AdminUserDetailSnapshot = {
  warnings: string[];
  user: VizAuthUserRow;
  summary: AdminUserSummary;
  usageLogs: AdminUsageLogRow[];
  totals: ReturnType<typeof aggregateUsageLogs>;
  dailyTokens: ReturnType<typeof dailyTokenBuckets>;
  modelShares: ReturnType<typeof modelTokenShares>;
  planConfigs: BillingPlanConfig[];
};

type BillingBundle = {
  planConfigs: BillingPlanConfig[];
  subscriptionsByOwner: Map<string, BillingSubscriptionRow[]>;
  warning: string | null;
};

type BillingControlFlags = {
  lifetimeFree: boolean;
  freeQuotaBlocked: boolean;
  freeQuotaResetAfterIso: string | null;
};

function pushWarning(target: string[], value: string | null | undefined) {
  const text = (value || "").trim();
  if (!text || target.includes(text)) {
    return;
  }
  target.push(text);
}

function normalizeUsageLogRow(row: Partial<AdminUsageLogRow>): AdminUsageLogRow {
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

function userLabel(user: Pick<VizAuthUserRow, "id" | "email" | "pod_username">) {
  return (user.pod_username && user.pod_username.trim()) || user.email || user.id;
}

function isSuspendedUser(user: Pick<VizAuthUserRow, "banned_until" | "deleted_at">) {
  return Boolean(user.banned_until || user.deleted_at);
}

function usageUnitsForPlan(
  log: Pick<AdminUsageLogRow, "image_count" | "total_tokens">,
  planConfig: Pick<BillingPlanConfig, "overageUnitName">,
) {
  const unit = planConfig.overageUnitName.toLowerCase();
  if (unit.includes("token")) {
    const tokens = Number(log.total_tokens || 0);
    return Math.max(0, Number.isFinite(tokens) ? tokens : 0);
  }

  const count = Number(log.image_count || 0);
  return Math.max(1, Number.isFinite(count) ? count : 0);
}

function buildUsageMap(logs: AdminUsageLogRow[]) {
  const usageByUser = new Map<string, AdminUserUsageSummary>();

  for (const log of logs) {
    const current = usageByUser.get(log.user_id) || {
      images: 0,
      tokens: 0,
      costUsd: 0,
      requestCount: 0,
      lastSeenAt: null,
    };

    usageByUser.set(log.user_id, {
      images: current.images + Math.max(0, Number(log.image_count || 0)),
      tokens: current.tokens + Math.max(0, Number(log.total_tokens || 0)),
      costUsd: current.costUsd + conservativeLogCostUsd(log),
      requestCount: current.requestCount + 1,
      lastSeenAt:
        !current.lastSeenAt || ((log.created_at || "") > current.lastSeenAt)
          ? log.created_at || current.lastSeenAt
          : current.lastSeenAt,
    });
  }

  return usageByUser;
}

async function loadRecentUsageLogs(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  limit: number | null,
  userId?: string,
  range?: AdminTimeRange,
  openAIProjectId?: string,
): Promise<LoadRecentUsageLogsResult> {
  const rows: AdminUsageLogRow[] = [];
  let activePlanIndex = 0;
  let activePlan = USAGE_LOG_QUERY_PLANS[0]!;

  for (let start = 0; ; start += USAGE_LOG_PAGE_SIZE) {
    const pageSize = limit == null ? USAGE_LOG_PAGE_SIZE : Math.min(USAGE_LOG_PAGE_SIZE, Math.max(0, limit - rows.length));
    if (pageSize <= 0) {
      break;
    }

    let pageRows: Partial<AdminUsageLogRow>[] | null = null;
    let lastSchemaError: string | null = null;

    for (let planIndex = activePlanIndex; planIndex < USAGE_LOG_QUERY_PLANS.length; planIndex += 1) {
      const plan = USAGE_LOG_QUERY_PLANS[planIndex]!;
      let query = sb
        .from("usage_logs")
        .select(plan.select)
        .order("created_at", { ascending: false })
        .range(start, start + pageSize - 1);

      if (userId) {
        query = query.eq("user_id", userId);
      }
      if (openAIProjectId && plan.supportsProjectFilter) {
        query = query.eq("openai_project_id", openAIProjectId);
      }
      if (range) {
        query = query.gte("created_at", range.startIso).lt("created_at", range.endIso);
      }

      const result = await query;
      if (!result.error) {
        pageRows = result.data as Partial<AdminUsageLogRow>[] | null;
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

    const normalizedRows = ((pageRows ?? []) as Partial<AdminUsageLogRow>[]).map(normalizeUsageLogRow);
    rows.push(...normalizedRows);

    if (normalizedRows.length < pageSize || (limit != null && rows.length >= limit)) {
      break;
    }
  }

  return {
    rows,
    schemaMode: activePlan.mode,
    projectFilterApplied: !openAIProjectId || activePlan.supportsProjectFilter,
  };
}

async function loadBillingBundle(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  ownerIds: string[],
): Promise<BillingBundle> {
  let warning: string | null = null;
  let planConfigs = getFallbackBillingPlanConfigs();

  try {
    planConfigs = await listBillingPlanConfigs(sb);
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法读取 billing 套餐配置。";
    warning = message;
    planConfigs = getFallbackBillingPlanConfigs();
  }

  const safeOwnerIds = ownerIds.length > 0 ? ownerIds : [ZERO_UUID];
  const { data: subscriptionRows, error: subscriptionError } = await sb
    .from("app_subscriptions")
    .select("*")
    .in("owner_id", safeOwnerIds)
    .order("updated_at", { ascending: false });

  if (subscriptionError) {
    if (isMissingBillingTableErrorMessage(subscriptionError.message)) {
      warning =
        `当前数据库尚未完成 billing 表迁移，后台先使用 fallback 套餐配置继续展示。${billingMigrationHint()}`;
    } else {
      throw new Error(`app_subscriptions: ${subscriptionError.message}`);
    }
  }

  const subscriptionsByOwner = new Map<string, BillingSubscriptionRow[]>();
  for (const row of ((subscriptionRows ?? []) as BillingSubscriptionRow[])) {
    const list = subscriptionsByOwner.get(row.owner_id) || [];
    list.push(row);
    subscriptionsByOwner.set(row.owner_id, list);
  }

  return { planConfigs, subscriptionsByOwner, warning };
}

function defaultBillingControlFlags(): BillingControlFlags {
  return {
    lifetimeFree: false,
    freeQuotaBlocked: false,
    freeQuotaResetAfterIso: null,
  };
}

async function loadBillingControlFlagsByOwner(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  ownerIds: string[],
): Promise<Map<string, BillingControlFlags>> {
  const flagsByOwner = new Map<string, BillingControlFlags>();
  for (const id of ownerIds) {
    flagsByOwner.set(id.toLowerCase(), defaultBillingControlFlags());
  }
  const safeOwnerIds = ownerIds.length > 0 ? ownerIds : [ZERO_UUID];

  const { data, error } = await sb
    .from("app_billing_user_entitlements")
    .select("owner_id,entitlement,active,notes")
    .in("entitlement", ["lifetime_free", "free_quota_blocked", "free_quota_reset_after"])
    .in("owner_id", safeOwnerIds);

  if (error) {
    if (!isMissingBillingTableErrorMessage(error.message)) {
      throw new Error(`app_billing_user_entitlements: ${error.message}`);
    }
    for (const id of ownerIds) {
      const normalized = id.toLowerCase();
      if (DEFAULT_LIFETIME_FREE_USER_IDS.has(normalized)) {
        flagsByOwner.set(normalized, {
          ...defaultBillingControlFlags(),
          lifetimeFree: true,
        });
      }
    }
    return flagsByOwner;
  }

  for (const row of data ?? []) {
    const ownerId = (row.owner_id as string | null)?.trim().toLowerCase();
    if (ownerId) {
      const current = flagsByOwner.get(ownerId) || defaultBillingControlFlags();
      const active = Boolean(row.active);
      const entitlement = String(row.entitlement || "");
      if (entitlement === "lifetime_free") {
        current.lifetimeFree = active;
      } else if (entitlement === "free_quota_blocked") {
        current.freeQuotaBlocked = active;
      } else if (entitlement === "free_quota_reset_after") {
        current.freeQuotaResetAfterIso = active ? String(row.notes || "").trim() || null : null;
      }
      flagsByOwner.set(ownerId, current);
    }
  }

  return flagsByOwner;
}

function buildAdminUserSummary(
  user: VizAuthUserRow,
  adminIds: Set<string>,
  usageByUser: Map<string, AdminUserUsageSummary>,
  subscriptionsByOwner: Map<string, BillingSubscriptionRow[]>,
  planConfigs: BillingPlanConfig[],
  usageLogs: AdminUsageLogRow[],
  billingControlFlagsByOwner: Map<string, BillingControlFlags>,
): AdminUserSummary {
  const subscriptions = subscriptionsByOwner.get(user.id) || [];
  const effectiveSubscription = pickEffectiveSubscription(subscriptions);
  const realStripeSubscription =
    subscriptions.find((row) => !isAdminOverrideSubscription(row)) || null;
  const effectivePlan = getEffectivePlan(effectiveSubscription);
  const billingControlFlags =
    billingControlFlagsByOwner.get(user.id.toLowerCase()) || defaultBillingControlFlags();
  const lifetimeFree = billingControlFlags.lifetimeFree;
  const planConfig = getPlanConfigMap(planConfigs).get(effectivePlan) || planConfigs[0]!;
  const periodStart = effectiveSubscription?.current_period_start || monthStartIso();
  const usedThisPeriod = usageLogs.reduce((sum, log) => {
    if (log.user_id !== user.id) {
      return sum;
    }
    if (!log.created_at || log.created_at < periodStart) {
      return sum;
    }
    return sum + usageUnitsForPlan(log, planConfig);
  }, 0);

  return {
    user,
    label: userLabel(user),
    isAdmin: adminIds.has(user.id),
    isSuspended: isSuspendedUser(user),
    usage:
      usageByUser.get(user.id) || {
        images: 0,
        tokens: 0,
        costUsd: 0,
        requestCount: 0,
        lastSeenAt: null,
      },
    effectiveSubscription,
    realStripeSubscription,
    effectivePlan,
    lifetimeFree,
    freeQuotaBlocked: billingControlFlags.freeQuotaBlocked,
    freeQuotaResetAfterIso: billingControlFlags.freeQuotaResetAfterIso,
    planConfig,
    planUsage: computePlanUsage(planConfig, usedThisPeriod),
  };
}

async function loadAdminDataset(
  logLimit: number | null = DASHBOARD_LOG_LIMIT,
  usageRange?: AdminTimeRange,
  openAIProjectId?: string,
) {
  const sb = await createAdminClient();
  const warnings: string[] = [];

  const [userResult, adminResult, usageResult] = await Promise.allSettled([
    listRegisteredUsersWithStatus(sb),
    sb.from("admin_users").select("id"),
    loadRecentUsageLogs(sb, logLimit, undefined, usageRange, openAIProjectId),
  ]);

  const users =
    userResult.status === "fulfilled"
      ? userResult.value
      : (pushWarning(warnings, userResult.reason instanceof Error ? userResult.reason.message : "无法读取用户列表"), []);

  const adminIds =
    adminResult.status === "fulfilled" && !adminResult.value.error
      ? new Set((adminResult.value.data ?? []).map((row) => row.id as string))
      : (pushWarning(
          warnings,
          adminResult.status === "fulfilled"
            ? `admin_users: ${adminResult.value.error?.message || "unknown error"}`
            : adminResult.reason instanceof Error
              ? adminResult.reason.message
              : "无法读取管理员列表",
        ),
        new Set<string>());

  const usageLogs =
    usageResult.status === "fulfilled"
      ? usageResult.value.rows
      : (pushWarning(warnings, usageResult.reason instanceof Error ? usageResult.reason.message : "无法读取 usage_logs"), []);

  if (usageResult.status === "fulfilled") {
    if (usageResult.value.schemaMode !== "full") {
      pushWarning(
        warnings,
        "Local usage attribution is running in compatibility mode because the current Supabase usage_logs schema has not been fully migrated yet.",
      );
    }
    if (openAIProjectId && !usageResult.value.projectFilterApplied) {
      pushWarning(
        warnings,
        "The selected OpenAI project filter is applied to official OpenAI reconciliation, but not to local attribution yet because the current usage_logs table does not store openai_project_id.",
      );
    }
  }

  const billingBundle = await loadBillingBundle(
    sb,
    users.map((user) => user.id),
  ).catch((error) => {
    pushWarning(warnings, error instanceof Error ? error.message : "无法读取 billing 数据");
    return {
      planConfigs: getFallbackBillingPlanConfigs(),
      subscriptionsByOwner: new Map<string, BillingSubscriptionRow[]>(),
      warning: null,
    } satisfies BillingBundle;
  });

  pushWarning(warnings, billingBundle.warning);

  const billingControlFlagsByOwner = await loadBillingControlFlagsByOwner(
    sb,
    users.map((user) => user.id),
  ).catch((error) => {
    pushWarning(warnings, error instanceof Error ? error.message : "Unable to read billing user entitlements.");
    return new Map(
      users.map((user) => {
        const normalized = user.id.toLowerCase();
        return [
          normalized,
          {
            ...defaultBillingControlFlags(),
            lifetimeFree: DEFAULT_LIFETIME_FREE_USER_IDS.has(normalized),
          },
        ] as const;
      }),
    );
  });

  const usageByUser = buildUsageMap(usageLogs);
  const summaries = users
    .map((user) =>
      buildAdminUserSummary(
        user,
        adminIds,
        usageByUser,
        billingBundle.subscriptionsByOwner,
        billingBundle.planConfigs,
        usageLogs,
        billingControlFlagsByOwner,
      ),
    )
    .sort((a, b) => {
      const suspendedDelta = Number(a.isSuspended) - Number(b.isSuspended);
      if (suspendedDelta !== 0) {
        return suspendedDelta;
      }
      return a.label.localeCompare(b.label);
    });

  return {
    warnings,
    usageLogs,
    users: summaries,
    planConfigs: billingBundle.planConfigs,
  };
}

export async function loadAdminDashboardSnapshot(): Promise<AdminDashboardSnapshot> {
  const dataset = await loadAdminDataset();
  const totals = aggregateUsageLogs(dataset.usageLogs);
  const users = dataset.users;

  return {
    warnings: dataset.warnings,
    usageLogs: dataset.usageLogs,
    users,
    totals: {
      ...totals,
      totalUsers: users.length,
      adminUsers: users.filter((user) => user.isAdmin).length,
      suspendedUsers: users.filter((user) => user.isSuspended).length,
      paidUsers: users.filter((user) => user.effectivePlan !== "free").length,
      liveSubscriptions: users.filter((user) => isSubscriptionUsable(user.realStripeSubscription?.status)).length,
      adminOverrides: users.filter((user) => isAdminOverrideSubscription(user.effectiveSubscription)).length,
      projectedMonthlyRevenueCents: users.reduce((sum, user) => {
        return sum + user.planConfig.monthlyBaseCents + user.planUsage.estimatedOverageCents;
      }, 0),
    },
    dailyTokens: dailyTokenBuckets(dataset.usageLogs),
    modelShares: modelTokenShares(dataset.usageLogs),
    topUsers: [...users]
      .sort((a, b) => b.usage.tokens - a.usage.tokens || b.usage.images - a.usage.images)
      .slice(0, 8),
    newestUsers: [...users]
      .sort(
        (a, b) =>
          (b.user.created_at || "").localeCompare(a.user.created_at || "") || a.label.localeCompare(b.label),
      )
      .slice(0, 8),
    planBreakdown: (["free", "normal", "usage"] as BillingPlanId[]).map((planId) => ({
      planId,
      count: users.filter((user) => user.effectivePlan === planId).length,
    })),
  };
}

export async function loadAdminUsersSnapshot(): Promise<AdminUsersSnapshot> {
  const dataset = await loadAdminDataset();
  return {
    warnings: dataset.warnings,
    users: dataset.users,
    totals: {
      totalUsers: dataset.users.length,
      adminUsers: dataset.users.filter((user) => user.isAdmin).length,
      suspendedUsers: dataset.users.filter((user) => user.isSuspended).length,
      paidUsers: dataset.users.filter((user) => user.effectivePlan !== "free").length,
    },
  };
}

export async function loadAdminBillingSnapshot(): Promise<AdminBillingSnapshot> {
  const dataset = await loadAdminDataset();
  return {
    warnings: dataset.warnings,
    planConfigs: dataset.planConfigs,
    users: [...dataset.users].sort((a, b) => {
    const planOrder = ["normal", "usage", "free"];
      const delta = planOrder.indexOf(a.effectivePlan) - planOrder.indexOf(b.effectivePlan);
      if (delta !== 0) {
        return delta;
      }
      return a.label.localeCompare(b.label);
    }),
    totals: {
      paidUsers: dataset.users.filter((user) => user.effectivePlan !== "free").length,
      liveSubscriptions: dataset.users.filter((user) => isSubscriptionUsable(user.realStripeSubscription?.status))
        .length,
      adminOverrides: dataset.users.filter((user) => isAdminOverrideSubscription(user.effectiveSubscription)).length,
      projectedMonthlyRevenueCents: dataset.users.reduce((sum, user) => {
        return sum + user.planConfig.monthlyBaseCents + user.planUsage.estimatedOverageCents;
      }, 0),
    },
  };
}

export async function loadAdminUsageBoardSnapshot(
  userId?: string,
  usageRange?: AdminTimeRange,
  openAIProjectId?: string,
): Promise<AdminUsageBoardSnapshot> {
  const dataset = await loadAdminDataset(null, usageRange, openAIProjectId);
  const user = userId ? dataset.users.find((entry) => entry.user.id === userId) || null : null;
  const usageLogs = user ? dataset.usageLogs.filter((log) => log.user_id === user.user.id) : dataset.usageLogs;
  const userLabelMap = Object.fromEntries(
    dataset.users.map((entry) => [entry.user.id, entry.label] as const),
  );

  return {
    warnings: dataset.warnings,
    user,
    userLabelMap,
    usageLogs,
    totals: aggregateUsageLogs(usageLogs),
    dailyTokens: dailyTokenBuckets(usageLogs),
    modelShares: modelTokenShares(usageLogs),
    topUsers: [...dataset.users]
      .sort((a, b) => b.usage.costUsd - a.usage.costUsd || b.usage.tokens - a.usage.tokens || b.usage.images - a.usage.images)
      .slice(0, 10),
  };
}

export async function loadAdminUserDetailSnapshot(
  userId: string,
): Promise<AdminUserDetailSnapshot | null> {
  const sb = await createAdminClient();
  const warnings: string[] = [];

  const user = await getRegisteredUserById(sb, userId);
  if (!user) {
    return null;
  }

  const [usageLogs, adminRows, billingBundle] = await Promise.all([
    loadRecentUsageLogs(sb, USER_DETAIL_LOG_LIMIT, userId),
    sb.from("admin_users").select("id"),
    loadBillingBundle(sb, [userId]).catch((error) => {
      pushWarning(warnings, error instanceof Error ? error.message : "无法读取 billing 数据");
      return {
        planConfigs: getFallbackBillingPlanConfigs(),
        subscriptionsByOwner: new Map<string, BillingSubscriptionRow[]>(),
        warning: null,
      } satisfies BillingBundle;
    }),
  ]);

  pushWarning(warnings, billingBundle.warning);
  if (adminRows.error) {
    pushWarning(warnings, `admin_users: ${adminRows.error.message}`);
  }
  if (usageLogs.schemaMode !== "full") {
    pushWarning(
      warnings,
      "Local user usage detail is running in compatibility mode because the current Supabase usage_logs schema has not been fully migrated yet.",
    );
  }

  const adminIds = new Set((adminRows.data ?? []).map((row) => row.id as string));
  const billingControlFlagsByOwner = await loadBillingControlFlagsByOwner(sb, [userId]).catch((error) => {
    pushWarning(warnings, error instanceof Error ? error.message : "Unable to read billing user entitlements.");
    const normalized = userId.toLowerCase();
    return new Map([
      [
        normalized,
        {
          ...defaultBillingControlFlags(),
          lifetimeFree: DEFAULT_LIFETIME_FREE_USER_IDS.has(normalized),
        },
      ],
    ]);
  });
  const usageByUser = buildUsageMap(usageLogs.rows);
  const summary = buildAdminUserSummary(
    user,
    adminIds,
    usageByUser,
    billingBundle.subscriptionsByOwner,
    billingBundle.planConfigs,
    usageLogs.rows,
    billingControlFlagsByOwner,
  );

  return {
    warnings,
    user,
    summary,
    usageLogs: usageLogs.rows,
    totals: aggregateUsageLogs(usageLogs.rows),
    dailyTokens: dailyTokenBuckets(usageLogs.rows),
    modelShares: modelTokenShares(usageLogs.rows),
    planConfigs: billingBundle.planConfigs,
  };
}
