import { NextResponse } from "next/server";
import type Stripe from "stripe";

import {
  grantTokenPackFromCheckoutSession,
  getStripe,
  upsertInvoiceSnapshotFromStripe,
  upsertSubscriptionFromStripe,
} from "@/lib/billing";
import { getSupabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

type WebhookEventStatus = "processing" | "processed" | "failed";

function extractStripeObjectId(object: Stripe.Event.Data.Object) {
  const candidate = object as { id?: unknown };
  return typeof candidate.id === "string" ? candidate.id : null;
}

async function beginWebhookProcessing(event: Stripe.Event) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    throw new Error("Supabase service role is not configured.");
  }

  const now = new Date().toISOString();
  const insertPayload = {
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_object_id: extractStripeObjectId(event.data.object),
    livemode: event.livemode,
    status: "processing" as WebhookEventStatus,
    attempts: 1,
    received_at: now,
    updated_at: now,
    processed_at: null,
    last_error: null,
    payload: event as unknown as Record<string, unknown>,
  };

  const { error: insertError } = await admin.from("app_billing_webhook_events").insert(insertPayload);
  if (!insertError) {
    return { shouldProcess: true } as const;
  }

  if (insertError.code !== "23505") {
    throw new Error(`Failed to start webhook idempotency record: ${insertError.message}`);
  }

  const { data: existing, error: existingError } = await admin
    .from("app_billing_webhook_events")
    .select("status,attempts")
    .eq("stripe_event_id", event.id)
    .maybeSingle();

  if (existingError) {
    throw new Error(`Failed to inspect existing webhook event: ${existingError.message}`);
  }

  const current = (existing || {}) as { status?: WebhookEventStatus | null; attempts?: number | null };
  if (current.status === "processed" || current.status === "processing") {
    return { shouldProcess: false } as const;
  }

  const attempts = Math.max(1, Number(current.attempts || 1)) + 1;
  const { error: updateError } = await admin
    .from("app_billing_webhook_events")
    .update({
      status: "processing",
      attempts,
      updated_at: now,
      processed_at: null,
      last_error: null,
      payload: event as unknown as Record<string, unknown>,
    })
    .eq("stripe_event_id", event.id);

  if (updateError) {
    throw new Error(`Failed to reopen webhook event for retry: ${updateError.message}`);
  }

  return { shouldProcess: true } as const;
}

async function finishWebhookProcessing(eventId: string, status: Extract<WebhookEventStatus, "processed" | "failed">, lastError?: string | null) {
  const admin = getSupabaseAdmin();
  if (!admin) {
    return;
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("app_billing_webhook_events")
    .update({
      status,
      processed_at: status === "processed" ? now : null,
      updated_at: now,
      last_error: lastError || null,
    })
    .eq("stripe_event_id", eventId);

  if (error) {
    console.error("Failed to update webhook event status:", error);
  }
}

async function retrieveExpandedSubscription(subscriptionId: string) {
  const stripe = getStripe();
  if (!stripe) {
    return null;
  }

  return stripe.subscriptions.retrieve(subscriptionId, {
    expand: ["latest_invoice"],
  });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode === "payment" && session.metadata?.purchase_type === "token_pack") {
    await grantTokenPackFromCheckoutSession(session);
    return;
  }

  if (!session.subscription) {
    return;
  }
  const subscriptionId =
    typeof session.subscription === "string" ? session.subscription : session.subscription.id;
  const subscription = await retrieveExpandedSubscription(subscriptionId);
  if (subscription) {
    await upsertSubscriptionFromStripe(subscription, session.metadata?.owner_id || null);
  }
}

async function handleSubscriptionUpsert(subscription: Stripe.Subscription) {
  const expanded =
    typeof subscription.latest_invoice === "string"
      ? await retrieveExpandedSubscription(subscription.id)
      : subscription;
  await upsertSubscriptionFromStripe(expanded || subscription);
}

async function handleInvoiceEvent(invoice: Stripe.Invoice) {
  await upsertInvoiceSnapshotFromStripe(invoice);
}

export async function POST(request: Request) {
  const stripe = getStripe();
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  if (!stripe || !webhookSecret) {
    return NextResponse.json({ error: "Stripe webhook is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const body = await request.text();
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Stripe webhook signature.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const processing = await beginWebhookProcessing(event);
  if (!processing.shouldProcess) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
        await handleSubscriptionUpsert(event.data.object as Stripe.Subscription);
        break;
      case "invoice.finalized":
      case "invoice.paid":
      case "invoice.payment_succeeded":
      case "invoice.payment_failed":
      case "invoice.updated":
        await handleInvoiceEvent(event.data.object as Stripe.Invoice);
        break;
      default:
        break;
    }
  } catch (error) {
    console.error("Stripe webhook handling failed:", error);
    await finishWebhookProcessing(
      event.id,
      "failed",
      error instanceof Error ? error.message : "Stripe webhook handling failed.",
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Stripe webhook handling failed." },
      { status: 500 },
    );
  }

  await finishWebhookProcessing(event.id, "processed");
  return NextResponse.json({ received: true });
}
