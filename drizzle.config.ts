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
  // 刻意与运行时那条 transaction pooler（6543）分开。
  //
  // 不是因为迁移在 pooler 上跑不了——drizzle 的 migrator 把迁移包在一个事务里，
  // 实测在 transaction 模式下能正常应用。真正的原因是它有个够不着的天花板：
  // CREATE INDEX CONCURRENTLY 不能在事务内执行，而 transaction 模式下每条语句
  // 都身处事务。等表大到需要不锁表加索引时，迁移就会卡死在这里。
  // pooler 也有更严格的语句超时，长迁移容易被掐断。
  //
  // 现在 schema 只有一张空表，这些都还看不出来。把出口预留在这里，
  // 比等撞上了再回来改配置便宜。
  dbCredentials: { url: directUrl },
  casing: "snake_case",
  strict: true,
  verbose: true,
});
