create table if not exists public.admin_console_accounts (
  id uuid primary key default gen_random_uuid(),
  identifier text not null,
  identifier_key text generated always as (lower(btrim(identifier))) stored,
  display_name text not null,
  email text,
  email_key text generated always as (nullif(lower(btrim(email)), '')) stored,
  password_hash text not null,
  session_version integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  password_changed_at timestamptz,
  constraint admin_console_accounts_identifier_format
    check (identifier ~ '^[A-Za-z0-9._@-]{3,120}$'),
  constraint admin_console_accounts_session_version_positive
    check (session_version > 0)
);

create unique index if not exists admin_console_accounts_identifier_key_uidx
  on public.admin_console_accounts (identifier_key);

create unique index if not exists admin_console_accounts_email_key_uidx
  on public.admin_console_accounts (email_key)
  where email_key is not null;

create index if not exists admin_console_accounts_active_idx
  on public.admin_console_accounts (is_active, display_name);

create or replace function public.set_admin_console_account_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_admin_console_accounts_updated_at on public.admin_console_accounts;
create trigger trg_admin_console_accounts_updated_at
before update on public.admin_console_accounts
for each row
execute function public.set_admin_console_account_updated_at();

alter table public.admin_console_accounts enable row level security;

revoke all on table public.admin_console_accounts from anon;
revoke all on table public.admin_console_accounts from authenticated;
