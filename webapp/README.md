# OrSight

## 功能

- 批量上传 POD 签退截图
- AI 自动识别并填入在线表格
- 批量并发识别与进度条
- 双模型策略：批量用便宜模型，复核用强模型
- 在线修改表格内容
- 一键复制为表格文本，直接粘贴到其他表格
- 一键下载 Excel
- 对高风险记录给出复核提醒

## 启动

1. 复制环境变量文件

```bash
copy .env.example .env.local
```

2. 填写 AI 配置

- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `OPENAI_PRIMARY_MODEL`
- `OPENAI_REVIEW_MODEL`
- `OPENAI_REASONING_EFFORT`，建议 `minimal`

3. 安装并启动

```bash
npm install
npm run dev
```

4. 打开浏览器

```text
http://localhost:3000
```

## 识别规则

- `抽查路线` 只取任务区路线号
- `运单数量` 只取 `应领件数`
- `未收数量` 只取 `未领取`
- `错扫数量` 只取 `错分数量`
- 顶部 `站点车队` 不能写入抽查路线
- 多任务截图不能靠差值推断未完整显示的数据

## 当前实现说明

- 前端：`Next.js`
- 后端接口：`src/app/api/extract/route.ts`
- 表格导出：`xlsx`
- AI 接口：兼容 OpenAI 风格的 `chat/completions`
- 推荐生产配置：批量识别 `gpt-5-mini`，再次识别 `gpt-5`
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

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
