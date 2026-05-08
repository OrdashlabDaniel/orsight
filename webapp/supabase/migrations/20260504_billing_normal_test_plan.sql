-- Two-tier billing test catalog: Free + Normal.
-- Normal is the only public paid plan during the Stripe subscription test.

alter table public.app_billing_plan_configs
  drop constraint if exists app_billing_plan_configs_plan_id_check;

alter table public.app_billing_plan_configs
  add constraint app_billing_plan_configs_plan_id_check
  check (plan_id in ('free', 'normal', 'pro', 'business'));

alter table public.app_subscriptions
  drop constraint if exists app_subscriptions_plan_check;

alter table public.app_subscriptions
  add constraint app_subscriptions_plan_check
  check (plan in ('free', 'normal', 'pro', 'business'));

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
  is_public,
  is_active,
  sort_order
)
values (
  'normal',
  'Normal',
  'Monthly subscription for regular OrSight use during the current billing test. Includes a fixed monthly token quota.',
  'monthly_quota',
  999,
  1000000,
  0,
  'tokens',
  'usd',
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
  is_public = excluded.is_public,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

update public.app_billing_plan_configs
set
  included_credits = 50000,
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
  'Billing catalog for OrSight. Current test catalog publicly exposes Free + Normal only.';
