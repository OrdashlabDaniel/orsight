-- Free trial budget guardrails.
-- Product decision:
-- - Free beta seats are capped at 100 users.
-- - Each Free user gets a conservative $0.30 internal AI cost budget per UTC month.
-- - At the current conservative planning rate of ~$0.03/image, that is 10 images/month.

create table if not exists public.app_free_plan_seats (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  claimed_at timestamptz not null default now()
);

create index if not exists app_free_plan_seats_claimed_at_idx
  on public.app_free_plan_seats (claimed_at asc);

alter table public.app_free_plan_seats enable row level security;

drop policy if exists "app_free_plan_seats_owner_select" on public.app_free_plan_seats;
create policy "app_free_plan_seats_owner_select"
on public.app_free_plan_seats
for select
to authenticated
using (auth.uid() = owner_id);

grant select on public.app_free_plan_seats to authenticated;

create or replace function public.claim_free_plan_seat(p_owner_id uuid, p_seat_limit integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(coalesce(p_seat_limit, 0), 0);
  v_used integer := 0;
begin
  if p_owner_id is null then
    return jsonb_build_object('ok', false, 'reason', 'missing_owner', 'limit', v_limit, 'used', 0);
  end if;

  if v_limit = 0 then
    return jsonb_build_object('ok', true, 'reason', 'unlimited', 'limit', null, 'used', null, 'claimed', true);
  end if;

  perform pg_advisory_xact_lock(hashtext('orsight_free_plan_seats'));

  select count(*)::integer into v_used
  from public.app_free_plan_seats;

  if exists (select 1 from public.app_free_plan_seats where owner_id = p_owner_id) then
    return jsonb_build_object(
      'ok', true,
      'reason', 'already_claimed',
      'limit', v_limit,
      'used', v_used,
      'claimed', true
    );
  end if;

  if v_used >= v_limit then
    return jsonb_build_object(
      'ok', false,
      'reason', 'free_seats_full',
      'limit', v_limit,
      'used', v_used,
      'claimed', false
    );
  end if;

  insert into public.app_free_plan_seats (owner_id)
  values (p_owner_id);

  return jsonb_build_object(
    'ok', true,
    'reason', 'claimed',
    'limit', v_limit,
    'used', v_used + 1,
    'claimed', true
  );
end;
$$;

revoke all on function public.claim_free_plan_seat(uuid, integer) from public;
grant execute on function public.claim_free_plan_seat(uuid, integer) to service_role;

update public.app_billing_plan_configs
set
  description = 'Free beta access with a hard 10-image monthly quota, a $0.30 internal AI cost cap, and a 100-seat beta cap.',
  billing_model = 'free_quota',
  monthly_base_cents = 0,
  included_credits = 750000,
  overage_unit_cents = 0,
  overage_unit_name = 'tokens',
  is_public = false,
  is_active = true,
  updated_at = now()
where plan_id = 'free';

comment on table public.app_free_plan_seats is
  'Users who have claimed one of the limited Free beta seats. The application enforces the active seat limit from BILLING_FREE_SEAT_LIMIT.';
comment on function public.claim_free_plan_seat(uuid, integer) is
  'Atomically claims a Free beta seat under the configured seat limit.';
