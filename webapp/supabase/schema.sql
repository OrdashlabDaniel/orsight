-- OrSight / webapp — Supabase 数据库与 Storage 初始化
-- 在 Supabase 控制台 → SQL Editor → New query → 粘贴全文 → Run

-- ---------------------------------------------------------------------------
-- 1. 训练样本元数据（与代码中 training_examples 表一致）
-- ---------------------------------------------------------------------------
create table if not exists public.training_examples (
  image_name text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

comment on table public.training_examples is 'POD 训练池：每张图的标注与结构化输出，整包存在 data 里';
comment on column public.training_examples.image_name is '与 Storage 中文件名一致，用于 upsert 去重';
comment on column public.training_examples.data is 'TrainingExample JSON（含 output、boxes 等）';

create index if not exists training_examples_updated_at_idx
  on public.training_examples (updated_at desc);

alter table public.training_examples enable row level security;

-- 不添加 anon/authenticated 策略：禁止浏览器直连表；仅服务端用 Service Role 访问（绕过 RLS）。

-- ---------------------------------------------------------------------------
-- 2. Storage：训练图片桶（与代码中 bucket 名 training-images 一致）
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'training-images',
  'training-images',
  false,
  52428800,
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage 同样依赖服务端 Service Role 读写；若将来要做「用户只能读自己的对象」，再单独加 storage.objects 策略。
