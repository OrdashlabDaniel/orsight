-- Billing catalog + invoice snapshot support for hybrid monthly + usage billing.

create table if not exists public.app_billing_plan_configs (
  plan_id text primary key check (plan_id in ('free', 'pro', 'business')),
  display_name text not null,
  description text not null default '',
  billing_model text not null default 'free_quota'
    check (billing_model in ('free_quota', 'monthly_quota', 'monthly_plus_usage')),
  monthly_base_cents integer not null default 0,
  included_credits integer not null default 0,
  overage_unit_cents integer not null default 0,
  overage_unit_name text not null default 'image',
  currency text not null default 'usd',
  stripe_base_price_id text,
  stripe_usage_price_id text,
  stripe_meter_event_name text,
  is_public boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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
    'Starter access with a hard monthly quota.',
    'free_quota',
    0,
    25,
    0,
    'image',
    'usd',
    false,
    true,
    0
  ),
  (
    'pro',
    'Pro',
    'Monthly subscription plus usage billing after included recognitions.',
    'monthly_plus_usage',
    2900,
    1000,
    2,
    'image',
    'usd',
    true,
    true,
    10
  ),
  (
    'business',
    'Business',
    'Higher included usage with monthly subscription plus metered billing.',
    'monthly_plus_usage',
    9900,
    5000,
    1,
    'image',
    'usd',
    true,
    true,
    20
  )
on conflict (plan_id) do nothing;

grant select on public.app_billing_plan_configs to authenticated;
alter table public.app_billing_plan_configs enable row level security;

drop policy if exists "app_billing_plan_configs_authenticated_select" on public.app_billing_plan_configs;
create policy "app_billing_plan_configs_authenticated_select"
on public.app_billing_plan_configs
for select
to authenticated
using (true);

alter table public.app_subscriptions
  add column if not exists billing_source text not null default 'stripe'
    check (billing_source in ('stripe', 'admin_override')),
  add column if not exists latest_invoice_id text,
  add column if not exists latest_invoice_status text,
  add column if not exists latest_invoice_amount_due integer,
  add column if not exists latest_invoice_amount_paid integer,
  add column if not exists latest_invoice_amount_remaining integer,
  add column if not exists currency text;

update public.app_subscriptions
set billing_source = case
  when stripe_subscription_id like 'admin_override_%' then 'admin_override'
  else 'stripe'
end
where billing_source is distinct from case
  when stripe_subscription_id like 'admin_override_%' then 'admin_override'
  else 'stripe'
end;

create index if not exists app_billing_plan_configs_sort_idx
  on public.app_billing_plan_configs (sort_order asc, plan_id asc);

comment on table public.app_billing_plan_configs is 'Admin-editable billing catalog for OrSight plans.';
