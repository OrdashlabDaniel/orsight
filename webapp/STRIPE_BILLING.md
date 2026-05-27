# Stripe Billing Setup

The current OrSight billing model is deliberately cash-safe:

- `Free`: capped trial access, no Stripe checkout.
- `Normal`: $14.99/month plus applicable tax with 30,000,000 ordinary AI credits, hard stop when exhausted.
- `Pro`: $49.99/month plus applicable tax with 100,000,000 ordinary AI credits plus a separate gpt-5.5 expert pool for Recognition Butler.
- `Prepaid Usage Credits`: one-time top-up. Customers pay first, then extra ordinary AI usage consumes their prepaid credit balance.

There is no public postpaid metered plan in the recommended flow. This prevents surprise invoices and keeps OrSight from fronting OpenAI cost before the customer pays.

## 1. Stripe Assets

Create these Stripe products in Sandbox first, then repeat in Live mode after testing.

### Product 1: OrSight Normal

```text
Product name: OrSight Normal
Pricing model: Recurring
Amount: $14.99 USD, tax collected separately where applicable.
Billing period: Monthly
Description: Monthly subscription for OrSight with 30,000,000 ordinary AI credits.
```

Copy the recurring monthly price id into:

```env
STRIPE_PRICE_NORMAL_MONTHLY=price_1TbJAhJkKqe5aomDyjOHQKpC
```

### Product 2: OrSight Pro

```text
Product name: OrSight Pro
Pricing model: Recurring
Amount: $49.99 USD, tax collected separately where applicable.
Billing period: Monthly
Description: Monthly subscription for OrSight with 100,000,000 ordinary AI credits and a separate gpt-5.5 expert pool.
```

Copy the recurring monthly price id into:

```env
STRIPE_PRICE_PRO_MONTHLY=price_1TbJAhJkKqe5aomDarrzs5eu
```

### Product 3: OrSight Usage Credits

Create one one-time price. It feeds the same prepaid credit ledger.

| Product name | Pricing model | Amount | Credits | Env var |
|---|---:|---:|---:|---|
| OrSight Usage Credits 3M | One-off | $3.00 USD | 3,000,000 | `STRIPE_PRICE_USAGE_CREDIT_30K` |

Suggested shared description:

```text
Prepaid pay-as-you-go credits for extra OrSight AI usage.
```

Recommended price logic:

- Ordinary billing credits are cost-normalized: `gpt-5-mini` consumes 1x and `gpt-5` consumes 5x.
- Free includes 1,000,000 ordinary credits/month and cannot use `gpt-5` or `gpt-5.5`.
- Normal includes 30,000,000 ordinary credits/month and cannot use `gpt-5.5`.
- Pro includes 100,000,000 ordinary credits/month and a separate $6/month gpt-5.5 expert cost pool.
- Prepaid credits are $3 for 3,000,000 ordinary credits. They do not apply to `gpt-5.5`.

## 2. Environment Variables

```env
BILLING_ENFORCE=true
NEXT_PUBLIC_APP_URL=https://orsight.com
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

STRIPE_PRICE_NORMAL_MONTHLY=price_...
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_USAGE_CREDIT_30K=price_...

BILLING_CURRENCY=usd
BILLING_FREE_MONTHLY_CREDITS=1000000
BILLING_FREE_USAGE_UNIT=credits

BILLING_NORMAL_MONTHLY_FEE_CENTS=1499
BILLING_NORMAL_MONTHLY_CREDITS=30000000
BILLING_NORMAL_USAGE_UNIT=credits

BILLING_PRO_MONTHLY_FEE_CENTS=4999
BILLING_PRO_MONTHLY_CREDITS=100000000
BILLING_PRO_USAGE_UNIT=credits
BILLING_PRO_PREMIUM_MODEL_MONTHLY_COST_CENTS=600
BILLING_PRO_PREMIUM_MODEL_WARNING_CENTS=540
BILLING_GPT55_REQUEST_COST_LIMIT_CENTS=75

BILLING_USAGE_RESERVATION_TTL_SECONDS=1200

BILLING_USAGE_CREDIT_30K_TOKENS=3000000
BILLING_USAGE_CREDIT_30K_PRICE_CENTS=300

BILLING_EXTRACT_ESTIMATED_TOKENS_PER_FILE=75000
BILLING_TEMPLATE_ESTIMATED_TOKENS=75000
BILLING_PREVIEW_ESTIMATED_TOKENS=75000
BILLING_GUIDANCE_ESTIMATED_TOKENS=50000
```

