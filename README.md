# Multi-Currency Finance

一个多币种个人财务分析工具：**账本数据只留在你自己的浏览器里，后端只负责公共汇率数据。**

---

## 架构

这个项目最重要的一条线，是数据被刻意切成了互不相通的两半：

```
┌─ 浏览器 ───────────────────────────────┐
│                                        │
│   用户账本数据                          │
│     localStorage / 用户自己导出的文件     │
│     ↑                                  │
│     └── 用月度汇率就地折算、分析          │
│                  ↑                     │
└──────────────────┼─────────────────────┘
                   │  只往下游走，账本数据不上行
                   │
┌─ 后端 ───────────┼─────────────────────┐
│                  │                     │
│   Vercel Cron ──> 抓取上月汇率           │
│                  ↓                     │
│              Postgres (Supabase)       │
│               表: fx_rates              │
│                  ↓                     │
│           Route Handler /api/fx        │
│                                        │
└────────────────────────────────────────┘
```

后端从头到尾只处理一种数据：**公开的、无主的、对谁都一样的汇率**。它不知道任何用户的存在。

## 技术栈

| 层 | 选型 | 为什么 |
|---|---|---|
| 全栈框架 | Next.js 16（App Router） | 前后端同仓库，一次部署，Route Handler 与页面共享类型 |
| 语言 | TypeScript（strict） | 额外开了 `noUncheckedIndexedAccess`，代码中不出现 `any` |
| 数据库 | Supabase（Postgres） | 托管 Postgres + 免费额度，只存公共汇率数据 |
| ORM | Drizzle | schema 即 TypeScript，迁移是可审查的 SQL 文件而非黑盒 |
| 定时任务 | Vercel Cron | 与部署同仓库配置，无需额外基础设施 |
| 图表 | Recharts | |
| 部署 | Vercel | |

## 本地运行

需要 Node 22（仓库有 `.nvmrc`，`nvm use` 即可）。

```bash
npm install
cp .env.example .env.local     # 然后填入真实连接串
npm run db:migrate             # 建表
npm run dev
```

### 关于两条连接串

`.env.example` 里有两个变量，它们不是同一条串，用途也不能互换：

- `DATABASE_URL` —— Supavisor **transaction pooler（6543）**。应用运行时用。
  serverless 函数实例频繁创建销毁，直连会打满 Postgres 的连接上限。
  代价是这个模式不支持 prepared statement，所以驱动侧必须 `prepare: false`。
- `DIRECT_DATABASE_URL` —— **direct connection（5432）**。只有本地跑 drizzle-kit 时用。
  迁移要执行 DDL 并依赖会话级 advisory lock，而 transaction 模式会在事务之间
  把连接换掉，锁语义不成立。

两条串都在 Supabase 控制台 Project Settings → Database → Connection string 里。
direct connection 默认是 IPv6 的；如果你的网络只有 IPv4，改用 Supavisor session
mode（同样的 pooler 域名，端口 5432）。

### 脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器 |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:generate` | 由 schema 生成迁移 SQL |
| `npm run db:migrate` | 应用迁移 |
| `npm run db:studio` | Drizzle Studio |

---

## 设计取舍

### 一、用户账本数据永不入库

这是整个项目的地基，也是唯一一个真正需要解释的决定。

用户的记账数据只存在于浏览器的 localStorage 和用户自己导出的文件里。后端读不到，
数据库里没有，服务器日志里也不会出现。

**为什么不存**：财务数据高度敏感。一旦入库，这个项目就同时背上了静态加密、密钥轮换、
备份策略、跨境合规、以及泄露之后的通知责任。对一个开源的展示项目而言，这些责任没有
一项是它有能力兑现的——而用户不会因为它是"展示项目"就少受一次泄露的损失。

**它换来了什么**：不存用户身份数据 → 不需要账号系统 → 没有密码哈希、没有会话管理、
没有 OAuth 回调、没有越权访问。全栈里最容易出安全事故的一整块，被一个架构决定整个
移出了攻击面。

这个取舍不是靠自觉维持的，代码层面有两道机械保障：

1. `src/db/index.ts` 和 `src/lib/env.ts` 顶部都有 `import "server-only"`。任何试图
   从客户端组件引用数据库或环境变量的代码，会在**构建期**直接失败，而不是等到运行时
   才发现连接串进了浏览器 bundle。
2. `fx_rates` 表开启了 RLS 且不建任何 policy。Supabase 默认会把 public schema 的表
   通过 PostgREST 暴露给 anon key；开了 RLS 又没有 policy，anon 角色就一行也读不到。
   服务端用连接串里的 postgres 角色访问，本就绕过 RLS。结果是这张表的唯一出入口是
   我们自己的 API 层。

### 二、月度汇率，不是日汇率

汇率表以「月」为粒度（`month` 列存 `YYYY-MM`），不存日汇率。

日汇率的短期波动对个人财务分析是纯噪音：它会让"这个月是不是花多了"这个问题的答案，
取决于你恰好在哪一天做的对比。用月度基准把这层噪音消掉，月与月之间才可比。

`month` 列用 `text` 而不是 `date`，也是同一个理由的延伸：这一列的语义是"一个月"，
不是"某一天"。存成 `date` 就得随便挑 1 号来充当整个月，等于把一个并不存在的精度
写进数据里。`YYYY-MM` 定长零填充，字典序即时间序，范围查询照样走索引。

### 三、折算值冻结，永不重算

每一笔交易折算成基准币的数值，一旦按**交易发生那个月**的汇率算出，就存为静态值。
之后汇率表再怎么更新，已经折算过的历史数字不动。

反面做法是用"今天的汇率"重算去年的消费——那会让用户每天打开应用，看到的历史都在变。
一段已经发生的过去，不应该因为今天的汇率波动而改写。

### 四、基准币默认 USD

三个目标币种（SEK / THB / CNY）都有对 USD 的直接报价。以 USD 为基准可以避免
两跳换算（例如 SEK → EUR → THB）把两次舍入误差叠加进结果。

### 五、`rate` 用 `numeric` 而非 `double precision`

汇率是金融数值。二进制浮点的舍入误差会一路带进用户看到的折算金额里。Drizzle 把
`numeric` 映射为 JS `string` 也正是这个原因——中途落到 `number` 上就已经丢了精度。

---

## 明确不做的

不做账号/登录、不做移动端 App、不做多人协作、不做 AI 建议、不接任何银行或支付平台 API。

## 当前进度

- [x] 项目初始化：Next.js + TS strict + Drizzle + Supabase 连通
- [ ] 汇率抓取（外部数据源 + 错误处理与重试）
- [ ] Vercel Cron 月度触发
- [ ] `/api/fx` 查询接口
- [ ] 汇率趋势图（加载 / 空数据 / 错误三态）
- [ ] 前端本地账本：localStorage、CSV 导入、冻结折算、双币种视角
