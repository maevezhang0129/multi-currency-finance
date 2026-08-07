import "server-only";

import { timingSafeEqual } from "node:crypto";

import { serverEnv } from "./env";

/**
 * cron 端点的鉴权。所有 /api/cron/* 共用，别在各个路由里各写一份——
 * 这种校验一旦出现两个版本，迟早有一个会被漏改。
 */

/**
 * 比较密钥。用定长时间比较而不是 `===`。
 *
 * `===` 在第一个不同的字节就返回，攻击者能通过测量响应时间逐字节猜出密钥。
 * 这条路径上密钥是固定的、可被反复探测，正是时序攻击适用的场景。
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual 要求等长，长度本身不是秘密，先比长度是安全的。
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Vercel 触发定时任务时会带 `Authorization: Bearer <CRON_SECRET>`。
 * 没有这道检查，任何知道 URL 的人都能触发抓取任务。
 */
export function isCronAuthorized(request: Request): boolean {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return false;
  return secretMatches(header.slice("Bearer ".length), serverEnv.CRON_SECRET);
}

/** 未通过鉴权时的统一响应。不解释哪里不对——对调用者，任何细节都是情报。 */
export function unauthorizedResponse(): Response {
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
