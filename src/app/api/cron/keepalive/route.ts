import { sql } from "drizzle-orm";

import { db } from "@/db";
import { fxRates } from "@/db/schema";
import { isCronAuthorized, unauthorizedResponse } from "@/lib/cron-auth";

/**
 * 防止 Supabase 免费层因闲置而自动暂停项目。
 *
 * 免费层在 **7 天无活动**后会把项目暂停，判定依据是真实的数据库查询和 API
 * 流量，不是有没有打开控制台。而汇率抓取一个月才跑一次，撑不过这条线。
 *
 * 对一个作品集项目，后果是具体的：招聘方隔两周点开线上 demo，看到的是一个
 * 连不上数据库的报错页。数据不会丢，控制台点一下 Restore 就能恢复，
 * 但没人能保证自己每周去点一次。
 *
 * 这不是什么巧妙的手法，就是免费层的既定规则下唯一不花钱的做法。
 * 升级到付费计划同样能解决——只是对一个展示项目不划算。
 */

export const dynamic = "force-dynamic";

/** 一条索引覆盖的聚合查询，几毫秒的事。 */
export const maxDuration = 15;

export async function GET(request: Request): Promise<Response> {
  // 这个端点很轻，但没理由不设防——同一套鉴权，不留例外。
  if (!isCronAuthorized(request)) return unauthorizedResponse();

  try {
    // 刻意查真表而不是 `select 1`：Supabase 判定「活跃」看的是真实的数据库
    // 查询，一条不触碰任何表的语句是否算数并无明确说法，查真表则毫无疑问。
    // max(month) 走 fx_rates_month_idx，代价可以忽略。
    const [row] = await db
      .select({ latestMonth: sql<string | null>`max(${fxRates.month})` })
      .from(fxRates);

    return Response.json({
      ok: true,
      latestMonth: row?.latestMonth ?? null,
      checkedAt: new Date().toISOString(),
    });
  } catch (caught) {
    // 失败要留痕：这个任务一旦静默失效，项目会在 7 天后悄无声息地暂停，
    // 而下一次有人发现通常是在线上已经挂了之后。
    const message = caught instanceof Error ? caught.message : String(caught);
    console.error(`[keepalive] 数据库探活失败：${message}`);
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
