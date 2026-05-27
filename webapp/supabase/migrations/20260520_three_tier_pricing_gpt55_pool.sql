-- Three-tier launch pricing and gpt-5.5 cost-pool separation.
--
-- Ordinary AI credits:
--   gpt-5-mini = 1x, gpt-5 = 5x.
--   gpt-5.5 is not ordinary-credit usage; it is gated separately for Pro expert tasks.
--
-- Public launch plans:
--   Free   = $0/month,     1,000,000 ordinary AI credits.
--   Normal = $14.99/month, 30,000,000 ordinary AI credits.
--   Pro    = $49.99/month, 100,000,000 ordinary AI credits + separate gpt-5.5 expert pool.
--
-- Prepaid Usage Credits remain one-time ordinary-credit add-ons and do not apply to gpt-5.5.

insert into public.app_billing_plan_configs (
  plan_id,
  display_name,
  description,
  billing_model,
  monthly_base_cents,
  included_credits,
  overage_unit_cents,
  overage_unit_name,
  currency,
  stripe_usage_price_id,
  stripe_meter_event_name,
  is_public,
  is_active,
  sort_order
)
values
  (
    'free',
    'Free',
    'Starter access with 1,000,000 ordinary AI credits per month. gpt-5-mini is the default model; gpt-5 and gpt-5.5 are not available.',
    'free_quota',
    0,
    1000000,
    0,
    'credits',
    'usd',
    null,
    null,
    false,
    true,
    0
  ),
  (
    'normal',
    'Normal',
    'Monthly subscription with 30,000,000 ordinary AI credits. gpt-5-mini uses 1x and gpt-5 uses 5x. gpt-5.5 and Recognition Butler are not included.',
    'monthly_quota',
    1499,
    30000000,
    0,
    'credits',
    'usd',
    null,
    null,
    true,
    true,
    10
  ),
  (
    'pro',
    'Pro',
    'Monthly subscription with 100,000,000 ordinary AI credits plus a separate gpt-5.5 expert pool for Recognition Butler and special rule-building tasks.',
    'monthly_quota',
    4999,
    100000000,
    0,
    'credits',
    'usd',
    null,
    null,
    true,
    true,
    20
  )
on conflict (plan_id) do update
set
  display_name = excluded.display_name,
  description = excluded.description,
  billing_model = excluded.billing_model,
  monthly_base_cents = excluded.monthly_base_cents,
  included_credits = excluded.included_credits,
  overage_unit_cents = excluded.overage_unit_cents,
  overage_unit_name = excluded.overage_unit_name,
  currency = excluded.currency,
  stripe_usage_price_id = excluded.stripe_usage_price_id,
  stripe_meter_event_name = excluded.stripe_meter_event_name,
  is_public = excluded.is_public,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

update public.app_billing_plan_configs
set
  stripe_usage_product_id = null,
  stripe_meter_id = null,
  updated_at = now()
where plan_id in ('normal', 'pro');

update public.app_billing_plan_configs
set
  description = 'Hidden legacy metered subscription. Current pay-as-you-go uses prepaid ordinary AI credits instead.',
  is_public = false,
  is_active = false,
  updated_at = now()
where plan_id = 'usage';

update public.app_billing_plan_configs
set
  is_public = false,
  is_active = false,
  updated_at = now()
where plan_id = 'business';

comment on table public.app_billing_plan_configs is
  'Billing catalog for OrSight. Public launch plans are Free, Normal, and Pro ordinary-credit quotas; gpt-5.5 is gated by a separate Pro expert cost pool.';
