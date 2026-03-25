-- OrSight Admin Dashboard Schema

-- ---------------------------------------------------------------------------
-- 1. Create usage_logs table to track API usage and costs per user
-- ---------------------------------------------------------------------------
create table if not exists public.usage_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) not null,
  action_type text not null, -- e.g., 'extract_table', 'counter_verify'
  image_count integer not null default 0,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  model_used text not null,
  created_at timestamptz not null default now()
);

comment on table public.usage_logs is 'Logs OpenAI token usage and image processing counts per user';

create index if not exists usage_logs_user_id_idx on public.usage_logs (user_id);
create index if not exists usage_logs_created_at_idx on public.usage_logs (created_at desc);

alter table public.usage_logs enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Create admin_users table for restricting access to the admin dashboard
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

comment on table public.admin_users is 'List of users who have access to the admin dashboard';

alter table public.admin_users enable row level security;

-- ---------------------------------------------------------------------------
-- 3. RLS Policies
-- ---------------------------------------------------------------------------

-- usage_logs: Users can read their own logs (optional, if we want to show it in the main app later)
create policy "Users can view their own usage logs"
  on public.usage_logs for select
  using (auth.uid() = user_id);

-- admin_users: Only admins can view the full admin_users list (nested EXISTS)
create policy "Admins can view admin_users"
  on public.admin_users for select
  using (exists (select 1 from public.admin_users where id = auth.uid()));

-- Middleware (anon JWT) must read *own* row without recursive RLS on EXISTS above
create policy "Users can read own admin_users row"
  on public.admin_users for select
  using (auth.uid() = id);

-- Admins can view all usage logs
create policy "Admins can view all usage logs"
  on public.usage_logs for select
  using (exists (select 1 from public.admin_users where id = auth.uid()));

-- Note: Inserts to usage_logs will be done via the Service Role key in the backend API,
-- so we don't need an insert policy for authenticated users.
