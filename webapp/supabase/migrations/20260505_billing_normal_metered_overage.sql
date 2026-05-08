-- Switch the public Normal plan from hard prepaid packs to Stripe metered
-- overage. Users still receive an included monthly token allowance, then
-- only pay for actual extra usage in 1,000-token billing units.

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
  'normal',
  'Normal',
  'Monthly subscription with 1,000,000 included AI tokens and metered overage.',
  'monthly_plus_usage',
  999,
  1000000,
  1,
  '1K tokens',
  'usd',
  'orsight_normal_usage',
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
  stripe_meter_event_name = coalesce(public.app_billing_plan_configs.stripe_meter_event_name, excluded.stripe_meter_event_name),
  is_public = excluded.is_public,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();
