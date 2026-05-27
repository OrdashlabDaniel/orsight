-- Align launch quotas and prices with the 12-image benchmark experience target.
-- Target:
--   Free   can complete one 12-image gpt-5-mini run.
--   Normal can complete at least 30 gpt-5-mini runs and at least 5 gpt-5 runs.
--   Pro remains meaningfully above Normal while keeping gpt-5.5 in a separate expert pool.

update public.app_billing_plan_configs
set
  description = 'Starter access with 1,000,000 ordinary AI credits per month. gpt-5-mini is the default model; gpt-5 and gpt-5.5 are not available.',
  included_credits = 1000000,
  overage_unit_name = 'credits',
  updated_at = now()
where plan_id = 'free';

update public.app_billing_plan_configs
set
  description = 'Monthly subscription with 30,000,000 ordinary AI credits. gpt-5-mini uses 1x and gpt-5 uses 5x. gpt-5.5 and Recognition Butler are not included.',
  monthly_base_cents = 1499,
  included_credits = 30000000,
  overage_unit_name = 'credits',
  billing_model = 'monthly_quota',
  is_public = true,
  is_active = true,
  updated_at = now()
where plan_id = 'normal';

update public.app_billing_plan_configs
set
  description = 'Monthly subscription with 100,000,000 ordinary AI credits plus a separate gpt-5.5 expert pool for Recognition Butler and special rule-building tasks.',
  monthly_base_cents = 4999,
  included_credits = 100000000,
  overage_unit_name = 'credits',
  billing_model = 'monthly_quota',
  is_public = true,
  is_active = true,
  updated_at = now()
where plan_id = 'pro';
