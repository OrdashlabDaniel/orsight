# Supabase 搭建指南（OrSight / webapp）

本应用用 Supabase 做三件事：**登录（Auth）**、**训练元数据（Postgres）**、**训练图片（Storage）**。  
业务上的「抽查表格」数据主要在浏览器里处理，**默认不落库**；云端持久化的是 **训练池**。

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
| **Authentication → Providers → Email** | 关闭 **Confirm email**（用户名+密码流程无需邮箱验证） |
| **Authentication → URL Configuration** | **Site URL**：本地填 `http://localhost:3000`；上线后改为正式域名 |
| **Redirect URLs** | 增加 `http://localhost:3000/auth/callback` 及生产环境 `https://你的域名/auth/callback` |

---

## 三、数据库 + Storage（训练池）

应用代码约定：

- **表名**：`public.training_examples`  
  - `image_name`（主键，与图片文件名一致）  
  - `data`（`jsonb`，整份训练样本 JSON）  
  - `updated_at`（可选维护字段）
- **Storage 桶名**：`training-images`（私有桶，服务端用 Service Role 上传/下载）

### 操作步骤

1. Supabase 控制台 → **SQL Editor** → **New query**。
2. 打开本仓库文件 **`webapp/supabase/schema.sql`**，**全选复制**到编辑器。
3. 点击 **Run**（成功即可，可重复执行：使用了 `if not exists` / `on conflict`）。

### 可选自检

- **Table Editor**：应能看到表 `training_examples`。
- **Storage**：应能看到桶 **`training-images`**（Private）。

未配置或表/桶不存在时，应用会**自动退回本地文件**训练池（不影响主流程试跑）；配置正确后，训练数据会读写 Supabase。

---

## 四、安全与上线注意

1. **`SUPABASE_SERVICE_ROLE_KEY` 仅放在服务端环境变量**（如 Vercel 仅 Server，不要 `NEXT_PUBLIC_`）。
2. **不要把 `service_role` 写进浏览器或 Git。**
3. 生产环境在 Supabase 把 **Site URL**、**Redirect URLs** 改成你的正式域名。
4. 若团队扩大，可再为 `training_examples` / `storage.objects` 增加基于 `auth.uid()` 的 RLS 策略；当前设计是 **仅 Next 服务端用 Service Role 访问**，与现有 API 一致。

---

## 五、完成后自测清单

- [ ] 本地能注册/登录（非假登录）
- [ ] 工作台「训练池」相关操作无报错（保存标注后刷新仍在）
- [ ] Supabase **Table Editor** 中 `training_examples` 有新增行（保存过训练样本后）
- [ ] **Storage → training-images** 中有对应图片文件（若本地上传了训练图）

更详细的登录说明见 **`AUTH.md`**。
