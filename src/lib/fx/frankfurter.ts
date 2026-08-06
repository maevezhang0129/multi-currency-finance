import { z } from "zod";

import { type Month, monthRange } from "./month";

/**
 * Frankfurter（https://frankfurter.dev）客户端。
 *
 * 选它的理由和已知取舍写在 README 的「设计取舍」里。这里只说两个实现相关的点：
 *
 * 1. 它会以 403 拒掉一些默认 User-Agent，所以必须显式带一个能标识来源的 UA。
 * 2. 数据来自 ECB 参考汇率，只有工作日。一个月拿到 20~23 条是正常的，
 *    不是缺数据。
 */

const BASE_URL = "https://api.frankfurter.dev/v1";
const USER_AGENT = "multi-currency-finance/0.1 (+https://github.com/)";

/** 数据来源标识，写进 fx_rates.source。 */
export const FX_SOURCE = "ecb-frankfurter";

/**
 * 外部接口返回的 JSON 一律经 zod 解析后才进入业务代码。
 *
 * 不是为了「加个校验」走形式：这是信任边界。上游改了字段、返回了 HTML 错误页、
 * 或某天把 rate 变成字符串，我们要在解析这一步就炸掉并说清哪里不对，
 * 而不是让一个 undefined 一路漂到写库时才变成一条脏数据。
 */
const seriesResponseSchema = z.object({
  amount: z.number(),
  base: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  // 形如 { "2026-07-01": { "SEK": 9.7474 }, ... }
  rates: z.record(z.string(), z.record(z.string(), z.number())),
});

/** 一天的观测值。 */
export interface DailyRate {
  /** YYYY-MM-DD */
  date: string;
  rate: number;
}

export class FxFetchError extends Error {
  constructor(
    message: string,
    readonly cause_?: unknown,
    /** 是否值得重试。4xx 属于请求本身有问题，重试多少次都一样。 */
    readonly retryable = false,
  ) {
    super(message);
    this.name = "FxFetchError";
  }
}

interface RetryOptions {
  /** 总尝试次数，含第一次。 */
  attempts?: number;
  /** 单次请求超时。 */
  timeoutMs?: number;
  /** 首次退避间隔，之后按 2 的幂增长。 */
  backoffMs?: number;
  /** 便于测试注入，默认真实等待。 */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function fetchJson(
  url: string,
  { attempts = 3, timeoutMs = 10_000, backoffMs = 500, sleep = defaultSleep }: RetryOptions,
): Promise<unknown> {
  let lastError: FxFetchError | undefined;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) {
        return await response.json();
      }

      // 5xx 是对方的问题，可能是暂时的；4xx 是我们的请求有问题，重试无意义。
      const retryable = response.status >= 500;
      const error = new FxFetchError(
        `汇率接口返回 ${response.status} ${response.statusText}：${url}`,
        undefined,
        retryable,
      );
      if (!retryable) throw error;
      lastError = error;
    } catch (caught) {
      if (caught instanceof FxFetchError) {
        if (!caught.retryable) throw caught;
        lastError = caught;
      } else {
        // 网络中断、DNS 失败、AbortSignal 超时都落在这里，都值得重试。
        lastError = new FxFetchError(
          `请求汇率接口失败：${url}`,
          caught,
          true,
        );
      }
    }

    if (attempt < attempts) {
      await sleep(backoffMs * 2 ** (attempt - 1));
    }
  }

  throw (
    lastError ??
    new FxFetchError(`请求汇率接口失败且无错误信息：${url}`, undefined, false)
  );
}

/**
 * 拉取某个月内 base→quote 的每日汇率。
 *
 * 返回空数组是合法结果，不是错误：ECB 对某些币种的历史起点较晚
 * （例如 CNY 在 2005 年前没有数据），调用方据此跳过该月即可。
 */
export async function fetchDailyRatesForMonth(
  base: string,
  quote: string,
  month: Month,
  options: RetryOptions = {},
): Promise<DailyRate[]> {
  const { start, end } = monthRange(month);
  const url = `${BASE_URL}/${start}..${end}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(quote)}`;

  const payload = await fetchJson(url, options);
  const parsed = seriesResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new FxFetchError(
      `汇率接口返回的结构不符合预期：${url}\n${z.prettifyError(parsed.error)}`,
      parsed.error,
      false,
    );
  }

  if (parsed.data.base !== base) {
    throw new FxFetchError(
      `汇率接口返回的基准币是 ${parsed.data.base}，与请求的 ${base} 不符：${url}`,
      undefined,
      false,
    );
  }

  const daily: DailyRate[] = [];
  for (const [date, quotes] of Object.entries(parsed.data.rates)) {
    const rate = quotes[quote];
    // 请求时只要了一个 symbol，但不假设对方一定给；缺就跳过而不是记成 0。
    if (rate === undefined) continue;
    daily.push({ date, rate });
  }

  daily.sort((a, b) => a.date.localeCompare(b.date));
  return daily;
}

/**
 * 当月均值。这是本项目选定的月度口径。
 *
 * 为什么是均值而不是月末快照：月末快照仍然是某一天的汇率，日汇率的噪音只是
 * 换了个位置；均值才真正实现了「消除噪音、让月度可比」这个目的。而且消费是
 * 分散在整个月里发生的「流量」，用均值折算更贴近实际。
 */
export function averageRate(daily: readonly DailyRate[]): number | undefined {
  if (daily.length === 0) return undefined;
  const sum = daily.reduce((acc, d) => acc + d.rate, 0);
  return sum / daily.length;
}
