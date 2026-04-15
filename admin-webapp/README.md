This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## 子域名上线（如 admin.example.com）

1. 在托管平台新建一个部署，**根目录**选本仓库的 `admin-webapp`（与用户端 `webapp` 分开两个项目）。
2. 绑定自定义域名，例如 `admin.yourdomain.com`。
3. 配置环境变量：与 `webapp` 生产环境相同的 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`（见本目录 `.env.example`）。
4. 打开 **Supabase → Authentication → URL configuration**，在 **Redirect URLs** 中加入：  
   `https://admin.yourdomain.com/auth/callback`  
   （将域名换成你的管理员子域；OAuth/邮件链接回调依赖此项。）
5. 在用户端 `webapp` 的生产环境变量中设置：  
   `NEXT_PUBLIC_ADMIN_APP_URL=https://admin.yourdomain.com`  
   用户登录页会出现「进入管理员登录」，跳转到管理员站的 `/login`。

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
