-- Stripe webhook idempotency and audit table.
-- Keeps billing mirror updates safe when Stripe retries or duplicates events.

create table if not exists public.app_billing_webhook_events (
  stripe_event_id text primary key,
  event_type text not null,
  stripe_object_id text,
  livemode boolean not null default false,
  status text not null default 'processing'
    check (status in ('processing', 'processed', 'failed')),
  attempts integer not null default 1,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create index if not exists app_billing_webhook_events_status_received_idx
  on public.app_billing_webhook_events (status, received_at desc);

create index if not exists app_billing_webhook_events_object_idx
  on public.app_billing_webhook_events (event_type, stripe_object_id);

alter table public.app_billing_webhook_events enable row level security;

comment on table public.app_billing_webhook_events is
  'Stripe webhook idempotency log and processing audit trail for OrSight billing.';
