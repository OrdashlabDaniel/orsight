create table if not exists public.app_billing_user_entitlements (
  owner_id uuid not null references auth.users(id) on delete cascade,
  entitlement text not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, entitlement)
);

create index if not exists app_billing_user_entitlements_active_idx
  on public.app_billing_user_entitlements (entitlement, active, owner_id);

alter table public.app_billing_user_entitlements enable row level security;

drop policy if exists "Billing entitlement owner read" on public.app_billing_user_entitlements;
create policy "Billing entitlement owner read"
  on public.app_billing_user_entitlements
  for select
  to authenticated
  using (auth.uid() = owner_id);

grant select on public.app_billing_user_entitlements to authenticated;

insert into public.app_billing_user_entitlements (owner_id, entitlement, active, notes)
values
  ('618aa87b-9cab-482d-9fa0-fda3558c2a42', 'lifetime_free', true, 'Lifetime free account from admin user directory, 2026-05-06.'),
  ('6fe48ae3-9c72-4be2-a731-2822969928a7', 'lifetime_free', true, 'Lifetime free account from admin user directory, 2026-05-06.'),
  ('980a56ab-d479-4fd2-b2c3-13dde4c74cbd', 'lifetime_free', true, 'Lifetime free account from admin user directory, 2026-05-06.')
on conflict (owner_id, entitlement) do update
set active = excluded.active,
    notes = excluded.notes,
    updated_at = now();
