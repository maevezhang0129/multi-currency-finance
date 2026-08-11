import Link from "next/link";

import {
  CategoryBars,
  ChangeBadge,
  EntryRow,
  heroSizeClass,
  PrimaryAction,
} from "@/components/ledger/primitives";
import {
  BASE_CURRENCY,
  changeVsPrevious,
  formatAmount,
  HOME_CURRENCY,
  MOCK_CATEGORIES,
  MOCK_ENTRIES,
  MOCK_TOTAL,
  MOCK_TOTAL_BASE,
} from "@/lib/ledger/mock";

/**
 * 账本首页。排版走「单一焦点」：一个屏幕先回答一个问题——这个月花了多少。
 *
 * 分类和明细排在下面要滚动才看到，这是刻意的取舍，不是没排下。信息都在一屏里
 * 平铺的话，眼睛得自己找重点；把最重要的那个数放大到没有争议，就不用找了。
 *
 * 数据目前是假的。步骤 2 接上 localStorage 后会换成真实记录。
 */
export default function Home() {
  const max = Math.max(...MOCK_CATEGORIES.map((c) => Number(c.amount)));
  const total = formatAmount(MOCK_TOTAL);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <main className="flex-1 px-6 pb-28">
        <header className="flex items-center justify-between pt-10 pb-8">
          <button
            type="button"
            className="text-sm text-ink-muted transition-colors hover:text-ink"
          >
            2026 年 8 月 ▾
          </button>
          <Link
            href="/rates"
            className="text-sm text-ink-muted transition-colors hover:text-ink"
          >
            汇率
          </Link>
        </header>

        {/*
          英雄数字。字号随长度自适应（见 heroSizeClass），并强制不换行。
          币种缩小并降一档颜色——你早知道自己用什么币，它不是每次都要读的信息。
        */}
        <section className="pb-10">
          <p className="tnum flex items-baseline gap-2 whitespace-nowrap text-ink">
            <span className={`${heroSizeClass(total)} font-semibold tracking-tight`}>
              {total}
            </span>
            <span className="text-xl text-ink-subtle">{HOME_CURRENCY}</span>
          </p>

          <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="tnum text-sm text-ink-muted">
              ≈ {formatAmount(MOCK_TOTAL_BASE)} {BASE_CURRENCY}
            </span>
            <ChangeBadge percent={changeVsPrevious()} />
          </p>
        </section>

        <section className="border-t border-border-subtle pt-7">
          <h2 className="pb-4 text-xs font-medium tracking-wide text-ink-subtle">
            分类
          </h2>
          <CategoryBars categories={MOCK_CATEGORIES} max={max} />
        </section>

        <section className="mt-8 border-t border-border-subtle pt-7">
          <div className="flex items-baseline justify-between pb-2">
            <h2 className="text-xs font-medium tracking-wide text-ink-subtle">
              最近
            </h2>
            <button
              type="button"
              className="text-xs text-ink-muted transition-colors hover:text-ink"
            >
              全部记录
            </button>
          </div>
          <ul className="divide-y divide-border-subtle">
            {MOCK_ENTRIES.map((e) => (
              <EntryRow key={e.id} entry={e} />
            ))}
          </ul>
        </section>
      </main>

      {/*
        记账按钮固定在拇指够得着的位置。「花完当场就记」意味着这个按钮永远
        不该需要先滚动才能点到。上方的渐变让内容滚到按钮下面时不至于糊在一起。
      */}
      <div className="pointer-events-none sticky bottom-0 bg-gradient-to-t from-background via-background to-transparent px-6 pt-8 pb-6">
        <PrimaryAction className="pointer-events-auto w-full">
          记一笔
        </PrimaryAction>
      </div>
    </div>
  );
}
