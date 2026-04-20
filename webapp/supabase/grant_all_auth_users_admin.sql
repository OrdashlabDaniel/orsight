-- One-time: give every existing auth user access to admin-webapp (public.admin_users).
-- Run in Supabase SQL Editor or: echo ... | npx supabase db query --linked

insert into public.admin_users (id, email)
select
  u.id,
  coalesce(u.raw_user_meta_data->>'pod_username', u.email::text)
from auth.users u
where
  u.email_confirmed_at is not null
  and not exists (select 1 from public.admin_users a where a.id = u.id)
on conflict (id) do nothing;
