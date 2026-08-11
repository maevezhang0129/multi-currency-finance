import { z } from "zod";

// 用相对路径而不是 `@/` 别名：vitest 没有配置别名解析（见 CLAUDE.md §9），
// src/lib 下可被测试的模块一律走相对路径。
import { BASE_CURRENCY, QUOTE_CURRENCIES } from "../fx/config";
import { isMonth } from "../fx/month";

/**
 * 账本的数据结构。
 *
 * 这些数据**只存在于用户浏览器的 localStorage 里，永远不会上传**（CLAUDE.md §3）。
 * 也正因为如此，它必须自己扛住格式演进：没有服务端可以做迁移，用户手里那份
 * 数据可能是几个月前的版本写的。所以有 version 字段，读的时候必须校验。
 */

/** 可以用来消费的币种。基准币也能花，所以放在第一位。 */
export const SPENDABLE_CURRENCIES = [
  BASE_CURRENCY,
  ...QUOTE_CURRENCIES,
] as const;

export type SpendableCurrency = (typeof SPENDABLE_CURRENCIES)[number];

/**
 * 默认分类。用户可以增删改，这里只是初始值。
 *
 * 收入和支出分开两套：「餐饮」不会是一笔收入，把它们混在一个列表里，
 * 意味着每次记账都要在一堆用不上的选项里找。
 *
 * 记录里存的是分类的**名字**而不是 id。这让删除变得没有代价——删掉一个分类
 * 只是不再把它列为选项，已有记录照常显示自己的名字，不会变成孤儿数据。
 * 代价是改名要顺带更新已有记录，那是一次字符串替换（见 renameCategory）。
 */
export const DEFAULT_EXPENSE_CATEGORIES = [
  "餐饮",
  "买菜",
  "住房",
  "交通",
  "日用",
  "服饰",
  "娱乐",
  "医疗",
  "教育",
  "通讯",
  "旅行",
  "人情",
  "订阅",
  "其他",
] as const;

export const DEFAULT_INCOME_CATEGORIES = [
  "工资",
  "奖金",
  "投资",
  "退款",
  "其他",
] as const;

/** 分类名。长度上限是为了不让一个超长名字把界面撑破。 */
export const categoryName = z
  .string()
  .trim()
  .min(1, "分类名不能为空")
  .max(12, "分类名最多 12 个字");

export interface CategorySet {
  expense: string[];
  income: string[];
}

export const defaultCategories = (): CategorySet => ({
  expense: [...DEFAULT_EXPENSE_CATEGORIES],
  income: [...DEFAULT_INCOME_CATEGORIES],
});

/** 收入还是支出。账本只记支出的话，储蓄率这类分析就无从谈起。 */
export const ENTRY_KINDS = ["expense", "income"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/**
 * 金额字符串。
 *
 * 全程用字符串而不是 number，理由与汇率那边一致（CLAUDE.md §11.7）：
 * 二进制浮点存不下 0.1 这种十进制小数，一旦落到 number 上，误差就已经产生了，
 * 之后再怎么格式化也补不回来。
 */
const amountString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, "金额只能是最多两位小数的非负数字")
  .refine((v) => Number(v) > 0, "金额必须大于 0");

/** 汇率字符串，小数位比金额多，与 fx_rates 的 numeric(20,10) 对齐。 */
const rateString = z
  .string()
  .regex(/^\d+(\.\d{1,10})?$/, "汇率格式不合法")
  .refine((v) => Number(v) > 0, "汇率必须大于 0");

const dateString = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "日期应为 YYYY-MM-DD");

const monthString = z.string().refine(isMonth, "月份应为 YYYY-MM");

/**
 * 折算结果。
 *
 * `frozen` 是这里最重要的字段。CLAUDE.md §5 要求折算值一旦算出就冻结、
 * 永不重算——但当月的月度汇率还不存在（cron 只抓已结束的月份）。所以分成两种：
 *
 * - `frozen: false`：当月记录，用最近可得的汇率临时折算，界面要标明
 * - `frozen: true`：该月汇率已入库并重算过一次，此后永久不动
 *
 * 不做这个区分的话，只有两个选择：要么当月不显示折算值（少一半信息），
 * 要么用上个月的汇率假装是本月的（谎报）。两个都不可接受。
 */
export const conversionSchema = z.object({
  base: z.string(),
  amount: amountString,
  rate: rateString,
  /** 用的是哪个月的汇率。与 date 所属月份不同时，说明是临时折算。 */
  rateMonth: monthString,
  frozen: z.boolean(),
});

export type Conversion = z.infer<typeof conversionSchema>;

export const entrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(ENTRY_KINDS),
  /** 消费/收入发生的日期，不是录入日期。 */
  date: dateString,
  amount: amountString,
  currency: z.enum(SPENDABLE_CURRENCIES),
  /**
   * 分类名。这里存名字而不是引用某个 id——分类被删掉之后，
   * 这条记录仍然知道自己属于什么，不会变成一条没有归属的账。
   */
  category: categoryName,
  note: z.string().max(200).optional(),
  /**
   * 折算成基准币的结果。
   *
   * 允许为 null：录入时可能拿不到汇率（离线、或该币种该月还没数据）。
   * 这种情况要如实显示「待折算」，而不是编一个数出来。
   */
  conversion: conversionSchema.nullable(),
  createdAt: z.string(),
});

export type Entry = z.infer<typeof entrySchema>;

/** 当前存储格式版本。改动 entry 结构时必须加一，并在 storage 里写迁移。 */
export const LEDGER_VERSION = 1;

export const ledgerSchema = z.object({
  version: z.literal(LEDGER_VERSION),
  entries: z.array(entrySchema),
});

export type Ledger = z.infer<typeof ledgerSchema>;

/** 当前设置格式版本。加字段时必须加一，并在 storage 里写迁移。 */
export const SETTINGS_VERSION = 2;

export const settingsSchema = z.object({
  version: z.literal(SETTINGS_VERSION),
  /** 用户日常所在地的币种，界面上的主视角。 */
  homeCurrency: z.enum(SPENDABLE_CURRENCIES),
  categories: z.object({
    expense: z.array(categoryName).min(1, "至少要保留一个支出分类"),
    income: z.array(categoryName).min(1, "至少要保留一个收入分类"),
  }),
});

/** v1 的设置只有本币。升级时补上默认分类，用户的选择不丢。 */
export const settingsSchemaV1 = z.object({
  version: z.literal(1),
  homeCurrency: z.enum(SPENDABLE_CURRENCIES),
});

export type Settings = z.infer<typeof settingsSchema>;

export const emptyLedger = (): Ledger => ({
  version: LEDGER_VERSION,
  entries: [],
});
