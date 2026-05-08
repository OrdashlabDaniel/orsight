# OrSight 工程交接文档

更新时间：2026-05-02
项目路径：`C:\works\Ordash_Lab_LLC\Project\Orsight`
适用对象：后续接手的工程师、AI 编码助手、项目负责人

## 1. 文档目的

这份文档的目标不是宣传，而是**帮助接手者快速进入可执行状态**。
它覆盖四件事：

1. OrSight 当前产品目标与业务定位
2. 当前代码与系统已经做到哪里
3. 哪些地方正在重构，哪些地方已经陷入循环
4. 后续应该按什么顺序继续，避免再重复几天的无效修补

这份文档刻意把“这几天一直没有收敛的问题”写清楚，避免下一个接手者继续在同一个坑里浪费时间和 token 成本。

---

## 2. 产品目标

OrSight 是一个以图片/PDF 为输入的数据提取与填表系统，核心目标是：

1. 让用户上传司机签退/POD/运营表格截图后，系统自动提取字段并生成在线表格
2. 让用户通过训练模式持续修正识别效果，而不是每次靠工程师硬编码
3. 支持多种来源形态：
   - 单张手机拍摄的 POD/签退界面
   - 完整表格截图
   - PDF
   - 用户上传的 Excel 模板
4. 让用户能够通过“识别管家”与模型沟通，逐步优化识别方式
5. 最终形成一套可商用的 SaaS：
   - 用户注册/登录
   - 训练池
   - 多填表空间
   - 订阅/计费
   - 管理员后台

---

## 3. 当前项目总体阶段

### 3.1 产品阶段判断

当前项目处于：

- **核心产品已跑通**
- **识别与训练主流程基本成型**
- **多填表空间已进入中后期**
- **支付/订阅正在接近上线前阶段**
- **管理员后台正在重构，但没有完全收口**

换句话说：

- 前台主产品已经不是从 0 到 1
- 训练池、识别、识别管家、导出、去重、删除、表格项目管理等已经有大量落地实现
- 真正卡住的主要是**后台管理系统的统一化与登录链路收敛**

### 3.2 当前最敏感的项目风险

目前最大的风险不是识别本身，而是：

1. **后台管理系统存在新旧两套实现并行**
2. **管理员登录链路反复变动，导致本地测试反复卡死**
3. **Billing 和 Users、Usage Board 之间的架构边界没有最终收口**

---

## 4. 仓库结构总览

项目根目录下最重要的部分：

- `webapp/`
  - 主用户端产品
  - 包含填表模式、训练模式、识别管家、订阅接口等
- `admin-webapp/`
  - 后台管理系统
  - 当前正在重构
- `docs/`
  - 文档目录
- `PROJECT_HANDOFF.md`
  - 旧交接文档，存在编码污染，不建议继续直接维护
- `OrSight_Project_Overview_2026-04-22.md`
  - 旧项目总览，存在编码污染
- `OrSight_Project_Overview_2026-04-22.pdf`
  - 旧 PDF 版本

---

## 5. 前台主产品当前进展

以下是主用户端 `webapp/` 的当前功能状态总结。

### 5.1 填表模式

已实现或基本实现：

1. 图片 / PDF 上传
2. OCR / AI 识别并生成表格记录
3. 结果在线编辑
4. 下载 Excel
5. 复制表格内容
6. 去重与跨图合并
7. 用户可删除单条识别结果
8. 对识别异常条目做“待复核”标记
9. 一键再识别待复核

### 5.2 训练模式

已实现或基本实现：

1. 训练池图片上传
2. 标注框绘制
3. 单条记录模式
4. 完整表格模式
5. 标注撤销
6. 标注后试填预览
7. 标注图片进入训练池
8. 训练池缩略图
9. 删除训练池图片

### 5.3 表格项目管理

已经做过多轮改造，目前方向为：

1. 表格项目支持新增
2. 支持删除
3. 支持重命名
4. 支持顺序调整
5. 标注字段与表格项目联动

