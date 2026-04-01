# OrSight / pod-audit-tool — 项目交接文档（AI 与工程师可读）

> **目的**：让未接触过本仓库的 AI 或工程师在读完本文后，能定位代码、理解数据流、遵守业务约束，并安全地扩展功能。  
> **仓库根路径示例**：`c:\works\Career\Position\GOFO\works\pod-audit-tool`（以你本机为准）  
> **产品名**：OrSight（填表模式 / 训练模式）

---

## 1. 项目是做什么的

### 1.1 一句话

用户上传 **POD（签退）设备或网页截图**，系统用 **多模态大模型** 抽取结构化字段，填入在线表格；对可疑结果 **标红/待复核**；用户可 **再次识别、查看原图、打开标注**；正确样本可 **存入训练池**，通过 **提示词 + 参考图 + 按区域裁剪二次 OCR** 提高后续批量识别质量。

### 1.2 不是什么

- **不是**对基座模型做真正的 LoRA/微调；训练池是 **示例学习（in-context）+ 区域裁剪辅助**，不是离线训练。
- **默认不把**「当前这次填表结果」持久化到业务数据库；表格主要在浏览器内存中（刷新会丢）。**持久化的是训练池**（Supabase 或本地文件）。
- **admin-webapp** 是 **运营/用量可视化后台**，与主填表流程独立。

---

## 2. 仓库结构（必须知道的路径）

```
pod-audit-tool/
├── webapp/                 # 主应用 Next.js（用户填表 + 训练）
│   ├── src/app/(protected)/page.tsx    # 填表主页（大表格、上传、识别）
│   ├── src/app/(protected)/training/   # 训练模式页面
│   ├── src/app/api/extract/route.ts   # 批量/再次识别核心 API
│   ├── src/app/api/training/*         # 训练池、预览裁剪、规则、图片
│   ├── src/lib/pod.ts                 # PodRecord、校验、visionPrompt
│   ├── src/lib/training.ts            # 训练样本加载、提示词拼装、参考图
│   ├── src/lib/supabase.ts            # Supabase 客户端与配置判断
│   ├── src/lib/auth-server.ts         # getAuthUserOrSkip（登录/跳过）
│   ├── supabase/schema.sql            # 训练表 + Storage 桶
│   ├── supabase/admin_schema.sql      # usage_logs + admin_users（管理端）
│   ├── .env.example
│   ├── AUTH.md / SUPABASE_SETUP.md
│   └── README.md
├── admin-webapp/           # 管理后台 Next.js（独立端口，常用 3001）
│   ├── src/app/(protected)/          # 需管理员登录
│   ├── src/app/viz/                  # 可视化（含用户用量等，部分路由可公开）
│   └── .env.example
├── training/               # 无 Supabase 时的本地训练元数据兜底（如 examples.json）
├── image/training-ai/      # 无 Supabase 时的本地训练图片目录（与代码约定一致）
├── scripts/                # 杂项脚本（如报告 PDF）
├── ADMIN_SETUP.md          # 管理端数据库与启动说明
├── pod_form_rules.md       # 业务规则文字说明（与代码应对齐）
└── PROJECT_HANDOFF.md      # 本文档
```

---

## 3. 技术栈

| 层级 | 技术 |
|------|------|
| 主应用 | Next.js（App Router）、React、TypeScript |
| 管理端 | 同上，独立 `package.json` |
| AI | OpenAI 兼容 `POST /v1/chat/completions`，`response_format: json_object`，图片用 `image_url`（含 data URL） |
| 图像 | `sharp`（服务端裁剪） |
| 认证（主站） | Supabase Auth；可选开发假登录 Cookie |
| 数据 | Supabase Postgres（`training_examples`、`usage_logs`、`admin_users`）；Storage 桶 `training-images` |
| 表格导出 | `xlsx` |

---

## 4. 核心业务规则（不可随意违背）

以下与 `webapp/src/lib/pod.ts` 中 `visionPrompt`、`validateRecord` 及 `api/extract` 逻辑一致，修改前请全文搜索影响面。

