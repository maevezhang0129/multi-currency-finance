import type { FxResponse } from "../fx/api-types";
import { monthOf, type Month } from "../fx/month";
import { divide } from "./money";
import type { Conversion, Entry } from "./types";

/**
 * 把一笔消费折算成基准币。纯函数，不碰网络也不碰存储。
 *
 * 这里实现的是 CLAUDE.md §5 那条「折算值一旦算出就冻结、永不重算」，
 * 以及它绕不开的一个现实矛盾：**当月的月度汇率还不存在**。定时任务只抓
 * 已经结束的月份，所以你今天记的账，本月均值要等到下个月初才有。
 *
 * 解法是把折算分成两种状态，而不是二选一：
 *
 * - 交易所在月的汇率已入库 → 用它，`frozen: true`，此后永不改动
 * - 还没有 → 用最近可得的那个月的汇率，`frozen: false`，界面标明是临时值，
 *   等该月汇率入库后重算一次再冻结
 *
 * 不做这个区分只剩两条路：当月不显示折算值（用户少了一半信息），
 * 或者拿上个月的汇率假装是本月的（谎报）。两条都不能接受。
 */

/** 按 `币种|月份` 建索引，另记每个币种最近可得的那个月。 */
export interface RateIndex {
  byMonth: ReadonlyMap<string, string>;
  latestByCurrency: ReadonlyMap<string, { month: Month; rate: string }>;
}

export function buildRateIndex(response: FxResponse): RateIndex {
  const byMonth = new Map<string, string>();
  const latestByCurrency = new Map<string, { month: Month; rate: string }>();

  for (const series of response.series) {
    for (const point of series.points) {
      byMonth.set(`${series.quote}|${point.month}`, point.rate);

      const current = latestByCurrency.get(series.quote);
      // 月份定长零填充，字典序即时间序，可以直接比较字符串。
      if (current === undefined || point.month > current.month) {
        latestByCurrency.set(series.quote, {
          month: point.month,
          rate: point.rate,
        });
      }
    }
  }

  return { byMonth, latestByCurrency };
}

export interface ConvertParams {
  amount: string;
  currency: string;
  /** 交易发生日，YYYY-MM-DD。 */
  date: string;
  base: string;
  rates: RateIndex;
  /** 注入当前时间，便于测试；也让「当月」的判定有唯一来源。 */
  now?: Date;
}

/**
 * 返回折算结果，拿不到汇率时返回 null。
 *
 * 返回 null 而不是抛错，也不是编一个数：拿不到汇率是正常情况（离线、
 * 该币种历史起点较晚），界面如实显示「待折算」即可，等汇率到了再补。
 */
export function convertToBase({
  amount,
  currency,
  date,
  base,
  rates,
  now = new Date(),
}: ConvertParams): Conversion | null {
  const entryMonth = date.slice(0, 7);

  // 基准币换基准币是恒等式，不需要汇率，也不存在「临时」一说。
  if (currency === base) {
    return {
      base,
      amount,
      rate: "1",
      rateMonth: entryMonth,
      frozen: true,
    };
  }

  const currentMonth = monthOf(now);
  const exact = rates.byMonth.get(`${currency}|${entryMonth}`);

  if (exact !== undefined) {
    return {
      base,
      amount: divide(amount, exact),
      rate: exact,
      rateMonth: entryMonth,
      // 只有交易所在月已经结束，那个月的均值才是终值。
      // 理论上库里不会有未结束月份的汇率，这里再挡一道，
      // 免得某天数据源口径变了就悄悄冻结了一个还会变的数。
      frozen: entryMonth < currentMonth,
    };
  }

  const latest = rates.latestByCurrency.get(currency);
  if (latest === undefined) return null;

  return {
    base,
    amount: divide(amount, latest.rate),
    rate: latest.rate,
    rateMonth: latest.month,
    frozen: false,
  };
}

/**
 * 用最新的汇率把该补的记录补上，返回新的记录数组；没有任何变化时返回 null。
 *
 * 这是折算这件事的闭环。没有它，两类记录会永远停在原地：录入时拿不到汇率的
 * （显示「待折算」，且不计入合计），和当月记录的临时折算（月份结束、真实均值
 * 入库后仍用着旧汇率）。
 *
 * 返回 null 而不是原数组，是为了让调用方能判断「要不要写库」——每次汇率加载
 * 完都无条件写一遍 localStorage，会把不该变的 fetchedAt 之类反复搅动。
 */
export function refreshConversions(
  entries: readonly Entry[],
  base: string,
  rates: RateIndex,
  now: Date = new Date(),
): Entry[] | null {
  let changed = false;

  const next = entries.map((entry) => {
    if (!needsRefreeze(entry.date, entry.conversion, rates, entry.currency)) {
      return entry;
    }

    const conversion = convertToBase({
      amount: entry.amount,
      currency: entry.currency,
      date: entry.date,
      base,
      rates,
      now,
    });

    // 仍然拿不到汇率就保持原样，不要把已有的临时值抹成 null。
    if (conversion === null) return entry;

    changed = true;
    return { ...entry, conversion };
  });

  return changed ? next : null;
}

/**
 * 这条折算是否还需要重算。
 *
 * 临时折算的记录，一旦它所属月份的汇率入库，就该重算一次并冻结。
 * 已冻结的永远返回 false——那正是「历史不会变」的含义。
 */
export function needsRefreeze(
  entryDate: string,
  conversion: Conversion | null,
  rates: RateIndex,
  currency: string,
): boolean {
  if (conversion === null) return true;
  if (conversion.frozen) return false;
  return rates.byMonth.has(`${currency}|${entryDate.slice(0, 7)}`);
}
