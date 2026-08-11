# CLAUDE.md

本文件是本项目对 Claude Code 的工作说明。开始任何编码前先读完，并在整个开发过程中遵守这里的原则。

---

## 1. 这个项目是什么 / 不是什么

**一句话定位**：一个多币种个人财务分析工具。目标是**做出一个真正能用的账本**，同时把它做成一个经得起看的开源项目。

**关键前提**（2026-08-10 修订）：这个项目有**两个读者，主次分明**。

- **第一读者是使用者**——首先是我自己。它必须真的好用：录一笔账要快，看一眼要能明白钱花在哪、汇率影响了多少。做不到这一点，代码再漂亮也是个空壳。
- **第二读者是看代码的人**（招聘方、面试官、其他开发者）。架构清晰度、代码可读性、工程规范仍然重要，但它们服务于第一目标，不再是唯一标准。

> 这一节原先写的是「第一读者不是用户，而是看代码的人」「不追求记账 app 好用」。
> 汇率纵切完成并上线后，实际目标澄清为「要做一个能用的账本」，故改。
> 前端设计从「可选」变为**必须**。

**据此产生的硬性要求**：
- **可用性优先于功能数量。** 宁可只有三个功能但每个都顺手，也不要十个半成品。这一条没变，变的是「做到干净」现在包含用起来顺手，而不只是代码干净。
- 每一个技术选择都要能在 README 里说清「为什么这么选」。
- 界面要真的设计过，不是把数据摆上去就算。留白、层次、状态、空态、错误态都算设计的一部分。
- **不确定界面该长什么样时，先给方案和取舍让我选，不要直接实现。** 我前端设计经验不多，正想借这个项目学，所以过程比结果重要：告诉我为什么这么排，比直接给我一个好看的页面更有价值。

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

**第一阶段：汇率地基（已完成，2026-08-10 上线）**

1. ~~项目初始化：Next.js + TS strict + Drizzle + Supabase 连通。~~ ✅
2. ~~汇率纵切第 1~5 层全部打通（第 4 节）。~~ ✅
3. ~~部署到 Vercel，cron 线上验证通过。~~ ✅
4. ~~README。~~ ✅ 线上：https://multi-currency-finance.vercel.app

**第二阶段：账本本体（已完成，2026-08-11）**

这一阶段的目标是「能用」，不是「能演示」。顺序仍然是做完一个再开下一个。

5. ~~需求与界面设计。~~ ✅ 给了「单一焦点」与「卡片分区」两个方向，选了前者。
6. ~~录入与存储：localStorage、记一笔、明细列表、编辑与删除。~~ ✅
7. ~~折算与分析：按交易发生月折算并冻结，当月临时折算月末自动重算。~~ ✅
8. ~~导入导出：CSV 双向（含列名映射、脏数据清洗、去重）+ 完整备份。~~ ✅

计划外补做：自定义分类（含设置 v1→v2 迁移）、汇率页独立路由、折算回填闭环。

**唯一未做**：「汇率影响」单独一行。不是遗漏，是定义没想透——「同样的消费因为
汇率变化多花了多少」到底拿哪两个口径相减（跟上月？跟年初？跟换汇那天？），
三种算法给出三个都说得通的数字。定义定下来之前不做，宁可不显示也不给一个
看起来精确、实际讲不清的数。

**当前状态**：219 个测试、CI 绿、线上运行中。README 已按作品集形态重写
（英文为主 `README.md`，中文 `README.zh-CN.md`）。

每完成一步，线上更新一次，自己真实用几天再往下走。**用不顺的地方比没做完的功能更值得优先处理。**

---

## 9. 常用命令

需要 Node 22（`.nvmrc`）。改完代码至少跑 `npm run typecheck` 和 `npm run test`。

| 命令 | 说明 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run typecheck` | `next typegen && tsc --noEmit`。**必须走这个脚本**，裸 `tsc` 拿不到 Next 生成的路由类型 |
| `npm run lint` | ESLint（flat config，`eslint` 无参即全量） |
| `npm run test` | Vitest 单跑一遍；`npm run test:watch` 监听 |
| `npm run db:generate` | 由 `src/db/schema.ts` 生成迁移 SQL 到 `drizzle/` |
| `npm run db:migrate` | 应用迁移，走 `DIRECT_DATABASE_URL` |
| `npm run db:studio` | Drizzle Studio |

单个测试文件 / 单个用例：

```bash
npx vitest run src/lib/fx/month.test.ts
npx vitest run -t "addMonths"
```

测试文件与源码同目录，命名 `*.test.ts`（组件测试 `*.test.tsx`）。

`vitest.config.ts` 默认跑 node 环境——两百多个纯函数测试不需要 DOM，全局开
jsdom 只是白付代价。**组件测试靠文件顶部的 `@vitest-environment jsdom` 注释单独切换**。

`globals` 是 false，所以 Testing Library 的自动清理不会生效，组件测试必须
在 `afterEach` 里自己调 `cleanup()`——不调的话下一个测试会渲染出第二份组件，
所有查询都报「找到多个元素」。

手动回填历史汇率（本地）：

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "http://localhost:3000/api/cron/fx?from=2020-01&to=2024-12"
```

