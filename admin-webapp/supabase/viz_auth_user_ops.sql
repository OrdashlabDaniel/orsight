-- Direct auth.users helpers for admin-webapp /viz flows.
-- Run this in Supabase SQL Editor before using the updated /viz recycle/delete actions.

create or replace function public.viz_get_registered_user_by_id(target_user_id uuid)
returns table (
  id uuid,
  email text,
  created_at timestamptz,
  pod_username text,
  banned_until timestamptz,
  deleted_at timestamptz
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
    coalesce(u.raw_user_meta_data->>'pod_username', '')::text as pod_username,
    u.banned_until,
    u.deleted_at
  from auth.users u
  where u.id = target_user_id
  limit 1;
$$;

create or replace function public.viz_disable_auth_user_login(target_user_id uuid)
returns table (
  id uuid,
  email text,
  banned_until timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  return query
  update auth.users u
  set banned_until = now() + interval '10 years'
  where u.id = target_user_id
  returning u.id, u.email::text, u.banned_until;
end;
$$;

create or replace function public.viz_enable_auth_user_login(target_user_id uuid)
returns table (
  id uuid,
  email text,
  banned_until timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  return query
  update auth.users u
  set
    banned_until = null,
    deleted_at = null
  where u.id = target_user_id
  returning u.id, u.email::text, u.banned_until;
end;
$$;

create or replace function public.viz_hard_delete_auth_user(target_user_id uuid)
returns table (
  id uuid,
  email text,
  banned_until timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  existing_id uuid;
  existing_email text;
begin
  select u.id, u.email::text
  into existing_id, existing_email
  from auth.users u
  where u.id = target_user_id
  limit 1;

  if existing_id is null then
    return;
  end if;

  delete from auth.users u
  where u.id = target_user_id;

  return query
  select existing_id, existing_email, null::timestamptz;
end;
$$;

revoke all on function public.viz_get_registered_user_by_id(uuid) from public;
revoke all on function public.viz_disable_auth_user_login(uuid) from public;
revoke all on function public.viz_enable_auth_user_login(uuid) from public;
revoke all on function public.viz_hard_delete_auth_user(uuid) from public;

grant execute on function public.viz_get_registered_user_by_id(uuid) to service_role;
grant execute on function public.viz_disable_auth_user_login(uuid) to service_role;
grant execute on function public.viz_enable_auth_user_login(uuid) to service_role;
grant execute on function public.viz_hard_delete_auth_user(uuid) to service_role;
