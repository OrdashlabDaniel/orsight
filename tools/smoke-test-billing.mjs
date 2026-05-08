import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const webappRoot = path.join(repoRoot, "webapp");
const requireFromWebapp = createRequire(path.join(webappRoot, "package.json"));

const Stripe = requireFromWebapp("stripe");
const { createClient } = requireFromWebapp("@supabase/supabase-js");

function loadEnv(filePath) {
  const values = {};
  const content = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^([^#=\s]+)=(.*)$/);
    if (!match) continue;
    values[match[1]] = match[2].trim();
  }
  return values;
}

function required(name, env) {
  const value = env[name] || process.env[name] || "";
  if (!value.trim()) {
    throw new Error(`Missing required env: ${name}`);
  }
  return value.trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function postSignedWebhook(origin, stripe, webhookSecret, event) {
  const payload = JSON.stringify(event);
  const signature = stripe.webhooks.generateTestHeaderString({
    payload,
    secret: webhookSecret,
  });

  const response = await fetch(`${origin}/api/billing/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signature,
    },
    body: payload,
  });

  const text = await response.text();
  let body = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }

  if (!response.ok) {
    throw new Error(`Webhook ${event.type} failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

async function ensureTable(client, table) {
  const { error } = await client.from(table).select("*").limit(1);
  if (error) {
    throw new Error(`${table} is not queryable: ${error.message}`);
  }
}

const env = {
  ...loadEnv(path.join(webappRoot, ".env.local")),
  ...process.env,
};

const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL", env);
const serviceRoleKey = required("SUPABASE_SERVICE_ROLE_KEY", env);
const stripeSecretKey = required("STRIPE_SECRET_KEY", env);
const webhookSecret = required("STRIPE_WEBHOOK_SECRET", env);
const normalPriceId = required("STRIPE_PRICE_NORMAL_MONTHLY", env);
const usageCreditPrices = [
  ["usage_credit_30k", "STRIPE_PRICE_USAGE_CREDIT_30K", 300, 30_000],
  ["usage_credit_50k", "STRIPE_PRICE_USAGE_CREDIT_50K", 500, 50_000],
  ["usage_credit_70k", "STRIPE_PRICE_USAGE_CREDIT_70K", 700, 70_000],
  ["usage_credit_100k", "STRIPE_PRICE_USAGE_CREDIT_100K", 1000, 100_000],
].map(([packId, envName, amountCents, tokenCredits]) => ({
  packId,
  priceId: required(envName, env),
  amountCents,
  tokenCredits,
}));

const origin = (process.env.WEBAPP_ORIGIN || env.NEXT_PUBLIC_APP_URL || "http://localhost:3002").replace(/\/$/, "");
const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
const stripe = new Stripe(stripeSecretKey, { apiVersion: "2026-03-25.dahlia" });

const eventIds = [];
let smokeUserId = null;

try {
  console.log("Checking Supabase billing tables");
  for (const table of [
    "usage_logs",
    "app_billing_customers",
    "app_subscriptions",
    "app_billing_plan_configs",
    "app_billing_webhook_events",
    "app_billing_token_ledger",
    "app_free_plan_seats",
  ]) {
    await ensureTable(supabase, table);
  }

  console.log("Checking Stripe price configuration");
  const normalPrice = await stripe.prices.retrieve(normalPriceId);
  assert(normalPrice.active, "Normal monthly price is not active.");
  assert(normalPrice.unit_amount === 999, "Normal monthly price must be $9.99.");
  assert(normalPrice.recurring?.interval === "month", "Normal price must be monthly recurring.");

  for (const pack of usageCreditPrices) {
    const price = await stripe.prices.retrieve(pack.priceId);
    assert(price.active, `${pack.packId} price is not active.`);
    assert(price.unit_amount === pack.amountCents, `${pack.packId} amount does not match expected cents.`);
    assert(!price.recurring, `${pack.packId} must be a one-time price.`);
  }

  console.log("Creating temporary Supabase smoke user");
  const email = `billing-smoke-${Date.now()}@example.invalid`;
  const { data: userData, error: userError } = await supabase.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: {
      smoke_test: "billing",
    },
  });
  if (userError) throw userError;
  smokeUserId = userData.user.id;

  const stripeCustomerId = `cus_billing_smoke_${Date.now()}`;
  const checkoutSessionId = `cs_test_billing_smoke_${Date.now()}`;
  const tokenPack = usageCreditPrices[0];

  const tokenEvent = {
    id: `evt_billing_smoke_token_${Date.now()}`,
    object: "event",
    api_version: "2026-03-25.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "checkout.session.completed",
    data: {
      object: {
        id: checkoutSessionId,
        object: "checkout.session",
        mode: "payment",
        payment_status: "paid",
        customer: stripeCustomerId,
        client_reference_id: smokeUserId,
        payment_intent: `pi_billing_smoke_${Date.now()}`,
        amount_total: tokenPack.amountCents,
        currency: "usd",
        metadata: {
          owner_id: smokeUserId,
          purchase_type: "token_pack",
          pack_id: tokenPack.packId,
          token_credits: String(tokenPack.tokenCredits),
          stripe_price_id: tokenPack.priceId,
          checkout_request_id: `smoke_${Date.now()}`,
        },
      },
    },
  };
  eventIds.push(tokenEvent.id);

  console.log("Posting signed Usage Credits webhook");
  await postSignedWebhook(origin, stripe, webhookSecret, tokenEvent);

  const { data: ledgerRows, error: ledgerError } = await supabase
    .from("app_billing_token_ledger")
    .select("delta_tokens,reason,stripe_checkout_session_id")
    .eq("owner_id", smokeUserId)
    .eq("stripe_checkout_session_id", checkoutSessionId);
  if (ledgerError) throw ledgerError;
  assert(ledgerRows?.[0]?.delta_tokens === tokenPack.tokenCredits, "Token pack ledger credit was not created.");

  const subscriptionId = `sub_billing_smoke_${Date.now()}`;
  const subscriptionEvent = {
    id: `evt_billing_smoke_sub_${Date.now()}`,
    object: "event",
    api_version: "2026-03-25.dahlia",
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: "customer.subscription.created",
    data: {
      object: {
        id: subscriptionId,
        object: "subscription",
        customer: stripeCustomerId,
        status: "active",
        cancel_at_period_end: false,
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        latest_invoice: null,
        metadata: {
          owner_id: smokeUserId,
          plan: "normal",
          billing_model: "monthly_quota",
        },
        items: {
          object: "list",
          data: [
            {
              id: `si_billing_smoke_${Date.now()}`,
              object: "subscription_item",
              price: {
                id: normalPriceId,
                object: "price",
              },
            },
          ],
        },
      },
    },
  };
  eventIds.push(subscriptionEvent.id);

  console.log("Posting signed Normal subscription webhook");
  await postSignedWebhook(origin, stripe, webhookSecret, subscriptionEvent);

  const { data: subscriptionRows, error: subscriptionError } = await supabase
    .from("app_subscriptions")
    .select("plan,status,stripe_subscription_id")
    .eq("owner_id", smokeUserId)
    .eq("stripe_subscription_id", subscriptionId);
  if (subscriptionError) throw subscriptionError;
  assert(subscriptionRows?.[0]?.plan === "normal", "Normal subscription was not mirrored.");
  assert(subscriptionRows?.[0]?.status === "active", "Normal subscription status was not mirrored.");

  console.log("Billing smoke test passed");
} finally {
  if (smokeUserId) {
    await supabase.from("app_billing_token_ledger").delete().eq("owner_id", smokeUserId);
    await supabase.from("app_subscriptions").delete().eq("owner_id", smokeUserId);
    await supabase.from("app_billing_customers").delete().eq("owner_id", smokeUserId);
    await supabase.from("app_free_plan_seats").delete().eq("owner_id", smokeUserId);
    if (eventIds.length) {
      await supabase.from("app_billing_webhook_events").delete().in("stripe_event_id", eventIds);
    }
    await supabase.auth.admin.deleteUser(smokeUserId);
  }
}
