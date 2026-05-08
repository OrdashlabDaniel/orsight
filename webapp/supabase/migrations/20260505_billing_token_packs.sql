-- Prepaid token packs for hard-quota billing.
-- Subscription quota is monthly. Token packs are one-time Stripe Checkout
-- purchases that carry as a ledger balance and are consumed after monthly
-- included tokens are exhausted.

create extension if not exists pgcrypto;

create table if not exists public.app_billing_token_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  delta_tokens integer not null,
  reason text not null check (
    reason in (
      'token_pack_purchase',
      'quota_overage_consumption',
      'admin_adjustment',
      'refund_reversal'
    )
  ),
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_price_id text,
  usage_log_id uuid references public.usage_logs(id) on delete set null,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists app_billing_token_ledger_owner_created_idx
  on public.app_billing_token_ledger (owner_id, created_at desc);

create unique index if not exists app_billing_token_ledger_checkout_session_uidx
  on public.app_billing_token_ledger (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

create unique index if not exists app_billing_token_ledger_usage_consumption_uidx
  on public.app_billing_token_ledger (usage_log_id)
  where reason = 'quota_overage_consumption' and usage_log_id is not null;

grant select on public.app_billing_token_ledger to authenticated;

alter table public.app_billing_token_ledger enable row level security;

drop policy if exists "app_billing_token_ledger_owner_select" on public.app_billing_token_ledger;
create policy "app_billing_token_ledger_owner_select"
on public.app_billing_token_ledger
for select
to authenticated
using (auth.uid() = owner_id);

comment on table public.app_billing_token_ledger is
  'Immutable prepaid token ledger. Positive rows come from one-time Stripe token pack purchases; negative rows consume prepaid tokens after monthly quota is exhausted.';
