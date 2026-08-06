import { db } from "@/db";
import { fxRates } from "@/db/schema";

import {
  averageRate,
  fetchDailyRatesForMonth,
  FX_SOURCE,
} from "./frankfurter";
import type { Month } from "./month";

/**
 * 单个 (币种对, 月份) 的处理结果。
 *
 * 刻意把「失败」做成一种结果而不是抛异常：一次回填要跑几百个月份，
 * 其中一个月拿不到数据不应该让整批中断。调用方拿到完整清单后再决定
 * 怎么报告——但失败绝不会被悄悄咽掉，它一定出现在返回值里。
 */
export type IngestOutcome =
  | { status: "written"; month: Month; quote: string; rate: string; observations: number }
  | { status: "skipped"; month: Month; quote: string; reason: string }
  | { status: "failed"; month: Month; quote: string; error: string };

/** numeric(20,10) 对应的小数位。在这里定死，避免各处写法漂移。 */
const RATE_SCALE = 10;

async function ingestOne(
  base: string,
  quote: string,
  month: Month,
): Promise<IngestOutcome> {
  try {
    const daily = await fetchDailyRatesForMonth(base, quote, month);
    const average = averageRate(daily);

    if (average === undefined) {
      // ECB 对部分币种的历史起点较晚（CNY 早于 2005 年就没有），
      // 这是数据本身的事实，不是故障。
      return {
        status: "skipped",
        month,
        quote,
        reason: "该月无可用汇率数据",
      };
    }

    const rate = average.toFixed(RATE_SCALE);

    await db
      .insert(fxRates)
      .values({
        baseCurrency: base,
        quoteCurrency: quote,
        month,
        rate,
        source: FX_SOURCE,
      })
      // 幂等：cron 重跑或回填区间重叠时更新而不是报唯一约束冲突。
      // 冲突目标正是 schema 里那条 (base, quote, month) 唯一约束。
      .onConflictDoUpdate({
        target: [fxRates.baseCurrency, fxRates.quoteCurrency, fxRates.month],
        set: { rate, source: FX_SOURCE, fetchedAt: new Date() },
      });

    return {
      status: "written",
      month,
      quote,
      rate,
      observations: daily.length,
    };
  } catch (caught) {
    return {
      status: "failed",
      month,
      quote,
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

/**
 * 抓取并写入若干个月、若干个报价币的月度汇率。
 *
 * 串行执行。这里不并发不是疏漏：Frankfurter 是别人免费提供的公共服务，
 * 一次回填可能是几百个请求，把它们同时打出去既不礼貌也容易触发限流。
 * 月度任务对延迟本来就不敏感。
 */
export async function ingestMonths(
  base: string,
  quotes: readonly string[],
  months: readonly Month[],
): Promise<IngestOutcome[]> {
  const outcomes: IngestOutcome[] = [];
  for (const month of months) {
    for (const quote of quotes) {
      outcomes.push(await ingestOne(base, quote, month));
    }
  }
  return outcomes;
}

export function summarize(outcomes: readonly IngestOutcome[]): {
  written: number;
  skipped: number;
  failed: number;
} {
  return {
    written: outcomes.filter((o) => o.status === "written").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
  };
}
