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
3. **`SUPABASE_SERVICE_ROLE_KEY`**：service_role（仅服务端；用于后台/兼容迁移/计量日志等受控能力，见 **`SUPABASE_SETUP.md`**）。
4. **Authentication → Providers → Email**：关闭 **Confirm email**（无需邮箱验证）。
5. **Authentication → URL**：Site URL = `http://localhost:3000`；Redirect URLs 增加 `http://localhost:3000/auth/callback`。
6. **Google 登录（可选但推荐生产开启）**  
   - 若点击「使用 Google 登录」后浏览器出现 JSON：`Unsupported provider: provider is not enabled`，表示 **Supabase 尚未启用 Google 提供商**，与应用代码无关。  
   - 在 **Authentication → Providers → Google**：打开开关，填写 **Google Cloud Console** 里 OAuth 2.0 客户端的 **Client ID** 与 **Client Secret**（同意屏幕、已授权重定向 URI等按 Google 文档配置）。  
   - **Redirect URLs** 必须为「你的站点 origin + `/auth/callback`」。例如生产：`https://你的域名/auth/callback`；Vercel 预览：`https://xxx.vercel.app/auth/callback`（每个常用部署 URL 都要加一条，或临时用通配规则若项目允许）。  
   - **首次 Google 登录成功** 时，Supabase 会在 **`auth.users`** 中 **自动创建该用户**（等同于注册）；业务上的 `app_forms` 等数据在用户首次进入工作台时会按现有逻辑初始化，无需再填密码注册。  
   - 应用在 **`/auth/callback`** 中会为 OAuth 用户补写 `user_metadata.pod_username`（展示名），与邮箱/用户名体系对齐。
7. **管理员子域入口（可选）**：在用户端 `.env.local` / 生产环境设置 `NEXT_PUBLIC_ADMIN_APP_URL`（无末尾斜杠），例如本地 `http://localhost:3002`、生产 `https://admin.你的域名.com`。登录页会显示「进入管理员登录」。管理员站部署与 Supabase Redirect 说明见 **`admin-webapp/README.md`**。

改完 `.env.local` 后务必 **重启开发服务器**。

## 数据库与训练池

登录只依赖 URL + anon；发布版的**用户表单、训练样本、模板文件**云端持久化需要执行 **`supabase/schema.sql`**，老环境升级还要执行 **`supabase/migrations/20260417_release_tenant_isolation.sql`**。请按 **`SUPABASE_SETUP.md`** 操作。

## 用户名登录

界面为「用户名 + 密码」，不要求邮箱格式；底层映射为伪邮箱，展示名存在 `user_metadata`。详见此前说明。

## API

启用登录且已配置 Supabase 时，`/api/extract` 等与训练相关接口需要已登录 Cookie。
