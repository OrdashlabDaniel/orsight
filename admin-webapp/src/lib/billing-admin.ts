import Stripe from "stripe";

export type BillingPlanId = "free" | "normal" | "usage" | "pro" | "business";
export type BillingModel = "free_quota" | "monthly_quota" | "monthly_plus_usage";

export type BillingPlanConfig = {
  planId: BillingPlanId;
  displayName: string;
  description: string;
  billingModel: BillingModel;
  monthlyBaseCents: number;
  includedCredits: number;
  overageUnitCents: number;
  overageUnitName: string;
  currency: string;
  stripeBaseProductId: string | null;
  stripeBasePriceId: string | null;
  stripeUsageProductId: string | null;
  stripeUsagePriceId: string | null;
  stripeMeterId: string | null;
  stripeMeterEventName: string | null;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type BillingSubscriptionRow = {
  owner_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  plan: string | null;
  status: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  latest_invoice_id: string | null;
  latest_invoice_status: string | null;
  latest_invoice_amount_due: number | null;
  latest_invoice_amount_paid: number | null;
  latest_invoice_amount_remaining: number | null;
  currency: string | null;
  billing_source: "stripe" | "admin_override" | string | null;
  created_at?: string | null;
  updated_at?: string | null;
  raw?: Record<string, unknown> | null;
};

type PlanConfigRow = {
  plan_id: string;
  display_name: string | null;
  description: string | null;
  billing_model: string | null;
  monthly_base_cents: number | null;
  included_credits: number | null;
  overage_unit_cents: number | null;
  overage_unit_name: string | null;
  currency: string | null;
  stripe_base_product_id: string | null;
  stripe_base_price_id: string | null;
  stripe_usage_product_id: string | null;
  stripe_usage_price_id: string | null;
  stripe_meter_id: string | null;
  stripe_meter_event_name: string | null;
  is_public: boolean | null;
  is_active: boolean | null;
  sort_order: number | null;
};

export const PLAN_IDS: BillingPlanId[] = ["free", "normal", "usage", "pro", "business"];
export const PUBLIC_PLAN_ORDER: BillingPlanId[] = ["free", "normal"];
export const PLAN_ORDER: BillingPlanId[] = ["free", "normal", "usage", "pro", "business"];
export const ADMIN_OVERRIDE_PREFIX = "admin_override_";

function env(name: string) {
  return (process.env[name] || "").trim();
}

function intEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(env(name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeCurrency(value: string | null | undefined) {
  const normalized = (value || "").trim().toLowerCase();
  return normalized || "usd";
}

export function normalizeBillingPlan(plan: unknown): BillingPlanId | null {
  return plan === "free" || plan === "normal" || plan === "usage" || plan === "pro" || plan === "business"
    ? plan
    : null;
}

export function normalizeBillingModel(model: unknown): BillingModel | null {
  return model === "free_quota" || model === "monthly_quota" || model === "monthly_plus_usage"
    ? model
    : null;
}

export function isSubscriptionUsable(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}

export function getAdminOverrideSubscriptionId(ownerId: string) {
  return `${ADMIN_OVERRIDE_PREFIX}${ownerId}`;
}

export function isAdminOverrideSubscription(row: BillingSubscriptionRow | null | undefined) {
  return (
    row?.billing_source === "admin_override" ||
    Boolean(row?.stripe_subscription_id?.startsWith(ADMIN_OVERRIDE_PREFIX))
  );
}

export function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString();
}

export function oneYearFromNowIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate(), 0, 0, 0)).toISOString();
}

export function pickEffectiveSubscription(rows: BillingSubscriptionRow[]) {
  const sorted = [...rows].sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
  return (
    sorted.find((row) => isAdminOverrideSubscription(row) && isSubscriptionUsable(row.status)) ||
    sorted.find((row) => !isAdminOverrideSubscription(row) && isSubscriptionUsable(row.status)) ||
    sorted[0] ||
    null
  );
}

export function getEffectivePlan(row: BillingSubscriptionRow | null | undefined): BillingPlanId {
  if (!row || !isSubscriptionUsable(row.status)) {
    return "free";
  }
  return normalizeBillingPlan(row.plan) || "free";
}

