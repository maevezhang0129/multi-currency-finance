import { sql } from "drizzle-orm";

import { db } from "@/db";
import { fxRates } from "@/db/schema";

import { monthlyAverages } from "./aggregate";
import {
  classifyBatch,
  failBatch,
  indexByMonthAndQuote,
  planBatches,
  type IngestOutcome,
} from "./batching";
import { fetchDailyRates, FX_SOURCE } from "./frankfurter";
import { monthRange, type Month } from "./month";

export type { IngestOutcome } from "./batching";
export { summarize } from "./batching";

/**
 * 每次网络请求覆盖多少个月。
 *
 * 定在 60（5 年）是被限流逼出来的：实测连续快速请求约 3 次后，服务端开始
 * 静默丢弃，不返回任何响应直到超时。所以策略是把请求数压到个位数——回填
 * 1999 年至今 331 个月只要 6 次请求——而不是把请求拆细再靠退避去搏。
 * 单次响应实测 7.5 年 / 104KB / 11 秒，60 个月完全在安全范围内。
 */
const MONTHS_PER_REQUEST = 60;

/** 批次之间的间隔。同样是为了不触发上面那个静默限流。 */
const DELAY_BETWEEN_REQUESTS_MS = 6_000;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 抓取并写入若干个月、若干个报价币的月度汇率。
 *
 * 批次串行执行。不并发不是疏漏：Frankfurter 是别人免费提供的公共服务，
 * 并发只会更快撞上限流，而月度任务对延迟本来就不敏感。
 */
export async function ingestMonths(
  base: string,
  quotes: readonly string[],
  months: readonly Month[],
): Promise<IngestOutcome[]> {
  const outcomes: IngestOutcome[] = [];

  for (const [index, batch] of planBatches(
    months,
    MONTHS_PER_REQUEST,
  ).entries()) {
    if (index > 0) await sleep(DELAY_BETWEEN_REQUESTS_MS);
    outcomes.push(...(await ingestBatch(base, quotes, batch)));
  }

  return outcomes;
}

async function ingestBatch(
  base: string,
  quotes: readonly string[],
  months: readonly Month[],
): Promise<IngestOutcome[]> {
  const first = months[0];
  const last = months[months.length - 1];
  if (first === undefined || last === undefined) return [];

  try {
    const { start } = monthRange(first);
    const { end } = monthRange(last);

    const observations = await fetchDailyRates(base, quotes, start, end);
    const { rows, outcomes } = classifyBatch(
      base,
      quotes,
      months,
      indexByMonthAndQuote(monthlyAverages(observations)),
      FX_SOURCE,
    );

    if (rows.length > 0) {
      await db
        .insert(fxRates)
        .values(rows)
        // 幂等：cron 重跑或回填区间重叠时更新而不是撞唯一约束。
        // 冲突目标正是 schema 里那条 (base, quote, month) 唯一约束。
        .onConflictDoUpdate({
          target: [fxRates.baseCurrency, fxRates.quoteCurrency, fxRates.month],
          set: {
            rate: sql`excluded.rate`,
            source: sql`excluded.source`,
            fetchedAt: sql`now()`,
          },
        });
    }

    return outcomes;
  } catch (caught) {
    return failBatch(
      quotes,
      months,
      caught instanceof Error ? caught.message : String(caught),
    );
  }
}
