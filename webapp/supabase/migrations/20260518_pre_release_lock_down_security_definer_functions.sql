-- Release hardening: security-definer RPCs must never be callable by anon/authenticated clients.

drop function if exists public.claim_free_plan_seat(uuid, integer);

revoke all on function public.list_registered_users() from public, anon, authenticated;
revoke all on function public.viz_get_registered_user_by_id(uuid) from public, anon, authenticated;
revoke all on function public.viz_disable_auth_user_login(uuid) from public, anon, authenticated;
revoke all on function public.viz_enable_auth_user_login(uuid) from public, anon, authenticated;
revoke all on function public.viz_hard_delete_auth_user(uuid) from public, anon, authenticated;

grant execute on function public.list_registered_users() to service_role;
grant execute on function public.viz_get_registered_user_by_id(uuid) to service_role;
grant execute on function public.viz_disable_auth_user_login(uuid) to service_role;
grant execute on function public.viz_enable_auth_user_login(uuid) to service_role;
grant execute on function public.viz_hard_delete_auth_user(uuid) to service_role;
