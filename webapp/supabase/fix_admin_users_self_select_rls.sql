-- Fix: middleware uses anon Supabase client to check admin_users.
-- The policy "Admins can view admin_users" uses EXISTS (subquery on same table),
-- which under RLS often prevents reading your own row. Add a non-recursive policy:

drop policy if exists "Users can read own admin_users row" on public.admin_users;

create policy "Users can read own admin_users row"
  on public.admin_users for select
  using (auth.uid() = id);
