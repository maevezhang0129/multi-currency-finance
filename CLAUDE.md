# CLAUDE.md

本文件是本项目对 Claude Code 的工作说明。开始任何编码前先读完，并在整个开发过程中遵守这里的原则。

---

## 1. 这个项目是什么 / 不是什么

**一句话定位**：一个多币种个人财务分析工具，作为「全栈能力展示」项目开源到 GitHub。

**关键前提**：这个仓库的第一读者不是「用户」，而是**看代码的人**（招聘方、面试官、其他开发者）。因此评判标准是**架构清晰度、代码可读性、工程规范**，而不是功能数量。

**据此产生的硬性要求**：
- 功能宁少勿多。一条做到干净、每层都体面的纵切，胜过五条各做一半的链路。
- 每一个技术选择都要能在 README 里说清「为什么这么选」。
- 不追求「记账 app 好用」，追求「这段代码看起来是懂全栈的人写的」。

**明确不做的事**（避免范围蔓延）：
- 不做用户账号 / 登录 / 认证系统（见第 3 节，这是刻意的架构决策）。
- 不做移动端 App、不做多人协作、不做 AI 建议引擎。
- 不接任何银行 / 支付平台 API。

---

## 2. 技术栈（已定，不要擅自替换）

| 层 | 选型 | 说明 |
|---|---|---|
| 全栈框架 | Next.js（App Router） | 前后端同仓库，一次部署 |
| 语言 | TypeScript（strict 模式） | **禁止 `any`**。类型是核心的能力信号 |
| 数据库 | Supabase（Postgres） | 只存公共汇率数据，不存用户账本 |
| ORM | Drizzle | schema 即代码，体现数据建模能力 |
| 定时任务 | Vercel Cron | 每月抓取汇率 |
| 前端图表 | Recharts | |
| 部署 | Vercel（连 GitHub 自动部署） | |

如果某个选型在实现中遇到硬阻塞，**先停下来向我说明问题和候选替代方案，不要自行切换技术栈**。

---

## 3. 最重要的架构原则：用户账本数据永不入库

这是整个项目的地基，也是 README 里最该被强调的设计取舍。

**原则**：用户的记账 / 账本数据**只存在用户自己的浏览器（localStorage）或用户自己导出的文件里，后端和数据库永不接触、永不存储**。

**为什么**（务必写进 README 的「设计取舍」章节）：
- 财务数据高度敏感。一旦入库，项目就背上加密、合规、备份、泄露责任。对一个开源展示项目，这是灾难性的错配。
- 不存用户身份数据 → 不需要账号系统 → 砍掉了全栈里最容易出安全事故的一整块。
- 这恰恰体现了一种成熟判断：**懂得「不做什么」比堆功能更能证明工程能力。**

**因此，后端只处理无状态、无隐私的公共数据**——也就是汇率。数据流是：

```
用户账本数据  →  仅存于浏览器 localStorage / 用户导出的文件   （后端不碰）
公共汇率数据  →  后端 cron 抓取 → Postgres → API → 前端       （全栈部分）
```

前端在浏览器本地，用从后端拿到的汇率，对用户的本地账本做折算和分析。

---

## 4. 开发主线：先把「汇率」这一条纵切做通做透

**在这条链路 100% 完成并部署上线之前，不要开始任何其他功能。** 这是防止项目烂尾的核心纪律。

这条链路只做汇率一件事，但要求穿透全栈每一层，每层各展示一种能力：

1. **数据库层（Drizzle schema）**：设计 `fx_rates` 表，字段至少含 `base_currency`、`quote_currency`、`month`（YYYY-MM）、`rate`、`source`、`fetched_at`。`(base, quote, month)` 建唯一约束用于去重。
2. **定时任务层（Vercel Cron）**：每月初触发，抓取上一个自然月的月度汇率。
3. **外部抓取层**：调用外部汇率数据源。**必须包含错误处理与重试**，抓取失败要记录而不是静默吞掉。API key 通过环境变量注入，绝不硬编码、绝不出现在前端。
4. **API 路由层（Next.js Route Handler）**：提供查询接口（如按币种对、按月份区间查）。**校验入参**，返回结构化 JSON，错误返回合适的 HTTP 状态码。
5. **前端层（React + Recharts）**：完整处理三种状态——加载中、空数据、错误。用图表展示汇率趋势。

