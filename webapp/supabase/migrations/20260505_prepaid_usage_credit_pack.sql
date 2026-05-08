-- Current launch billing model:
-- Free trial -> Normal subscription hard quota -> prepaid Usage Credits.
-- The legacy metered Usage plan remains in the schema for compatibility, but
-- it should not be exposed as a public checkout plan.

update public.app_billing_plan_configs
set
  is_public = false,
  is_active = true,
  display_name = 'Legacy Usage',
  description = 'Hidden legacy metered subscription. Current pay-as-you-go uses prepaid token credits instead.',
  updated_at = now()
where plan_id = 'usage';

update public.app_billing_plan_configs
set
  is_public = true,
  is_active = true,
  billing_model = 'monthly_quota',
  monthly_base_cents = 999,
  included_credits = 1000000,
  overage_unit_cents = 0,
  overage_unit_name = 'tokens',
  stripe_usage_product_id = null,
  stripe_usage_price_id = null,
  stripe_meter_id = null,
  stripe_meter_event_name = null,
  updated_at = now()
where plan_id = 'normal';

comment on table public.app_billing_token_ledger is
  'Immutable prepaid token ledger. Positive rows are one-time Stripe Usage Credit purchases; negative rows consume prepaid balance after Free or Normal included quota is exhausted.';
