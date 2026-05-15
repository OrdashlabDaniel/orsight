import Stripe from "stripe";
import type { User } from "@supabase/supabase-js";

import {
  estimateOpenAITokenCostUsd,
  OPENAI_PRICING_BASIS_VERSION,
  type OpenAIPricingTier,
} from "@/lib/openai-accounting";
import { normalizeFormId } from "@/lib/forms";
import { getSupabaseAdmin, isSupabaseServiceRoleConfigured } from "@/lib/supabase";

export type BillingPlanId = "free" | "normal" | "usage" | "pro" | "business";
export type BillingModel = "free_quota" | "monthly_quota" | "monthly_plus_usage";
export type TokenPackId =
  | "usage_credit_30k"
  | "usage_credit_50k"
  | "usage_credit_70k"
  | "usage_credit_100k"
  | "token_pack_1m";

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
  stripeBasePriceId: string | null;
  stripeUsagePriceId: string | null;
  stripeMeterEventName: string | null;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
};

export type TokenPackConfig = {
  packId: TokenPackId;
  displayName: string;
  description: string;
  credits: number;
  priceCents: number;
  currency: string;
  stripePriceId: string | null;
  isActive: boolean;
};

export type BillingStatus = {
  enabled: boolean;
  configured: boolean;
  enforced: boolean;
  lifetimeFree: boolean;
  freeQuotaBlocked: boolean;
  freeQuotaResetAfterIso: string | null;
  plan: BillingPlanId;
  planLabel: string;
  billingModel: BillingModel;
  subscriptionStatus: string | null;
  paymentStatus: string | null;
  billingSource: "none" | "stripe" | "admin_override";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  currentPeriodEndIso: string | null;
  monthlyBaseCents: number;
  monthlyQuota: number;
  monthlyUsed: number;
  monthlyImagesUsed: number;
  remainingIncluded: number | null;
  freeMonthlyCostLimitCents: number;
  freeMonthlyCostUsedCents: number;
  freeMonthlyCostRemainingCents: number | null;
  freeMonthlyImageLimit: number | null;
  freeMonthlyImagesRemaining: number | null;
  freeSeatLimit: number | null;
  freeSeatsUsed: number | null;
  freeSeatClaimed: boolean;
  freeSeatAvailable: boolean;
  prepaidTokensPurchased: number;
  prepaidTokensConsumed: number;
  prepaidTokensBalance: number;
  prepaidTokensAvailable: number;
  effectiveRemaining: number | null;
  billableUsage: number;
  meteredBillableUnits: number;
  meteredUnitSize: number;
  estimatedOverageCents: number;
  overageUnitCents: number;
  overageUnitName: string;
  tokenPack: TokenPackConfig | null;
  tokenPacks: TokenPackConfig[];
  canUseAi: boolean;
  upgradeRequired: boolean;
  message: string | null;
};

export type UsageLogInput = {
  userId: string;
  actionType: string;
  formId?: string;
  quantity?: number;
  requestCount?: number;
  promptTokens?: number;
  cachedInputTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  modelUsed?: string;
  openAIProjectId?: string | null;
  openAIApiKeyId?: string | null;
  openAIRequestIds?: string[];
  clientRequestIds?: string[];
  serviceTier?: string | null;
  pricingTier?: OpenAIPricingTier | null;
  openAIEndpoint?: string | null;
  estimatedCostUsd?: number | null;
  conservativeCostUsd?: number | null;
  pricingBasisVersion?: string | null;
};

type SubscriptionRow = {
  owner_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  plan: BillingPlanId | string | null;
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
  updated_at?: string | null;
  raw?: Record<string, unknown> | null;
};

type BillingCustomerRow = {
  owner_id: string;
  stripe_customer_id: string;
  email: string | null;
};

type UsageRow = {
  id: string;
  created_at: string | null;
  image_count: number | null;
  total_tokens: number | null;
  estimated_cost_usd?: number | null;
  conservative_cost_usd?: number | null;
};

type FreeSeatState = {
  limit: number | null;
  used: number | null;
  claimed: boolean;
  available: boolean;
  reason: string | null;
};

type BillingUserEntitlements = {
  lifetimeFree: boolean;
  freeQuotaBlocked: boolean;
  freeQuotaResetAfterIso: string | null;
};

type TokenLedgerRow = {
  delta_tokens: number | null;
  reason: string | null;
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
  stripe_base_price_id: string | null;
  stripe_usage_price_id: string | null;
  stripe_meter_event_name: string | null;
  is_public: boolean | null;
  is_active: boolean | null;
  sort_order: number | null;
};

const ADMIN_OVERRIDE_SUBSCRIPTION_PREFIX = "admin_override_";
const DEFAULT_TOKEN_PACK_ID: TokenPackId = "usage_credit_100k";
const USAGE_CREDIT_PACK_IDS: TokenPackId[] = [
  "usage_credit_30k",
  "usage_credit_50k",
  "usage_credit_70k",
  "usage_credit_100k",
];
const DEFAULT_LIFETIME_FREE_USER_IDS = new Set([
  "618aa87b-9cab-482d-9fa0-fda3558c2a42",
  "6fe48ae3-9c72-4be2-a731-2822969928a7",
  "980a56ab-d479-4fd2-b2c3-13dde4c74cbd",
]);

function env(name: string) {
  return (process.env[name] || "").trim();
}