1. **抽查路线 `route`**：须为快递员任务路线形态（如 `IAH01-030-C`，含两位区域数字）。**不得**把顶部 **站点车队**（如 `IAH-BAA`）当作路线；此类误填会被后处理挪到 `stationTeam` 并清空 `route`。
2. **运单数量 `total`**：须来自 **应领件数**（或训练池认可的 `totalSourceLabel`，如 **应收件数**）。不得用实领/已领等替代；计数器与训练裁剪会校验或补全。
3. **未收数量 `unscanned`**：对应 **未领取** 等语义，勿与角标装饰数字混淆。
4. **错扫数量 `exceptions`**：对应 **错分/错扫** 等列；勿把未收或小角标当作错扫。
5. **可疑的运单数量**：宁可 **清空** 并标复核，也不要留错误数字。
6. **多行截图**：每条清晰行对应 `records` 里一条；**跨图完全相同业务键**会在前端 `organizeRecords` **合并为一行**，`imageName` 用 ` | ` 连接多张文件名，`mergedSourceCount` 标记合并条数。

---

## 5. 核心数据模型：`PodRecord`

定义见 `webapp/src/lib/pod.ts`。

| 字段 | 含义 |
|------|------|
| `id` | 前端行 id，常含 `imageName-index` |
| `imageName` | 来源图文件名；合并行为 `a.jpg \| b.jpg` |
| `date`, `route`, `driver` | 日期、抽查路线、司机 |
| `total`, `unscanned`, `exceptions` | 数字或 `""` |
| `totalSourceLabel` | 运单数量来源标签（如应领件数） |
| `waybillStatus` | 如 待更新 / 全领取 |
| `stationTeam` | 站点车队 |
| `reviewRequired`, `reviewReason` | 待复核标记与原因 |
| `mergedSourceCount` | 可选；≥2 表示跨图合并行 |

**校验**：`validateRecord` 会产出 `ExtractionIssue[]`（含 `missing_total`、`missing_unscanned` 等 `code`）。前端 **待复核徽章** 在 `record.reviewRequired` **或** 存在 error 级 issue 时显示（见 `(protected)/page.tsx`）。

---

## 6. 批量识别流水线（`POST /api/extract`）

文件：`webapp/src/app/api/extract/route.ts`。

### 6.1 认证

`getAuthUserOrSkip()`：若配置为必须登录且无 Supabase/假登录，则 401。本地可 `NEXT_PUBLIC_REQUIRE_LOGIN=false` 且未启用 Supabase 时 **skipAuth**。

### 6.2 单次请求内 Vision 上下文（性能关键）

`buildExtractVisionContext()` **每请求只构建一次**：

- `loadTrainingExamples()` + `loadGlobalRules()`
- `buildVisualReferencePack(examples)` 与 `buildAgentThreadReferenceImages` **并行**

后续 **N 次主识别**（一致性检查）**共用**该上下文，避免重复读库与重复拼参考图。

### 6.3 一致性次数

环境变量 **`EXTRACT_CONSISTENCY_ATTEMPTS`**：整数 **2～8**，默认 **4**。同一张图并行调用主 Vision **N 次**，对 **第一条 attempt 的每条 record** 做签名比对；不一致则 `reviewRequired` + issue `consistency_mismatch`。

### 6.4 主 Vision：`callVisionModel`

- 系统提示：`visionPrompt`（`pod.ts`）+ `buildTrainingPromptSection` + 训练池框选文字说明 + 参考图 + Agent 参考图 + **当前待识别整图**。
- 返回：`imageType`（`POD` / `WEB_TABLE` / `OTHER`）+ `records[]`。

### 6.5 POD 且训练池非空：训练池裁剪（并行）

对 **仅 1 条 record** 的 POD 图，在 **route / total / unscanned / exceptions** 上，若训练样本中存在对应字段且 **`coordSpace === "image"`** 的框，则取 **中位数矩形**，`sharp` 裁剪后 **各自一次** JSON OCR，**四路 `Promise.all` 并行**，再合并到一条 record（`mergeParallelRefineReasons` 合并复核原因）。

**重要**：旧数据仅有 `container` 或未写 `coordSpace` 的框 **不会**参与裁剪；需在训练工作台用位图坐标重新保存。

