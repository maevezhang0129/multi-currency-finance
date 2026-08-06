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
  DATABASE_URL: z.url(),
  /**
   * 迁移专用连接串。Session pooler 或 direct connection。
   * 与运行时分开的理由见 drizzle.config.ts 的注释。
   */
  DIRECT_DATABASE_URL: z.url(),
  /**
   * 保护 cron 端点。Vercel 触发定时任务时会带 `Authorization: Bearer <CRON_SECRET>`，
   * 该变量由平台自动注入到生产环境；本地需要自己在 .env.local 里放一个。
   *
   * 要求最小长度，是为了挡住「设成 `dev` 图省事」这种写法——那等于没有保护。
   */
  CRON_SECRET: z.string().min(16, "至少 16 个字符，太短等于没有保护"),
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
