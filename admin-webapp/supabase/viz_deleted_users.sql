-- Recycle bin for users removed from /viz admin flows.
-- Run in Supabase SQL Editor (or via migration tooling).
-- After auth user is deleted, usage_logs remain until purge_at (30 days) or permanent delete.

create table if not exists public.viz_deleted_users (
  id uuid primary key,
  email text,
  deleted_at timestamptz not null default now(),
  purge_at timestamptz not null,
  deleted_by uuid,
  deleted_by_email text
);

create index if not exists viz_deleted_users_purge_at_idx
  on public.viz_deleted_users (purge_at);

-- RLS on with no policies: anon/authenticated cannot read; service role bypasses RLS.
alter table public.viz_deleted_users enable row level security;
