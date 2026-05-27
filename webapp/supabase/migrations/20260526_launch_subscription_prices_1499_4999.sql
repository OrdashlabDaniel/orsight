-- Launch subscription pricing update after profitability review.
-- Taxes are collected separately by Stripe Checkout automatic_tax.
--
-- Public launch plans:
--   Free   = $0/month,      1,000,000 ordinary AI credits.
--   Normal = $14.99/month, 30,000,000 ordinary AI credits.
--   Pro    = $49.99/month, 100,000,000 ordinary AI credits + separate gpt-5.5 expert pool.

update public.app_billing_plan_configs
set
  description = 'Starter access with 1,000,000 ordinary AI credits per month. gpt-5-mini is the default model; gpt-5 and gpt-5.5 are not available.',
  monthly_base_cents = 0,
  included_credits = 1000000,
  overage_unit_cents = 0,
  overage_unit_name = 'credits',
  billing_model = 'free_quota',
  stripe_base_product_id = null,
  stripe_base_price_id = null,
  stripe_usage_product_id = null,
  stripe_usage_price_id = null,
  stripe_meter_id = null,
  stripe_meter_event_name = null,
  is_public = false,
  is_active = true,
  updated_at = now()
where plan_id = 'free';

update public.app_billing_plan_configs
set
  display_name = 'Normal',
  description = 'Monthly subscription with 30,000,000 ordinary AI credits. gpt-5-mini uses 1x and gpt-5 uses 5x. gpt-5.5 and Recognition Butler are not included. Tax is collected separately where applicable.',
  monthly_base_cents = 1499,
  included_credits = 30000000,
  overage_unit_cents = 0,
  overage_unit_name = 'credits',
  billing_model = 'monthly_quota',
  currency = 'usd',
  stripe_base_product_id = 'prod_USTyL1kXEAvirC',
  stripe_base_price_id = 'price_1TbJAhJkKqe5aomDyjOHQKpC',
  stripe_usage_product_id = null,
  stripe_usage_price_id = null,
  stripe_meter_id = null,
  stripe_meter_event_name = null,
  is_public = true,
  is_active = true,
  sort_order = 10,
  updated_at = now()
where plan_id = 'normal';

update public.app_billing_plan_configs
set
  display_name = 'Pro',
  description = 'Monthly subscription with 100,000,000 ordinary AI credits plus a separate gpt-5.5 expert pool for Recognition Butler and special rule-building tasks. Tax is collected separately where applicable.',
  monthly_base_cents = 4999,
  included_credits = 100000000,
  overage_unit_cents = 0,
  overage_unit_name = 'credits',
  billing_model = 'monthly_quota',
  currency = 'usd',
  stripe_base_product_id = 'prod_UaU8F0gZCpQiTR',
  stripe_base_price_id = 'price_1TbJAhJkKqe5aomDarrzs5eu',
  stripe_usage_product_id = null,
  stripe_usage_price_id = null,
  stripe_meter_id = null,
  stripe_meter_event_name = null,
  is_public = true,
  is_active = true,
  sort_order = 20,
  updated_at = now()
where plan_id = 'pro';

update public.app_billing_plan_configs
set
  is_public = false,
  is_active = false,
  updated_at = now()
where plan_id in ('usage', 'business');