function fallbackPlanConfig(planId: BillingPlanId): BillingPlanConfig {
  if (planId === "normal") {
    return {
      planId,
      displayName: "Normal",
      description: "Monthly subscription with a hard 10,000,000 AI token quota.",
      billingModel: "monthly_quota",
      monthlyBaseCents: intEnv("BILLING_NORMAL_MONTHLY_FEE_CENTS", 999),
      includedCredits: intEnv("BILLING_NORMAL_MONTHLY_CREDITS", 10_000_000),
      overageUnitCents: 0,
      overageUnitName: env("BILLING_NORMAL_USAGE_UNIT") || "tokens",
      currency: normalizeCurrency(env("BILLING_CURRENCY") || "usd"),
      stripeBaseProductId: null,
      stripeBasePriceId: env("STRIPE_PRICE_NORMAL_MONTHLY") || null,
      stripeUsageProductId: null,
      stripeUsagePriceId: null,
      stripeMeterId: null,
      stripeMeterEventName: null,
      isPublic: true,
      isActive: true,
      sortOrder: 10,
    };
  }

  if (planId === "usage") {
    return {
      planId,
      displayName: "Legacy Usage",
      description: "Hidden legacy metered subscription. Current pay-as-you-go uses prepaid token credits instead.",
      billingModel: "monthly_plus_usage",
      monthlyBaseCents: intEnv("BILLING_USAGE_MONTHLY_FEE_CENTS", 0),
      includedCredits: intEnv("BILLING_USAGE_INCLUDED_CREDITS", 0),
      overageUnitCents: intEnv("BILLING_USAGE_OVERAGE_UNIT_CENTS", 1),
      overageUnitName: env("BILLING_USAGE_UNIT") || "1K tokens",
      currency: normalizeCurrency(env("BILLING_CURRENCY") || "usd"),
      stripeBaseProductId: null,
      stripeBasePriceId: env("STRIPE_PRICE_USAGE_MONTHLY") || null,
      stripeUsageProductId: null,
      stripeUsagePriceId: env("STRIPE_PRICE_USAGE_METERED") || null,
      stripeMeterId: null,
      stripeMeterEventName: env("STRIPE_METER_EVENT_USAGE") || "orsight_usage",
      isPublic: false,
      isActive: true,
      sortOrder: 20,
    };
  }

  if (planId === "business") {
    return {
      planId,
      displayName: "Business",
      description: "High-volume monthly plan with included usage and metered overage.",
      billingModel: "monthly_plus_usage",
      monthlyBaseCents: intEnv("BILLING_BUSINESS_MONTHLY_FEE_CENTS", 9900),
      includedCredits: intEnv("BILLING_BUSINESS_MONTHLY_CREDITS", 5000),
      overageUnitCents: intEnv("BILLING_BUSINESS_OVERAGE_UNIT_CENTS", 1),
      overageUnitName: env("BILLING_BUSINESS_USAGE_UNIT") || "image",
      currency: normalizeCurrency(env("BILLING_CURRENCY") || "usd"),
      stripeBaseProductId: null,
      stripeBasePriceId: env("STRIPE_PRICE_BUSINESS_MONTHLY") || null,
      stripeUsageProductId: null,
      stripeUsagePriceId: env("STRIPE_PRICE_BUSINESS_USAGE") || null,
      stripeMeterId: null,
      stripeMeterEventName: env("STRIPE_METER_EVENT_BUSINESS") || "orsight_business_usage",
      isPublic: false,
      isActive: false,
      sortOrder: 20,
    };
  }

  if (planId === "pro") {
    return {
      planId,
      displayName: "Pro",
      description: "Standard monthly plan with included usage and metered overage.",
      billingModel: "monthly_plus_usage",
      monthlyBaseCents: intEnv("BILLING_PRO_MONTHLY_FEE_CENTS", 2900),
      includedCredits: intEnv("BILLING_PRO_MONTHLY_CREDITS", 1000),
      overageUnitCents: intEnv("BILLING_PRO_OVERAGE_UNIT_CENTS", 2),
      overageUnitName: env("BILLING_PRO_USAGE_UNIT") || "image",
      currency: normalizeCurrency(env("BILLING_CURRENCY") || "usd"),
      stripeBaseProductId: null,
      stripeBasePriceId: env("STRIPE_PRICE_PRO_MONTHLY") || null,
      stripeUsageProductId: null,
      stripeUsagePriceId: env("STRIPE_PRICE_PRO_USAGE") || null,
      stripeMeterId: null,
      stripeMeterEventName: env("STRIPE_METER_EVENT_PRO") || "orsight_pro_usage",
      isPublic: false,
      isActive: false,
      sortOrder: 10,
    };
  }

  return {
    planId: "free",
    displayName: "Free",
    description: "Free starter tier with a hard monthly quota.",
    billingModel: "free_quota",
    monthlyBaseCents: 0,
    includedCredits: intEnv("BILLING_FREE_MONTHLY_CREDITS", 750_000),
    overageUnitCents: 0,
    overageUnitName: env("BILLING_FREE_USAGE_UNIT") || "tokens",
    currency: normalizeCurrency(env("BILLING_CURRENCY") || "usd"),
    stripeBaseProductId: null,
    stripeBasePriceId: null,
    stripeUsageProductId: null,
    stripeUsagePriceId: null,
    stripeMeterId: null,
    stripeMeterEventName: null,
    isPublic: false,
    isActive: true,
    sortOrder: 0,
  };
}

