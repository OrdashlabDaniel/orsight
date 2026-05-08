# 测试支线部署（不影响主线用户）

主线（`main`）应对应**正式**域名与**生产** Supabase。
要在 **`develop` 或其它测试分支** 上随便测、又不影响正式用户，需要同时满足两件事：

1. **独立 URL**：测试代码部署在另一个站点（或同一 Vercel 项目里仅用于预览的域名），正式用户只访问生产站点。
2. **独立数据**：测试站点使用的 `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` 必须指向**另一个 Supabase 项目**（staging）。若与生产共用同一套库，即使用不同分支，也会改到同一份用户与训练数据。

---

## 推荐做法：第二个 Vercel 项目 + `develop` 为生产分支

1. 在 [Vercel](https://vercel.com) 新建项目，例如 `orsight-webapp-staging`，连接同一 GitHub 仓库。
2. **Root Directory** 选 `webapp`。
3. **Production Branch** 设为 `develop`（这样推 `develop` 会更新测试站，与主线 `main` 的正式项目分离）。
4. 在该项目的 **Environment Variables** 中配置：
   - 与 `webapp/.env.example` 一致的一整套变量；
   - **Supabase**：填 **staging 专用** 项目的 URL 与密钥（不要用生产项目的密钥）；
   - 务必增加：
     `NEXT_PUBLIC_APP_CHANNEL=staging`
     这样全站会显示黄色「测试环境」条，避免与正式环境混淆。
5. 在 **staging Supabase** 控制台 → Authentication → URL Configuration 里，把测试站的域名加入 **Redirect URLs**（与 `AUTH.md` / `SUPABASE_SETUP.md` 中生产配置类似，只是换成 staging 域名）。

正式用户使用的项目保持：`Production Branch = main`，且**不要**设置 `NEXT_PUBLIC_APP_CHANNEL=staging`（或显式设为 `production`）。

---

## 代码里如何区分

- `NEXT_PUBLIC_APP_CHANNEL=staging` 时，布局顶部会显示测试环境横幅（见 `src/components/DeploymentBanner.tsx`）。
- 服务端也可用 `getPublicAppChannel()`（`src/lib/app-environment.ts`）做后续扩展（例如关闭某些写操作）；当前以部署隔离与数据隔离为主。

---

## 与 Git 分支的关系

| 分支     | 典型用途     | 部署目标              |
|----------|--------------|------------------------|
| `main`   | 稳定发布     | 正式 Vercel + 生产 DB |
| `develop`| 集成与测试   | 测试 Vercel + staging DB |

仅推代码到 `develop` 不会自动隔离数据；**必须用不同 Supabase 项目（或至少不同实例）** 才能从根上避免影响主线用户。