function boolEnv(name: string, fallback = false) {
  const raw = env(name).toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function intEnv(name: string, fallback: number) {
  const parsed = Number.parseInt(env(name), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberEnv(name: string, fallback: number) {
  const parsed = Number.parseFloat(env(name));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCurrency(value: string | null | undefined) {
  const normalized = (value || "").trim().toLowerCase();
  return normalized || "usd";
}

function normalizeOwnerId(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function envIdSet(name: string) {
  return new Set(
    env(name)
      .split(/[,\s]+/)
      .map(normalizeOwnerId)
      .filter(Boolean),
  );
}

function fallbackBillingUserEntitlements(ownerId: string): BillingUserEntitlements {
  return {
    lifetimeFree:
      DEFAULT_LIFETIME_FREE_USER_IDS.has(ownerId) ||
      envIdSet("BILLING_LIFETIME_FREE_USER_IDS").has(ownerId),
    freeQuotaBlocked: false,
    freeQuotaResetAfterIso: null,
  };
}

function isMissingEntitlementTableError(error: { code?: string; message?: string }) {
  const message = error.message || "";
  return (
    error.code === "42P01" ||
    (/app_billing_user_entitlements|schema cache|does not exist/i.test(message) &&
      /table|relation|column|schema cache|does not exist/i.test(message))
  );
}

function normalizeResetAfterIso(value: string | null | undefined) {
  const raw = (value || "").trim();
  if (!raw) return null;
  const time = new Date(raw).getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(time).toISOString();
}

function laterIso(left: string, right: string | null) {
  if (!right) return left;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return left;
  return rightTime > leftTime ? new Date(rightTime).toISOString() : left;
}

export async function loadBillingUserEntitlements(ownerId: string): Promise<BillingUserEntitlements> {
  const normalizedOwnerId = normalizeOwnerId(ownerId);
  if (!normalizedOwnerId) {
    return {
      lifetimeFree: false,
      freeQuotaBlocked: false,
      freeQuotaResetAfterIso: null,
    };
  }

  const fallback = fallbackBillingUserEntitlements(normalizedOwnerId);
  const admin = getSupabaseAdmin();
  if (!admin) return fallback;

  const { data, error } = await admin
    .from("app_billing_user_entitlements")
    .select("entitlement,active,notes")
    .eq("owner_id", normalizedOwnerId)
    .in("entitlement", ["lifetime_free", "free_quota_blocked", "free_quota_reset_after"]);

  if (error) {
    if (!isMissingEntitlementTableError(error)) {
      console.error("Failed to load billing user entitlements:", error);
    }
    return fallback;
  }

  const entitlements: BillingUserEntitlements = {
    lifetimeFree: false,
    freeQuotaBlocked: false,
    freeQuotaResetAfterIso: null,
  };

  for (const row of data ?? []) {
    const active = Boolean(row.active);
    const entitlement = String(row.entitlement || "");
    if (entitlement === "lifetime_free") {
      entitlements.lifetimeFree = active;
    } else if (entitlement === "free_quota_blocked") {
      entitlements.freeQuotaBlocked = active;
    } else if (entitlement === "free_quota_reset_after") {
      entitlements.freeQuotaResetAfterIso = active ? normalizeResetAfterIso(row.notes as string | null) : null;
    }
  }

  return entitlements;
}

export async function isLifetimeFreeUser(ownerId: string) {
  return (await loadBillingUserEntitlements(ownerId)).lifetimeFree;
}

export function normalizeBillingPlan(plan: string | null | undefined): BillingPlanId | null {
  if (plan === "free" || plan === "normal" || plan === "usage" || plan === "pro" || plan === "business") {
    return plan;
  }
  return null;
}

export function normalizeBillingModel(value: string | null | undefined): BillingModel | null {
  if (value === "free_quota" || value === "monthly_quota" || value === "monthly_plus_usage") {
    return value;
  }
  return null;
}

export function normalizeTokenPackId(value: string | null | undefined): TokenPackId | null {
  if (
    value === "usage_credit_30k" ||
    value === "usage_credit_50k" ||
    value === "usage_credit_70k" ||
    value === "usage_credit_100k" ||
    value === "token_pack_1m"
  ) {
    return value;
  }
  return null;
}

function usageCreditPackDefaults(packId: Exclude<TokenPackId, "token_pack_1m">) {
  if (packId === "usage_credit_30k") {
    return {
      displayName: "Usage Credit 30K",
      description: "Prepaid pay-as-you-go credits for 30,000 extra AI tokens.",
      creditsEnv: "BILLING_USAGE_CREDIT_30K_TOKENS",
      priceEnv: "BILLING_USAGE_CREDIT_30K_PRICE_CENTS",
      stripePriceEnv: "STRIPE_PRICE_USAGE_CREDIT_30K",
      credits: 30_000,
      priceCents: 300,
    };
  }
  if (packId === "usage_credit_50k") {
    return {
      displayName: "Usage Credit 50K",
      description: "Prepaid pay-as-you-go credits for 50,000 extra AI tokens.",
      creditsEnv: "BILLING_USAGE_CREDIT_50K_TOKENS",
      priceEnv: "BILLING_USAGE_CREDIT_50K_PRICE_CENTS",
      stripePriceEnv: "STRIPE_PRICE_USAGE_CREDIT_50K",
      credits: 50_000,
      priceCents: 500,
    };
  }
  if (packId === "usage_credit_70k") {
    return {
      displayName: "Usage Credit 70K",
      description: "Prepaid pay-as-you-go credits for 70,000 extra AI tokens.",
      creditsEnv: "BILLING_USAGE_CREDIT_70K_TOKENS",
      priceEnv: "BILLING_USAGE_CREDIT_70K_PRICE_CENTS",
      stripePriceEnv: "STRIPE_PRICE_USAGE_CREDIT_70K",
      credits: 70_000,
      priceCents: 700,
    };
  }

  return {
    displayName: "Usage Credit 100K",
    description: "Prepaid pay-as-you-go credits for 100,000 extra AI tokens.",
    creditsEnv: "BILLING_USAGE_CREDIT_100K_TOKENS",
    priceEnv: "BILLING_USAGE_CREDIT_100K_PRICE_CENTS",
    stripePriceEnv: "STRIPE_PRICE_USAGE_CREDIT_100K",
    credits: 100_000,
    priceCents: 1000,
  };
}

export function getTokenPackConfig(packId: TokenPackId = DEFAULT_TOKEN_PACK_ID): TokenPackConfig {
  if (packId === "token_pack_1m") {
    return {
      packId,
      displayName: "Legacy Token Pack 1M",
      description: "Legacy one-time prepaid add-on for 1,000,000 extra AI tokens.",
      credits: intEnv("BILLING_TOKEN_PACK_1M_CREDITS", 1_000_000),
      priceCents: intEnv("BILLING_TOKEN_PACK_1M_PRICE_CENTS", 999),
      currency: normalizeCurrency(env("BILLING_CURRENCY") || "usd"),
      stripePriceId: env("STRIPE_PRICE_TOKEN_PACK_1M") || null,
      isActive: Boolean(env("STRIPE_PRICE_TOKEN_PACK_1M")),
    };
  }

  const defaults = usageCreditPackDefaults(packId);
  return {
    packId,
    displayName: defaults.displayName,
    description: defaults.description,
    credits: intEnv(defaults.creditsEnv, defaults.credits),
    priceCents: intEnv(defaults.priceEnv, defaults.priceCents),
    currency: normalizeCurrency(env("BILLING_CURRENCY") || "usd"),
    stripePriceId: env(defaults.stripePriceEnv) || null,
    isActive: true,
  };
}

export function listUsageCreditPackConfigs(): TokenPackConfig[] {
  return USAGE_CREDIT_PACK_IDS.map((packId) => getTokenPackConfig(packId));
}

export async function getCheckoutTokenPackConfig(packId: TokenPackId): Promise<TokenPackConfig> {
  const config = getTokenPackConfig(packId);
  if (!config.isActive) {
    throw new Error(`Token pack ${packId} is not available for checkout.`);
  }
  if (!config.stripePriceId) {
    throw new Error(`Token pack ${packId} is missing its Stripe price id.`);
  }
  return config;
}

export function isBillingConfigured() {
  return Boolean(env("STRIPE_SECRET_KEY") && env("STRIPE_WEBHOOK_SECRET") && isSupabaseServiceRoleConfigured());
}

function isProductionLikeRuntime() {
  const vercelEnv = env("VERCEL_ENV").toLowerCase();
  return (
    env("VERCEL") === "1" ||
    vercelEnv === "production" ||
    vercelEnv === "preview" ||
    process.env.NODE_ENV === "production"
  );
}

function isExplicitFalse(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off";
}

export function isBillingEnforced() {
  const raw = env("BILLING_ENFORCE");
  const productionLike = isProductionLikeRuntime();

  if (!raw) {
    return productionLike;
  }

  if (isExplicitFalse(raw)) {
    return productionLike ? boolEnv("BILLING_ALLOW_UNENFORCED_BILLING", false) : false;
  }

  return boolEnv("BILLING_ENFORCE", productionLike);
}

export function getStripe(): Stripe | null {
  const secretKey = env("STRIPE_SECRET_KEY");
  if (!secretKey) {
    return null;
  }
  return new Stripe(secretKey, { apiVersion: "2026-03-25.dahlia" });
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
      stripeBasePriceId: env("STRIPE_PRICE_NORMAL_MONTHLY") || null,
      stripeUsagePriceId: null,
      stripeMeterEventName: null,
      isPublic: true,
      isActive: true,
      sortOrder: 10,
    };
  }

  if (planId === "usage") {
    return {
      planId,
      displayName: "Pay as you go",
      description: "Metered AI token billing for continued usage after Normal quota is exhausted.",
      billingModel: "monthly_plus_usage",
      monthlyBaseCents: intEnv("BILLING_USAGE_MONTHLY_FEE_CENTS", 0),
      includedCredits: intEnv("BILLING_USAGE_INCLUDED_CREDITS", 0),
      overageUnitCents: intEnv("BILLING_USAGE_OVERAGE_UNIT_CENTS", 1),
      overageUnitName: env("BILLING_USAGE_UNIT") || "1K tokens",
      currency: normalizeCurrency(env("BILLING_CURRENCY") || "usd"),
      stripeBasePriceId: env("STRIPE_PRICE_USAGE_MONTHLY") || null,
      stripeUsagePriceId: env("STRIPE_PRICE_USAGE_METERED") || null,
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
      description: "Business monthly subscription plus usage-based billing.",
      billingModel: "monthly_plus_usage",
      monthlyBaseCents: intEnv("BILLING_BUSINESS_MONTHLY_FEE_CENTS", 9900),
      includedCredits: intEnv("BILLING_BUSINESS_MONTHLY_CREDITS", 5000),
      overageUnitCents: intEnv("BILLING_BUSINESS_OVERAGE_UNIT_CENTS", 1),
      overageUnitName: env("BILLING_BUSINESS_USAGE_UNIT") || "image",
      currency: normalizeCurrency(env("BILLING_CURRENCY") || "usd"),
      stripeBasePriceId: env("STRIPE_PRICE_BUSINESS_MONTHLY") || null,
      stripeUsagePriceId: env("STRIPE_PRICE_BUSINESS_USAGE") || null,
      stripeMeterEventName: env("STRIPE_METER_EVENT_BUSINESS") || null,
      isPublic: false,
      isActive: false,
      sortOrder: 20,
    };
  }

  if (planId === "pro") {
    return {
      planId,
      displayName: "Pro",
      description: "Pro monthly subscription plus usage-based billing.",
      billingModel: "monthly_plus_usage",
      monthlyBaseCents: intEnv("BILLING_PRO_MONTHLY_FEE_CENTS", 2900),
      includedCredits: intEnv("BILLING_PRO_MONTHLY_CREDITS", 1000),
      overageUnitCents: intEnv("BILLING_PRO_OVERAGE_UNIT_CENTS", 2),
      overageUnitName: env("BILLING_PRO_USAGE_UNIT") || "image",
      currency: normalizeCurrency(env("BILLING_CURRENCY") || "usd"),
      stripeBasePriceId: env("STRIPE_PRICE_PRO_MONTHLY") || null,
      stripeUsagePriceId: env("STRIPE_PRICE_PRO_USAGE") || null,
      stripeMeterEventName: env("STRIPE_METER_EVENT_PRO") || null,
      isPublic: false,
      isActive: false,
      sortOrder: 10,
    };
  }

  return {
    planId: "free",
    displayName: "Free",
    description: "Starter access with a hard monthly quota.",
    billingModel: "free_quota",
    monthlyBaseCents: 0,
    includedCredits: intEnv("BILLING_FREE_MONTHLY_CREDITS", 750_000),
    overageUnitCents: 0,
    overageUnitName: env("BILLING_FREE_USAGE_UNIT") || "tokens",
    currency: normalizeCurrency(env("BILLING_CURRENCY") || "usd"),
    stripeBasePriceId: null,
    stripeUsagePriceId: null,
    stripeMeterEventName: null,
    isPublic: false,
    isActive: true,
    sortOrder: 0,
  };
}

const PLAN_IDS: BillingPlanId[] = ["free", "normal", "usage", "pro", "business"];

function fallbackCatalogMap(): Map<BillingPlanId, BillingPlanConfig> {
  return new Map(PLAN_IDS.map((planId) => [planId, fallbackPlanConfig(planId)]));
}

function coercePlanConfig(row: PlanConfigRow): BillingPlanConfig | null {
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
    stripeBasePriceId: (row.stripe_base_price_id || "").trim() || fallback.stripeBasePriceId,
    stripeUsagePriceId: (row.stripe_usage_price_id || "").trim() || fallback.stripeUsagePriceId,
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
      stripeUsagePriceId: planId === "usage" ? config.stripeUsagePriceId : null,
      stripeMeterEventName: planId === "usage" ? config.stripeMeterEventName || fallback.stripeMeterEventName : null,
      isPublic: planId === "normal",
      isActive: true,
      sortOrder: fallback.sortOrder,
    };
  }

  return config;
}

async function loadBillingCatalogMap(): Promise<Map<BillingPlanId, BillingPlanConfig>> {
  const fallback = fallbackCatalogMap();
  const admin = getSupabaseAdmin();
  if (!admin) {
    return fallback;
  }

  const { data, error } = await admin
    .from("app_billing_plan_configs")
    .select(
      "plan_id,display_name,description,billing_model,monthly_base_cents,included_credits,overage_unit_cents,overage_unit_name,currency,stripe_base_price_id,stripe_usage_price_id,stripe_meter_event_name,is_public,is_active,sort_order",
    )
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("Failed to load billing plan configs:", error);
    return fallback;
  }

  for (const raw of (data || []) as PlanConfigRow[]) {
    const next = coercePlanConfig(raw);
    if (next) {
      fallback.set(next.planId, next);
    }
  }

  return fallback;
}

