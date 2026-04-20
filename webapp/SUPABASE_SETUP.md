# Supabase 搭建指南（OrSight / webapp）

本应用用 Supabase 做三件事：**登录（Auth）**、**用户/填表数据（Postgres）**、**训练图片与模板原件（Storage）**。  
发布版的核心业务数据会落到带 `owner_id + form_id` 的租户表，并配合 RLS 与私有桶策略强制隔离。

---

## 一、创建项目并拿到密钥

1. 打开 [supabase.com](https://supabase.com) → 新建 **Project**（记下数据库密码）。
2. 进入 **Project Settings → API**：
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`（形如 `https://xxxxx.supabase.co`）
   - **anon public** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role**（保密，勿提交前端）→ `SUPABASE_SERVICE_ROLE_KEY`

3. 在 `webapp/.env.local` 中填写（不要用文档里的占位符）：

```env
NEXT_PUBLIC_SUPABASE_URL=https://你的项目.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=你的_anon_密钥
SUPABASE_SERVICE_ROLE_KEY=你的_service_role_密钥
```

4. **关掉假登录**（若曾开启）：删除或注释 `NEXT_PUBLIC_DEV_MOCK_LOGIN`。

5. 重启：`npm run dev`。

---

## 二、登录（Auth）必配项

与 `AUTH.md` 一致，请确认：

| 位置 | 设置 |
|------|------|
| **Authentication → Providers → Email** | 打开 Email provider；不要依赖默认发信服务做真实注册 |
| **Authentication → Configuration → Custom SMTP** | 配置你自己的 SMTP（默认 SMTP 只发给项目团队成员邮箱，且限流很低） |
| **Authentication → Email Templates** | 验证码模板里输出 `{{ .Token }}`，不要只保留 `{{ .ConfirmationURL }}` |
| **Authentication → URL Configuration** | **Site URL**：上线后填正式域名；本地与预览用 Additional Redirect URLs |
| **Redirect URLs** | 至少加入 `http://localhost:3000/**`、生产环境 `https://你的域名/auth/callback`、以及 `https://*-.vercel.app/**` |

---

## 三、数据库 + Storage（发布版租户隔离）

应用代码约定（发布版）：

- **核心表**：
  - `public.app_forms`
  - `public.app_form_configs`
  - `public.app_form_training_examples`
  - `public.app_form_files`
- **兼容旧数据的 legacy 表**：`public.training_examples`
- **Storage 桶**：
  - `training-images`（训练图片 / Agent 上下文图片）
  - `form-files`（模板文件、训练原件、Excel/PDF/文档）

### 操作步骤

1. Supabase 控制台 → **SQL Editor** → **New query**。
2. 新环境：打开 **`webapp/supabase/schema.sql`**，**全选复制**到编辑器后执行。
3. 已有环境升级到发布版：再执行 **`webapp/supabase/migrations/20260417_release_tenant_isolation.sql`**。
4. 点击 **Run**（以上 SQL 都可重复执行：使用了 `if not exists` / `on conflict` / `drop policy if exists`）。

### 可选自检

- **Table Editor**：应能看到表 `app_forms`、`app_form_configs`、`app_form_training_examples`、`app_form_files`。
- **Storage**：应能看到桶 **`training-images`** 与 **`form-files`**（都为 Private）。

未配置或表/桶不存在时，应用会**自动退回本地文件**训练池（不影响主流程试跑）；配置正确后，训练数据会读写 Supabase。

---

## 四、安全与上线注意

1. **`SUPABASE_SERVICE_ROLE_KEY` 仅放在服务端环境变量**（如 Vercel 仅 Server，不要 `NEXT_PUBLIC_`）。
2. **不要把 `service_role` 写进浏览器或 Git。**
3. 生产环境在 Supabase 把 **Site URL** 改成你的正式域名，同时保留 localhost 与 preview 的 **Redirect URLs** 以便线下 / 支线 OAuth 可继续使用。
4. 发布版已为 `app_*` 表和 `storage.objects` 加了基于 `auth.uid()` 的 RLS / Storage policy；普通用户请求应优先走用户会话，不要再把业务数据读写建立在 service role 上。

---

## 五、完成后自测清单

- [ ] 本地能注册/登录（非假登录）
- [ ] 工作台「训练池 / 模板文件池 / 填表列表」相关操作无报错
- [ ] Supabase **Table Editor** 中 `app_forms` / `app_form_configs` / `app_form_training_examples` / `app_form_files` 有对应数据
- [ ] **Storage → training-images** 与 **Storage → form-files** 中有对应对象

更详细的登录说明见 **`AUTH.md`**。
