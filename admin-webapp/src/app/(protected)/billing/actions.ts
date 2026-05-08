"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type Stripe from "stripe";

import {
  type BillingPlanConfig,
  type BillingPlanId,
  type BillingSubscriptionRow,
  getAdminOverrideSubscriptionId,
  getPlanConfigMap,
  getStripeAdmin,
  isAdminOverrideSubscription,
  listBillingPlanConfigs,
  monthStartIso,
  normalizeBillingModel,
  normalizeBillingPlan,
  oneYearFromNowIso,
  PLAN_IDS,
} from "@/lib/billing-admin";
import { createAdminClient } from "@/lib/supabase/server";
import { requireAdminActor } from "@/lib/viz-admin-verify";

function buildRedirectTarget(formData: FormData) {
  const returnTo = asString(formData.get("returnTo"));
  if (!returnTo.startsWith("/")) {
    return {
      pathname: "/billing",
      searchParams: new URLSearchParams(),
    };
  }

  const url = new URL(returnTo, "http://localhost");
  return {
    pathname: url.pathname || "/billing",
    searchParams: new URLSearchParams(url.search),
  };
}

function backAfterAction(formData: FormData, params: Record<string, string>) {
  const target = buildRedirectTarget(formData);
  revalidatePath("/billing");
  revalidatePath("/usage-board");
  revalidatePath("/users");
  revalidatePath("/account");
  revalidatePath(target.pathname);

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      target.searchParams.set(key, value);
    } else {
      target.searchParams.delete(key);
    }
  }

  const search = target.searchParams.toString();
  redirect(`${target.pathname}${search ? `?${search}` : ""}`);
}

async function requireBillingAdmin(formData: FormData) {
  const target = buildRedirectTarget(formData);
  const search = target.searchParams.toString();
  await requireAdminActor(`${target.pathname}${search ? `?${search}` : ""}`);
}

function asString(value: FormDataEntryValue | null) {
  return String(value || "").trim();
}

