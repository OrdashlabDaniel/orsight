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
  'free',
  'Free',
  'Free starter tier with a hard 1,000,000 AI token monthly quota.',
  'free_quota',
  0,
  1000000,
  0,
  'tokens',
  'usd',
  false,
  true,
  0
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

do $$
begin
  if to_regclass('public.app_billing_user_entitlements') is not null then
    delete from public.app_billing_user_entitlements
    where entitlement in ('free_quota_blocked', 'free_quota_reset_after');
  end if;

  drop function if exists public.app_claim_free_plan_seat(uuid, integer);

  if to_regclass('public.app_free_plan_seats') is not null then
    drop table public.app_free_plan_seats;
  end if;
end $$;