export async function listBillingPlanCatalog(): Promise<BillingPlanConfig[]> {
  return Array.from((await loadBillingCatalogMap()).values()).sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function listPublicBillingPlans(): Promise<BillingPlanConfig[]> {
  return (await listBillingPlanCatalog()).filter(
    (plan) => plan.isActive && plan.isPublic && plan.planId === "normal",
  );
}

async function getBillingPlanConfig(planId: BillingPlanId): Promise<BillingPlanConfig> {
  return (await loadBillingCatalogMap()).get(planId) || fallbackPlanConfig(planId);
}

export async function getCheckoutPlanConfig(planId: BillingPlanId): Promise<BillingPlanConfig> {
  const config = await getBillingPlanConfig(planId);
  if (!config.isActive || !config.isPublic || planId !== "normal") {
    throw new Error(`Plan ${planId} is not available for checkout.`);
  }
  const requiresBasePrice = config.monthlyBaseCents > 0 || config.billingModel !== "monthly_plus_usage";
  if (requiresBasePrice && !config.stripeBasePriceId) {
    throw new Error(`Plan ${planId} is missing its Stripe monthly price id.`);
  }
  if (config.billingModel === "monthly_plus_usage" && !config.stripeUsagePriceId) {
    throw new Error(`Plan ${planId} is missing its Stripe metered usage price id.`);
  }
  if (config.billingModel === "monthly_plus_usage" && !config.stripeMeterEventName) {
    throw new Error(`Plan ${planId} is missing its Stripe meter event name.`);
  }
  return config;
}

export function isSubscriptionUsable(status: string | null | undefined) {
  return status === "active" || status === "trialing";
}

export function isManagedStripeSubscriptionStatus(status: string | null | undefined) {
  return (
    status === "active" ||
    status === "trialing" ||
    status === "past_due" ||
    status === "unpaid" ||
    status === "incomplete" ||
    status === "paused"
  );
}

function stripeSubscriptionPriority(status: string | null | undefined) {
  switch (status) {
    case "active":
      return 0;
    case "trialing":
      return 1;
    case "past_due":
      return 2;
    case "unpaid":
      return 3;
    case "incomplete":
      return 4;
    case "paused":
      return 5;
    default:
      return 99;
  }
}

function isAdminOverrideSubscription(row: SubscriptionRow | null | undefined) {
  return (
    row?.billing_source === "admin_override" ||
    Boolean(row?.stripe_subscription_id?.startsWith(ADMIN_OVERRIDE_SUBSCRIPTION_PREFIX))
  );
}

function billingSource(row: SubscriptionRow | null | undefined): "none" | "stripe" | "admin_override" {
  if (!row) return "none";
  return isAdminOverrideSubscription(row) ? "admin_override" : "stripe";
}

function monthStartIso() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0)).toISOString();
}

function finiteUnixSeconds(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toIsoFromUnixSeconds(value: unknown): string | null {
  const seconds = finiteUnixSeconds(value);
  return seconds == null ? null : new Date(seconds * 1000).toISOString();
}

type StripeSubscriptionWithLegacyPeriod = Stripe.Subscription & {
  current_period_start?: number | null;
  current_period_end?: number | null;
};

type StripeSubscriptionItemWithPeriod = Stripe.SubscriptionItem & {
  current_period_start?: number | null;
  current_period_end?: number | null;
};

function subscriptionItemsWithPeriod(subscription: Stripe.Subscription): StripeSubscriptionItemWithPeriod[] {
  return (subscription.items?.data ?? []) as StripeSubscriptionItemWithPeriod[];
}

function subscriptionPeriodStartSeconds(subscription: Stripe.Subscription): number | null {
  const itemStarts = subscriptionItemsWithPeriod(subscription)
    .map((item) => finiteUnixSeconds(item.current_period_start))
    .filter((value): value is number => value != null);
  const legacySubscription = subscription as StripeSubscriptionWithLegacyPeriod;

  return (
    (itemStarts.length > 0 ? Math.max(...itemStarts) : null) ??
    finiteUnixSeconds(legacySubscription.current_period_start) ??
    finiteUnixSeconds(subscription.start_date) ??
    finiteUnixSeconds(subscription.created)
  );
}

function subscriptionPeriodEndSeconds(subscription: Stripe.Subscription): number | null {
  const itemEnds = subscriptionItemsWithPeriod(subscription)
    .map((item) => finiteUnixSeconds(item.current_period_end))
    .filter((value): value is number => value != null);
  const legacySubscription = subscription as StripeSubscriptionWithLegacyPeriod;

  return (
    (itemEnds.length > 0 ? Math.min(...itemEnds) : null) ??
    finiteUnixSeconds(legacySubscription.current_period_end)
  );
}

function toAmountInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  return null;
}

function matchPlanFromPriceIds(
  priceIds: string[],
  catalog: Map<BillingPlanId, BillingPlanConfig>,
  fallbackPlan: BillingPlanId | null,
): BillingPlanId {
  for (const [planId, config] of catalog.entries()) {
    if (
      (config.stripeBasePriceId && priceIds.includes(config.stripeBasePriceId)) ||
      (config.stripeUsagePriceId && priceIds.includes(config.stripeUsagePriceId))
    ) {
      return planId;
    }
  }

  return fallbackPlan || "free";
}

async function loadEffectiveSubscription(ownerId: string): Promise<SubscriptionRow | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin
    .from("app_subscriptions")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) {
    console.error("Failed to load billing subscription:", error);
    return null;
  }

  const rows = ((data ?? []) as SubscriptionRow[]).filter(Boolean);
  return (
    rows.find((row) => isAdminOverrideSubscription(row) && isSubscriptionUsable(row.status)) ||
    rows.find((row) => !isAdminOverrideSubscription(row) && isSubscriptionUsable(row.status)) ||
    rows[0] ||
    null
  );
}

