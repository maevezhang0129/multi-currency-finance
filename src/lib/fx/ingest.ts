import { db } from "@/db";
import { fxRates } from "@/db/schema";

import { monthlyAverages } from "./aggregate";
import { fetchDailyRates, FX_SOURCE, type RequestOptions } from "./frankfurter";
import { type Month, monthRange } from "./month";

/**
 * 单个 (币种对, 月份) 的处理结果。
 *
 * 刻意把「失败」做成一种结果而不是抛异常：一次回填要跑几百个月份，
 * 其中一批拿不到数据不应该让整批中断。调用方拿到完整清单后再决定
 * 怎么报告——但失败绝不会被悄悄咽掉，它一定出现在返回值里。
 */
export type IngestOutcome =
  | {
      status: "written";
      month: Month;
      quote: string;
      rate: string;
      observations: number;
    }
  | { status: "skipped"; month: Month; quote: string; reason: string }
  | { status: "failed"; month: Month; quote: string; error: string };

/** numeric(20,10) 对应的小数位。在这里定死，避免各处写法漂移。 */
const RATE_SCALE = 10;

/**
 * 一次请求覆盖多少个月。
 *
 * 上限来自实测：接口对连续快速请求是静默丢弃的（第 4 个请求起直接不响应），
 * 所以要点是**把请求数压到个位数**，而不是把请求打散。60 个月一批时，
 * 回填 25 年只需 5 次请求；单次响应约 100KB，十几秒返回。
 */
const MONTHS_PER_REQUEST = 60;

/** 批次之间的间隔。实测限流窗口是秒级的，隔几秒就能稳定拿到下一批。 */
const DELAY_BETWEEN_REQUESTS_MS = 6_000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function chunk<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export interface IngestOptions extends RequestOptions {
  sleepBetweenRequests?: (ms: number) => Promise<void>;
}

/**
 * 抓取并写入若干个月、若干个报价币的月度汇率。
 *
 * 按批发请求：每批覆盖连续的若干个月和全部报价币，一次拿回来在本地聚合。
 * 早先的写法是每个 (币种, 月份) 打一个请求，回填 25 年要 900 次——
 * 实测第 4 个请求就开始被静默丢弃，那个设计根本跑不通。
 */
export async function ingestMonths(
  base: string,
  quotes: readonly string[],
  months: readonly Month[],
  options: IngestOptions = {},
): Promise<IngestOutcome[]> {
  const { sleepBetweenRequests = defaultSleep, ...requestOptions } = options;
  const outcomes: IngestOutcome[] = [];
  const batches = chunk(months, MONTHS_PER_REQUEST);

  for (const [index, batch] of batches.entries()) {
    if (index > 0) {
      await sleepBetweenRequests(DELAY_BETWEEN_REQUESTS_MS);
    }

    const first = batch[0];
    const last = batch[batch.length - 1];
    // batch 由 chunk 产生，不可能为空；这一步只是为了满足类型收窄。
    if (first === undefined || last === undefined) continue;

    const { start } = monthRange(first);
    const { end } = monthRange(last);

    let averages;
    try {
      const observations = await fetchDailyRates(
        base,
        quotes,
        start,
        end,
        requestOptions,
      );
      averages = monthlyAverages(observations);
    } catch (caught) {
      // 整批失败：把这一批里每个 (月份, 币种) 都标记出来，
      // 让失败的范围在结果里是明确的，而不是「少了一些」。
      const error = caught instanceof Error ? caught.message : String(caught);
      for (const month of batch) {
        for (const quote of quotes) {
          outcomes.push({ status: "failed", month, quote, error });
        }
      }
      continue;
    }

    const byKey = new Map(averages.map((a) => [`${a.month}|${a.quote}`, a]));

    for (const month of batch) {
      for (const quote of quotes) {
        const average = byKey.get(`${month}|${quote}`);
        if (average === undefined) {
          // ECB 对部分币种的历史起点较晚（CNY 早于 2005 年就没有）。
          // 这是数据本身的事实，不是故障，和 failed 分开记。
          outcomes.push({
            status: "skipped",
            month,
            quote,
            reason: "该月无可用汇率数据",
          });
          continue;
        }

        const rate = average.rate.toFixed(RATE_SCALE);
        try {
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
              target: [
                fxRates.baseCurrency,
                fxRates.quoteCurrency,
                fxRates.month,
              ],
              set: { rate, source: FX_SOURCE, fetchedAt: new Date() },
            });

          outcomes.push({
            status: "written",
            month,
            quote,
            rate,
            observations: average.observations,
          });
        } catch (caught) {
          outcomes.push({
            status: "failed",
            month,
            quote,
            error: caught instanceof Error ? caught.message : String(caught),
          });
        }
      }
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
