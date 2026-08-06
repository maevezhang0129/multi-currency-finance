import { z } from "zod";

/**
 * Frankfurter（https://frankfurter.dev）客户端。
 *
 * 选它的理由和已知取舍写在 README 的「设计取舍」里。三个来自实测、
 * 直接决定了这里怎么写的事实：
 *
 * 1. 它会以 403 拒掉一些默认 User-Agent，所以必须显式带 UA。
 * 2. **限流是静默丢弃的**：连续快速请求，第 4 个起既不返回 429 也不返回任何
 *    响应，只是挂到超时。所以调用方必须主动控制节奏，不能指望靠状态码退避。
 * 3. 区间查询会把起点往前贴到最近一个交易日——请求 2019-01-01 起，
 *    返回里会出现 2018-12-31。按月聚合前必须先按请求区间过滤，
 *    否则会凭一条越界观测值算出一个假的月均值。
 *
 * 第 2 点决定了接口形状：一次请求拿「多币种 × 长区间」，而不是每个
 * (币种, 月份) 打一次。回填 25 年从 900 个请求降到个位数。
 */

const BASE_URL = "https://api.frankfurter.dev/v1";
const USER_AGENT = "multi-currency-finance/0.1 (+https://github.com/)";

/** 数据来源标识，写进 fx_rates.source。 */
export const FX_SOURCE = "ecb-frankfurter";

/**
 * 外部接口返回的 JSON 一律经 zod 解析后才进入业务代码。
 *
 * 这是信任边界：上游改字段、返回 HTML 错误页、或某天把 rate 变成字符串，
 * 我们要在解析这一步就炸掉并说清哪里不对，而不是让 undefined 一路漂到
 * 写库时才变成一条脏数据。
 */
const seriesResponseSchema = z.object({
  amount: z.number(),
  base: z.string(),
  start_date: z.string(),
  end_date: z.string(),
  // 形如 { "2026-07-01": { "SEK": 9.7474, "THB": 33.4 }, ... }
  rates: z.record(z.string(), z.record(z.string(), z.number())),
});

/** 某一天各报价币的观测值。 */
export interface DailyObservation {
  /** YYYY-MM-DD */
  date: string;
  /** quote 币种 -> 汇率。语义：1 base = rate quote。 */
  rates: Readonly<Record<string, number>>;
}

export class FxFetchError extends Error {
  constructor(
    message: string,
    options?: { cause?: unknown; retryable?: boolean },
  ) {
    super(message, { cause: options?.cause });
    this.name = "FxFetchError";
    /** 是否值得重试。4xx 属于请求本身有问题，重试多少次都一样。 */
    this.retryable = options?.retryable ?? false;
  }

  readonly retryable: boolean;
}

/** 把底层错误的信息也带上，否则日志里只剩一句「请求失败」，等于没记。 */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.name === "TimeoutError"
      ? `${cause.name}: 超时（该接口限流时不返回状态码，只是不响应）`
      : `${cause.name}: ${cause.message}`;
  }
  return String(cause);
}

export interface RequestOptions {
  /** 总尝试次数，含第一次。 */
  attempts?: number;
  /** 单次请求超时。长区间的响应可达 100KB 量级、耗时十几秒，默认给得宽。 */
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
  {
    attempts = 3,
    timeoutMs = 45_000,
    backoffMs = 5_000,
    sleep = defaultSleep,
  }: RequestOptions,
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
        { retryable },
      );
      if (!retryable) throw error;
      lastError = error;
    } catch (caught) {
      if (caught instanceof FxFetchError) {
        if (!caught.retryable) throw caught;
        lastError = caught;
      } else {
        // 网络中断、DNS 失败、超时都落在这里。限流也表现为超时。
        lastError = new FxFetchError(
          `请求汇率接口失败：${url}（${describeCause(caught)}）`,
          { cause: caught, retryable: true },
        );
      }
    }

    if (attempt < attempts) {
      // 退避间隔给得比一般 HTTP 重试大：这个接口的限流窗口是秒级的，
      // 退避太短只会把下一次也撞进同一个窗口。
      await sleep(backoffMs * 2 ** (attempt - 1));
    }
  }

  throw (
    lastError ??
    new FxFetchError(`请求汇率接口失败且无错误信息：${url}`)
  );
}

/**
 * 拉取 [startDate, endDate] 区间内 base 对多个 quote 的每日汇率。
 *
 * 返回值已按请求区间过滤并按日期升序排列。区间外的日期（接口会往前贴一个
 * 交易日）会被丢弃。
 *
 * 返回空数组是合法结果，不是错误：ECB 对某些币种的历史起点较晚
 * （CNY 要到 2005 年才有），调用方据此跳过即可。
 */
export async function fetchDailyRates(
  base: string,
  quotes: readonly string[],
  startDate: string,
  endDate: string,
  options: RequestOptions = {},
): Promise<DailyObservation[]> {
  const symbols = quotes.join(",");
  const url = `${BASE_URL}/${startDate}..${endDate}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(symbols)}`;

  const payload = await fetchJson(url, options);
  const parsed = seriesResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new FxFetchError(
      `汇率接口返回的结构不符合预期：${url}\n${z.prettifyError(parsed.error)}`,
      { cause: parsed.error },
    );
  }

  if (parsed.data.base !== base) {
    throw new FxFetchError(
      `汇率接口返回的基准币是 ${parsed.data.base}，与请求的 ${base} 不符：${url}`,
    );
  }

  const observations: DailyObservation[] = [];
  for (const [date, rates] of Object.entries(parsed.data.rates)) {
    // 关键过滤：接口会把起点往前贴到最近一个交易日，不丢掉的话
    // 越界那天会凭一条观测值算出一个假的月均值。
    if (date < startDate || date > endDate) continue;
    observations.push({ date, rates });
  }

  observations.sort((a, b) => a.date.localeCompare(b.date));
  return observations;
}