function asInt(value: FormDataEntryValue | null, fallback = 0) {
  const parsed = Number.parseInt(asString(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asBool(value: FormDataEntryValue | null) {
  const normalized = asString(value).toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "on" || normalized === "yes";
}

function currentFocus(formData: FormData) {
  return asString(formData.get("focus"));
}

async function loadPlanConfigs() {
  const sb = await createAdminClient();
  return { sb, configs: await listBillingPlanConfigs(sb) };
}

function lookupPlan(configs: BillingPlanConfig[], planId: BillingPlanId) {
  const map = getPlanConfigMap(configs);
  const config = map.get(planId);
  if (!config) {
    throw new Error(`Missing billing plan config for ${planId}.`);
  }
  return config;
}

async function loadLatestStripeSubscription(
  ownerId: string,
): Promise<{
  row: BillingSubscriptionRow | null;
  sb: Awaited<ReturnType<typeof createAdminClient>>;
}> {
  const sb = await createAdminClient();
  const { data, error } = await sb
    .from("app_subscriptions")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(`Failed to load subscription: ${error.message}`);
  }

  const rows = ((data ?? []) as BillingSubscriptionRow[]).filter(
    (row) => row.stripe_subscription_id && !isAdminOverrideSubscription(row),
  );

  return { sb, row: rows[0] || null };
}

function invoiceSnapshot(invoice: Stripe.Invoice | null | undefined) {
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
    latest_invoice_amount_due: typeof invoice.amount_due === "number" ? invoice.amount_due : null,
    latest_invoice_amount_paid: typeof invoice.amount_paid === "number" ? invoice.amount_paid : null,
    latest_invoice_amount_remaining:
      typeof invoice.amount_remaining === "number" ? invoice.amount_remaining : null,
    currency: invoice.currency || null,
  };
}

async function upsertStripeSubscriptionRecord(
  sb: Awaited<ReturnType<typeof createAdminClient>>,
  subscription: Stripe.Subscription,
  configs: BillingPlanConfig[],
  ownerId: string,
) {
  const sub = subscription as Stripe.Subscription & {
    current_period_start?: number;
    current_period_end?: number;
  };
  const stripeCustomerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || null;
  if (!stripeCustomerId) {
    throw new Error("Stripe subscription is missing a customer id.");
  }

  const configMap = getPlanConfigMap(configs);
  const priceIds = subscription.items.data.map((item) => item.price?.id).filter(Boolean) as string[];
  let plan: BillingPlanId = normalizeBillingPlan(subscription.metadata?.plan) || "free";

  for (const planId of PLAN_IDS) {
    const config = configMap.get(planId);
    if (!config) continue;
    if (
      (config.stripeBasePriceId && priceIds.includes(config.stripeBasePriceId)) ||
      (config.stripeUsagePriceId && priceIds.includes(config.stripeUsagePriceId))
    ) {
      plan = planId;
      break;
    }
  }

  const latestInvoice =
    typeof subscription.latest_invoice === "string"
      ? null
      : (subscription.latest_invoice as Stripe.Invoice | null);

  const { error } = await sb.from("app_subscriptions").upsert(
    {
      owner_id: ownerId,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: priceIds[0] || null,
      plan,
      status: subscription.status,
      current_period_start:
        typeof sub.current_period_start === "number"
          ? new Date(sub.current_period_start * 1000).toISOString()
          : null,
      current_period_end:
        typeof sub.current_period_end === "number"
          ? new Date(sub.current_period_end * 1000).toISOString()
          : null,
      cancel_at_period_end: subscription.cancel_at_period_end,
      billing_source: "stripe",
      raw: subscription as unknown as Record<string, unknown>,
      updated_at: new Date().toISOString(),
      ...invoiceSnapshot(latestInvoice),
    },
    { onConflict: "owner_id,stripe_subscription_id" },
  );

  if (error) {
    throw new Error(`Failed to sync Stripe subscription into Supabase: ${error.message}`);
  }
}

async function ensureStripeProduct(
  stripe: Stripe,
  existingId: string | null,
  name: string,
  metadata: Record<string, string>,
) {
  if (existingId) {
    try {
      const product = await stripe.products.retrieve(existingId);
      if (!("deleted" in product && product.deleted)) {
        await stripe.products.update(existingId, { name, metadata });
        return product;
      }
    } catch {
      // fall through to create a fresh product
    }
  }

  return stripe.products.create({ name, metadata });
}

async function ensureStripeMeter(
  stripe: Stripe,
  config: BillingPlanConfig,
) {
  const eventName = config.stripeMeterEventName || `orsight_${config.planId}_usage`;

  if (config.stripeMeterId) {
    try {
      const meter = await stripe.billing.meters.retrieve(config.stripeMeterId);
      if (meter.event_name === eventName) {
        return meter;
      }
      return stripe.billing.meters.update(meter.id, {
        display_name: `${config.displayName} usage`,
      });
    } catch {
      // fall through to create
    }
  }

  return stripe.billing.meters.create({
    display_name: `${config.displayName} usage`,
    event_name: eventName,
    default_aggregation: { formula: "sum" },
    customer_mapping: {
      type: "by_id",
      event_payload_key: "stripe_customer_id",
    },
    value_settings: {
      event_payload_key: "value",
    },
  });
}

async function ensureBasePrice(stripe: Stripe, config: BillingPlanConfig, productId: string) {
  if (config.stripeBasePriceId) {
    try {
      const existing = await stripe.prices.retrieve(config.stripeBasePriceId);
      if (
        existing.active &&
        existing.currency === config.currency &&
        existing.unit_amount === config.monthlyBaseCents &&
        existing.recurring?.interval === "month" &&
        existing.recurring?.usage_type === "licensed"
      ) {
        return existing;
      }
    } catch {
      // fall through to create
    }
  }

  return stripe.prices.create({
    product: productId,
    currency: config.currency,
    unit_amount: Math.max(0, config.monthlyBaseCents),
    recurring: {
      interval: "month",
      usage_type: "licensed",
    },
    metadata: {
      orsight_plan_id: config.planId,
      orsight_role: "base",
    },
    nickname: `${config.displayName} monthly base`,
  });
}

async function ensureUsagePrice(
  stripe: Stripe,
  config: BillingPlanConfig,
  productId: string,
  meterId: string,
) {
  if (config.stripeUsagePriceId) {
    try {
      const existing = await stripe.prices.retrieve(config.stripeUsagePriceId);
      if (
        existing.active &&
        existing.currency === config.currency &&
        existing.unit_amount === config.overageUnitCents &&
        existing.recurring?.interval === "month" &&
        existing.recurring?.usage_type === "metered" &&
        existing.recurring?.meter === meterId
      ) {
        return existing;
      }
    } catch {
      // fall through to create
    }
  }

  return stripe.prices.create({
    product: productId,
    currency: config.currency,
    unit_amount: Math.max(0, config.overageUnitCents),
    recurring: {
      interval: "month",
      usage_type: "metered",
      meter: meterId,
    },
    metadata: {
      orsight_plan_id: config.planId,
      orsight_role: "usage",
    },
    nickname: `${config.displayName} usage overage`,
  });
}

export async function savePlanConfigAction(formData: FormData) {
  await requireBillingAdmin(formData);
  const planId = normalizeBillingPlan(asString(formData.get("planId")));
  const focus = currentFocus(formData);
  if (!planId) {
    backAfterAction(formData, { err: "missing_plan_id", ...(focus ? { focus } : {}) });
  }
  const safePlanId = planId as BillingPlanId;

  const requestedBillingModel = normalizeBillingModel(asString(formData.get("billingModel")));
  const billingModel =
    safePlanId === "free"
      ? "free_quota"
      : safePlanId === "normal"
        ? "monthly_quota"
        : safePlanId === "usage"
          ? "monthly_plus_usage"
          : requestedBillingModel || "monthly_quota";
  const displayName = asString(formData.get("displayName")) || safePlanId.toUpperCase();
  const description = asString(formData.get("description"));
  const monthlyBaseCents =
    safePlanId === "free" ? 0 : Math.max(0, asInt(formData.get("monthlyBaseCents"), 0));
  const includedCredits = Math.max(0, asInt(formData.get("includedCredits"), 0));
  const overageUnitCents =
    billingModel === "monthly_plus_usage" ? Math.max(0, asInt(formData.get("overageUnitCents"), 0)) : 0;
  const overageUnitName = asString(formData.get("overageUnitName")) || "tokens";
  const currency = asString(formData.get("currency")).toLowerCase() || "usd";
  const isPublic = safePlanId === "normal" ? asBool(formData.get("isPublic")) : false;
  const isActive = safePlanId === "pro" || safePlanId === "business" ? false : asBool(formData.get("isActive"));
  const sortOrder = asInt(formData.get("sortOrder"), PLAN_IDS.indexOf(safePlanId));

  const sb = await createAdminClient();
  const { data: existingRow } = await sb
    .from("app_billing_plan_configs")
    .select(
      "stripe_base_product_id,stripe_base_price_id,stripe_usage_product_id,stripe_usage_price_id,stripe_meter_id,stripe_meter_event_name",
    )
    .eq("plan_id", safePlanId)
    .maybeSingle();

  const { error } = await sb.from("app_billing_plan_configs").upsert(
    {
      plan_id: safePlanId,
      display_name: displayName,
      description,
      billing_model: billingModel,
      monthly_base_cents: monthlyBaseCents,
      included_credits: includedCredits,
      overage_unit_cents: overageUnitCents,
      overage_unit_name: overageUnitName,
      currency,
      is_public: isPublic,
      is_active: isActive,
      sort_order: sortOrder,
      stripe_base_product_id: existingRow?.stripe_base_product_id || null,
      stripe_base_price_id: existingRow?.stripe_base_price_id || null,
      stripe_usage_product_id: existingRow?.stripe_usage_product_id || null,
      stripe_usage_price_id: existingRow?.stripe_usage_price_id || null,
      stripe_meter_id: existingRow?.stripe_meter_id || null,
      stripe_meter_event_name:
        billingModel === "monthly_plus_usage"
          ? asString(formData.get("stripeMeterEventName")) ||
            existingRow?.stripe_meter_event_name ||
            (safePlanId === "usage" ? "orsight_usage" : `orsight_${safePlanId}_usage`)
          : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "plan_id" },
  );

  if (error) {
    backAfterAction(formData, { err: `save_plan:${error.message}`, ...(focus ? { focus } : {}) });
  }

  backAfterAction(formData, {
    notice: `已保存 ${displayName} 的套餐配置`,
    ...(focus ? { focus } : {}),
  });
}

export async function syncPlanToStripeAction(formData: FormData) {
  await requireBillingAdmin(formData);
  const planId = normalizeBillingPlan(asString(formData.get("planId")));
  const focus = currentFocus(formData);
  if (!planId || planId !== "normal") {
    backAfterAction(formData, { err: "sync_plan_requires_paid_plan", ...(focus ? { focus } : {}) });
  }
  const safePlanId = planId as Exclude<BillingPlanId, "free" | "usage" | "pro" | "business">;

  const stripe = getStripeAdmin();
  if (!stripe) {
    backAfterAction(formData, { err: "missing_STRIPE_SECRET_KEY", ...(focus ? { focus } : {}) });
  }
  const stripeAdmin = stripe as Stripe;

  const { sb, configs } = await loadPlanConfigs();
  const config = lookupPlan(configs, safePlanId);

  try {
    const baseProduct = await ensureStripeProduct(
      stripeAdmin,
      config.stripeBaseProductId,
      `OrSight ${config.displayName} Monthly`,
      { orsight_plan_id: config.planId, orsight_role: "base" },
    );
    const basePrice = await ensureBasePrice(stripeAdmin, config, baseProduct.id);

    let usageProductId = config.stripeUsageProductId;
    let usagePriceId = config.stripeUsagePriceId;
    let meterId = config.stripeMeterId;
    let meterEventName = config.stripeMeterEventName;

    if (config.billingModel === "monthly_plus_usage") {
      const meter = await ensureStripeMeter(stripeAdmin, config);
      meterId = meter.id;
      meterEventName = meter.event_name;

      const usageProduct = await ensureStripeProduct(
        stripeAdmin,
        config.stripeUsageProductId,
        `OrSight ${config.displayName} Usage`,
        { orsight_plan_id: config.planId, orsight_role: "usage" },
      );
      usageProductId = usageProduct.id;

      const usagePrice = await ensureUsagePrice(stripeAdmin, config, usageProduct.id, meter.id);
      usagePriceId = usagePrice.id;
    }

    const { error } = await sb
      .from("app_billing_plan_configs")
      .update({
        stripe_base_product_id: baseProduct.id,
        stripe_base_price_id: basePrice.id,
        stripe_usage_product_id: config.billingModel === "monthly_plus_usage" ? usageProductId : null,
        stripe_usage_price_id: config.billingModel === "monthly_plus_usage" ? usagePriceId : null,
        stripe_meter_id: config.billingModel === "monthly_plus_usage" ? meterId : null,
        stripe_meter_event_name: config.billingModel === "monthly_plus_usage" ? meterEventName : null,
        updated_at: new Date().toISOString(),
      })
      .eq("plan_id", safePlanId);

    if (error) {
      throw new Error(error.message);
    }
  } catch (error) {
    backAfterAction(formData, {
      err: `sync_plan_to_stripe:${error instanceof Error ? error.message : "unknown_error"}`,
      ...(focus ? { focus } : {}),
    });
  }

  backAfterAction(formData, {
    notice: `已将 ${config.displayName} 套餐配置同步到 Stripe`,
    ...(focus ? { focus } : {}),
  });
}

export async function setBillingOverrideAction(formData: FormData) {
  await requireBillingAdmin(formData);
  const ownerId = asString(formData.get("ownerId"));
  const plan = normalizeBillingPlan(asString(formData.get("plan")));
  const label = asString(formData.get("label")) || ownerId;
  const focus = currentFocus(formData);

  if (!ownerId || (plan !== "free" && plan !== "normal")) {
    backAfterAction(formData, { err: "missing_owner_or_plan", ...(focus ? { focus } : {}) });
  }

  const sb = await createAdminClient();
  const { data: customer } = await sb
    .from("app_billing_customers")
    .select("stripe_customer_id")
    .eq("owner_id", ownerId)
    .maybeSingle();

  const stripeCustomerId =
    typeof customer?.stripe_customer_id === "string" && customer.stripe_customer_id.trim()
      ? customer.stripe_customer_id
      : `admin_customer_${ownerId}`;

  const { error } = await sb.from("app_subscriptions").upsert(
    {
      owner_id: ownerId,
      stripe_customer_id: stripeCustomerId,
      stripe_subscription_id: getAdminOverrideSubscriptionId(ownerId),
      stripe_price_id: null,
      plan,
      status: "active",
      current_period_start: monthStartIso(),
      current_period_end: oneYearFromNowIso(),
      cancel_at_period_end: false,
      latest_invoice_id: null,
      latest_invoice_status: null,
      latest_invoice_amount_due: null,
      latest_invoice_amount_paid: null,
      latest_invoice_amount_remaining: null,
      currency: "usd",
      billing_source: "admin_override",
      raw: {
        source: "admin_override",
        updated_by: "admin-webapp",
        label,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "owner_id,stripe_subscription_id" },
  );

  if (error) {
    backAfterAction(formData, { err: `set_override:${error.message}`, ...(focus ? { focus } : {}) });
  }

  backAfterAction(formData, {
    notice: `已为 ${label} 设置后台套餐覆盖：${plan}`,
    ...(focus ? { focus } : {}),
  });
}

export async function clearBillingOverrideAction(formData: FormData) {
  await requireBillingAdmin(formData);
  const ownerId = asString(formData.get("ownerId"));
  const label = asString(formData.get("label")) || ownerId;
  const focus = currentFocus(formData);

  if (!ownerId) {
    backAfterAction(formData, { err: "missing_owner", ...(focus ? { focus } : {}) });
  }

  const sb = await createAdminClient();
  const { error } = await sb
    .from("app_subscriptions")
    .delete()
    .eq("owner_id", ownerId)
    .eq("stripe_subscription_id", getAdminOverrideSubscriptionId(ownerId));

  if (error) {
    backAfterAction(formData, { err: `clear_override:${error.message}`, ...(focus ? { focus } : {}) });
  }

  backAfterAction(formData, {
    notice: `已取消 ${label} 的后台套餐覆盖`,
    ...(focus ? { focus } : {}),
  });
}

export async function changeStripePlanAction(formData: FormData) {
  await requireBillingAdmin(formData);
  const ownerId = asString(formData.get("ownerId"));
  const label = asString(formData.get("label")) || ownerId;
  const targetPlan = normalizeBillingPlan(asString(formData.get("plan")));
  const focus = currentFocus(formData);

  if (!ownerId || targetPlan !== "normal") {
    backAfterAction(formData, { err: "invalid_target_plan", ...(focus ? { focus } : {}) });
  }
  const safeTargetPlan = targetPlan as Exclude<BillingPlanId, "free" | "usage" | "pro" | "business">;

  const stripe = getStripeAdmin();
  if (!stripe) {
    backAfterAction(formData, { err: "missing_STRIPE_SECRET_KEY", ...(focus ? { focus } : {}) });
  }
  const stripeAdmin = stripe as Stripe;

  const { sb, configs } = await loadPlanConfigs();
  const targetConfig = lookupPlan(configs, safeTargetPlan);

  const hasCheckoutPrice =
    Boolean(targetConfig.stripeBasePriceId) ||
    (targetConfig.billingModel === "monthly_plus_usage" && Boolean(targetConfig.stripeUsagePriceId));
  if (!hasCheckoutPrice) {
    backAfterAction(formData, {
      err: `plan_${targetPlan}_missing_stripe_price`,
      ...(focus ? { focus } : {}),
    });
  }
  const safeBasePriceId = targetConfig.stripeBasePriceId;

  const { row } = await loadLatestStripeSubscription(ownerId);
  if (!row?.stripe_subscription_id) {
    backAfterAction(formData, {
      err: "user_has_no_real_stripe_subscription",
      ...(focus ? { focus } : {}),
    });
  }
  const safeSubscriptionId = row!.stripe_subscription_id as string;

  try {
    const subscription = await stripeAdmin.subscriptions.retrieve(safeSubscriptionId, {
      expand: ["items.data.price", "latest_invoice"],
    });

    const items: Stripe.SubscriptionUpdateParams.Item[] = subscription.items.data.map((item) => ({
      id: item.id,
      deleted: true,
    }));

    if (safeBasePriceId) {
      items.push({ price: safeBasePriceId });
    }
    if (targetConfig.billingModel === "monthly_plus_usage" && targetConfig.stripeUsagePriceId) {
      items.push({ price: targetConfig.stripeUsagePriceId });
    }

    const updated = await stripeAdmin.subscriptions.update(subscription.id, {
      cancel_at_period_end: false,
        proration_behavior: "create_prorations",
      metadata: {
        ...(subscription.metadata || {}),
        owner_id: ownerId,
        plan: safeTargetPlan,
      },
      items,
      expand: ["latest_invoice"],
    });

    await upsertStripeSubscriptionRecord(sb, updated, configs, ownerId);
  } catch (error) {
    backAfterAction(formData, {
      err: `change_stripe_plan:${error instanceof Error ? error.message : "unknown_error"}`,
      ...(focus ? { focus } : {}),
    });
  }

  backAfterAction(formData, {
    notice: `已将 ${label} 的 Stripe 订阅切换到 ${targetConfig.displayName}`,
    ...(focus ? { focus } : {}),
  });
}

export async function setStripeCancelAtPeriodEndAction(formData: FormData) {
  await requireBillingAdmin(formData);
  const ownerId = asString(formData.get("ownerId"));
  const label = asString(formData.get("label")) || ownerId;
  const focus = currentFocus(formData);
  const nextValue = asBool(formData.get("cancelAtPeriodEnd"));

  if (!ownerId) {
    backAfterAction(formData, { err: "missing_owner", ...(focus ? { focus } : {}) });
  }

  const stripe = getStripeAdmin();
  if (!stripe) {
    backAfterAction(formData, { err: "missing_STRIPE_SECRET_KEY", ...(focus ? { focus } : {}) });
  }
  const stripeAdmin = stripe as Stripe;

  const { sb, configs } = await loadPlanConfigs();
  const { row } = await loadLatestStripeSubscription(ownerId);
  if (!row?.stripe_subscription_id) {
    backAfterAction(formData, {
      err: "user_has_no_real_stripe_subscription",
      ...(focus ? { focus } : {}),
    });
  }
  const safeSubscriptionId = row!.stripe_subscription_id as string;

  try {
    const updated = await stripeAdmin.subscriptions.update(safeSubscriptionId, {
      cancel_at_period_end: nextValue,
      expand: ["latest_invoice"],
    });

    await upsertStripeSubscriptionRecord(sb, updated, configs, ownerId);
  } catch (error) {
    backAfterAction(formData, {
      err: `update_cancel_at_period_end:${error instanceof Error ? error.message : "unknown_error"}`,
      ...(focus ? { focus } : {}),
    });
  }

  backAfterAction(formData, {
    notice: nextValue
      ? `已设置 ${label} 的 Stripe 订阅到期取消`
      : `已恢复 ${label} 的 Stripe 订阅续费`,
    ...(focus ? { focus } : {}),
  });
}
