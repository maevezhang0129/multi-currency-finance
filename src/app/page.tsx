export default function Home() {
  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col justify-center gap-4 px-6 py-16 font-sans">
      <h1 className="text-2xl font-semibold tracking-tight">
        Multi-Currency Finance
      </h1>
      <p className="text-sm leading-relaxed text-black/60 dark:text-white/60">
        多币种个人财务分析工具。账本数据只留在你自己的浏览器里，后端只负责抓取与提供公共汇率数据。
      </p>
      <p className="text-sm text-black/40 dark:text-white/40">汇率趋势图开发中。</p>
    </main>
  );
}
