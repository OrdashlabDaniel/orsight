-- Stripe Billing for OrSight.
-- Stripe webhooks write with the Supabase service role. Authenticated users may
-- read only their own billing rows.

create extension if not exists pgcrypto;

create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  action_type text not null,
  image_count integer not null default 0,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  model_used text not null default 'n/a',
  created_at timestamptz not null default now()
);

create index if not exists usage_logs_user_id_idx on public.usage_logs (user_id);
create index if not exists usage_logs_created_at_idx on public.usage_logs (created_at desc);

alter table public.usage_logs enable row level security;

drop policy if exists "Users can view their own usage logs" on public.usage_logs;
create policy "Users can view their own usage logs"
on public.usage_logs
for select
to authenticated
using (auth.uid() = user_id);

create table if not exists public.app_billing_customers (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text not null unique,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_subscriptions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  stripe_price_id text,
  plan text not null default 'free' check (plan in ('free', 'pro', 'business')),
  status text not null,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, stripe_subscription_id)
);

create index if not exists app_subscriptions_owner_updated_idx
  on public.app_subscriptions (owner_id, updated_at desc);

create index if not exists app_subscriptions_stripe_customer_idx
  on public.app_subscriptions (stripe_customer_id);

grant select on public.app_billing_customers to authenticated;
grant select on public.app_subscriptions to authenticated;
grant select on public.usage_logs to authenticated;

alter table public.app_billing_customers enable row level security;
alter table public.app_subscriptions enable row level security;

drop policy if exists "app_billing_customers_owner_select" on public.app_billing_customers;
create policy "app_billing_customers_owner_select"
on public.app_billing_customers
for select
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "app_subscriptions_owner_select" on public.app_subscriptions;
create policy "app_subscriptions_owner_select"
on public.app_subscriptions
for select
to authenticated
using (auth.uid() = owner_id);

comment on table public.app_billing_customers is 'Maps OrSight users to Stripe customers.';
comment on table public.app_subscriptions is 'Stripe subscription mirror used for product access and AI quota gates.';
