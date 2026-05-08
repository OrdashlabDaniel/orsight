-- Three-tier billing catalog:
-- Free: hard trial quota, no Stripe checkout.
-- Normal: $9.99/month, hard 1,000,000-token monthly quota.
-- Usage: separate Stripe metered subscription, billed from the first 1K-token unit.

alter table public.app_billing_plan_configs
  drop constraint if exists app_billing_plan_configs_plan_id_check;

alter table public.app_billing_plan_configs
  add constraint app_billing_plan_configs_plan_id_check
  check (plan_id in ('free', 'normal', 'usage', 'pro', 'business'));

alter table public.app_subscriptions
  drop constraint if exists app_subscriptions_plan_check;

alter table public.app_subscriptions
  add constraint app_subscriptions_plan_check
  check (plan in ('free', 'normal', 'usage', 'pro', 'business'));

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
  stripe_usage_product_id,
  stripe_usage_price_id,
  stripe_meter_id,
  stripe_meter_event_name,
  is_public,
  is_active,
  sort_order
)
values (
  'normal',
  'Normal',
  'Monthly subscription with a hard 1,000,000 AI token quota.',
  'monthly_quota',
  999,
  1000000,
  0,
  'tokens',
  'usd',
  null,
  null,
  null,
  null,
  true,
  true,
  10
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
  stripe_usage_product_id = null,
  stripe_usage_price_id = null,
  stripe_meter_id = null,
  stripe_meter_event_name = null,
  is_public = excluded.is_public,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

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
  stripe_meter_event_name,
  is_public,
  is_active,
  sort_order
)
values (
  'usage',
  'Pay as you go',
  'Metered AI token billing for continued usage after Normal quota is exhausted.',
  'monthly_plus_usage',
  0,
  0,
  1,
  '1K tokens',
  'usd',
  'orsight_usage',
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
  stripe_meter_event_name = coalesce(public.app_billing_plan_configs.stripe_meter_event_name, excluded.stripe_meter_event_name),
  is_public = excluded.is_public,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

update public.app_billing_plan_configs
set
  included_credits = 50000,
  overage_unit_cents = 0,
  overage_unit_name = 'tokens',
  is_public = false,
  is_active = true,
  updated_at = now()
where plan_id = 'free';

update public.app_billing_plan_configs
set
  is_public = false,
  is_active = false,
  updated_at = now()
where plan_id in ('pro', 'business');

comment on table public.app_billing_plan_configs is
  'Billing catalog for OrSight. Public plans are Free, Normal hard quota, and Pay as you go metered usage.';
