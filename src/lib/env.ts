import "server-only";

import { z } from "zod";

/**
 * 服务端环境变量的唯一入口。
 *
 * 这里刻意在模块加载时就校验并抛错：缺变量应该在进程启动的第一秒暴露成
 * 「缺少 DATABASE_URL」，而不是等到某次查询才抛一个费解的连接超时。
 *
 * 文件顶部的 `server-only` 让任何从客户端组件 import 这里的代码在构建期
 * 直接失败——密钥不可能因为一次疏忽被打进前端 bundle。
 */
const serverEnvSchema = z.object({
  /** 运行时连接串。Supabase transaction pooler（端口 6543），适配 serverless。 */
  DATABASE_URL: z.string().url(),
  /**
   * 迁移专用连接串。Supabase direct connection（端口 5432）。
   * drizzle-kit 需要执行 DDL 并使用 advisory lock，transaction pooler 不适合。
   */
  DIRECT_DATABASE_URL: z.string().url(),
});

function loadServerEnv(): z.infer<typeof serverEnvSchema> {
  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(
      `环境变量校验失败：\n${details}\n\n请参考 .env.example 补全 .env.local。`,
    );
  }

  return parsed.data;
}

export const serverEnv = loadServerEnv();
