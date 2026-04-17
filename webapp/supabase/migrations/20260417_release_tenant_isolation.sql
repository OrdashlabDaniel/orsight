-- OrSight release hardening:
-- 1) move user/form data to tenant-owned relational tables
-- 2) enable authenticated RLS for per-user rows
-- 3) split raw document/template files into a dedicated bucket
-- 4) tighten storage object access and privileged RPC exposure

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Buckets
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'training-images',
  'training-images',
  false,
  52428800,
  array[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'application/pdf'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'form-files',
  'form-files',
  false,
  52428800,
  array[
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
    'application/pdf',
    'text/plain',
    'text/csv',
    'text/markdown',
    'application/json',
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. Tenant-owned tables
-- ---------------------------------------------------------------------------
create table if not exists public.app_forms (
  owner_id uuid not null references auth.users(id) on delete cascade,
  form_id text not null,
  name text not null,
  description text not null default '',
  status text not null check (status in ('draft', 'ready')),
  ready boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  template_source text not null default 'blank' check (template_source in ('blank', 'copied')),
  source_form_id text,
  primary key (owner_id, form_id)
);

create table if not exists public.app_form_configs (
  owner_id uuid not null,
  form_id text not null,
  instructions text not null default '',
  documents jsonb not null default '[]'::jsonb,
  guidance_history jsonb not null default '[]'::jsonb,
  agent_thread jsonb not null default '[]'::jsonb,
  working_rules text not null default '',
  table_fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, form_id),
  foreign key (owner_id, form_id) references public.app_forms(owner_id, form_id) on delete cascade
);

create table if not exists public.app_form_training_examples (
  owner_id uuid not null,
  form_id text not null,
  image_name text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, form_id, image_name),
  foreign key (owner_id, form_id) references public.app_forms(owner_id, form_id) on delete cascade
);

create table if not exists public.app_form_files (
  owner_id uuid not null,
  form_id text not null,
  id text not null,
  pool text not null check (pool in ('training', 'templates')),
  file_name text not null,
  storage_name text not null,
  mime_type text not null,
  size_bytes bigint not null default 0,
  uploaded_at timestamptz not null default now(),
  kind text not null check (kind in ('image', 'pdf', 'spreadsheet', 'document', 'text', 'other')),
  source text,
  primary key (owner_id, form_id, id),
  foreign key (owner_id, form_id) references public.app_forms(owner_id, form_id) on delete cascade
);

create index if not exists app_forms_owner_updated_idx
  on public.app_forms (owner_id, updated_at desc);

create index if not exists app_form_training_examples_owner_form_idx
  on public.app_form_training_examples (owner_id, form_id);

create index if not exists app_form_files_owner_form_pool_idx
  on public.app_form_files (owner_id, form_id, pool, uploaded_at desc);

grant select, insert, update, delete on public.app_forms to authenticated;
grant select, insert, update, delete on public.app_form_configs to authenticated;
grant select, insert, update, delete on public.app_form_training_examples to authenticated;
grant select, insert, update, delete on public.app_form_files to authenticated;

alter table public.app_forms enable row level security;
alter table public.app_form_configs enable row level security;
alter table public.app_form_training_examples enable row level security;
alter table public.app_form_files enable row level security;

drop policy if exists "app_forms_owner_access" on public.app_forms;
create policy "app_forms_owner_access"
on public.app_forms
for all
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "app_form_configs_owner_access" on public.app_form_configs;
create policy "app_form_configs_owner_access"
on public.app_form_configs
for all
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "app_form_training_examples_owner_access" on public.app_form_training_examples;
create policy "app_form_training_examples_owner_access"
on public.app_form_training_examples
for all
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "app_form_files_owner_access" on public.app_form_files;
create policy "app_form_files_owner_access"
on public.app_form_files
for all
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

comment on table public.app_forms is 'Per-user form metadata. Release-safe replacement for the forms manifest blob.';
comment on table public.app_form_configs is 'Per-user/per-form instructions, rules, table field config, and agent thread.';
comment on table public.app_form_training_examples is 'Per-user/per-form labeled training annotations.';
comment on table public.app_form_files is 'Per-user/per-form raw training/template file metadata.';

-- ---------------------------------------------------------------------------
-- 3. Storage object policies
-- Path convention: tnt_<auth.uid()>/...
-- ---------------------------------------------------------------------------
drop policy if exists "training_images_tenant_select" on storage.objects;
create policy "training_images_tenant_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'training-images'
  and (storage.foldername(name))[1] = ('tnt_' || auth.uid()::text)
);

drop policy if exists "training_images_tenant_insert" on storage.objects;
create policy "training_images_tenant_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'training-images'
  and (storage.foldername(name))[1] = ('tnt_' || auth.uid()::text)
);

drop policy if exists "training_images_tenant_update" on storage.objects;
create policy "training_images_tenant_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'training-images'
  and (storage.foldername(name))[1] = ('tnt_' || auth.uid()::text)
)
with check (
  bucket_id = 'training-images'
  and (storage.foldername(name))[1] = ('tnt_' || auth.uid()::text)
);

drop policy if exists "training_images_tenant_delete" on storage.objects;
create policy "training_images_tenant_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'training-images'
  and (storage.foldername(name))[1] = ('tnt_' || auth.uid()::text)
);

drop policy if exists "form_files_tenant_select" on storage.objects;
create policy "form_files_tenant_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'form-files'
  and (storage.foldername(name))[1] = ('tnt_' || auth.uid()::text)
);

drop policy if exists "form_files_tenant_insert" on storage.objects;
create policy "form_files_tenant_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'form-files'
  and (storage.foldername(name))[1] = ('tnt_' || auth.uid()::text)
);

drop policy if exists "form_files_tenant_update" on storage.objects;
create policy "form_files_tenant_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'form-files'
  and (storage.foldername(name))[1] = ('tnt_' || auth.uid()::text)
)
with check (
  bucket_id = 'form-files'
  and (storage.foldername(name))[1] = ('tnt_' || auth.uid()::text)
);

drop policy if exists "form_files_tenant_delete" on storage.objects;
create policy "form_files_tenant_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'form-files'
  and (storage.foldername(name))[1] = ('tnt_' || auth.uid()::text)
);

-- ---------------------------------------------------------------------------
-- 4. Tighten privileged RPC exposure
-- ---------------------------------------------------------------------------
revoke execute on function public.list_registered_users() from anon, authenticated;
grant execute on function public.list_registered_users() to service_role;
