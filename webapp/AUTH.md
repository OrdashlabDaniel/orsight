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
4. **Authentication → Providers → Email**：打开 Email provider；生产环境不要依赖 Supabase 默认发信。
5. **Authentication → Configuration → Custom SMTP**：配置你自己的 SMTP（Resend / SES / Postmark / SendGrid 等）。Supabase 默认 SMTP **只会发给项目团队成员邮箱**，且限流很低，不适合真实注册验证码。
6. **Authentication → Email Templates**：把当前用于邮箱验证码的模板改成输出 `{{ .Token }}`（不要只保留 `{{ .ConfirmationURL }}`），这样页面里的 6 位验证码输入框才有真实可用的验证码。

## 分享填表直发邮件

如果要让「分享填表」里的“发送邀请”按钮**直接把链接发到对方邮箱**，除了在 Supabase 里配置注册/确认邮件 SMTP，还需要给 `webapp` 服务端配置自己的发信环境变量（见 `.env.example` 里的 `FORM_SHARE_SMTP_*` / `FORM_SHARE_FROM_EMAIL`）。  
原因是：Supabase 的 Auth 邮件配置不会自动暴露给 Next.js 服务器；分享邀请属于应用自己的业务邮件，必须由 `webapp` 后端自行发出。
7. **Authentication → URL Configuration**：
   - **Site URL**：生产填正式域名，例如 `https://www.orsight.com`
   - **Redirect URLs** 至少加入：
     - `http://localhost:3000/**`
     - `https://www.orsight.com/auth/callback`
     - `https://orsight.com/auth/callback`
     - `https://*-.vercel.app/**`（用于 Vercel 支线 / 预览域名）
8. **Google 登录（可选但推荐生产开启）**  
   - 若点击「使用 Google 登录」后浏览器出现 JSON：`Unsupported provider: provider is not enabled`，表示 **Supabase 尚未启用 Google 提供商**，与应用代码无关。  
   - 在 **Authentication → Providers → Google**：打开开关，填写 **Google Cloud Console** 里 OAuth 2.0 客户端的 **Client ID** 与 **Client Secret**（同意屏幕、已授权重定向 URI等按 Google 文档配置）。  
   - Google OAuth 最终回跳能否在主线 / 支线 / 本地都生效，关键在 **Supabase 的 Redirect URLs allow-list**。应用代码已经按当前 origin 动态传 `redirectTo`，所以要确保上面的 localhost / vercel preview / 正式域名都在 Supabase 里放行。  
   - **首次 Google 登录成功** 时，Supabase 会在 **`auth.users`** 中 **自动创建该用户**（等同于注册）；业务上的 `app_forms` 等数据在用户首次进入工作台时会按现有逻辑初始化，无需再填密码注册。  
   - 应用在 **`/auth/callback`** 中会为 OAuth 用户补写 `user_metadata.pod_username`（展示名），与邮箱/用户名体系对齐。
9. **管理员子域入口（可选）**：在用户端 `.env.local` / 生产环境设置 `NEXT_PUBLIC_ADMIN_APP_URL`（无末尾斜杠），例如本地 `http://localhost:3002`、生产 `https://admin.你的域名.com`。登录页会显示「进入管理员登录」。管理员站部署与 Supabase Redirect 说明见 **`admin-webapp/README.md`**。

改完 `.env.local` 后务必 **重启开发服务器**。

## 邮箱注册与 Auth 里「待验证」用户

- **Supabase 的机制**：使用邮箱 + 密码调用 `signUp` 时，**必须先**在 `auth.users` 插入一行（密码哈希、发信令牌等都挂在这行上），因此控制台 **Authentication → Users** 里会立刻看到该邮箱，状态常为 *Waiting for verification*。**无法在「用户还没点邮件链接」的前提下，让这一行完全不存在**；这不是应用代码能改写的流程。
- **与「正式可用」的区别**：未验证用户 `email_confirmed_at` 为空；在控制台开启 **Confirm email** 时，这类账号**不能完成密码登录**。本仓库的 **`list_registered_users`**（见 `webapp/supabase/list_registered_users_rpc.sql`）**只统计** `email_confirmed_at is not null` 的用户，因此 **OrSight 管理端依赖该 RPC 的「注册用户」列表不会把纯待验证账号算作正式用户**。
- **若你关心的是业务表**：不要在「注册提交」时往 `public.*` 写正式租户数据；应在用户**已确认邮箱并成功登录**后再初始化（例如首次进入工作台时），或配合数据库触发器仅在确认后写入。`signUp` 本身只会动 Auth 侧。

## 数据库与训练池

登录只依赖 URL + anon；发布版的**用户表单、训练样本、模板文件**云端持久化需要执行 **`supabase/schema.sql`**，老环境升级还要执行 **`supabase/migrations/20260417_release_tenant_isolation.sql`**。请按 **`SUPABASE_SETUP.md`** 操作。

## 用户名登录

界面为「用户名 + 密码」，不要求邮箱格式；底层映射为伪邮箱，展示名存在 `user_metadata`。详见此前说明。

## API

启用登录且已配置 Supabase 时，`/api/extract` 等与训练相关接口需要已登录 Cookie。
