import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

// drizzle-kit 是独立于 Next.js 的 CLI，不会自动读 .env.local。
// 借 @next/env 复用 Next 自己的加载顺序，保证 CLI 和应用看到同一份环境变量。
loadEnvConfig(process.cwd());

const directUrl = process.env.DIRECT_DATABASE_URL;

if (!directUrl) {
  throw new Error(
    "缺少 DIRECT_DATABASE_URL。迁移必须走 Supabase 的 direct connection（5432），" +
      "参考 .env.example。",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  // 刻意用 direct connection 而非运行时那条 transaction pooler（6543）：
  // 迁移要执行 DDL 并依赖会话级 advisory lock，pooler 的事务模式会把连接
  // 在事务间换掉，锁语义不成立。
  dbCredentials: { url: directUrl },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
