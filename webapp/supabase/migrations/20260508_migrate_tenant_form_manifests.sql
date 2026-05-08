-- Import tenant-scoped legacy form manifests into the relational form table.
-- The shared legacy manifest is intentionally ignored so one account can never
-- inherit another account's historical form list.

with manifest_forms as (
  select
    regexp_replace(te.image_name, '^tnt_([^:]+)::.*$', '\1')::uuid as owner_id,
    elem.form,
    elem.ordinality
  from public.training_examples te
  cross join lateral jsonb_array_elements(coalesce(te.data->'forms', '[]'::jsonb)) with ordinality as elem(form, ordinality)
  join auth.users u on u.id = regexp_replace(te.image_name, '^tnt_([^:]+)::.*$', '\1')::uuid
  where te.image_name like 'tnt\_%::__forms_manifest__' escape '\'
), normalized as (
  select
    owner_id,
    coalesce(nullif(regexp_replace(lower(form->>'id'), '[^a-z0-9_-]+', '-', 'g'), ''), 'form-' || ordinality::text) as form_id,
    left(coalesce(nullif(form->>'name', ''), 'Untitled form'), 120) as name,
    coalesce(form->>'description', '') as description,
    case
      when form->>'status' = 'ready' or coalesce((form->>'ready')::boolean, false) then 'ready'
      else 'draft'
    end as status,
    case
      when form->>'status' = 'ready' or coalesce((form->>'ready')::boolean, false) then true
      else false
    end as ready,
    case
      when coalesce(form->>'createdAt', '') ~ '^\d+(\.\d+)?$' then to_timestamp((form->>'createdAt')::numeric / 1000)
      else now()
    end as created_at,
    case
      when coalesce(form->>'updatedAt', '') ~ '^\d+(\.\d+)?$' then to_timestamp((form->>'updatedAt')::numeric / 1000)
      else now()
    end as updated_at,
    case
      when coalesce(form->>'deletedAt', '') ~ '^\d+(\.\d+)?$' then to_timestamp((form->>'deletedAt')::numeric / 1000)
      else null
    end as deleted_at,
    case when form->>'templateSource' = 'copied' then 'copied' else 'blank' end as template_source,
    nullif(regexp_replace(lower(coalesce(form->>'sourceFormId', '')), '[^a-z0-9_-]+', '-', 'g'), '') as source_form_id
  from manifest_forms
)
insert into public.app_forms (
  owner_id,
  form_id,
  name,
  description,
  status,
  ready,
  created_at,
  updated_at,
  deleted_at,
  template_source,
  source_form_id
)
select
  owner_id,
  form_id,
  name,
  description,
  status,
  ready,
  created_at,
  updated_at,
  deleted_at,
  template_source,
  source_form_id
from normalized
on conflict (owner_id, form_id) do update set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  ready = excluded.ready,
  created_at = excluded.created_at,
  updated_at = excluded.updated_at,
  deleted_at = excluded.deleted_at,
  template_source = excluded.template_source,
  source_form_id = excluded.source_form_id;