export function getPlanQuota(plan: BillingPlanId) {
  return fallbackPlanConfig(plan).includedCredits;
}

export function getFallbackBillingPlanConfigs() {
  return PUBLIC_PLAN_ORDER.map((planId) => fallbackPlanConfig(planId)).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function shortId(id: string | null | undefined) {
  if (!id) return "-";
  if (id.length <= 18) return id;
  return `${id.slice(0, 10)}...${id.slice(-6)}`;
}

export function billingSourceLabel(row: BillingSubscriptionRow | null | undefined) {
  if (!row) return "未订阅";
  return isAdminOverrideSubscription(row) ? "后台覆盖" : "Stripe";
}

export function paymentStatusLabel(status: string | null | undefined) {
  if (!status) return "未出账";
  if (status === "paid") return "已支付";
  if (status === "open") return "待支付";
  if (status === "draft") return "草稿";
  if (status === "uncollectible") return "无法收款";
  if (status === "void") return "已作废";
  return status;
}

export function formatMoney(cents: number | null | undefined, currency = "usd") {
  const value = Number(cents || 0);
  const normalizedCurrency = normalizeCurrency(currency).toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: normalizedCurrency,
    }).format(value / 100);
  } catch {
    return `${normalizedCurrency} ${(value / 100).toFixed(2)}`;
  }
}

function usesTokenUnits(config: Pick<BillingPlanConfig, "overageUnitName">) {
  return config.overageUnitName.toLowerCase().includes("token");
}

function meteredUnitSizeForPlan(config: Pick<BillingPlanConfig, "overageUnitName">) {
  if (!usesTokenUnits(config)) {
    return 1;
  }
  return Math.max(1, intEnv("BILLING_METERED_TOKEN_UNIT_SIZE", 1_000));
}

function meteredUnitsForUsage(rawUsage: number, config: Pick<BillingPlanConfig, "overageUnitName">) {
  const usage = Math.max(0, Math.trunc(Number(rawUsage) || 0));
  return Math.ceil(usage / meteredUnitSizeForPlan(config));
}

export function computePlanUsage(config: BillingPlanConfig, used: number) {
  const normalizedUsed = Math.max(0, used);
  const remainingIncluded =
    config.includedCredits < 0 ? null : Math.max(0, config.includedCredits - normalizedUsed);
  const billableUsage =
    config.billingModel === "monthly_plus_usage"
      ? Math.max(0, normalizedUsed - Math.max(0, config.includedCredits))
      : 0;
  const meteredBillableUnits =
    config.billingModel === "monthly_plus_usage" ? meteredUnitsForUsage(billableUsage, config) : 0;

  return {
    used: normalizedUsed,
    remainingIncluded,
    billableUsage,
    estimatedOverageCents: meteredBillableUnits * Math.max(0, config.overageUnitCents),
  };
}

export function isMissingBillingTableErrorMessage(message: string | null | undefined) {
  const normalized = (message || "").toLowerCase();
  if (!normalized) return false;

  const mentionsBillingTable =
    normalized.includes("app_subscriptions") ||
    normalized.includes("app_billing_plan_configs") ||
    normalized.includes("app_usage_invoices") ||
    normalized.includes("app_billing_user_entitlements") ||
    normalized.includes("app_free_plan_seats") ||
    normalized.includes("app_billing_token_ledger");

  return (
    mentionsBillingTable &&
    (normalized.includes("schema cache") ||
      normalized.includes("could not find the table") ||
      normalized.includes("does not exist"))
  );
}

export function billingMigrationHint() {
  return "请先在当前 Supabase 项目执行 webapp/STRIPE_BILLING.md 第 3 节列出的 billing migrations；至少需要 app_billing_customers、app_subscriptions、app_billing_webhook_events、app_billing_token_ledger 这些表。";
}

export function getStripeAdmin() {
  const secretKey = env("STRIPE_SECRET_KEY");
  if (!secretKey) return null;
  return new Stripe(secretKey, { apiVersion: "2026-04-22.dahlia" });
}