### 6.6 路线与站点修复

`repairRouteVersusStationTeamRecord`：若 `route` 像站点三字母段而非快递员路线，则写入 `stationTeam`、清空 `route`、标复核。

### 6.7 运单来源标签

`markSourceMismatchForReview`：`validLabels` 来自训练池样本的 `totalSourceLabel` + 默认「应领件数」「应收件数」「运单数量」。标签不合法则清空 `total` 并标复核。

### 6.8 POD 计数器核验

`callCounterVerifier`：固定比例裁剪 **应领/实领/已领** 三区，再调模型。`applyCounterVerification`：

- 若固定区读不到应领且 **无**训练池信任标签，则清空 total；
- 若 **totalSourceLabel 在 validLabels** 且计数器读失败，**保留**训练/主模型给出的 total（避免误删）；
- 末尾若 total 仍空但应领可读，用应领 **补全** total。

### 6.9 日志

登录用户且配置 Service Role 时，异步写入 `usage_logs`（`extract_table`、token 统计）。

### 6.10 响应

`records`、`issues`、`modelUsed`、`mode`、`trainingExamplesLoaded`。

---

## 7. 前端填表页要点（`(protected)/page.tsx`）

- **并发批量**：`runParallelExtraction` 对每张图单独 `POST /api/extract`（worker 池），合并 `records` 与 `issues`。
- **organizeRecords**（`pod.ts`）：按业务键去重；多源合并行带 **`mergedSourceCount`** 与紫色 **「跨图合并」** 提示。
- **查看图片**：`getSourceImageNames` 解析 ` | `，**并行加载多张** 在弹窗纵向展示（合并行可看全图）。
- **再次识别**：`mode: review`，用 `OPENAI_REVIEW_MODEL`。
- **打开标注**：`TrainingAnnotationWorkbench`，首图来自上传预览或 `/api/training/image`。

---

## 8. 训练模式与 API

### 8.1 类型（`training.ts`）

- **`TrainingExample`**：`imageName`、`output`（标准答案）、`boxes[]`、`fieldAggregations`、`notes`。
- **`TrainingBox`**：`field`、`value`、归一化 `x,y,width,height`、`coordSpace`：`image`（位图 0~1）或 `container`（遗留）。

### 8.2 训练相关路由

| 路径 | 作用 |
|------|------|
| `POST /api/training/save` | 写入训练样本（Supabase upsert 或本地 JSON） |
| `POST /api/training/preview-fill` | **仅裁剪框内**小图送模型，与批量填表逻辑对齐 |
| `GET /api/training/image` | 按 `imageName` 读 Storage 或本地文件，返回 data URL |
| `GET /api/training/status` | 训练池条数等 |
| `POST /api/training/rules` | 全局规则 / workingRules |
| `POST /api/training/guidance-chat` | Agent 对话 |
| 等 | `parse-document`、`context-asset` |

### 8.3 全局规则特殊键

`training_examples` 表中 `image_name === "__global_rules__"` 存 `GlobalRules`（instructions、documents、agentThread、workingRules 等）。**勿与普通图片样本混淆。**

### 8.4 训练提示词环境变量（可选）

- `TRAINING_PROMPT_EXAMPLES`：注入提示的文本样本条数上限（默认约 12）。
- `TRAINING_BOX_HINT_EXAMPLES`：带框说明的样本数（默认约 8）。
- `TRAINING_VISUAL_REF_IMAGES`：附加参考图张数，`0` 关闭（默认 2）。
- `AGENT_CONTEXT_REF_IMAGES`：Agent 线程里附图张数上限。

---

## 9. Supabase 与本地兜底

| 组件 | Supabase | 未配置时 |
|------|----------|----------|
| 训练元数据 | `public.training_examples` | `training/examples.json`（或代码内本地路径） |
| 训练图片 | Storage `training-images` | `image/training-ai/` |

**初始化 SQL**：`webapp/supabase/schema.sql`。  
**管理端表**：`webapp/supabase/admin_schema.sql`（`usage_logs`、`admin_users`）。

