-- Release quota tuning after 12-image pre-publish tests.
--
-- A 12-image field-collection batch currently reserves:
--   12 images * 80,000 estimated tokens/image * model multiplier.
--
-- Product target:
--   Free: enough for one complete gpt-5-mini trial batch.
--   Normal: enough for meaningful repeated use while preserving model-cost weighting.
--   $3 Usage Credits: useful as an add-on, not smaller than a normal batch.

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
values
  (
    'free',
    'Free',
    'Starter access with 1,000,000 AI credits per month. gpt-5-mini consumes 1x, gpt-5 consumes 5x, and gpt-5.5 is not available.',
    'free_quota',
    0,
    1000000,
    0,
    'credits',
    'usd',
    false,
    true,
    0
  ),
  (
    'normal',
    'Normal',
    'Monthly subscription with 16,000,000 AI credits. gpt-5-mini consumes 1x, gpt-5 consumes 5x, and gpt-5.5 consumes 15x.',
    'monthly_quota',
    999,
    16000000,
    0,
    'credits',
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

update public.app_billing_token_ledger
set
  delta_tokens = delta_tokens * 10,
  description = replace(coalesce(description, 'Usage Credits 300K'), '300K', '3M'),
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'credit_pack_3m_migrated_at', now(),
    'credit_pack_3m_migration', '20260518_release_quota_experience_tuning',
    'old_amount_was_300k_credits', true
  )
where
  reason = 'token_pack_purchase'
  and delta_tokens > 0
  and delta_tokens <= 300000
  and coalesce(metadata, '{}'::jsonb) ->> 'pack_id' = 'usage_credit_30k'
  and not (coalesce(metadata, '{}'::jsonb) ? 'credit_pack_3m_migration');

comment on table public.app_billing_plan_configs is
  'Billing catalog for OrSight. Public plans are Free and Normal hard AI-credit quotas; prepaid Usage Credits provide extra balance.';
