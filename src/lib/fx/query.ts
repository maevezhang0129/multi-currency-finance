import { z } from "zod";

import { BASE_CURRENCY, QUOTE_CURRENCIES } from "./config";
import { isMonth, type Month } from "./month";

/**
 * `/api/fx` 的入参解析。纯函数，不碰网络也不碰数据库——校验逻辑留在路由里
 * 就只能靠起服务打接口来验，抽出来才测得动。
 */

export interface FxQuery {
  base: string;
  /** 已去重，并保持调用方给定的顺序（响应里的 series 顺序与之一致）。 */
  quotes: string[];
  /** 省略表示不设下界。 */
  from: Month | undefined;
  /** 省略表示不设上界。 */
  to: Month | undefined;
}

export type FxQueryParseResult =
  | { ok: true; query: FxQuery }
  | { ok: false; issues: unknown };

const monthField = z
  .string()
  .refine(isMonth, "应为 YYYY-MM 格式，月份需补零");

/**
 * 币种一律用「白名单」而不是「格式正确即可」。
 *
 * `quote=XXX` 形式上是合法的三字母币种，但我们从来没抓过它的数据。
 * 若放行，调用方会得到一个 200 空数组，然后开始怀疑是不是数据没灌进去——
 * 而真正的问题是币种名写错了。这种情况属于请求有误，就该 400 并说清楚。
 */
const quoteField = z
  .string()
  .transform((raw) => raw.split(",").map((s) => s.trim()).filter((s) => s.length > 0))
  .pipe(
    z
      .array(z.enum(QUOTE_CURRENCIES))
      .min(1, "至少要指定一个币种")
      .transform((list) => [...new Set(list)]),
  );

const schema = z
  .object({
    // 只支持 USD 作基准：库里存的就是 USD 对各币种，换基准需要交叉换算，
    // 那是另一个决定（见 README 设计取舍），不该由查询参数悄悄触发。
    base: z
      .literal(BASE_CURRENCY, `目前只支持 ${BASE_CURRENCY} 作为基准币`)
      .default(BASE_CURRENCY),
    quote: quoteField.default([...QUOTE_CURRENCIES]),
    from: monthField.optional(),
    to: monthField.optional(),
  })
  .refine(
    (q) => q.from === undefined || q.to === undefined || q.from <= q.to,
    { message: "from 不能晚于 to", path: ["from"] },
  );

/**
 * 解析查询串。
 *
 * 全部参数都可省略：省略 quote 表示要全部关注币种，省略 from/to 表示不设边界。
 * 这样 `/api/fx` 裸调用就能拿到完整数据，前端画图不必先知道有哪些币种。
 */
export function parseFxQuery(params: URLSearchParams): FxQueryParseResult {
  const raw: Record<string, string> = {};
  for (const key of ["base", "quote", "from", "to"]) {
    const value = params.get(key);
    // 只把真正出现过的参数交给 zod，好让 .default() 生效。
    if (value !== null) raw[key] = value;
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: z.treeifyError(parsed.error) };
  }

  return {
    ok: true,
    query: {
      base: parsed.data.base,
      quotes: parsed.data.quote,
      from: parsed.data.from,
      to: parsed.data.to,
    },
  };
}
