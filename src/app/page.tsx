import { FxTrend } from "@/components/fx-trend";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12 font-sans sm:py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          Multi-Currency Finance
        </h1>
        <p className="max-w-prose text-sm leading-relaxed text-black/60 dark:text-white/60">
          多币种个人财务分析工具。账本数据只留在你自己的浏览器里，后端只负责抓取与提供公共汇率数据。
        </p>
      </header>

      <FxTrend />
    </main>
  );
}
