import type { MonthlyAverage } from "./aggregate";
import type { Month } from "./month";

/**
 * 抓取任务里不涉及 IO 的那一半：怎么分批、每批的结果怎么归类。
 *
 * 单独成文件是因为 `ingest.ts` 导入了 `@/db`，而 `db` 顶部有 `server-only`，
 * 在测试环境里 import 会直接抛错。把纯逻辑挪到这边，这些分支才测得动——
 * 而它们恰恰是最该被测的：分批边界、以及「一批失败不能带塌其余批次」。
 */

/**
 * 单个 (币种对, 月份) 的处理结果。
 *
 * 刻意把「失败」做成一种结果而不是抛异常：一次回填要覆盖几百个月份，
 * 其中一批拿不到数据不应该让整次运行中断。调用方拿到完整清单后再决定
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

/** 待写入的一行。字段名与 fx_rates 的列一一对应。 */
export interface PendingRow {
  baseCurrency: string;
  quoteCurrency: string;
  month: Month;
  rate: string;
  source: string;
}

/** numeric(20,10) 对应的小数位。在这里定死，避免各处写法漂移。 */
export const RATE_SCALE = 10;

/**
 * 把月份列表切成若干批，每批一次网络请求。
 *
 * 批要**大**，不要小——数据源的限流是静默丢弃的（连续快速请求约 3 次后
 * 就不再响应，只能挂到超时）。所以策略是把请求数压到个位数，而不是把批
 * 拆细再靠退避去搏。详见 CLAUDE.md 第 11 节。
 */
export function planBatches(
  months: readonly Month[],
  size: number,
): Month[][] {
  if (size < 1) throw new Error(`批次大小必须为正整数，收到 ${size}`);

  const batches: Month[][] = [];
  for (let i = 0; i < months.length; i += size) {
    batches.push(months.slice(i, i + size));
  }
  return batches;
}

/**
 * 按 `月份|币种` 建索引。
 *
 * `monthlyAverages` 返回的是一个扁平数组，而归类时要按 (月份, 币种) 逐个查找——
 * 直接在双重循环里 `find` 是 O(n²)，回填几百个月时会明显变慢。
 */
export function indexByMonthAndQuote(
  rates: readonly MonthlyAverage[],
): Map<string, MonthlyAverage> {
  return new Map(rates.map((r) => [`${r.month}|${r.quote}`, r]));
}

/**
 * 把一批抓回来的月度汇率归类成待写入的行与结果清单。
 *
 * 请求了却没拿到的 (月份, 币种) 记为 `skipped` 而非 `failed`：ECB 对部分币种
 * 的历史起点较晚（CNY 早于 2005 年就没有），那是数据本身的事实，不是故障。
 * 混为一谈会让真正的故障淹没在这类噪音里。
 */
export function classifyBatch(
  base: string,
  quotes: readonly string[],
  months: readonly Month[],
  byMonthAndQuote: ReadonlyMap<string, MonthlyAverage>,
  source: string,
): { rows: PendingRow[]; outcomes: IngestOutcome[] } {
  const rows: PendingRow[] = [];
  const outcomes: IngestOutcome[] = [];

  for (const month of months) {
    for (const quote of quotes) {
      const monthly = byMonthAndQuote.get(`${month}|${quote}`);

      if (monthly === undefined) {
        outcomes.push({
          status: "skipped",
          month,
          quote,
          reason: "该月无可用汇率数据",
        });
        continue;
      }

      const rate = monthly.rate.toFixed(RATE_SCALE);
      rows.push({
        baseCurrency: base,
        quoteCurrency: quote,
        month,
        rate,
        source,
      });
      outcomes.push({
        status: "written",
        month,
        quote,
        rate,
        observations: monthly.observations,
      });
    }
  }

  return { rows, outcomes };
}

/** 整批失败：这一批里每个 (月份, 币种) 都记为 failed，其余批次不受影响。 */
export function failBatch(
  quotes: readonly string[],
  months: readonly Month[],
  error: string,
): IngestOutcome[] {
  return months.flatMap((month) =>
    quotes.map<IngestOutcome>((quote) => ({
      status: "failed",
      month,
      quote,
      error,
    })),
  );
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
