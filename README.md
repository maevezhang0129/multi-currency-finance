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
- `DIRECT_DATABASE_URL` —— **Session pooler 或 direct connection**。只有本地跑
  drizzle-kit 时用，应用运行时不读它。

  分开不是因为迁移在 transaction pooler 上跑不了——drizzle 的 migrator 把迁移包在
  一个事务里，实测能正常应用。真正的原因是那条路有个够不着的天花板：
  `CREATE INDEX CONCURRENTLY` 不能在事务内执行，而 transaction 模式下每条语句都
  身处事务。等到表大得需要不锁表加索引时，迁移会卡死在这里。把出口预留好，比
  撞上了再回来改配置便宜。

两条串都在 Supabase 控制台的 **Connect** 按钮里（也可从 Project Settings → Database
进入）。direct connection 默认只有 IPv6；本机没有全局 IPv6 地址时用 Session
pooler 那条（IPv4，全 tier 可用）。

<details>
<summary>连不上？先确认不是本地网络的问题</summary>

不少网络环境（公司防火墙、部分代理节点）会封 **5432**，而 6543 放行。症状是
TCP 连接能建立、随即被对端关闭且不返回任何字节，客户端表现为长时间挂起。

判断方法：**不要用 `nc -z`**。在 fake-IP 模式的代理下，本地代理会先接受连接，
`nc` 一律报"通"，是假阳性。改用 Postgres 协议探测——发一个 SSLRequest 包，
服务器回 `S` 才说明真的连到了 Postgres：

```bash
python3 - <<'PY'
import socket, struct
s = socket.create_connection(("<host>", 5432), timeout=15); s.settimeout(15)
s.sendall(struct.pack("!ii", 8, 80877103))
print(repr(s.recv(1)))   # b'S' = 真的连到 Postgres；b'' = 上游没通
PY
```

拿一台第三方公开 Postgres 做对照（例如 `hh-pgsql-public.ebi.ac.uk:5432`），
如果它也是同样症状，那就是本地网络封了这个端口，与 Supabase 无关。

绕过办法：本地迁移临时把 `DIRECT_DATABASE_URL` 指向 6543 那条。drizzle 的
migrator 在 transaction 模式下能正常工作，只是碰不了 `CREATE INDEX CONCURRENTLY`。

</details>

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

### 六、免费层会把项目睡掉，所以有一个每天一次的探活任务

Supabase 免费层在**连续 7 天无活动**后会自动暂停项目，判定依据是真实的数据库
查询和 API 流量，不是有没有打开控制台。而这个项目的抓取任务一个月才跑一次，
撑不过这条线。

对一个作品集项目，后果很具体：别人隔两周点开线上 demo，看到的是一个连不上
数据库的报错页。数据不会丢，控制台点一下 Restore 几分钟就恢复，但没人能保证
自己每周去点一次。

所以 `vercel.json` 里有第二个 cron：`/api/cron/keepalive` 每天跑一次，
对 `fx_rates` 做一条走索引的 `max(month)` 查询。刻意查真表而不是 `select 1`
——判定活跃看的是真实的数据库查询，一条不触碰任何表的语句是否算数并无明确
说法，查真表则毫无疑问。

这不是什么巧妙手法，就是免费层既定规则下唯一不花钱的做法；升级到付费计划
同样能解决，只是对一个展示项目不划算。把它写在这里，是因为**这类运维约束
往往比业务代码更能决定一个项目在别人眼里是不是「真的跑着」**。

> Vercel Hobby 计划：每个项目最多 100 个 cron（2026 年 1 月起放开），
> 但每个 cron 最多每天触发一次。月度抓取 + 每日探活共两个，在限制内。

### 七、三张图，而不是一张三条线的图

USD 对 SEK / THB / CNY 分别在 9.6 / 33 / 6.8 的量级。三条线挤在一条线性轴上，
THB 会占满纵向空间，另外两条被压成近似水平的直线——图还在，信息没了。

双 y 轴是更糟的解法：两个刻度如何对齐完全是任意的，图会凭空造出一种数据里
并不存在的相关性。

所以拆成**小倍数**：每个币种一张图、各自的 y 轴，纵向对齐后仍然能比较「形状」，
而每张图里的数值都是真实汇率。另一种常见做法是把三条线归一到基期 = 100，
那样能同图比较，但「1 美元换多少克朗」这个对记账有直接意义的数字就消失了。

配色是跑验证器定的，不是挑好看的：三个色位在浅色与深色下都通过明度带、
彩度下限、色觉障碍全配对分离度的检查。深色模式不是浅色的自动反转，而是同一
批色相在深色底上单独选的一档。浅色模式下 aqua 那一档对比度低于 3:1，
按规范以可见标签加数据表视图作补偿——数据表对财务工具本来也是刚需。

## 明确不做的

不做账号/登录、不做移动端 App、不做多人协作、不做 AI 建议、不接任何银行或支付平台 API。

## 当前进度

- [x] 项目初始化：Next.js + TS strict + Drizzle + Supabase 连通
- [x] 汇率抓取（Frankfurter + 错误分类与退避重试 + 幂等 upsert）
- [x] Vercel Cron 月度触发（代码与配置就绪，**尚未在线上验证**）
- [x] `/api/fx` 查询接口（zod 校验入参、结构化 JSON、CDN 缓存头）
- [x] 汇率趋势图（加载 / 空数据 / 错误三态）
- [ ] 部署到 Vercel，验证 cron 真的被触发
- [ ] 前端本地账本：localStorage、CSV 导入、冻结折算、双币种视角

库里已有 2019-01 至 2026-07 共 273 条月度汇率（91 个月 × 3 个币种）。