但这一部分仍应继续验证边缘场景，尤其是：

- 空白新表创建
- 导入模板后字段同步
- 完整表格模式下多行字段的一致性

### 5.4 多填表空间

已做到：

1. 填表池首页
2. 多个填表空间切换
3. 新建填表
4. 克隆填表
5. 新建填表时的模板/训练流程

产品方向已经明确：

- 每个填表空间应有自己的：
  - 表格模板
  - 训练池
  - 识别规则上下文
  - 工作流

### 5.5 识别管家

已经做过较多开发，目标方向也已经明确：

1. 浮动对话框
2. 横跨填表模式与训练模式
3. 支持文字与图片/PDF 等附件输入
4. 用户通过对话反馈识别问题
5. 模型生成“内化规则”，不直接暴露底层架构控制

当前产品要求非常明确：

- 用户可以调整**识别方式**
- 用户不能调整整个软件架构
- 规则应**持久存在**
- 不是页面一关就丢失

这部分前端交互已经做了较多尝试，但要继续确认：

1. 会话持久化是否可靠
2. 附件预览、点开、标注是否稳定
3. 模型返回是否流式、低延迟

---

## 6. 支付 / 订阅系统当前进展

这部分已经不再是“从零开始”，而是接近上线前联调阶段。

### 6.1 已经完成的方向

在 `webapp/` 中已经落地的核心方向包括：

1. 订阅购买入口
2. 账单门户入口
3. Stripe webhook 回写
4. 内部套餐生效逻辑
5. 月费 + 用量计费混合模型的代码骨架
6. Billing 相关数据库迁移文件

### 6.2 当前认识

支付系统真正还差的不是“大量代码”，而是：

1. 环境变量
2. Stripe Dashboard 实际配置
3. 正式库迁移
4. 后台管理入口的统一化

### 6.3 重要文件

`webapp/` 侧相关文件包括但不限于：

- `src/app/api/billing/`
- `src/lib/billing.ts`
- `supabase/migrations/20260424_billing_catalog_and_invoices.sql`
- `supabase/migrations/20260424_billing_stripe_assets.sql`

---

## 7. 管理员后台当前真实状态

这一部分是当前最需要交接清楚的。

### 7.1 正在发生的事

后台管理系统当前不是一套代码，而是**新旧并存**：

#### 旧实现

- 入口核心是 `admin-webapp/src/app/viz/page.tsx`
- 这是原始用量看板
- 它具备用户很认可的 UX 和功能密度：
  - 汇总卡片
  - 图表
  - 用户列表
  - 导出
  - 单用户详情
  - 回收站

#### 新实现

- 使用新的统一后台壳子
- 左侧导航
- Dashboard / Users / Billing / Usage Board
- 核心侧边栏文件：
  - `admin-webapp/src/components/Sidebar.tsx`
- 新首页：
  - `admin-webapp/src/app/(protected)/page.tsx`

### 7.2 用户明确要的最终方向

用户已经明确否定了“新旧并行修补”的做法，要求如下：

1. **不要再继续修旧后台**
2. **以新的后台壳子为唯一主线**
3. 左侧导航保持
4. 旧 `Usage Board` 的 UX 和功能尽量原样保留
5. `Usage Board` 只是被集成到新后台系统里，不再独立漂着
6. `Users` 页面要能：
   - 删除用户
   - 赋予管理员权限
   - 移除管理员权限
7. 每个用户的付费/订阅管理要放在**单用户详情页**里完成
8. `Billing` 不应是脱离用户管理的孤岛式页面

### 7.3 当前为什么会反复循环

这几天最核心的问题不是某一个 bug，而是**架构没有一次收口**。

造成循环的具体原因：

1. **两套后台实现并存**
   - 旧 `viz`
   - 新 `(protected)` 路由体系

2. **认证链路被反复修改**
   - 公开访问 `/viz`
   - 受保护 `/billing`
   - Google 登录尝试
   - 本地单管理员密码登录
   - host 归一化 `127.0.0.1` / `localhost`