Production and Vercel Preview deployments enforce billing/quota by default, even if `BILLING_ENFORCE` is missing. To temporarily disable enforcement in a production-like environment, set both `BILLING_ENFORCE=false` and `BILLING_ALLOW_UNENFORCED_BILLING=true`. Do not use that escape hatch for normal beta operation.

## 3. Supabase Migrations

Run these migrations in order:

```text
supabase/migrations/20260423_stripe_billing.sql
supabase/migrations/20260424_billing_catalog_and_invoices.sql
supabase/migrations/20260424_billing_stripe_assets.sql
supabase/migrations/20260502_usage_logs_conservative_attribution.sql
supabase/migrations/20260503_billing_webhook_events.sql
supabase/migrations/20260504_billing_normal_test_plan.sql
supabase/migrations/20260505_billing_token_packs.sql
supabase/migrations/20260505_prepaid_usage_credit_pack.sql
supabase/migrations/20260515_normal_monthly_token_quota_10m.sql
supabase/migrations/20260515_billing_usage_reservations.sql
supabase/migrations/20260516_free_quota_tokens_only_1m.sql
supabase/migrations/20260518_credit_multiplier_billing.sql
supabase/migrations/20260518_release_quota_experience_tuning.sql
supabase/migrations/20260520_three_tier_pricing_gpt55_pool.sql
supabase/migrations/20260526_launch_subscription_prices_1499_4999.sql
```

If older `usage` or `metered overage` migrations were already applied, keep them applied. The prepaid migration hides that legacy usage plan from public checkout.

## 4. Stripe Webhook Endpoint

Create a Stripe webhook endpoint:

```text
https://your-domain.com/api/billing/webhook
```

Subscribe at minimum to:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.payment_succeeded
invoice.payment_failed
```

Copy the webhook signing secret into:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

## 5. Billing Portal

Enable Stripe Customer Portal for subscription management. Existing paid subscribers are sent to the portal instead of creating duplicate subscriptions.

At launch, expose `OrSight Normal` and `OrSight Pro` in the subscription portal. Prepaid Usage Credits are purchased through OrSight checkout, not through a subscription switch.

Checkout sessions enable Stripe automatic tax and collect billing address automatically. Public prices should be displayed as `$14.99 + tax` and `$49.99 + tax`; tax is not included in the plan price.

## 6. Enforcement Behavior

Defaults:

- Free: 1,000,000 ordinary credits/month, hard stop, no `gpt-5` or `gpt-5.5`.
- Normal: $14.99/month plus applicable tax, 30,000,000 ordinary credits/month, hard stop, no `gpt-5.5`.
- Pro: $49.99/month plus applicable tax, 100,000,000 ordinary credits/month plus a separate $6/month gpt-5.5 expert pool, hard stop.
- Prepaid Usage Credits: $3 one-time top-up for 3,000,000 extra ordinary credits.

When a user exceeds Free or Normal quota:

1. OrSight blocks the next AI request before calling OpenAI.
2. The user is prompted to upgrade or buy prepaid Usage Credits.
3. If the user buys credits, Stripe sends `checkout.session.completed`.
4. The webhook inserts a positive row into `app_billing_token_ledger`.
5. Future AI usage beyond the included quota inserts negative ledger rows and consumes prepaid balance.
6. When prepaid balance reaches zero, OrSight blocks again before calling OpenAI.

This makes the app conservative: it should never intentionally let billable AI usage continue without either included quota or prepaid credit balance.

Concurrent extraction batches reserve estimated credits before OpenAI calls. The current implementation uses short-lived `usage_logs` reservation rows so quota checks include in-flight work. The older raw-token reservation RPC is intentionally dropped by `20260518_credit_multiplier_billing.sql`.

## 7. Safe Test Sequence

1. Run all migrations in Supabase.
2. Put Sandbox `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_NORMAL_MONTHLY`, `STRIPE_PRICE_PRO_MONTHLY`, and `STRIPE_PRICE_USAGE_CREDIT_30K` into `.env.local`.
3. In local development only, you may keep `BILLING_ENFORCE=false` for the first smoke test.
4. Sign in as a real Supabase user and open `/account`.
5. Start Normal checkout and complete a Stripe test payment.
6. Confirm `app_subscriptions` updates through webhooks.
7. Start Usage Credit checkout and complete a Stripe test payment.
8. Confirm `app_billing_token_ledger` receives a positive `token_pack_purchase` row.
9. Turn `BILLING_ENFORCE=true` before any Preview, staging, or beta user test.
10. Exhaust Free, Normal, or Pro ordinary quota with test usage and confirm the app blocks, then resumes only after prepaid credits exist.