不带 `from`/`to` 就是 cron 的正常行为——只抓上一个自然月。

## 10. 代码地图：汇率链路的实际形态

```
vercel.json (0 3 1 * *)
  → GET /api/cron/fx            src/app/api/cron/fx/route.ts   鉴权 + 入参校验 + 汇总/日志
      → ingestMonths()          src/lib/fx/ingest.ts           分批 + 幂等 upsert
          → fetchDailyRates()   src/lib/fx/frankfurter.ts      唯一的网络边界，zod 校验
          → monthlyAverages()   src/lib/fx/aggregate.ts        纯函数，当月均值
          → db.insert(fxRates)  src/db/schema.ts               唯一一张表
```

几条贯穿性的约定，改任何一层前先理解：

- **`src/lib/fx/config.ts` 不是环境变量。** `BASE_CURRENCY` / `QUOTE_CURRENCIES` / `EARLIEST_MONTH` / `MAX_MONTHS_PER_RUN` 是产品定义，写死在代码里，改币种走 commit 而不是改生产配置。
- **失败是返回值，不是异常。** `ingest.ts` 返回 `IngestOutcome[]`，三态 `written | skipped | failed`。一批失败不中断其余批次，但失败一定出现在返回值里——不要改成抛异常，也不要把 `skipped` 折叠进计数后丢掉清单。
- **`skipped` 和 `failed` 语义不同。** `skipped` = 数据源那个月本来就没有（CNY 早于 2005）；`failed` = 出错了。混为一谈会让静默的数据缺失变得不可见。
- **纯函数与副作用分离。** `month.ts` / `aggregate.ts` 无 IO，测试覆盖在这两层。`ingest.ts` 和 `route.ts` 无单元测试（会打真实网络和真库），新增逻辑尽量往纯函数那侧放。
- **账本主界面有集成测试**（`ledger-app.test.tsx`）。纯函数测试保证「算得对」，集成测试保证「接得通」——两者拦的是不同的 bug。实测过：把「保存失败要提示用户」这条保护退回成静默关闭，纯函数测试全绿，集成测试立刻挂。新增用户可见的流程时，在那里补一条。
- **`month.ts` 不用 `Date` 做月份加减**，字符串 + 整数运算，避免部署环境时区把月初月末算偏。取「当前月」一律走 `monthOf(date)`（UTC）。
- **服务端专属模块顶部有 `import "server-only"`**（`src/db/index.ts`、`src/lib/env.ts`）。这是第 3 节那条原则的构建期保障，不要为了图方便去掉。

## 11. 已经踩过的坑（动这条链路前必读）

这些是实测结论，不是推测，代码里的写法都是为了绕开它们：

1. **Frankfurter 的限流是静默丢弃的。** 连续快速请求，第 4 个起既不返回 429 也不返回任何响应，只是挂到超时。因此重点是**把请求数压到个位数**，而不是靠状态码退避：`MONTHS_PER_REQUEST = 60`、批次间隔 6 秒、退避从 5 秒起。不要把批拆小、不要缩短间隔。
2. **区间查询会把起点往前贴到最近一个交易日。** 请求 `2019-01-01` 起，返回里会有 `2018-12-31`。`fetchDailyRates` 里那段按区间过滤是必须的，去掉会凭一条越界观测值算出假的月均值。
3. **部分响应会伪装成 `skipped`。** 限流时曾返回过缺最后一个月的响应，整体仍是 200。所以 route 会把 `skipped` 清单原样回给调用方并 `console.warn`——这个行为别删。
4. **两条连接串不能互换。** `DATABASE_URL` = 6543 transaction pooler，驱动侧必须 `prepare: false` + `max: 1`；`DIRECT_DATABASE_URL` 只给 drizzle-kit，运行时不读。理由见 `drizzle.config.ts` 和 README。
5. **schema 的 `check` 约束里写 `[0-9]` 而不是 `\d`。** JS 模板字符串会吃掉反斜杠，正则静默退化成 `^d{4}-...`，结果是任何合法月份都存不进去。
6. **`tsconfig` 开了 `noUncheckedIndexedAccess`。** 数组下标访问、正则捕获组之后都必须显式收窄，代码里那些看似多余的 `=== undefined` 判断是为此存在的。`any` 一律禁止（第 6 节）。
7. **`rate` 是 `numeric`，Drizzle 映射为 `string`。** 中途落到 JS `number` 上就已经丢精度，别为了「方便」加一层 `Number()`。

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