3. **登录态与路由耦合**
   - 登录成功但 cookie 未在正确 host 上生效
   - middleware 与页面访问路径不一致

4. **Billing 与 Users 的职责边界没有彻底统一**
   - 有独立 Billing 页面
   - 同时用户又要求从单用户详情里直接管理订阅

5. **过多增量补丁，没有一次推倒重收**
   - 结果是表面上“修了”
   - 实际上是不同代码路径继续打架

### 7.4 当前后台最重要的判断

如果后续继续做后台，**必须停止旧路线继续补丁式修补**。

正确做法应当是：

1. 新后台壳子为唯一主线
2. 把旧 `viz` 的内容迁入新的 `Usage Board` 页面
3. `Users` 页面做标准用户管理
4. 单用户详情页做计费/订阅/身份/删除等综合控制
5. `Billing` 页面保留为“全局套餐和价格配置页”，不是单用户操作主入口

---

## 8. 当前后台登录问题的交接说明

这一节是为了把“现在一直循环解决不了的问题”明确写下来。

### 8.1 用户要求

用户最新明确要求：

1. 后台只有一个真正管理员账号
2. 这个账号是：`IAHAMD`
3. 后台应该只允许这个管理员登录
4. 不要再绕 Google 登录
5. 不要再出现“明明登录了还进不去看板”

### 8.2 当前实际情况

后台登录链路被改过很多次，曾经包含：

1. Google 登录
2. Supabase 真实用户登录
3. 本地单管理员密码登录
4. host 归一化重定向

当前代码里已经存在本地管理员登录相关实现，但这条链路在最近几轮调试中出现了**密码状态沟通不一致**的问题：

- 曾对外口头说明过多个不同密码
- 本地 env / 代码兜底值 / 用户实际尝试值之间产生偏差

因此：

**不要再相信会话里的口头密码说明本身。**

后续接手者应直接检查：

- `admin-webapp/.env.local`
- `admin-webapp/src/lib/admin-local-auth.ts`
- 本地运行的实际进程环境

### 8.3 这个问题为什么几小时没有收敛

不是因为功能做不了，而是因为：

1. 身份系统变更太多
2. UI 架构同时在动
3. host/cookie 细节持续干扰验证
4. 没有先定死“只保留一种登录方式”

### 8.4 当前建议

后续不要再混用：

- Google 登录
- 用户登录
- 管理员登录

而是直接做：

1. 仅保留管理员密码登录
2. 仅保留 `IAHAMD`
3. 后台所有页面统一走这一套 auth guard
4. 登录成功只进新后台首页

---

## 9. 后台管理系统当前代码入口

以下是接手者最应该优先看的文件。

### 9.1 新后台壳子

- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\components\Sidebar.tsx`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\(protected)\page.tsx`

### 9.2 新 Users 体系

- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\(protected)\users\page.tsx`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\(protected)\users\[id]\page.tsx`

### 9.3 旧 Usage Board 体系

- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\viz\page.tsx`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\viz\VizCharts.tsx`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\viz\VizAccountRowMenu.tsx`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\viz\users\[id]\page.tsx`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\viz\users\[id]\UserTimeRangeControls.tsx`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\viz\users\[id]\VizUserDetailBillingPanel.tsx`

### 9.4 Billing 体系

- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\(protected)\billing\page.tsx`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\(protected)\billing\actions.ts`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\lib\billing-admin.ts`

### 9.5 登录与权限

- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\lib\supabase\middleware.ts`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\lib\admin-local-auth.ts`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\lib\admin-access.ts`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\login\page.tsx`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\login\actions.ts`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\auth\password-login\route.ts`
- `C:\works\Ordash_Lab_LLC\Project\Orsight\admin-webapp\src\app\auth\callback\route.ts`

---

## 10. 当前工作树状态

当前仓库不是干净状态，存在大量修改与新增文件。

### 10.1 重要结论

这说明：

1. 当前还处于**重构中间态**
2. 并不适合在没有进一步整理的情况下直接交给新工程师无脑继续开发
3. 接手者必须先识别：
   - 哪些是新后台主线
   - 哪些是旧 `viz` 代码
   - 哪些是未完成但已开始迁移的 billing / users 代码

### 10.2 当前 dirty tree 重点

`admin-webapp` 与 `webapp` 都有较多 modified / untracked 文件。
尤其是：

- `admin-webapp/src/app/(protected)/...`
- `admin-webapp/src/app/viz/...`
- `admin-webapp/src/lib/...`
- `webapp/src/app/api/billing/...`
- `webapp/src/lib/billing.ts`
- `webapp/supabase/migrations/...`

### 10.3 接手建议

不要在当前脏工作树上继续“边跑边猜”。
后续至少应当：

1. 先做一次手工归类
2. 明确保留/废弃路径
3. 再进入下一轮开发

---

## 11. 现在最推荐的后续执行顺序

如果由新 AI 或新工程师继续，建议严格按下面顺序，不要跳。

### 第一步：冻结后台架构

结论先定死：

1. 新后台壳子保留
2. 旧 `viz` 不再作为独立后台
3. 旧 `viz` 的 UX 和功能迁移为新的 `Usage Board`

### 第二步：登录只保留一条线

1. 只允许管理员账号
2. 只允许 `IAHAMD`
3. 只保留一种密码登录实现
4. 删除 Google 登录分支
5. 删除多余 fallback

### 第三步：恢复 Usage Board

目标不是重写 UX，而是：

1. 把旧 `viz` 页面内容原样保留
2. 接进新的左侧导航系统
3. 确保点击 `Usage Board` 不再跳回 Dashboard

### 第四步：Users 页面标准化

Users 列表页至少要有：

1. 用户名
2. 邮箱
3. 用户 ID
4. 注册时间
5. 图片量
6. Token
7. 费用
8. 套餐
9. 订阅状态
10. 操作：
   - 查看详情
   - 删除用户
   - 设为管理员
   - 取消管理员

### 第五步：单用户详情页成为控制中心

这个页面应该是后台的单用户管理核心，包含：

1. 用户基本信息
2. 用量与图表
3. 导出
4. 身份管理
5. 订阅状态
6. 手动套餐覆盖
7. Stripe 信息
8. 删除用户

### 第六步：Billing 页面缩为全局配置页

Billing 页面只保留：

1. 套餐和价格配置
2. 订阅机制配置
3. 免费账户规则
4. Stripe 资产同步

不要再把单用户具体操作主要放在这里。

---

## 12. 对 AI 接手者的明确约束

为了避免再次掉进循环，接手的 AI 应遵守下面的原则：

1. 不要再同时维护新旧两套后台路线
2. 不要一边修登录，一边改页面结构，一边改计费入口
3. 先选定唯一路线，再连续完成
4. 不要再靠会话中的口头密码说明判断真实凭据
5. 任何时候都以代码和实际 env 为准
6. 不要继续补丁式修补旧 `viz` 作为独立后台

---

## 13. 当前对产品负责人最重要的真实结论

如果只用一句话概括当前状态：

**主产品前台已接近可商用，支付系统已接近联调完成，但管理员后台因为新旧架构并行与登录链路反复变动，已经连续数天没有稳定收口，必须停止补丁式迭代，改为一次性重建后台主线。**

---

## 14. 这份交接文档的建议用途

这份文档适合：

1. 交给新的 AI 接手
2. 交给新的工程师接手
3. 作为内部同步文档

不适合：

1. 对外展示
2. 作为正式 PR 说明
3. 作为销售/产品介绍材料

---

## 15. 最后总结

当前项目不是“失败了”，而是：

- 前台业务已经跑通很多关键流程
- 支付系统接近最后一段
- 但后台在错误的方法论下连续进入了“修一处、跳一处、再回登录、再改路由”的循环

这份文档的核心价值，就是让下一位接手者**不要再沿着这条循环路线继续走**。