详见 `webapp/SUPABASE_SETUP.md`、`webapp/AUTH.md`。

---

## 10. 环境变量清单（主应用 `webapp`）

| 变量 | 说明 |
|------|------|
| `OPENAI_API_KEY` | 必填（识别/训练相关 API） |
| `OPENAI_BASE_URL` | 默认 OpenAI 官方 |
| `OPENAI_PRIMARY_MODEL` | 批量识别默认模型 |
| `OPENAI_REVIEW_MODEL` | 再次识别 |
| `OPENAI_REASONING_EFFORT` | 建议 `minimal` |
| `OPENAI_PREVIEW_MODEL` | 可选；预览裁剪 |
| `OPENAI_GUIDANCE_MODEL` | 可选；指导对话 |
| `EXTRACT_CONSISTENCY_ATTEMPTS` | 2～8，默认 4 |
| `NEXT_PUBLIC_REQUIRE_LOGIN` | `false` 可关闭强制登录（无 Supabase 时） |
| `NEXT_PUBLIC_DEV_MOCK_LOGIN` | 仅开发假登录 |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 前端 + 服务端用户态 |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端写训练池、usage_logs |

---

## 11. 管理端 `admin-webapp`

- **用途**：管理员登录后查看用户列表、用量；`/viz` 等可视化（具体以当前路由为准）。
- **环境**：与主站共用同一 Supabase 项目 URL/anon；**必须**配置 `SUPABASE_SERVICE_ROLE_KEY` 读全量数据。
- **启动**：`cd admin-webapp && npm install && npx next dev -p 3001`（Windows 下注意端口参数写法）。
- **权限**：`admin_users` 表需手动插入你的 `auth.users.id`。

见 `ADMIN_SETUP.md`。

---

## 12. 与 AI 协作时的约束（给后续 AI 的硬性说明）

1. **先读再改**：改识别逻辑必看 `extract/route.ts`、`pod.ts`、`training.ts` 三处联动。
2. **不要破坏**：图片查看弹窗与标注工作台 **分离**；可疑 **运单数量** 策略是 **清空+复核**，不是静默保留。
3. **坐标系**：新训练框必须是 **`coordSpace: "image"`**，否则批量裁剪增强 **不生效**。
4. **合并行**：`imageName` 含 ` | ` 或 `mergedSourceCount > 1`；查看图片、再次识别、删除需考虑 **多文件名**（见 `getSourceImageNames`）。
5. **不要提交**：`.env.local`、`service_role`、用户私有图片；大体积训练素材按团队规范走 `.gitignore`。

---

## 13. 推荐自检清单（接手后）

- [ ] `webapp`：`npm install && npm run dev`，能打开填表页。
- [ ] `.env.local`：至少 `OPENAI_API_KEY`；若需登录则 Supabase 三项齐全。
- [ ] 上传 1 张 POD → 识别 → 表格有数据；故意错误样本是否出现待复核/错误 issue。
- [ ] 训练页保存 1 条带 **位图框** 的样本 → 再批量识别同构图，观察 total/route 等是否改善。
- [ ] （可选）执行 `schema.sql` / `admin_schema.sql`，验证训练池与 admin 登录。

---

## 14. 文档与脚本索引

| 文件 | 内容 |
|------|------|
| `webapp/README.md` | 用户向功能与启动 |
| `webapp/AUTH.md` | 登录与假登录 |
| `webapp/SUPABASE_SETUP.md` | 库表与 Storage |
| `ADMIN_SETUP.md` | 管理端 |
| `pod_form_rules.md` | 业务规则叙述 |
| `training/README.md` | 训练目录说明（若有） |

---

## 15. 版本与远程（截至文档编写时的惯例）

- 主开发分支通常为 **`main`**，远程曾关联 `origin`（以你本地 `git remote -v` 为准）。
- 具体 commit 以 Git 历史为准；功能迭代快时 **以代码为准、文档为辅**，重大行为变更请同步更新本节或全文。

---

**文档维护**：新增 API、新表、新环境变量或改变识别/训练语义时，请更新本文件对应章节，便于下一位人类或 AI 快速对齐。
