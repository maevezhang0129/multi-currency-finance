import { z } from "zod";

import { isCronAuthorized, unauthorizedResponse } from "@/lib/cron-auth";
import {
  BASE_CURRENCY,
  EARLIEST_MONTH,
  MAX_MONTHS_PER_RUN,
  QUOTE_CURRENCIES,
} from "@/lib/fx/config";
import { ingestMonths, summarize } from "@/lib/fx/ingest";
import { isMonth, monthsBetween, previousMonth } from "@/lib/fx/month";

/** 读 header 本就使 GET 变为动态，这里写明是为了让意图一眼可见。 */
export const dynamic = "force-dynamic";

/** 月度任务只抓 3 个币种对，很快；给回填留点余量。 */
export const maxDuration = 60;

const monthParam = z.string().refine(isMonth, "应为 YYYY-MM 格式");

const querySchema = z
  .object({
    /** 省略则抓上一个自然月，也就是 cron 的正常行为。 */
    from: monthParam.optional(),
    to: monthParam.optional(),
  })
  .refine((q) => (q.from === undefined) === (q.to === undefined), {
    message: "from 与 to 必须同时提供或同时省略",
  });

/**
 * 抓取月度汇率并写库。
 *
 * 两种用法共用一个端点：
 * - 不带参数：抓上一个自然月。Vercel Cron 每月初这样调用。
 * - 带 from/to：回填该闭区间。本地手动调用，用于灌历史数据。
 *
 * 后者不单独写脚本，是因为脚本要在 Next 之外运行，会碰上 `server-only`
 * 和 `@/*` 路径别名两个问题，为此再引一个运行时不划算。同一件事、
 * 同一段代码，只是范围参数不同。
 */
export async function GET(request: Request): Promise<Response> {
  if (!isCronAuthorized(request)) return unauthorizedResponse();

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
  });

  if (!parsed.success) {
    return Response.json(
      { error: "参数不合法", details: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const { from, to } = parsed.data;
  const months =
    from === undefined || to === undefined
      ? [previousMonth(new Date())]
      : monthsBetween(from, to);

  if (months.length === 0) {
    return Response.json(
      { error: "from 晚于 to，区间为空" },
      { status: 400 },
    );
  }
  if (months.length > MAX_MONTHS_PER_RUN) {
    return Response.json(
      {
        error: `一次最多回填 ${MAX_MONTHS_PER_RUN} 个月，本次请求 ${months.length} 个`,
      },
      { status: 400 },
    );
  }
  const earliest = months[0];
  if (earliest !== undefined && earliest < EARLIEST_MONTH) {
    return Response.json(
      { error: `数据源最早只到 ${EARLIEST_MONTH}` },
      { status: 400 },
    );
  }

  const outcomes = await ingestMonths(BASE_CURRENCY, QUOTE_CURRENCIES, months);
  const summary = summarize(outcomes);
  const failures = outcomes.filter((o) => o.status === "failed");
  const skipped = outcomes.filter((o) => o.status === "skipped");

  // 失败必须留下痕迹，否则一次静默的失败会一直静默下去。
  for (const failure of failures) {
    console.error(
      `[fx] 抓取失败 ${BASE_CURRENCY}/${failure.quote} ${failure.month}: ${failure.error}`,
    );
  }

  // skipped 同样要回给调用方，不能只留在 summary 的计数里。
  //
  // 实测踩过一次：数据源被限流时返回了一个缺最后一个月的**部分响应**，
  // 缺的那个月被当成「该月无数据」记为 skipped，整体仍是 200。
  // 数据静默地不完整，是这条链路最难发现的故障。
  // 「CNY 在 2005 年前没有」是合理的 skipped，「上个月没有」不是——
  // 把清单摆出来，才有可能分辨这两者。
  if (skipped.length > 0) {
    console.warn(
      `[fx] ${skipped.length} 个 (月份, 币种) 无数据，请确认是数据源的历史起点所致，` +
        `而非一次不完整的响应：` +
        skipped
          .slice(0, 10)
          .map((s) => `${s.month}/${s.quote}`)
          .join(", "),
    );
  }

  return Response.json(
    {
      base: BASE_CURRENCY,
      quotes: QUOTE_CURRENCIES,
      months: { from: months[0], to: months[months.length - 1] },
      summary,
      // 全量清单在回填时可能上千条，只回需要人过目的两类；成功的看 summary。
      failures,
      skipped,
    },
    // 有任何失败就返回 500，让 Vercel 把这次 cron 标成失败并可见。
    { status: summary.failed > 0 ? 500 : 200 },
  );
}
