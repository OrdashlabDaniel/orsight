# 登录说明

## 默认行为：**必须先登录**

- 访问 `/` 会跳到登录页（未登录时）。
- 若 **未正确配置 Supabase**（例如仍是 `your_supabase_project_url` 或没有 `https://`），打开首页会跳到 **`/login?reason=config`**，按页面说明补全环境变量即可。

## 纯本地、暂时不要登录

在 `webapp/.env.local` 中设置：

```env
NEXT_PUBLIC_REQUIRE_LOGIN=false
```

并重启 `npm run dev`。此时不会强制登录（也不校验 Supabase）。

## 开发假登录（不配 Supabase，测登录页）

仅在 **`npm run dev`**（`NODE_ENV=development`）下生效，生产构建不会启用。

在 `webapp/.env.local` 中增加：

```env
NEXT_PUBLIC_DEV_MOCK_LOGIN=true
```

重启后：

- 会出现完整登录表单（不再停在「需要配置登录」）。
- **任意用户名** + **密码至少 6 位** 即可进入工作台（通过 HttpOnly Cookie 记会话）。
- 顶部导航会显示「假登录」标签；退出调用 `/api/auth/dev-logout`。

上线前请删除该变量，改用真实 Supabase。

## Supabase 配置检查清单

1. **`NEXT_PUBLIC_SUPABASE_URL`**：必须是 `https://xxxx.supabase.co` 这种地址（复制 Supabase 控制台里的 Project URL）。
2. **`NEXT_PUBLIC_SUPABASE_ANON_KEY`**：anon public 密钥。
3. **`SUPABASE_SERVICE_ROLE_KEY`**：service_role（仅服务端；训练池写 Postgres/Storage 需要，见 **`SUPABASE_SETUP.md`**）。
4. **Authentication → Providers → Email**：关闭 **Confirm email**（无需邮箱验证）。
5. **Authentication → URL**：Site URL = `http://localhost:3000`；Redirect URLs 增加 `http://localhost:3000/auth/callback`。

改完 `.env.local` 后务必 **重启开发服务器**。

## 数据库与训练池

登录只依赖 URL + anon；**训练样本云端持久化**需要执行 SQL 创建表与 Storage 桶，请按 **`SUPABASE_SETUP.md`** 操作（可复制 **`supabase/schema.sql`**）。

## 用户名登录

界面为「用户名 + 密码」，不要求邮箱格式；底层映射为伪邮箱，展示名存在 `user_metadata`。详见此前说明。

## API

启用登录且已配置 Supabase 时，`/api/extract` 等与训练相关接口需要已登录 Cookie。
