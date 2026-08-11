import Link from "next/link";

import { FxTrend } from "@/components/fx-trend";

/**
 * 汇率趋势页。
 *
 * 原本这张图占着首页。账本上线后它不再是主角——日常打开应用是为了记账和看
 * 花了多少，不是为了看汇率走势。但它也不该被删掉：折算用的就是这些数字，
 * 能查得到才让人信得过前面那个「≈ 1,276.40 USD」。
 *
 * 所以给它一个自己的页面，首页留一个入口。
 */
export default function RatesPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-10 sm:py-14">
      <header className="flex flex-col gap-3">
        <Link
          href="/"
          className="text-sm text-ink-muted transition-colors hover:text-ink"
        >
          ← 返回
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">汇率</h1>
        <p className="max-w-prose text-sm leading-relaxed text-ink-muted">
          账本里的折算用的就是这些月度汇率。数据由每月一次的定时任务从欧洲央行参考汇率抓取，
          按当月所有交易日取均值。
        </p>
      </header>

      <FxTrend />
    </main>
  );
}
