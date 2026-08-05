import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

/**
 * 月度汇率。这是本项目后端唯一的表——用户账本数据永不入库，
 * 所以这里没有任何一列与用户身份相关。
 */
export const fxRates = pgTable(
  "fx_rates",
  {
    id: bigint("id", { mode: "number" })
      .generatedAlwaysAsIdentity()
      .primaryKey(),

    /** ISO 4217 基准币，如 USD。 */
    baseCurrency: text("base_currency").notNull(),
    /** ISO 4217 报价币，如 SEK。语义：1 base = rate quote。 */
    quoteCurrency: text("quote_currency").notNull(),

    /**
     * 归属月份，YYYY-MM。
     *
     * 用 text 而非 date：这一列的语义是「一个月」而不是「某一天」，
     * 存 date 会逼迫我们随便挑一天(比如 1 号)充当整个月，把一个本不存在的
     * 精度写进数据里。YYYY-MM 定长且零填充，字典序即时间序，范围查询照常走索引。
     */
    month: text("month").notNull(),

    /**
     * 汇率值。numeric 而非 double precision——汇率是金融数值，
     * 二进制浮点的舍入误差会一路带进用户的折算金额里。
     * Drizzle 把 numeric 映射为 string，正是为了不在 JS number 上丢精度。
     */
    rate: numeric("rate", { precision: 20, scale: 10 }).notNull(),

    /** 数据来源标识，便于日后换源时区分历史数据的出处。 */
    source: text("source").notNull(),

    /** 抓取时刻。timestamptz，永远带时区。 */
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * 去重的唯一依据，也是 cron 重跑时 upsert 的冲突目标。
     * 列序 (base, quote, month) 同时充当主查询「按币种对 + 月份区间」的索引：
     * 前两列等值、末列范围，正好符合复合索引的最左前缀规则，无需额外建索引。
     */
    unique("fx_rates_pair_month_key").on(
      table.baseCurrency,
      table.quoteCurrency,
      table.month,
    ),

    /** 支撑「某个月所有币种对」的查询，这个方向用不上上面那个索引。 */
    index("fx_rates_month_idx").on(table.month),

    check(
      "fx_rates_base_currency_format",
      sql`${table.baseCurrency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "fx_rates_quote_currency_format",
      sql`${table.quoteCurrency} ~ '^[A-Z]{3}$'`,
    ),
    /** 自己对自己的汇率恒为 1，存进来只会是抓取逻辑出了错。 */
    check(
      "fx_rates_distinct_currencies",
      sql`${table.baseCurrency} <> ${table.quoteCurrency}`,
    ),
    // 用 [0-9] 而不是 \d：JS 模板字符串会把 \d 的反斜杠吃掉，
    // 正则会静默退化成 ^d{4}-...，任何合法月份都存不进去。
    check(
      "fx_rates_month_format",
      sql`${table.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`,
    ),
    check("fx_rates_rate_positive", sql`${table.rate} > 0`),
  ],
)
  /**
   * 开启 RLS 且不建任何 policy。
   *
   * Supabase 会把 public schema 的表通过 PostgREST 暴露给 anon key，
   * 而这张表只应该由我们自己的 Route Handler 读、由 cron 写。开了 RLS
   * 又没有 policy，anon / authenticated 角色就一行也拿不到；服务端用
   * 连接串里的 postgres 角色访问，本就绕过 RLS，不受影响。
   *
   * 也就是说：读写这张表的唯一入口是我们自己的 API 层。
   */
  .enableRLS();

export type FxRate = typeof fxRates.$inferSelect;
export type NewFxRate = typeof fxRates.$inferInsert;