每完成一层，提交一个独立 commit（见第 6 节）。

---

## 5. 汇率的领域规则（技术亮点，别做错）

普通记账 app 在这一点上几乎全是错的，做对了就是这个 repo 的差异化亮点。

- **月度汇率，不是日汇率**。用月度（月末快照或当月均值）作为折算基准，消除日汇率噪音，让月度对比平滑。
- **折算值必须冻结写死**。每一笔历史交易折算成基准币的数值，一旦按「交易发生月」的汇率算出，就**存为静态值，永不随实时汇率变动**。
  - 反面教材：用「今天的汇率」重算去年的消费。这会让用户每天打开看到的历史都在变，是绝对要避免的。
  - 实现上：折算发生在数据「进入用户本地账本」时，用当时那个月的汇率算好存下；之后即使汇率表更新，已折算的历史值不动。
- **双币种视角**。分析要能同时呈现「本币视角」（看消费行为是否变化）和「基准币视角」（看总资产 / 储蓄率），并单独暴露一行「汇率影响」= 两个视角的差额。对只用单一币种的用户，这一行自然为 0，功能自动隐藏。
- **基准币默认 USD**：三个目标币种（SEK / THB / CNY）都有对 USD 的直接报价，避免两跳换算引入误差。

---

## 6. 工作规范（这些直接影响「看起来像不像高手」）

**Commit 纪律**：
- **禁止**开发完一大坨后一次性 `git add .` 提交。
- 按纵切的每一层分步提交，让 commit 历史讲出「一层层搭起来」的故事。例：`feat: fx_rates schema (drizzle)` → `feat: monthly fx cron job` → `feat: fx query api route` → `feat: fx trend chart`。
- 用清晰的 commit message（推荐 conventional commits 风格）。

**密钥与环境变量**：
- 真实 `.env` / `.env.local` 必须在 `.gitignore` 里。
- 提交一份占位的 `.env.example`，列出所有需要的变量名（不含真实值）。
- 任何密钥都不得出现在前端 bundle 或提交历史中。

**类型**：
- `tsconfig` 开 strict。代码里出现 `any` 视为需要修复的问题，用具体类型或 `unknown` + 收窄替代。

**README（第一印象的 80%，认真写）**，至少包含：
- 一句话定位
- 架构图（数据流：浏览器本地账本 / 后端汇率链路）
- 技术栈清单
- 本地运行步骤（含 `.env.example` 说明）
- **「设计取舍」章节**——重点写清「为什么用户账本数据不入库」。这一段比任何代码都更能体现思考深度。

---

## 7. 与我（Claude Code）协作时的默认行为

- 动手写某层前，先简述你的实现计划，让我能在跑偏前纠正。
- 遇到环境 / 部署 / 连接类报错（Node 版本、Vercel 配置、Supabase 连接串等），主动排查并说明原因，而不是只抛出报错。
- 需要装依赖或工具（如 Node.js 环境、Drizzle CLI）时，先说明要装什么、为什么，再执行。
- 不确定某个产品的当前用法 / 版本要求（Vercel Cron 配置格式、Supabase 连接方式等）时，明确说明「这里需要核对官方文档」，不要凭记忆给可能过时的写法。

---

## 8. 里程碑顺序（做完一个再开下一个）

1. 项目初始化：Next.js + TS strict + Drizzle + Supabase 连通，`.env.example` 就位，能 `npm run dev`。
2. 汇率纵切第 1~5 层全部打通（第 4 节），本地跑通。
3. 部署到 Vercel，cron 生效，线上能看到汇率趋势图。
4. 写好 README。**到此为止，一个合格的全栈展示项目已经成立。**
5. （可选，之后再议）前端接入用户本地账本：localStorage 存储、CSV 导入、用冻结汇率做折算与分析、双币种视角。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
