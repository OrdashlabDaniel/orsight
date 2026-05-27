-- Cost-normalized AI credit billing.
--
-- Raw OpenAI token counts stay in usage_logs for audit and cost reconciliation.
-- Billing limits use AI credits:
--   gpt-5-mini = 1x, gpt-5 = 5x, gpt-5.5 = 15x.
-- Public quota:
--   Free = 1,000,000 credits/month, gpt-5.5 not available.
--   Historical Normal credit tuning, superseded by 20260526_launch_subscription_prices_1499_4999.sql.
-- Prepaid:
--   $3 usage-credit checkout grants 3,000,000 credits.

drop function if exists public.reserve_billing_usage(
  uuid,
  text,
  text,
  timestamptz,
  bigint,
  bigint,
  bigint,
  boolean,
  text,
  integer,
  jsonb
);

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

update public.app_billing_plan_configs
set
  description = 'Hidden legacy metered subscription. Current pay-as-you-go uses prepaid AI credits instead.',
  included_credits = 0,
  overage_unit_name = '1K credits',
  is_public = false,
  updated_at = now()
where plan_id = 'usage';

update public.app_billing_plan_configs
set
  is_public = false,
  is_active = false,
  updated_at = now()
where plan_id in ('pro', 'business');

update public.app_billing_token_ledger
set
  delta_tokens = delta_tokens * 10,
  description = case coalesce(metadata, '{}'::jsonb) ->> 'pack_id'
    when 'usage_credit_30k' then replace(coalesce(description, 'Usage Credits 300K'), '30K', '300K')
    when 'usage_credit_50k' then replace(coalesce(description, 'Usage Credits 500K'), '50K', '500K')
    when 'usage_credit_70k' then replace(coalesce(description, 'Usage Credits 700K'), '70K', '700K')
    when 'usage_credit_100k' then replace(coalesce(description, 'Usage Credits 1M'), '100K', '1M')
    else coalesce(description, 'Usage Credits')
  end,
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'credit_scheme_migrated_at', now(),
    'credit_scheme_migration', '20260518_credit_multiplier_billing',
    'old_amount_was_raw_token_pack', true
  )
where
  reason = 'token_pack_purchase'
  and delta_tokens > 0
  and coalesce(metadata, '{}'::jsonb) ->> 'pack_id' in (
    'usage_credit_30k',
    'usage_credit_50k',
    'usage_credit_70k',
    'usage_credit_100k'
  )
  and not (coalesce(metadata, '{}'::jsonb) ? 'credit_scheme_migration');

comment on table public.app_billing_token_ledger is
  'Immutable prepaid AI credit ledger. Column delta_tokens is retained for compatibility but stores credit deltas under the 2026-05-18 credit scheme.';

comment on column public.app_billing_token_ledger.delta_tokens is
  'Prepaid AI credit delta. Positive rows come from one-time Stripe credit purchases; negative rows consume prepaid credits after monthly quota is exhausted.';

comment on table public.app_billing_plan_configs is
  'Billing catalog for OrSight. Public plans are Free and Normal hard AI-credit quotas; prepaid Usage Credits provide extra balance.';
