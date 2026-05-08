-- Conservative cost attribution upgrade for usage_logs.
-- Goal:
-- 1) keep the existing product usage gate intact
-- 2) add richer local accounting metadata without forcing a high-management model
-- 3) preserve backward compatibility for older rows

alter table public.usage_logs
  add column if not exists form_id text,
  add column if not exists request_count integer not null default 1,
  add column if not exists cached_input_tokens integer not null default 0,
  add column if not exists openai_project_id text,
  add column if not exists openai_api_key_id text,
  add column if not exists service_tier text,
  add column if not exists pricing_tier text not null default 'standard',
  add column if not exists openai_endpoint text not null default '/v1/chat/completions',
  add column if not exists openai_request_ids jsonb not null default '[]'::jsonb,
  add column if not exists client_request_ids jsonb not null default '[]'::jsonb,
  add column if not exists pricing_basis_version text,
  add column if not exists estimated_cost_usd numeric(12,6),
  add column if not exists conservative_cost_usd numeric(12,6);

update public.usage_logs
set
  form_id = coalesce(nullif(trim(form_id), ''), 'form-1'),
  request_count = greatest(coalesce(request_count, 1), 1),
  cached_input_tokens = greatest(coalesce(cached_input_tokens, 0), 0),
  pricing_tier = coalesce(nullif(trim(pricing_tier), ''), 'standard'),
  openai_endpoint = coalesce(nullif(trim(openai_endpoint), ''), '/v1/chat/completions'),
  openai_request_ids = coalesce(openai_request_ids, '[]'::jsonb),
  client_request_ids = coalesce(client_request_ids, '[]'::jsonb)
where
  form_id is null
  or nullif(trim(form_id), '') is null
  or request_count is null
  or cached_input_tokens is null
  or pricing_tier is null
  or nullif(trim(openai_endpoint), '') is null
  or openai_request_ids is null
  or client_request_ids is null;

alter table public.usage_logs
  alter column form_id set default 'form-1',
  alter column form_id set not null;

create index if not exists usage_logs_user_form_created_idx
  on public.usage_logs (user_id, form_id, created_at desc);

create index if not exists usage_logs_project_created_idx
  on public.usage_logs (openai_project_id, created_at desc);

create index if not exists usage_logs_project_user_created_idx
  on public.usage_logs (openai_project_id, user_id, created_at desc);

create index if not exists usage_logs_api_key_created_idx
  on public.usage_logs (openai_api_key_id, created_at desc);

comment on column public.usage_logs.form_id is
  'Closest current workspace boundary in OrSight. Used for conservative local attribution until a dedicated billing workspace model exists.';
comment on column public.usage_logs.request_count is
  'How many upstream OpenAI requests were aggregated into this local usage row.';
comment on column public.usage_logs.cached_input_tokens is
  'Prompt-cached token volume recorded from OpenAI usage metadata when available.';
comment on column public.usage_logs.openai_project_id is
  'OpenAI project scope used for the upstream request when available.';
comment on column public.usage_logs.openai_api_key_id is
  'OpenAI API key identifier mapped by local config when available.';
comment on column public.usage_logs.service_tier is
  'OpenAI service tier such as standard, flex, or priority when available.';
comment on column public.usage_logs.pricing_tier is
  'Pricing table bucket used to rebuild local token cost.';
comment on column public.usage_logs.openai_endpoint is
  'OpenAI REST endpoint used for the upstream request.';
comment on column public.usage_logs.openai_request_ids is
  'One or more OpenAI x-request-id values associated with the usage row.';
comment on column public.usage_logs.client_request_ids is
  'One or more client-supplied X-Client-Request-Id values associated with the usage row.';
comment on column public.usage_logs.pricing_basis_version is
  'Local retained OpenAI pricing basis version used when rebuilding cost.';
comment on column public.usage_logs.estimated_cost_usd is
  'Token-price rebuild using the retained OpenAI pricing basis for the logged row.';
comment on column public.usage_logs.conservative_cost_usd is
  'Locally retained floor cost for pricing decisions. It must never be below the row-level rebuilt estimate.';
