import type { Month } from "../fx/month";
import type { RateIndex } from "./convert";
import { multiply, sum } from "./money";
import type { Entry } from "./types";

/**
 * 把记录汇总成界面要的数字。纯函数，不碰存储也不碰网络。
 *
 * 一个关键约定：**跨币种的金额不能直接相加。** 一笔 142 SEK 和一笔 1250 THB
 * 加起来是 1392 什么都不是。所以所有汇总都先经过折算，落到同一种币上再求和。
 *
 * 尚未实现「汇率影响」那一行。它需要先定义清楚「同样的消费，因为汇率变化
 * 而多花/少花了多少」到底拿哪两个口径相减——定义没想透之前，宁可不显示，
 * 也不要给一个看起来精确、实际讲不清的数。
 */

export interface CategoryTotal {
  category: string;
  /** 已折算到展示币种。 */
  amount: string;
}

export interface MonthSummary {
  month: Month;
  /** 展示币种（通常是本币）下的支出合计。 */
  total: string;
  /** 基准币下的支出合计。 */
  baseTotal: string;
  /** 按金额降序的分类合计。 */
  categories: CategoryTotal[];
  /** 参与统计的记录数。 */
  count: number;
  /** 其中有多少条还没折算成功——界面要如实告诉用户合计是不完整的。 */
  unconvertedCount: number;
  /** 其中有多少条用的是临时汇率。 */
  provisionalCount: number;
}

export function entriesInMonth(
  entries: readonly Entry[],
  month: Month,
): Entry[] {
  return entries.filter((e) => e.date.startsWith(month));
}

/**
 * 把一条记录的金额折算到展示币种。
 *
 * 路径是「原币 → 基准币 → 展示币」。第一段折算在录入时就算好并存下来了
 * （conversion），这里只做第二段。展示币就是基准币时不用再乘。
 *
 * 拿不到汇率时返回 null，调用方据此把这条计入 unconvertedCount，
 * 而不是当成 0 混进合计里——0 会让合计看起来正常，实际少了一笔。
 */
export function amountInDisplayCurrency(
  entry: Entry,
  displayCurrency: string,
  base: string,
  rates: RateIndex,
): string | null {
  if (entry.currency === displayCurrency) return entry.amount;
  if (entry.conversion === null) return null;
  if (displayCurrency === base) return entry.conversion.amount;

  // 用这条记录折算时的同一个月份，保证同一笔账在任何视角下都对应同一时点。
  const rate =
    rates.byMonth.get(`${displayCurrency}|${entry.conversion.rateMonth}`) ??
    rates.latestByCurrency.get(displayCurrency)?.rate;

  if (rate === undefined) return null;
  return multiply(entry.conversion.amount, rate);
}

export function summarizeMonth(
  entries: readonly Entry[],
  month: Month,
  displayCurrency: string,
  base: string,
  rates: RateIndex,
): MonthSummary {
  const inMonth = entriesInMonth(entries, month).filter(
    (e) => e.kind === "expense",
  );

  const displayAmounts: string[] = [];
  const baseAmounts: string[] = [];
  const byCategory = new Map<string, string[]>();
  let unconvertedCount = 0;
  let provisionalCount = 0;

  for (const entry of inMonth) {
    if (entry.conversion === null) unconvertedCount += 1;
    else if (!entry.conversion.frozen) provisionalCount += 1;

    if (entry.conversion !== null) baseAmounts.push(entry.conversion.amount);

    const shown = amountInDisplayCurrency(entry, displayCurrency, base, rates);
    if (shown === null) continue;

    displayAmounts.push(shown);
    const bucket = byCategory.get(entry.category);
    if (bucket === undefined) byCategory.set(entry.category, [shown]);
    else bucket.push(shown);
  }

  const categories = [...byCategory.entries()]
    .map(([category, amounts]) => ({ category, amount: sum(amounts) }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));

  return {
    month,
    total: sum(displayAmounts),
    baseTotal: sum(baseAmounts),
    categories,
    count: inMonth.length,
    unconvertedCount,
    provisionalCount,
  };
}

/**
 * 环比变化百分比。上月没有支出时返回 null——除以 0 得到 Infinity，
 * 而「比上月多了 ∞%」不是一句有意义的话。
 */
export function changePercent(
  current: string,
  previous: string,
): number | null {
  const prev = Number(previous);
  if (prev === 0) return null;
  return ((Number(current) - prev) / prev) * 100;
}

/** 最近的几条记录，按日期倒序。 */
export function recentEntries(
  entries: readonly Entry[],
  limit: number,
): Entry[] {
  return [...entries]
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