async function loadBillingCustomerRow(ownerId: string): Promise<BillingCustomerRow | null> {
  const admin = getSupabaseAdmin();
  if (!admin) return null;

  const { data, error } = await admin
    .from("app_billing_customers")
    .select("*")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load billing customer: ${error.message}`);
  }

  return (data as BillingCustomerRow | null) ?? null;
}

async function upsertBillingCustomerRow(ownerId: string, stripeCustomerId: string, email: string | null) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("Supabase service role is not configured.");
  }

  const { error } = await admin.from("app_billing_customers").upsert(
    {
      owner_id: ownerId,
      stripe_customer_id: stripeCustomerId,
      email,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" },
  );

  if (error) {
    throw new Error(`Failed to save billing customer: ${error.message}`);
  }
}

async function listStripeSubscriptionsForCustomer(customerId: string): Promise<Stripe.Subscription[]> {
  const stripe = getStripe();
  if (!stripe) {
    throw new Error("Billing is not configured.");
  }

  const response = await stripe.subscriptions.list({
    customer: customerId,
    status: "all",
    limit: 20,
    expand: ["data.latest_invoice"],
  });

  return response.data;
}

function pickPrimaryManagedStripeSubscription(subscriptions: Stripe.Subscription[]) {
  return [...subscriptions]
    .filter((subscription) => isManagedStripeSubscriptionStatus(subscription.status))
    .sort((left, right) => {
      const priorityDelta =
        stripeSubscriptionPriority(left.status) - stripeSubscriptionPriority(right.status);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return (right.created || 0) - (left.created || 0);
    })[0] ?? null;
}

export async function syncStripeSubscriptionsForCustomer(
  customerId: string,
  ownerIdHint?: string | null,
): Promise<Stripe.Subscription | null> {
  const subscriptions = await listStripeSubscriptionsForCustomer(customerId);

  for (const subscription of subscriptions) {
    await upsertSubscriptionFromStripe(subscription, ownerIdHint);
  }

  return pickPrimaryManagedStripeSubscription(subscriptions);
}

export async function syncStripeBillingForUser(user: User): Promise<Stripe.Subscription | null> {
  if (!getStripe() || !getSupabaseAdmin()) {
    return null;
  }

  const existing = await loadBillingCustomerRow(user.id);
  if (!existing?.stripe_customer_id) {
    return null;
  }

  return syncStripeSubscriptionsForCustomer(existing.stripe_customer_id, user.id);
}

async function loadUsageRows(ownerId: string, sinceIso: string): Promise<UsageRow[]> {
  const admin = getSupabaseAdmin();
  if (!admin) return [];

  const richSelect =
    "id,created_at,image_count,total_tokens,estimated_cost_usd,conservative_cost_usd";
  const { data, error } = await admin
    .from("usage_logs")
    .select(richSelect)
    .eq("user_id", ownerId)
    .gte("created_at", sinceIso);

  if (error) {
    const { data: fallbackData, error: fallbackError } = await admin
      .from("usage_logs")
      .select("id,created_at,image_count,total_tokens")
      .eq("user_id", ownerId)
      .gte("created_at", sinceIso);

    if (fallbackError) {
      console.error("Failed to load billing usage:", fallbackError);
      return [];
    }

    return (fallbackData ?? []) as UsageRow[];
  }

  return (data ?? []) as UsageRow[];
}

function usageUnitsForPlan(row: UsageRow, planConfig: Pick<BillingPlanConfig, "overageUnitName">) {
  if (planConfig.overageUnitName.toLowerCase().includes("token")) {
    const raw = Number(row.total_tokens ?? 0);
    return Math.max(0, Number.isFinite(raw) ? raw : 0);
  }

  const raw = Number(row.image_count ?? 0);
  return Math.max(1, Number.isFinite(raw) ? raw : 0);
}

function sumUsage(rows: UsageRow[], planConfig: Pick<BillingPlanConfig, "overageUnitName">) {
  return rows.reduce((sum, row) => {
    return sum + usageUnitsForPlan(row, planConfig);
  }, 0);
}

function usesTokenUnits(planConfig: Pick<BillingPlanConfig, "overageUnitName">) {
  return planConfig.overageUnitName.toLowerCase().includes("token");
}

function meteredUnitSizeForPlan(planConfig: Pick<BillingPlanConfig, "overageUnitName">) {
  if (!usesTokenUnits(planConfig)) {
    return 1;
  }
  return Math.max(1, intEnv("BILLING_METERED_TOKEN_UNIT_SIZE", 1_000));
}

function meteredUnitsForUsage(rawUsage: number, planConfig: Pick<BillingPlanConfig, "overageUnitName">) {
  const usage = Math.max(0, Math.trunc(Number(rawUsage) || 0));
  const unitSize = meteredUnitSizeForPlan(planConfig);
  return Math.ceil(usage / unitSize);
}

function getFreeMonthlyCostLimitCents() {
  return Math.max(0, intEnv("BILLING_FREE_MONTHLY_COST_LIMIT_CENTS", 30));
}

function getFreeSeatLimit() {
  const limit = Math.max(0, intEnv("BILLING_FREE_SEAT_LIMIT", 100));
  return limit > 0 ? limit : null;
}

function getFreeMonthlyImageLimit() {
  const rawExplicit = env("BILLING_FREE_MONTHLY_IMAGE_LIMIT");
  const explicit = intEnv("BILLING_FREE_MONTHLY_IMAGE_LIMIT", 0);
  if (rawExplicit && explicit <= 0) {
    return null;
  }
  if (explicit > 0) {
    return explicit;
  }

  const costLimitUsd = getFreeMonthlyCostLimitCents() / 100;
  const costPerImageUsd = getFreeEstimatedCostPerImageUsd();
  if (costLimitUsd <= 0 || costPerImageUsd <= 0) {
    return null;
  }

  return Math.max(1, Math.floor(costLimitUsd / costPerImageUsd));
}

function getFreeEstimatedCostPerImageUsd() {
  return Math.max(0.000001, numberEnv("BILLING_FREE_ESTIMATED_COST_USD_PER_IMAGE", 0.03));
}

function getFreeEstimatedTokensPerImage() {
  return Math.max(1, intEnv("BILLING_EXTRACT_ESTIMATED_TOKENS_PER_FILE", 75_000));
}

function estimateFreeRequestCostUsd(requestedUsage: number, planConfig: Pick<BillingPlanConfig, "overageUnitName">) {
  const requested = Math.max(1, Number(requestedUsage) || 1);
  if (!usesTokenUnits(planConfig)) {
    return requested * getFreeEstimatedCostPerImageUsd();
  }

  return (requested / getFreeEstimatedTokensPerImage()) * getFreeEstimatedCostPerImageUsd();
}

function estimateFreeRequestImages(requestedUsage: number, planConfig: Pick<BillingPlanConfig, "overageUnitName">) {
  const requested = Math.max(1, Number(requestedUsage) || 1);
  if (!usesTokenUnits(planConfig)) {
    return Math.max(1, Math.ceil(requested));
  }

  return Math.max(1, Math.ceil(requested / getFreeEstimatedTokensPerImage()));
}

function usageImagesForRow(row: UsageRow) {
  const raw = Number(row.image_count ?? 0);
  return Math.max(0, Number.isFinite(raw) ? raw : 0);
}

function sumUsageImages(rows: UsageRow[]) {
  return rows.reduce((sum, row) => sum + usageImagesForRow(row), 0);
}

function fallbackCostForUsageRow(row: UsageRow) {
  const images = Math.max(1, usageImagesForRow(row));
  return images * getFreeEstimatedCostPerImageUsd();
}

function usageCostForRow(row: UsageRow) {
  const conservative = Number(row.conservative_cost_usd);
  if (Number.isFinite(conservative) && conservative >= 0) {
    return conservative;
  }

  const estimated = Number(row.estimated_cost_usd);
  if (Number.isFinite(estimated) && estimated >= 0) {
    return estimated;
  }

  return fallbackCostForUsageRow(row);
}

function sumConservativeUsageCostUsd(rows: UsageRow[]) {
  return rows.reduce((sum, row) => sum + usageCostForRow(row), 0);
}

function centsFromUsd(value: number) {
  return Math.max(0, Math.ceil((Number.isFinite(value) ? value : 0) * 100));
}

async function loadTokenLedgerSummary(ownerId: string) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return {
      purchased: 0,
      consumed: 0,
      balance: 0,
      available: 0,
    };
  }

  const { data, error } = await admin
    .from("app_billing_token_ledger")
    .select("delta_tokens,reason")
    .eq("owner_id", ownerId);

  if (error) {
    console.error("Failed to load prepaid token ledger:", error);
    return {
      purchased: 0,
      consumed: 0,
      balance: 0,
      available: 0,
    };
  }

  const rows = (data ?? []) as TokenLedgerRow[];
  const purchased = rows.reduce((sum, row) => {
    const value = Number(row.delta_tokens ?? 0);
    return value > 0 ? sum + value : sum;
  }, 0);
  const consumed = rows.reduce((sum, row) => {
    const value = Number(row.delta_tokens ?? 0);
    return value < 0 ? sum + Math.abs(value) : sum;
  }, 0);
  const balance = purchased - consumed;

  return {
    purchased,
    consumed,
    balance,
    available: Math.max(0, balance),
  };
}

function orderedUsageRows(rows: UsageRow[]) {
  return [...rows].sort((left, right) => {
    const leftTime = left.created_at ? new Date(left.created_at).getTime() : 0;
    const rightTime = right.created_at ? new Date(right.created_at).getTime() : 0;
    if (leftTime !== rightTime) {
      return leftTime - rightTime;
    }
    return left.id.localeCompare(right.id);
  });
}

function usageWindowAroundRow(
  rows: UsageRow[],
  currentUsageLogId: string,
  planConfig: Pick<BillingPlanConfig, "overageUnitName">,
) {
  let usedBefore = 0;
  let usedAfter = 0;
  let foundCurrentRow = false;

  for (const row of orderedUsageRows(rows)) {
    const rowQuantity = usageUnitsForPlan(row, planConfig);
    if (row.id === currentUsageLogId) {
      usedBefore = usedAfter;
      usedAfter += rowQuantity;
      foundCurrentRow = true;
      break;
    }
    usedAfter += rowQuantity;
  }

  return { usedBefore, usedAfter, foundCurrentRow };
}

function prepaidWindowAroundFreeRow(
  rows: UsageRow[],
  currentUsageLogId: string,
  planConfig: Pick<BillingPlanConfig, "includedCredits" | "overageUnitName">,
  freeTrialAvailable: boolean,
) {
  const imageLimit = getFreeMonthlyImageLimit();
  const costLimitCents = getFreeMonthlyCostLimitCents();
  let trialTokens = 0;
  let trialImages = 0;
  let trialCostCents = 0;
  let prepaidBefore = 0;
  let prepaidAfter = 0;
  let foundCurrentRow = false;

  for (const row of orderedUsageRows(rows)) {
    const rowTokens = usageUnitsForPlan(row, planConfig);
    const rowImages = usageImagesForRow(row);
    const rowCostCents = centsFromUsd(usageCostForRow(row));
    const withinTokenBudget = trialTokens + rowTokens <= Math.max(0, planConfig.includedCredits);
    const withinImageBudget = imageLimit == null || trialImages + rowImages <= imageLimit;
    const withinCostBudget = costLimitCents <= 0 || trialCostCents + rowCostCents <= costLimitCents;
    const coveredByFreeTrial = freeTrialAvailable && withinTokenBudget && withinImageBudget && withinCostBudget;

    if (row.id === currentUsageLogId) {
      prepaidBefore = prepaidAfter;
    }

    if (coveredByFreeTrial) {
      trialTokens += rowTokens;
      trialImages += rowImages;
      trialCostCents += rowCostCents;
    } else {
      prepaidAfter += rowTokens;
    }

    if (row.id === currentUsageLogId) {
      foundCurrentRow = true;
      break;
    }
  }

  return { prepaidBefore, prepaidAfter, foundCurrentRow };
}

async function consumePrepaidTokensForUsage(
  ownerId: string,
  usageLogId: string,
  planConfig: BillingPlanConfig,
  usageRows: UsageRow[],
  options?: { freeTrialAvailable?: boolean },
) {
  if (!planConfig.overageUnitName.toLowerCase().includes("token") || planConfig.includedCredits < 0) {
    return;
  }

  if (planConfig.planId === "free") {
    const freeSeatState = await loadFreeSeatState(ownerId, false);
    const freeTrialAvailable =
      options?.freeTrialAvailable ?? (freeSeatState.claimed || freeSeatState.available);
    const { prepaidBefore, prepaidAfter, foundCurrentRow } = prepaidWindowAroundFreeRow(
      usageRows,
      usageLogId,
      planConfig,
      freeTrialAvailable,
    );
    if (!foundCurrentRow) {
      return;
    }

    const tokensToConsume = prepaidAfter - prepaidBefore;
    if (tokensToConsume <= 0) {
      return;
    }

    const admin = getSupabaseAdmin();
    if (!admin) {
      return;
    }

    const { error } = await admin.from("app_billing_token_ledger").insert({
      owner_id: ownerId,
      delta_tokens: -tokensToConsume,
      reason: "quota_overage_consumption",
      usage_log_id: usageLogId,
      description: "Consumed prepaid pay-as-you-go tokens after Free trial budget was exhausted.",
      metadata: {
        plan_id: planConfig.planId,
        free_monthly_cost_limit_cents: getFreeMonthlyCostLimitCents(),
        free_monthly_image_limit: getFreeMonthlyImageLimit(),
        prepaid_before: prepaidBefore,
        prepaid_after: prepaidAfter,
      },
    });

    if (error && error.code !== "23505") {
      console.error("Failed to consume prepaid token ledger:", error);
    }
    return;
  }

  const { usedBefore, usedAfter, foundCurrentRow } = usageWindowAroundRow(usageRows, usageLogId, planConfig);
  if (!foundCurrentRow) {
    return;
  }

  const consumedBefore = Math.max(0, usedBefore - planConfig.includedCredits);
  const consumedAfter = Math.max(0, usedAfter - planConfig.includedCredits);
  const tokensToConsume = consumedAfter - consumedBefore;
  if (tokensToConsume <= 0) {
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return;
  }

  const { error } = await admin.from("app_billing_token_ledger").insert({
    owner_id: ownerId,
    delta_tokens: -tokensToConsume,
    reason: "quota_overage_consumption",
    usage_log_id: usageLogId,
    description: "Consumed prepaid tokens after monthly included quota was exhausted.",
    metadata: {
      plan_id: planConfig.planId,
      monthly_included_tokens: planConfig.includedCredits,
      used_before: usedBefore,
      used_after: usedAfter,
    },
  });

  if (error && error.code !== "23505") {
    console.error("Failed to consume prepaid token ledger:", error);
  }
}

export type BillingUsageAction =
  | "extract_table"
  | "template_from_image"
  | "guidance_chat"
  | "preview_fill";

export function estimateBillingTokensForAction(actionType: BillingUsageAction, units = 1) {
  const count = Math.max(1, Math.trunc(Number(units) || 1));
  const perUnit =
    actionType === "extract_table"
      ? intEnv("BILLING_EXTRACT_ESTIMATED_TOKENS_PER_FILE", 75_000)
      : actionType === "template_from_image"
        ? intEnv("BILLING_TEMPLATE_ESTIMATED_TOKENS", 75_000)
        : actionType === "preview_fill"
          ? intEnv("BILLING_PREVIEW_ESTIMATED_TOKENS", 75_000)
          : intEnv("BILLING_GUIDANCE_ESTIMATED_TOKENS", 50_000);

  return Math.max(1, count * Math.max(1, perUnit));
}

function parseFreeSeatState(raw: unknown, fallbackLimit: number | null): FreeSeatState | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const value = raw as Record<string, unknown>;
  const limitRaw = Number(value.limit);
  const usedRaw = Number(value.used);
  const ok = value.ok === true;
  const claimed = value.claimed === true || value.reason === "already_claimed";

  return {
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : fallbackLimit,
    used: Number.isFinite(usedRaw) && usedRaw >= 0 ? usedRaw : null,
    claimed,
    available: ok || claimed,
    reason: typeof value.reason === "string" ? value.reason : null,
  };
}

async function loadFreeSeatState(ownerId: string, claim: boolean): Promise<FreeSeatState> {
  const limit = getFreeSeatLimit();
  if (limit == null) {
    return { limit: null, used: null, claimed: true, available: true, reason: "unlimited" };
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    return { limit, used: null, claimed: false, available: true, reason: "billing_not_configured" };
  }

  if (claim) {
    const { data, error } = await admin.rpc("claim_free_plan_seat", {
      p_owner_id: ownerId,
      p_seat_limit: limit,
    });

    if (!error) {
      const parsed = parseFreeSeatState(data, limit);
      if (parsed) {
        return parsed;
      }
    } else {
      console.error("Failed to claim Free plan seat:", error);
    }
  }

  const { data: existing, error: existingError } = await admin
    .from("app_free_plan_seats")
    .select("owner_id")
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (existingError) {
    console.error("Failed to load Free plan seat:", existingError);
    return { limit, used: null, claimed: false, available: true, reason: "free_seat_table_missing" };
  }

  const { count, error: countError } = await admin
    .from("app_free_plan_seats")
    .select("owner_id", { count: "exact", head: true });

  if (countError) {
    console.error("Failed to count Free plan seats:", countError);
    return { limit, used: null, claimed: Boolean(existing), available: Boolean(existing), reason: "free_seat_count_failed" };
  }

  const used = Math.max(0, count ?? 0);
  const claimed = Boolean(existing);
  if (claim && !claimed && used < limit) {
    const { error: insertError } = await admin.from("app_free_plan_seats").insert({ owner_id: ownerId });
    if (insertError) {
      console.error("Failed to insert Free plan seat:", insertError);
      return {
        limit,
        used,
        claimed: false,
        available: used < limit,
        reason: "free_seat_insert_failed",
      };
    }

    return {
      limit,
      used: used + 1,
      claimed: true,
      available: true,
      reason: "claimed_without_rpc",
    };
  }

  return {
    limit,
    used,
    claimed,
    available: claimed || used < limit,
    reason: claimed ? "already_claimed" : used < limit ? "available" : "free_seats_full",
  };
}

export async function getBillingStatusForUser(ownerId: string): Promise<BillingStatus> {
  const configured = isBillingConfigured();
  const enforced = isBillingEnforced();
  const billingEntitlements = await loadBillingUserEntitlements(ownerId);
  const lifetimeFree = billingEntitlements.lifetimeFree;
  const subscription = await loadEffectiveSubscription(ownerId);
  const usable = isSubscriptionUsable(subscription?.status);
  const explicitPlan = normalizeBillingPlan(subscription?.plan);
  const catalog = await loadBillingCatalogMap();
  const plan = lifetimeFree ? "free" : usable ? explicitPlan || "free" : explicitPlan === "free" ? "free" : "free";
  const freeQuotaBlocked = !lifetimeFree && plan === "free" && billingEntitlements.freeQuotaBlocked;
  const basePlanConfig = catalog.get(plan) || fallbackPlanConfig(plan);
  const planConfig: BillingPlanConfig = lifetimeFree
    ? {
        ...basePlanConfig,
        displayName: "Lifetime Free",
        description: "Lifetime free account with unrestricted OrSight AI usage.",
        billingModel: "free_quota",
        monthlyBaseCents: 0,
        includedCredits: -1,
        overageUnitCents: 0,
        stripeBasePriceId: null,
        stripeUsagePriceId: null,
        stripeMeterEventName: null,
      }
    : basePlanConfig;
  const periodStart = subscription?.current_period_start || monthStartIso();
  const usageStart = !lifetimeFree && plan === "free"
    ? laterIso(periodStart, billingEntitlements.freeQuotaResetAfterIso)
    : periodStart;
  const usageRows = await loadUsageRows(ownerId, usageStart);
  const used = sumUsage(usageRows, planConfig);
  const monthlyImagesUsed = sumUsageImages(usageRows);
  const freeMonthlyCostUsedUsd = plan === "free" ? sumConservativeUsageCostUsd(usageRows) : 0;
  const freeMonthlyCostUsedCents = centsFromUsd(freeMonthlyCostUsedUsd);
  const freeMonthlyCostLimitCents = !lifetimeFree && plan === "free" ? getFreeMonthlyCostLimitCents() : 0;
  const freeMonthlyCostRemainingCents =
    !lifetimeFree && plan === "free" && freeMonthlyCostLimitCents > 0
      ? Math.max(0, freeMonthlyCostLimitCents - freeMonthlyCostUsedCents)
      : null;
  const freeMonthlyImageLimit = !lifetimeFree && plan === "free" ? getFreeMonthlyImageLimit() : null;
  const freeMonthlyImagesRemaining =
    !lifetimeFree && plan === "free" && freeMonthlyImageLimit != null
      ? Math.max(0, freeMonthlyImageLimit - monthlyImagesUsed)
      : null;
  const freeSeatState =
    lifetimeFree
      ? { limit: null, used: null, claimed: true, available: true, reason: "lifetime_free" }
      : plan === "free"
        ? await loadFreeSeatState(ownerId, false)
        : { limit: null, used: null, claimed: true, available: true, reason: null };
  const tokenLedger = await loadTokenLedgerSummary(ownerId);
  const remainingIncluded =
    planConfig.includedCredits < 0 ? null : Math.max(0, planConfig.includedCredits - used);
  const effectiveRemaining =
    remainingIncluded == null ? null : remainingIncluded + tokenLedger.available;
  const billableUsage =
    planConfig.billingModel === "monthly_plus_usage"
      ? Math.max(0, used - Math.max(0, planConfig.includedCredits))
      : 0;
  const meteredUnitSize = meteredUnitSizeForPlan(planConfig);
  const meteredBillableUnits =
    planConfig.billingModel === "monthly_plus_usage" ? meteredUnitsForUsage(billableUsage, planConfig) : 0;
  const estimatedOverageCents = meteredBillableUnits * Math.max(0, planConfig.overageUnitCents);

  let canUseAi = true;
  if (lifetimeFree) {
    canUseAi = true;
  } else if (enforced) {
    if (planConfig.billingModel === "monthly_plus_usage") {
      canUseAi = usable;
    } else {
      const hasRemaining = effectiveRemaining == null || effectiveRemaining > 0;
      const hasPrepaidTokens = plan === "free" && tokenLedger.available > 0;
      const hasFreeCostBudget =
        plan !== "free" ||
        hasPrepaidTokens ||
        freeMonthlyCostLimitCents <= 0 ||
        freeMonthlyCostUsedCents < freeMonthlyCostLimitCents;
      const hasFreeImageBudget =
        plan !== "free" || hasPrepaidTokens || freeMonthlyImageLimit == null || monthlyImagesUsed < freeMonthlyImageLimit;
      const hasFreeSeat = plan !== "free" || hasPrepaidTokens || freeSeatState.available;
      const hasFreeAdminAccess = plan !== "free" || hasPrepaidTokens || !freeQuotaBlocked;
      canUseAi = usable ? hasRemaining : plan === "free" && hasRemaining;
      canUseAi = canUseAi && hasFreeCostBudget && hasFreeImageBudget && hasFreeSeat && hasFreeAdminAccess;
    }
  }

  let message: string | null = null;
  if (!lifetimeFree && enforced && !canUseAi) {
    if (planConfig.billingModel === "monthly_plus_usage") {
      message = "Your subscription is inactive. Please update payment or manage your subscription.";
    } else if (plan === "free" && freeQuotaBlocked) {
      message = "Free usage is disabled for this account. Upgrade to Normal or buy prepaid usage credits to continue.";
    } else if (plan === "free" && !freeSeatState.available) {
      message = "Free beta seats are full. Upgrade to Normal or buy prepaid usage credits to continue.";
    } else if (plan === "free" && freeMonthlyCostLimitCents > 0 && freeMonthlyCostUsedCents >= freeMonthlyCostLimitCents) {
      message = "Your Free monthly AI cost budget has been used. Upgrade to Normal or buy prepaid usage credits to continue.";
    } else if (plan === "free" && freeMonthlyImageLimit != null && monthlyImagesUsed >= freeMonthlyImageLimit) {
      message = "Your Free monthly image quota has been used. Upgrade to Normal or buy prepaid usage credits to continue.";
    } else {
      message = "Your monthly AI token quota has been used. Buy prepaid usage credits or manage your subscription to continue.";
    }
  }

  const availableTokenPacks =
    lifetimeFree || planConfig.billingModel === "monthly_plus_usage" ? [] : listUsageCreditPackConfigs();
  const defaultTokenPack =
    availableTokenPacks.find((pack) => pack.packId === DEFAULT_TOKEN_PACK_ID) || availableTokenPacks[0] || null;

  return {
    enabled: true,
    configured,
    enforced,
    lifetimeFree,
    freeQuotaBlocked,
    freeQuotaResetAfterIso: billingEntitlements.freeQuotaResetAfterIso,
    plan,
    planLabel: planConfig.displayName,
    billingModel: planConfig.billingModel,
    subscriptionStatus: subscription?.status || null,
    paymentStatus: subscription?.latest_invoice_status || null,
    billingSource: lifetimeFree ? "admin_override" : billingSource(subscription),
    stripeCustomerId: subscription?.stripe_customer_id || null,
    stripeSubscriptionId: subscription?.stripe_subscription_id || null,
    currentPeriodEndIso: subscription?.current_period_end || null,
    monthlyBaseCents: planConfig.monthlyBaseCents,
    monthlyQuota: planConfig.includedCredits,
    monthlyUsed: used,
    monthlyImagesUsed,
    remainingIncluded,
    freeMonthlyCostLimitCents,
    freeMonthlyCostUsedCents,
    freeMonthlyCostRemainingCents,
    freeMonthlyImageLimit,
    freeMonthlyImagesRemaining,
    freeSeatLimit: freeSeatState.limit,
    freeSeatsUsed: freeSeatState.used,
    freeSeatClaimed: freeSeatState.claimed,
    freeSeatAvailable: freeSeatState.available,
    prepaidTokensPurchased: tokenLedger.purchased,
    prepaidTokensConsumed: tokenLedger.consumed,
    prepaidTokensBalance: tokenLedger.balance,
    prepaidTokensAvailable: tokenLedger.available,
    effectiveRemaining,
    billableUsage,
    meteredBillableUnits,
    meteredUnitSize,
    estimatedOverageCents,
    overageUnitCents: planConfig.overageUnitCents,
    overageUnitName: planConfig.overageUnitName,
    tokenPack: defaultTokenPack,
    tokenPacks: availableTokenPacks,
    canUseAi: lifetimeFree ? true : !configured ? !enforced : canUseAi,
    upgradeRequired: lifetimeFree ? false : configured ? !canUseAi : enforced,
    message:
      !configured && enforced
        ? "Billing is enforced but Stripe/Supabase billing is not configured."
        : message,
  };
}

export async function requireBillingEntitlement(
  ownerId: string,
  quantity = 1,
): Promise<{
  ok: boolean;
  status: BillingStatus;
  response?: Response;
}> {
  const status = await getBillingStatusForUser(ownerId);
  const requested = Math.max(1, quantity);

  if (status.lifetimeFree) {
    return { ok: true, status };
  }

  if (!status.enforced) {
    return { ok: true, status };
  }

  if (status.billingModel === "monthly_plus_usage") {
    if (status.canUseAi) {
      return { ok: true, status };
    }
  } else {
    if (status.plan === "free") {
      const requestCostCents = centsFromUsd(
        estimateFreeRequestCostUsd(requested, {
          overageUnitName: status.overageUnitName,
        }),
      );
      const requestImages = estimateFreeRequestImages(requested, {
        overageUnitName: status.overageUnitName,
      });
      const exceedsFreeCostBudget =
        status.freeMonthlyCostLimitCents > 0 &&
        status.freeMonthlyCostUsedCents + requestCostCents > status.freeMonthlyCostLimitCents;
      const exceedsFreeImageQuota =
        status.freeMonthlyImageLimit != null &&
        status.monthlyImagesUsed + requestImages > status.freeMonthlyImageLimit;
      const needsPrepaidTokens = exceedsFreeCostBudget || exceedsFreeImageQuota;
      const hasPrepaidForRequest = status.prepaidTokensAvailable >= requested;

      if (needsPrepaidTokens && !hasPrepaidForRequest) {
        return {
          ok: false,
          status: {
            ...status,
            canUseAi: false,
            upgradeRequired: true,
            message: "Your Free trial budget is used. Upgrade to Normal or buy prepaid usage credits to continue.",
          },
          response: Response.json(
            {
              error: "Your Free trial budget is used. Upgrade to Normal or buy prepaid usage credits to continue.",
              code: exceedsFreeCostBudget ? "free_cost_budget_exceeded" : "free_image_quota_exceeded",
              requestedTokens: requested,
              estimatedRequestCostCents: requestCostCents,
              estimatedRequestImages: requestImages,
              billing: status,
            },
            { status: 402 },
          ),
        };
      }

      if (!needsPrepaidTokens) {
        const claimedSeat = await loadFreeSeatState(ownerId, true);
        if (!claimedSeat.available && !hasPrepaidForRequest) {
          return {
            ok: false,
            status: {
              ...status,
              freeSeatLimit: claimedSeat.limit,
              freeSeatsUsed: claimedSeat.used,
              freeSeatClaimed: claimedSeat.claimed,
              freeSeatAvailable: false,
              canUseAi: false,
              upgradeRequired: true,
              message: "Free beta seats are full. Upgrade to Normal or buy prepaid usage credits to continue.",
            },
            response: Response.json(
              {
                error: "Free beta seats are full. Upgrade to Normal or buy prepaid usage credits to continue.",
                code: "free_seats_full",
                requestedTokens: requested,
                billing: {
                  ...status,
                  freeSeatLimit: claimedSeat.limit,
                  freeSeatsUsed: claimedSeat.used,
                  freeSeatClaimed: claimedSeat.claimed,
                  freeSeatAvailable: false,
                },
              },
              { status: 402 },
            ),
          };
        }

        if (!claimedSeat.available && hasPrepaidForRequest) {
          return {
            ok: true,
            status: {
              ...status,
              freeSeatLimit: claimedSeat.limit,
              freeSeatsUsed: claimedSeat.used,
              freeSeatClaimed: claimedSeat.claimed,
              freeSeatAvailable: false,
              canUseAi: true,
              upgradeRequired: false,
              message: null,
            },
          };
        }
      }

      if (needsPrepaidTokens && hasPrepaidForRequest) {
        return {
          ok: true,
          status: {
            ...status,
            canUseAi: true,
            upgradeRequired: false,
            message: null,
          },
        };
      }
    }

    const enough = status.effectiveRemaining == null || status.effectiveRemaining >= requested;
    if (status.canUseAi && enough) {
      return { ok: true, status };
    }
  }

  return {
    ok: false,
    status,
    response: Response.json(
      {
        error:
          status.message ||
          "AI token quota exceeded. Please upgrade or manage your subscription before continuing.",
        code: "billing_required",
        requestedTokens: requested,
        billing: status,
      },
      { status: 402 },
    ),
  };
}

export async function recordBillingUsage(input: UsageLogInput) {
  const admin = getSupabaseAdmin();
  if (!admin) return;

  const quantity = Math.max(1, input.quantity || 1);
  const requestCount = Math.max(1, input.requestCount || 1);
  const promptTokens = Math.max(0, input.promptTokens || 0);
  const cachedInputTokens = Math.max(0, input.cachedInputTokens || 0);
  const completionTokens = Math.max(0, input.completionTokens || 0);
  const totalTokens = Math.max(0, input.totalTokens || 0);
  const pricingTier = input.pricingTier || "standard";
  const estimatedCostUsd = Number(
    (
      input.estimatedCostUsd ??
      estimateOpenAITokenCostUsd({
        model: input.modelUsed || "n/a",
        promptTokens,
        cachedInputTokens,
        completionTokens,
        pricingTier,
      })
    ).toFixed(6),
  );
  const conservativeCostUsd = Number(
    Math.max(input.conservativeCostUsd ?? estimatedCostUsd, estimatedCostUsd).toFixed(6),
  );
  const openAIRequestIds = [...new Set((input.openAIRequestIds || []).map((value) => value.trim()).filter(Boolean))];
  const clientRequestIds = [...new Set((input.clientRequestIds || []).map((value) => value.trim()).filter(Boolean))];
  const createdAtIso = new Date().toISOString();
  const { data, error } = await admin
    .from("usage_logs")
    .insert({
      user_id: input.userId,
      form_id: normalizeFormId(input.formId),
      action_type: input.actionType,
      image_count: quantity,
      request_count: requestCount,
      prompt_tokens: promptTokens,
      cached_input_tokens: cachedInputTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      model_used: input.modelUsed || "n/a",
      openai_project_id: input.openAIProjectId || null,
      openai_api_key_id: input.openAIApiKeyId || null,
      openai_request_ids: openAIRequestIds,
      client_request_ids: clientRequestIds,
      service_tier: input.serviceTier || null,
      pricing_tier: pricingTier,
      openai_endpoint: (input.openAIEndpoint || "").trim() || "/v1/chat/completions",
      pricing_basis_version: (input.pricingBasisVersion || "").trim() || OPENAI_PRICING_BASIS_VERSION,
      estimated_cost_usd: estimatedCostUsd,
      conservative_cost_usd: conservativeCostUsd,
      created_at: createdAtIso,
    })
    .select("id,created_at")
    .single();

  if (error) {
    console.error("Failed to record billing usage:", error);
    return;
  }

  const billingEntitlements = await loadBillingUserEntitlements(input.userId);
  if (billingEntitlements.lifetimeFree) {
    return;
  }

  const subscription = await loadEffectiveSubscription(input.userId);
  const usableSubscription = isSubscriptionUsable(subscription?.status);
  const plan = usableSubscription ? normalizeBillingPlan(subscription?.plan) || "free" : "free";
  const planConfig = await getBillingPlanConfig(plan);
  const currentPeriodStart = usableSubscription ? subscription?.current_period_start || monthStartIso() : monthStartIso();
  const usageStart =
    plan === "free" ? laterIso(currentPeriodStart, billingEntitlements.freeQuotaResetAfterIso) : currentPeriodStart;
  const usageRows = await loadUsageRows(input.userId, usageStart);

  if (planConfig.billingModel === "free_quota" || planConfig.billingModel === "monthly_quota") {
    await consumePrepaidTokensForUsage(input.userId, data.id, planConfig, usageRows, {
      freeTrialAvailable: plan === "free" ? !billingEntitlements.freeQuotaBlocked : undefined,
    });
    return;
  }

  if (
    !subscription ||
    !usableSubscription ||
    isAdminOverrideSubscription(subscription) ||
    planConfig.billingModel !== "monthly_plus_usage" ||
    !planConfig.stripeMeterEventName ||
    !subscription.stripe_customer_id
  ) {
    return;
  }

  const stripe = getStripe();
  if (!stripe) {
    return;
  }

  const usageWindow = usageWindowAroundRow(usageRows, data.id, planConfig);
  let usedBefore = usageWindow.usedBefore;
  let usedAfter = usageWindow.usedAfter;
  const foundCurrentRow = usageWindow.foundCurrentRow;

  if (!foundCurrentRow) {
    const currentRowQuantity =
      planConfig.overageUnitName.toLowerCase().includes("token") ? totalTokens : quantity;
    usedAfter = sumUsage(usageRows, planConfig);
    usedBefore = Math.max(0, usedAfter - currentRowQuantity);
  }

  const overageBefore = planConfig.includedCredits < 0 ? 0 : Math.max(0, usedBefore - planConfig.includedCredits);
  const overageAfter = planConfig.includedCredits < 0 ? 0 : Math.max(0, usedAfter - planConfig.includedCredits);
  const meteredQuantity =
    meteredUnitsForUsage(overageAfter, planConfig) - meteredUnitsForUsage(overageBefore, planConfig);

  if (meteredQuantity <= 0) {
    return;
  }

  try {
    await stripe.billing.meterEvents.create({
      event_name: planConfig.stripeMeterEventName,
      identifier: `usage_log:${data.id}`,
      timestamp: Math.floor(new Date(data.created_at || createdAtIso).getTime() / 1000),
      payload: {
        stripe_customer_id: subscription.stripe_customer_id,
        value: String(meteredQuantity),
      },
    });
  } catch (meterError) {
    console.error("Failed to emit Stripe meter event:", meterError);
  }
}

export async function ensureStripeCustomerForUser(user: User): Promise<string> {
  const stripe = getStripe();
  if (!stripe || !getSupabaseAdmin()) {
    throw new Error("Billing is not configured.");
  }

  const existing = await loadBillingCustomerRow(user.id);
  if (existing?.stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(existing.stripe_customer_id);
      if (!customer.deleted) {
        const nextEmail = user.email || null;
        const currentEmail = customer.email || null;
        const currentOwnerId = typeof customer.metadata?.owner_id === "string" ? customer.metadata.owner_id : null;

        if (currentEmail !== nextEmail || currentOwnerId !== user.id) {
          await stripe.customers.update(existing.stripe_customer_id, {
            email: nextEmail || undefined,
            metadata: {
              ...customer.metadata,
              owner_id: user.id,
            },
          });
        }

        if ((existing.email || null) !== nextEmail) {
          await upsertBillingCustomerRow(user.id, existing.stripe_customer_id, nextEmail);
        }

        return existing.stripe_customer_id;
      }
    } catch (error) {
      const stripeCode =
        error instanceof Stripe.errors.StripeError
          ? error.code
          : typeof error === "object" && error && "code" in error
            ? String((error as { code?: unknown }).code || "")
            : "";
      if (stripeCode !== "resource_missing") {
        throw error;
      }
    }
  }

  const customer = await stripe.customers.create({
    email: user.email || undefined,
    metadata: {
      owner_id: user.id,
    },
  });

  await upsertBillingCustomerRow(user.id, customer.id, user.email || null);
  return customer.id;
}

function parsePositiveInt(value: unknown, fallback: number) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number.parseInt(value, 10)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export async function grantTokenPackFromCheckoutSession(session: Stripe.Checkout.Session) {
  if (session.mode !== "payment") {
    return;
  }
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
    return;
  }

  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("Supabase service role is not configured.");
  }

  const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id || null;
  const ownerId =
    session.metadata?.owner_id ||
    session.client_reference_id ||
    (await resolveOwnerIdFromStripeCustomer(stripeCustomerId));

  if (!ownerId) {
    throw new Error("Cannot map token pack checkout session to an OrSight user.");
  }

  const packId = normalizeTokenPackId(session.metadata?.pack_id) || DEFAULT_TOKEN_PACK_ID;
  const pack = getTokenPackConfig(packId);
  const tokenCredits = parsePositiveInt(session.metadata?.token_credits, pack.credits);
  const paymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;

  if (stripeCustomerId) {
    await admin.from("app_billing_customers").upsert(
      {
        owner_id: ownerId,
        stripe_customer_id: stripeCustomerId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" },
    );
  }

  const { error } = await admin.from("app_billing_token_ledger").insert({
    owner_id: ownerId,
    delta_tokens: tokenCredits,
    reason: "token_pack_purchase",
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: paymentIntentId,
    stripe_price_id: session.metadata?.stripe_price_id || pack.stripePriceId,
    description: pack.displayName,
    metadata: {
      pack_id: pack.packId,
      payment_status: session.payment_status,
      amount_total: session.amount_total,
      currency: session.currency,
    },
  });

  if (error && error.code !== "23505") {
    throw new Error(`Failed to grant token pack credits: ${error.message}`);
  }
}

function buildInvoiceSnapshot(invoice: Stripe.Invoice | null | undefined) {
  if (!invoice) {
    return {
      latest_invoice_id: null,
      latest_invoice_status: null,
      latest_invoice_amount_due: null,
      latest_invoice_amount_paid: null,
      latest_invoice_amount_remaining: null,
      currency: null,
    };
  }

  return {
    latest_invoice_id: invoice.id || null,
    latest_invoice_status: invoice.status || null,
    latest_invoice_amount_due: toAmountInt(invoice.amount_due),
    latest_invoice_amount_paid: toAmountInt(invoice.amount_paid),
    latest_invoice_amount_remaining: toAmountInt(invoice.amount_remaining),
    currency: normalizeCurrency(invoice.currency || undefined),
  };
}

async function resolveOwnerIdFromStripeCustomer(
  stripeCustomerId: string | null,
  ownerIdHint?: string | null,
): Promise<string | null> {
  if (ownerIdHint) return ownerIdHint;
  const admin = getSupabaseAdmin();
  if (!admin || !stripeCustomerId) return null;

  const { data } = await admin
    .from("app_billing_customers")
    .select("owner_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();

  return (data as { owner_id?: string } | null)?.owner_id || null;
}

export async function upsertSubscriptionFromStripe(
  subscription: Stripe.Subscription,
  ownerIdHint?: string | null,
) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("Supabase service role is not configured.");
  }

  const stripeCustomerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || null;
  const ownerIdFromMetadata =
    typeof subscription.metadata?.owner_id === "string" && subscription.metadata.owner_id
      ? subscription.metadata.owner_id
      : null;
  const ownerId = await resolveOwnerIdFromStripeCustomer(stripeCustomerId, ownerIdHint || ownerIdFromMetadata);

  if (!ownerId || !stripeCustomerId) {
    throw new Error("Cannot map Stripe subscription to an OrSight user.");
  }

  await admin.from("app_billing_customers").upsert(
    {
      owner_id: ownerId,
      stripe_customer_id: stripeCustomerId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id" },
  );

  const catalog = await loadBillingCatalogMap();
  const priceIds = subscription.items.data.map((item) => item.price?.id).filter(Boolean) as string[];
  const plan = matchPlanFromPriceIds(priceIds, catalog, normalizeBillingPlan(subscription.metadata?.plan) || null);

  const latestInvoice =
    typeof subscription.latest_invoice === "string" ? null : (subscription.latest_invoice as Stripe.Invoice | null);
  const invoiceSnapshot = buildInvoiceSnapshot(latestInvoice);
  const periodStart = subscriptionPeriodStartSeconds(subscription);
  const periodEnd = subscriptionPeriodEndSeconds(subscription);

  const { error } = await admin.from("app_subscriptions").upsert(
    {
      owner_id: ownerId,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceIds[0] || null,
      plan,
      status: subscription.status,
      current_period_start: toIsoFromUnixSeconds(periodStart),
      current_period_end: toIsoFromUnixSeconds(periodEnd),
      cancel_at_period_end: subscription.cancel_at_period_end,
      billing_source: "stripe",
      ...invoiceSnapshot,
      raw: subscription as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id,stripe_subscription_id" },
  );

  if (error) {
    throw new Error(`Failed to save subscription: ${error.message}`);
  }
}

export async function upsertInvoiceSnapshotFromStripe(invoice: Stripe.Invoice) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("Supabase service role is not configured.");
  }

  const stripeInvoice = invoice as Stripe.Invoice & {
    subscription?: string | Stripe.Subscription | null;
  };
  const stripeCustomerId =
    typeof stripeInvoice.customer === "string" ? stripeInvoice.customer : stripeInvoice.customer?.id || null;
  const stripeSubscriptionId =
    typeof stripeInvoice.subscription === "string"
      ? stripeInvoice.subscription
      : stripeInvoice.subscription?.id || null;

  if (!stripeCustomerId && !stripeSubscriptionId) {
    return;
  }

  const patch = {
    latest_invoice_id: invoice.id || null,
    latest_invoice_status: invoice.status || null,
    latest_invoice_amount_due: toAmountInt(invoice.amount_due),
    latest_invoice_amount_paid: toAmountInt(invoice.amount_paid),
    latest_invoice_amount_remaining: toAmountInt(invoice.amount_remaining),
    currency: normalizeCurrency(invoice.currency || undefined),
    updated_at: new Date().toISOString(),
  };

  let query = admin.from("app_subscriptions").update(patch);
  if (stripeSubscriptionId) {
    query = query.eq("stripe_subscription_id", stripeSubscriptionId);
  }
  if (stripeCustomerId) {
    query = query.eq("stripe_customer_id", stripeCustomerId);
  }

  const { error } = await query;
  if (error) {
    throw new Error(`Failed to sync invoice snapshot: ${error.message}`);
  }
}
