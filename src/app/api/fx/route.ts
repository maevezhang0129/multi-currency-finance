import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";

import { db } from "@/db";
import { fxRates } from "@/db/schema";
import type { FxResponse, FxSeriesPoint } from "@/lib/fx/api-types";
import { parseFxQuery } from "@/lib/fx/query";

/** 读 searchParams 本就使 GET 变为动态，写明是为了让意图一眼可见。 */
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const parsed = parseFxQuery(new URL(request.url).searchParams);

  if (!parsed.ok) {
    return Response.json(
      { error: "参数不合法", details: parsed.issues },
      { status: 400 },
    );
  }

  const { base, quotes, from, to } = parsed.query;

  let rows;
  try {
    rows = await db
      .select({
        month: fxRates.month,
        quote: fxRates.quoteCurrency,
        rate: fxRates.rate,
      })
      .from(fxRates)
      .where(
        and(
          eq(fxRates.baseCurrency, base),
          inArray(fxRates.quoteCurrency, quotes),
          // 月份是定长零填充的 text，字典序即时间序，可以直接比较。
          from === undefined ? undefined : gte(fxRates.month, from),
          to === undefined ? undefined : lte(fxRates.month, to),
        ),
      )
      .orderBy(asc(fxRates.month));
  } catch (caught) {
    // 不捕获的话，Next 会返回一个空 body 的 500，线上排查时什么线索都没有。
    // 完整错误进服务端日志，响应里只给一个错误码。
    //
    // 只回 code 不回 message：Postgres 的错误信息里常带主机名和角色名，
    // 那些不该出现在公开接口的响应里。而 code 足够定位问题——28P01 是密码错、
    // ECONNREFUSED 是连不上、ETIMEDOUT 是网络不通。
    const code =
      caught instanceof Error && "code" in caught
        ? String((caught as { code?: unknown }).code)
        : undefined;

    console.error("[api/fx] 查询失败", caught);

    return Response.json(
      { error: "查询汇率数据失败", code: code ?? null },
      { status: 500 },
    );
  }

  const pointsByQuote = new Map<string, FxSeriesPoint[]>();
  for (const row of rows) {
    const points = pointsByQuote.get(row.quote);
    if (points === undefined) {
      pointsByQuote.set(row.quote, [{ month: row.month, rate: row.rate }]);
    } else {
      points.push({ month: row.month, rate: row.rate });
    }
  }

  // 按请求给定的币种顺序输出，图例顺序才可预期。
  // 某个币种一条数据都没有时给空数组而不是省略该项，
  // 前端才不必区分「没这个键」和「这个键是空的」。
  const series = quotes.map((quote) => ({
    quote,
    points: pointsByQuote.get(quote) ?? [],
  }));

  const body: FxResponse = {
    base,
    from: from ?? null,
    to: to ?? null,
    series,
  };

  return Response.json(
    body,
    {
      // 区间内无数据是 200 空数组，不是 404：`/api/fx?from=1990-01` 是一个
      // 完全合法的问题，答案恰好是空。用 404 会让前端分不清「没数据」和
      // 「路径写错了」，而这两种情况在界面上是两种完全不同的呈现。
      status: 200,
      headers: {
        // 汇率一个月才变一次，没必要每次请求都打一遍数据库。
        // 浏览器不留副本（max-age=0），由 CDN 按 s-maxage 缓存一天，
        // 过期后先用旧数据响应、后台再回源刷新。
        "cache-control":
          "public, max-age=0, s-maxage=86400, stale-while-revalidate=604800",
      },
    },
  );
}
