import { NextResponse } from "next/server";

import {
  ensureStripeCustomerForUser,
  getCheckoutPlanConfig,
  getCheckoutTokenPackConfig,
  getStripe,
  normalizeBillingPlan,
  normalizeTokenPackId,
  syncStripeSubscriptionsForCustomer,
  type BillingPlanId,
  type TokenPackId,
} from "@/lib/billing";
import { getAuthContextOrSkip } from "@/lib/auth-server";

export const runtime = "nodejs";

function getOrigin(request: Request) {
  const url = new URL(request.url);
  return process.env.NEXT_PUBLIC_APP_URL?.trim() || `${url.protocol}//${url.host}`;
}

function normalizePlan(raw: unknown): BillingPlanId | null {
  const plan = normalizeBillingPlan(typeof raw === "string" ? raw : null);
  if (plan === "normal" || plan === "pro") {
    return plan;
  }
  return null;
}

function normalizePack(raw: unknown): TokenPackId | null {
  return normalizeTokenPackId(typeof raw === "string" ? raw : null);
}

export async function POST(request: Request) {
  const { user, skipAuth } = await getAuthContextOrSkip();
  if (skipAuth || !user) {
    return NextResponse.json({ error: "Please sign in before starting checkout." }, { status: 401 });
  }

  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    plan?: unknown;
    packId?: unknown;
    purchaseType?: unknown;
    requestId?: unknown;
  };
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  const checkoutRequestId = requestId || `checkout_${Date.now()}`;
  const purchaseType = body.purchaseType === "token_pack" ? "token_pack" : "subscription";
  const origin = getOrigin(request);
  const customerId = await ensureStripeCustomerForUser(user);

  if (purchaseType === "token_pack") {
    const packId = normalizePack(body.packId);
    if (!packId) {
      return NextResponse.json({ error: "Unsupported usage credit pack." }, { status: 400 });
    }

    let packConfig;
    try {
      packConfig = await getCheckoutTokenPackConfig(packId);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Usage credit pack is not available." },
        { status: 400 },
      );
    }

    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer: customerId,
        payment_method_types: ["card"],
        automatic_tax: { enabled: true },
        billing_address_collection: "auto",
        customer_update: { address: "auto" },
        allow_promotion_codes: true,
        line_items: [{ price: packConfig.stripePriceId!, quantity: 1 }],
        client_reference_id: user.id,
        success_url: `${origin}/account?billing=token-pack-success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/account?billing=token-pack-cancelled`,
        metadata: {
          owner_id: user.id,
          purchase_type: "token_pack",
          pack_id: packConfig.packId,
          credit_amount: String(packConfig.credits),
          stripe_price_id: packConfig.stripePriceId!,
          checkout_request_id: checkoutRequestId,
        },
      },
      requestId ? { idempotencyKey: `checkout:${user.id}:${packId}:${requestId}` } : undefined,
    );

    return NextResponse.json({ url: session.url });
  }

  const plan = normalizePlan(body.plan);
  if (!plan) {
    return NextResponse.json({ error: "Unsupported billing plan." }, { status: 400 });
  }

  let config;
  try {
    config = await getCheckoutPlanConfig(plan);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Checkout plan is not available." },
      { status: 400 },
    );
  }
  const basePriceId = config.stripeBasePriceId;
  const usagePriceId = config.stripeUsagePriceId;
  if (config.billingModel === "monthly_plus_usage" && !usagePriceId) {
    return NextResponse.json({ error: `Plan ${plan} is missing its Stripe metered usage price.` }, { status: 503 });
  }

  const lineItems: Array<{ price: string; quantity?: number }> = [];
  if (basePriceId) {
    lineItems.push({ price: basePriceId, quantity: 1 });
  }
  if (config.billingModel === "monthly_plus_usage" && usagePriceId) {
    lineItems.push({ price: usagePriceId });
  }
  if (lineItems.length === 0) {
    return NextResponse.json({ error: `Plan ${plan} has no Stripe checkout price configured.` }, { status: 503 });
  }

  const existingSubscription = await syncStripeSubscriptionsForCustomer(customerId, user.id);

  if (existingSubscription) {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/account?billing=manage`,
    });

    return NextResponse.json({
      url: portalSession.url,
      destination: "portal",
      message: "An existing subscription was found. Redirecting to the billing portal instead of creating a duplicate subscription.",
    });
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    payment_method_types: ["card"],
    automatic_tax: { enabled: true },
    billing_address_collection: "auto",
    customer_update: { address: "auto" },
    allow_promotion_codes: true,
    line_items: lineItems,
    client_reference_id: user.id,
    success_url: `${origin}/account?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/account?billing=cancelled`,
    metadata: {
      owner_id: user.id,
      plan,
      billing_model: config.billingModel,
      checkout_request_id: checkoutRequestId,
    },
    subscription_data: {
      metadata: {
        owner_id: user.id,
        plan,
        billing_model: config.billingModel,
        checkout_request_id: checkoutRequestId,
      },
    },
  }, requestId ? { idempotencyKey: `checkout:${user.id}:${plan}:${requestId}` } : undefined);

  return NextResponse.json({ url: session.url });
}
