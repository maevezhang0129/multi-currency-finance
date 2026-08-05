import "server-only";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { serverEnv } from "@/lib/env";
import * as schema from "./schema";

/**
 * Drizzle 客户端，仅限服务端。
 *
 * 走 Supabase 的 transaction pooler（6543）。两个配置项不是可选的：
 *
 * - `prepare: false`：transaction 模式下连接在每个事务后就归还给连接池，
 *   命名 prepared statement 绑在具体连接上，复用时会报
 *   "prepared statement does not exist"。
 * - `max: 1`：serverless 下每个函数实例只需一条连接，实例数才是并发维度。
 *   每实例开连接池会在流量高峰直接打满 Postgres 的连接上限。
 */
function createClient() {
  return postgres(serverEnv.DATABASE_URL, {
    prepare: false,
    max: 1,
  });
}

/**
 * dev 模式下 Next.js 的热更新会反复重新执行模块，每次都新建连接会泄漏连接。
 * 挂在 globalThis 上复用，生产环境不走这条路径。
 */
const globalForDb = globalThis as unknown as {
  pgClient: ReturnType<typeof createClient> | undefined;
};

const pgClient = globalForDb.pgClient ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgClient = pgClient;
}

export const db = drizzle(pgClient, { schema });
