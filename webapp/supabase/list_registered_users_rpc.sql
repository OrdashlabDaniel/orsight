-- RPC: list registered users for admin-webapp /viz.
-- Uses security definer to access auth.users without relying on auth.admin.listUsers().

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
  order by u.created_at desc;
$$;

revoke all on function public.list_registered_users() from public;
revoke execute on function public.list_registered_users() from anon, authenticated;
grant execute on function public.list_registered_users() to service_role;

