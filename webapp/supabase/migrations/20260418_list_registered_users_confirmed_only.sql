-- Treat only email-confirmed auth users as "registered" in list_registered_users.
-- Re-run safe: replaces function body only.

create or replace function public.list_registered_users()
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  pod_username text
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    u.id,
    u.email::text,
    u.created_at,
    coalesce(u.raw_user_meta_data->>'pod_username', '')::text as pod_username
  from auth.users u
  where u.email_confirmed_at is not null
  order by u.created_at desc;
$$;

revoke all on function public.list_registered_users() from public;
revoke execute on function public.list_registered_users() from anon, authenticated;
grant execute on function public.list_registered_users() to service_role;
