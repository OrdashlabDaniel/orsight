-- Store Stripe asset ids for admin-managed billing catalog sync.

alter table public.app_billing_plan_configs
  add column if not exists stripe_base_product_id text,
  add column if not exists stripe_usage_product_id text,
  add column if not exists stripe_meter_id text;

comment on column public.app_billing_plan_configs.stripe_base_product_id is
  'Stripe Product id for the monthly base subscription price.';
comment on column public.app_billing_plan_configs.stripe_usage_product_id is
  'Stripe Product id for the metered overage usage price.';
comment on column public.app_billing_plan_configs.stripe_meter_id is
  'Stripe Billing Meter id used by hybrid monthly+usage plans.';