export function coercePlanConfigRow(row: PlanConfigRow): BillingPlanConfig | null {
  const planId = normalizeBillingPlan(row.plan_id);
  if (!planId) return null;

  const fallback = fallbackPlanConfig(planId);
  const config = {
    planId,
    displayName: (row.display_name || "").trim() || fallback.displayName,
    description: (row.description || "").trim() || fallback.description,
    billingModel: normalizeBillingModel(row.billing_model) || fallback.billingModel,
    monthlyBaseCents: Math.max(0, Number(row.monthly_base_cents ?? fallback.monthlyBaseCents) || 0),
    includedCredits: Math.max(0, Number(row.included_credits ?? fallback.includedCredits) || 0),
    overageUnitCents: Math.max(0, Number(row.overage_unit_cents ?? fallback.overageUnitCents) || 0),
    overageUnitName: (row.overage_unit_name || "").trim() || fallback.overageUnitName,
    currency: normalizeCurrency(row.currency || fallback.currency),
    stripeBaseProductId: (row.stripe_base_product_id || "").trim() || null,
    stripeBasePriceId: (row.stripe_base_price_id || "").trim() || null,
    stripeUsageProductId: (row.stripe_usage_product_id || "").trim() || null,
    stripeUsagePriceId: (row.stripe_usage_price_id || "").trim() || null,
    stripeMeterId: (row.stripe_meter_id || "").trim() || null,
    stripeMeterEventName: (row.stripe_meter_event_name || "").trim() || fallback.stripeMeterEventName,
    isPublic: row.is_public ?? fallback.isPublic,
    isActive: row.is_active ?? fallback.isActive,
    sortOrder: Number.isFinite(Number(row.sort_order)) ? Number(row.sort_order) : fallback.sortOrder,
  };

  if (planId === "free" || planId === "normal" || planId === "usage") {
    const usesTokens = config.overageUnitName.toLowerCase().includes("token");
    const billingModel =
      planId === "free" ? "free_quota" : planId === "usage" ? "monthly_plus_usage" : "monthly_quota";
    return {
      ...config,
      billingModel,
      monthlyBaseCents: planId === "free" ? 0 : config.monthlyBaseCents,
      includedCredits: usesTokens && config.includedCredits > 0 ? config.includedCredits : fallback.includedCredits,
      overageUnitCents: planId === "usage" ? config.overageUnitCents : 0,
      overageUnitName: usesTokens ? config.overageUnitName : fallback.overageUnitName,
      stripeUsageProductId: planId === "usage" ? config.stripeUsageProductId : null,
      stripeUsagePriceId: planId === "usage" ? config.stripeUsagePriceId : null,
      stripeMeterId: planId === "usage" ? config.stripeMeterId : null,
      stripeMeterEventName: planId === "usage" ? config.stripeMeterEventName || fallback.stripeMeterEventName : null,
      isPublic: planId === "normal",
      isActive: true,
      sortOrder: fallback.sortOrder,
    };
  }

  return config;
}

export async function listBillingPlanConfigs(
  sb: {
    from: (table: string) => {
      select: (fields: string) => {
        order: (column: string, options?: { ascending?: boolean }) => {
          then?: unknown;
          data?: unknown[] | null;
          error?: { message: string } | null;
        };
      };
    };
  },
): Promise<BillingPlanConfig[]> {
  const fallbackMap = new Map(getFallbackBillingPlanConfigs().map((config) => [config.planId, config]));
  const response = await sb
    .from("app_billing_plan_configs")
    .select(
      [
        "plan_id",
        "display_name",
        "description",
        "billing_model",
        "monthly_base_cents",
        "included_credits",
        "overage_unit_cents",
        "overage_unit_name",
        "currency",
        "stripe_base_product_id",
        "stripe_base_price_id",
        "stripe_usage_product_id",
        "stripe_usage_price_id",
        "stripe_meter_id",
        "stripe_meter_event_name",
        "is_public",
        "is_active",
        "sort_order",
      ].join(","),
    )
    .order("sort_order", { ascending: true });
  const data = (response as { data?: unknown[] | null }).data ?? null;
  const error = (response as { error?: { message: string } | null }).error ?? null;

  if (error) {
    if (isMissingBillingTableErrorMessage(error.message)) {
      return Array.from(fallbackMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);
    }
    throw new Error(`app_billing_plan_configs: ${error.message}`);
  }

  for (const row of (data || []) as PlanConfigRow[]) {
    const config = coercePlanConfigRow(row);
    if (config && PUBLIC_PLAN_ORDER.includes(config.planId)) {
      fallbackMap.set(config.planId, config);
    }
  }

  return Array.from(fallbackMap.values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getPlanConfigMap(configs: BillingPlanConfig[]) {
  return new Map(configs.map((config) => [config.planId, config]));
}
