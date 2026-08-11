import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/**
 * 此前项目没有这个文件，因为纯函数测试用默认配置就够。加它是为了跑组件测试：
 * 需要一个 DOM 环境、需要能编译 JSX、需要认得 `@/` 别名。
 *
 * 两种测试跑在一个命令里：纯函数测试仍然在 node 环境（快），
 * 只有组件测试通过文件内的 `@vitest-environment jsdom` 注释切到 DOM。
 * 全局开 jsdom 会让两百多个纯函数测试白白付出建 DOM 的代价。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    // 组件测试会渲染真实 DOM，比纯函数慢，但仍在秒级
    globals: false,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
