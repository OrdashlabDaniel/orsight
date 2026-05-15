-- Atomic quota reservations for AI requests.
-- This prevents concurrent extraction batches from all reading the same
-- remaining quota and collectively exceeding a user's plan limit.

create table if not exists public.app_billing_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null,
  billing_model text not null,
  period_start timestamptz not null,
  usage_units bigint not null check (usage_units > 0),
  uses_token_units boolean not null default true,
  action_type text,
  status text not null default 'active' check (status in ('active', 'consumed', 'released', 'expired')),
  usage_log_id uuid references public.usage_logs(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '20 minutes'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_billing_usage_reservations_owner_active_idx
  on public.app_billing_usage_reservations (owner_id, period_start, expires_at)
  where status = 'active';

create index if not exists app_billing_usage_reservations_usage_log_idx
  on public.app_billing_usage_reservations (usage_log_id)
  where usage_log_id is not null;

alter table public.app_billing_usage_reservations enable row level security;

revoke all on public.app_billing_usage_reservations from anon, authenticated;

create or replace function public.reserve_billing_usage(
  p_owner_id uuid,
  p_plan_id text,
  p_billing_model text,
  p_period_start timestamptz,
  p_quota_units bigint,
  p_prepaid_available_units bigint,
  p_requested_units bigint,
  p_uses_token_units boolean default true,
  p_action_type text default null,
  p_reservation_ttl_seconds integer default 1200,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_start timestamptz := coalesce(p_period_start, date_trunc('month', now()));
  v_quota bigint := coalesce(p_quota_units, 0);
  v_prepaid bigint := greatest(coalesce(p_prepaid_available_units, 0), 0);
  v_requested bigint := greatest(coalesce(p_requested_units, 0), 0);
  v_used bigint := 0;
  v_reserved bigint := 0;
  v_effective_limit bigint := 0;
  v_remaining bigint := 0;
  v_reservation_id uuid;
  v_ttl_seconds integer := greatest(coalesce(p_reservation_ttl_seconds, 1200), 60);
begin
  if p_owner_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_owner');
  end if;

  if v_requested <= 0 then
    return jsonb_build_object('ok', true, 'reason', 'nothing_to_reserve', 'reservation_id', null);
  end if;

  if v_quota < 0 then
    return jsonb_build_object('ok', true, 'reason', 'unlimited', 'reservation_id', null);
  end if;

  perform pg_advisory_xact_lock(hashtext('orsight_billing_usage:' || p_owner_id::text));

  update public.app_billing_usage_reservations
  set status = 'expired',
      updated_at = now()
  where owner_id = p_owner_id
    and status = 'active'
    and expires_at <= now();

  if coalesce(p_uses_token_units, true) then
    select coalesce(sum(greatest(coalesce(total_tokens, 0), 0)), 0)::bigint
    into v_used
    from public.usage_logs
    where user_id = p_owner_id
      and created_at >= v_period_start
      and action_type <> 'billing_reservation';
  else
    select coalesce(sum(greatest(coalesce(image_count, 0), 0)), 0)::bigint
    into v_used
    from public.usage_logs
    where user_id = p_owner_id
      and created_at >= v_period_start
      and action_type <> 'billing_reservation';
  end if;

  select coalesce(sum(usage_units), 0)::bigint
  into v_reserved
  from public.app_billing_usage_reservations
  where owner_id = p_owner_id
    and period_start = v_period_start
    and status = 'active'
    and uses_token_units = coalesce(p_uses_token_units, true);

  v_effective_limit := v_quota + v_prepaid;
  v_remaining := v_effective_limit - v_used - v_reserved;

  if v_requested > v_remaining then
    return jsonb_build_object(
      'ok', false,
      'reason', 'quota_exceeded',
      'used_units', v_used,
      'reserved_units', v_reserved,
      'requested_units', v_requested,
      'effective_limit_units', v_effective_limit,
      'remaining_units', greatest(v_remaining, 0)
    );
  end if;

  insert into public.app_billing_usage_reservations (
    owner_id,
    plan_id,
    billing_model,
    period_start,
    usage_units,
    uses_token_units,
    action_type,
    expires_at,
    metadata
  )
  values (
    p_owner_id,
    coalesce(nullif(p_plan_id, ''), 'free'),
    coalesce(nullif(p_billing_model, ''), 'free_quota'),
    v_period_start,
    v_requested,
    coalesce(p_uses_token_units, true),
    nullif(p_action_type, ''),
    now() + make_interval(secs => v_ttl_seconds),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_reservation_id;

  return jsonb_build_object(
    'ok', true,
    'reason', 'reserved',
    'reservation_id', v_reservation_id,
    'used_units', v_used,
    'reserved_units', v_reserved,
    'requested_units', v_requested,
    'effective_limit_units', v_effective_limit,
    'remaining_units', greatest(v_remaining - v_requested, 0),
    'expires_at', (now() + make_interval(secs => v_ttl_seconds))
  );
end;
$$;

revoke all on function public.reserve_billing_usage(
  uuid,
  text,
  text,
  timestamptz,
  bigint,
  bigint,
  bigint,
  boolean,
  text,
  integer,
  jsonb
) from public;
grant execute on function public.reserve_billing_usage(
  uuid,
  text,
  text,
  timestamptz,
  bigint,
  bigint,
  bigint,
  boolean,
  text,
  integer,
  jsonb
) to service_role;

comment on table public.app_billing_usage_reservations is
  'Short-lived server-side AI usage reservations used to atomically enforce per-user billing quotas across concurrent requests.';
comment on function public.reserve_billing_usage(
  uuid,
  text,
  text,
  timestamptz,
  bigint,
  bigint,
  bigint,
  boolean,
  text,
  integer,
  jsonb
) is
  'Atomically reserves estimated AI usage for a user plan by counting current usage plus active reservations under an advisory transaction lock.';
