# Stripe Billing Setup

The current OrSight billing model is deliberately cash-safe:

- `Free`: capped trial access, no Stripe checkout.
- `Normal`: $9.99/month with 1,000,000 included AI tokens, hard stop when exhausted.
- `Prepaid Usage Credits`: one-time top-up. Customers pay first, then extra AI token usage consumes their prepaid balance.

There is no public postpaid metered plan in the recommended flow. This prevents surprise invoices and keeps OrSight from fronting OpenAI cost before the customer pays.

## 1. Stripe Assets

Create these Stripe products in Sandbox first, then repeat in Live mode after testing.

### Product 1: OrSight Normal

```text
Product name: OrSight Normal
Pricing model: Recurring
Amount: $9.99 USD
Billing period: Monthly
Description: Monthly subscription for OrSight with 1,000,000 included AI tokens.
```

Copy the recurring monthly price id into:

```env
STRIPE_PRICE_NORMAL_MONTHLY=price_...
```

### Product 2: OrSight Usage Credits

Create four one-time prices. They all feed the same prepaid token ledger.

| Product name | Pricing model | Amount | Token credits | Env var |
|---|---:|---:|---:|---|
| OrSight Usage Credit 30K | One-off | $3.00 USD | 30,000 | `STRIPE_PRICE_USAGE_CREDIT_30K` |
| OrSight Usage Credit 50K | One-off | $5.00 USD | 50,000 | `STRIPE_PRICE_USAGE_CREDIT_50K` |
| OrSight Usage Credit 70K | One-off | $7.00 USD | 70,000 | `STRIPE_PRICE_USAGE_CREDIT_70K` |
| OrSight Usage Credit 100K | One-off | $10.00 USD | 100,000 | `STRIPE_PRICE_USAGE_CREDIT_100K` |

Suggested shared description:

```text
Prepaid pay-as-you-go credits for extra OrSight AI tokens.
```

Recommended price logic:

- Normal effective unit price: $9.99 / 1,000,000 tokens, about $0.01 per 1,000 tokens.
- Prepaid credit effective unit price: $3 / 30,000 tokens through $10 / 100,000 tokens, about $0.10 per 1,000 tokens.
- The prepaid path is roughly 10x more expensive than Normal, so recurring users are pushed toward Normal while occasional users can still continue safely.

## 2. Environment Variables

```env
BILLING_ENFORCE=false
NEXT_PUBLIC_APP_URL=https://orsight.com
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

STRIPE_PRICE_NORMAL_MONTHLY=price_...
STRIPE_PRICE_USAGE_CREDIT_30K=price_...
STRIPE_PRICE_USAGE_CREDIT_50K=price_...
STRIPE_PRICE_USAGE_CREDIT_70K=price_...
STRIPE_PRICE_USAGE_CREDIT_100K=price_...

BILLING_CURRENCY=usd
BILLING_FREE_SEAT_LIMIT=100
BILLING_FREE_MONTHLY_COST_LIMIT_CENTS=30
BILLING_FREE_ESTIMATED_COST_USD_PER_IMAGE=0.03
BILLING_FREE_MONTHLY_IMAGE_LIMIT=10
BILLING_FREE_MONTHLY_CREDITS=750000
BILLING_FREE_USAGE_UNIT=tokens

BILLING_NORMAL_MONTHLY_FEE_CENTS=999
BILLING_NORMAL_MONTHLY_CREDITS=1000000
BILLING_NORMAL_USAGE_UNIT=tokens

BILLING_USAGE_CREDIT_30K_TOKENS=30000
BILLING_USAGE_CREDIT_30K_PRICE_CENTS=300
BILLING_USAGE_CREDIT_50K_TOKENS=50000
BILLING_USAGE_CREDIT_50K_PRICE_CENTS=500
BILLING_USAGE_CREDIT_70K_TOKENS=70000
BILLING_USAGE_CREDIT_70K_PRICE_CENTS=700
BILLING_USAGE_CREDIT_100K_TOKENS=100000
BILLING_USAGE_CREDIT_100K_PRICE_CENTS=1000

BILLING_EXTRACT_ESTIMATED_TOKENS_PER_FILE=75000
BILLING_TEMPLATE_ESTIMATED_TOKENS=75000
BILLING_PREVIEW_ESTIMATED_TOKENS=75000
BILLING_GUIDANCE_ESTIMATED_TOKENS=50000
```

Only switch `BILLING_ENFORCE=true` after Stripe Checkout, webhook delivery, and Supabase migrations work in Sandbox.

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
supabase/migrations/20260505_free_trial_budget_and_seat_cap.sql
supabase/migrations/20260505_prepaid_usage_credit_pack.sql
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

Enable Stripe Customer Portal for subscription management. Existing Normal subscribers are sent to the portal instead of creating duplicate subscriptions.

At launch, only expose `OrSight Normal` in the subscription portal. Prepaid Usage Credits are purchased through OrSight checkout, not through a subscription switch.

## 6. Enforcement Behavior

Defaults:

- Free: 100 beta seats, 10 images/month, $0.30 internal AI cost cap, hard stop.
- Normal: $9.99/month, 1,000,000 tokens/month, hard stop.
- Prepaid Usage Credits: $3 / $5 / $7 / $10 one-time top-ups for 30,000 / 50,000 / 70,000 / 100,000 extra tokens.

When a user exceeds Free or Normal quota:

1. OrSight blocks the next AI request before calling OpenAI.
2. The user is prompted to upgrade to Normal or buy prepaid Usage Credits.
3. If the user buys credits, Stripe sends `checkout.session.completed`.
4. The webhook inserts a positive row into `app_billing_token_ledger`.
5. Future AI usage beyond the included quota inserts negative ledger rows and consumes prepaid balance.
6. When prepaid balance reaches zero, OrSight blocks again before calling OpenAI.

This makes the app conservative: it should never intentionally let billable AI usage continue without either included quota or prepaid token balance.

## 7. Safe Test Sequence

1. Run all migrations in Supabase.
2. Put Sandbox `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_NORMAL_MONTHLY`, and all four `STRIPE_PRICE_USAGE_CREDIT_*` ids into `.env.local`.
3. Keep `BILLING_ENFORCE=false` for the first smoke test.
4. Sign in as a real Supabase user and open `/account`.
5. Start Normal checkout and complete a Stripe test payment.
6. Confirm `app_subscriptions` updates through webhooks.
7. Start Usage Credit checkout and complete a Stripe test payment.
8. Confirm `app_billing_token_ledger` receives a positive `token_pack_purchase` row.
9. Turn `BILLING_ENFORCE=true` in Sandbox.
10. Exhaust Free or Normal quota with test usage and confirm the app blocks, then resumes only after prepaid credits exist.
