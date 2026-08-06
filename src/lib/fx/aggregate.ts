import type { DailyObservation } from "./frankfurter";
import type { Month } from "./month";

/**
 * 把每日观测值聚合成月度汇率。纯函数，不碰网络也不碰数据库。
 */

export interface MonthlyAverage {
  month: Month;
  quote: string;
  /** 当月所有交易日的算术平均。 */
  rate: number;
  /** 参与平均的观测值天数，用于判断这个月的数据是否稀疏。 */
  observations: number;
}

/**
 * 当月均值。这是本项目选定的月度口径。
 *
 * 为什么是均值而不是月末快照：月末快照仍然是某一天的汇率，日汇率的噪音只是
 * 换了个位置；均值才真正实现了「消除噪音、让月度可比」这个目的。而且消费是
 * 分散在整个月里发生的「流量」，用均值折算更贴近它实际发生的样子。
 *
 * 没有观测值的 (月份, 币种) 不会出现在返回值里——缺数据就是缺数据，
 * 编一个 0 或 NaN 出来是最坏的失败方式。
 */
export function monthlyAverages(
  observations: readonly DailyObservation[],
): MonthlyAverage[] {
  // month -> quote -> { sum, count }
  const buckets = new Map<Month, Map<string, { sum: number; count: number }>>();

  for (const { date, rates } of observations) {
    // date 是 YYYY-MM-DD，前 7 位正是 YYYY-MM。
    const month = date.slice(0, 7);
    let byQuote = buckets.get(month);
    if (byQuote === undefined) {
      byQuote = new Map();
      buckets.set(month, byQuote);
    }
    for (const [quote, rate] of Object.entries(rates)) {
      const bucket = byQuote.get(quote);
      if (bucket === undefined) {
        byQuote.set(quote, { sum: rate, count: 1 });
      } else {
        bucket.sum += rate;
        bucket.count += 1;
      }
    }
  }

  const result: MonthlyAverage[] = [];
  for (const [month, byQuote] of buckets) {
    for (const [quote, { sum, count }] of byQuote) {
      result.push({ month, quote, rate: sum / count, observations: count });
    }
  }

  // 稳定排序，便于测试断言和日志阅读。
  result.sort((a, b) => a.month.localeCompare(b.month) || a.quote.localeCompare(b.quote));
  return result;
}
