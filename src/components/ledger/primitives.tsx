import {
  BASE_CURRENCY,
  formatAmount,
  HOME_CURRENCY,
  type MockCategory,
  type MockEntry,
} from "@/lib/ledger/mock";

/**
 * 两个排版方向共用的小组件。
 *
 * 抽出来不只是为了少写代码——更重要的是让 A/B 两版的差异**只体现在布局上**。
 * 如果连列表行的写法都不一样，你比较的就不再是「哪种排版更好」，
 * 而是「哪一版我碰巧写得更用心」。
 */

/** 分类横条。 */
export function CategoryBars({
  categories,
  max,
}: {
  categories: MockCategory[];
  max: number;
}) {
  return (
    <ul className="flex flex-col gap-2.5">
      {categories.map((c) => (
        <li key={c.name} className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-sm text-ink-muted">{c.name}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border-subtle">
            {/*
              所有横条同一个颜色，长度表示多少。
              分类之间没有天然顺序，用深浅去编码金额是把「长度已经说过的事」
              再用颜色说一遍，白白烧掉一个本可以承载别的信息的通道。
            */}
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: `${(Number(c.amount) / max) * 100}%` }}
            />
          </span>
          <span className="tnum w-20 shrink-0 text-right text-sm text-ink">
            {formatAmount(c.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** 一条记录。 */
export function EntryRow({ entry }: { entry: MockEntry }) {
  const isForeign = entry.currency !== HOME_CURRENCY;

  return (
    <li className="flex items-baseline gap-3 py-2.5">
      <span className="tnum w-11 shrink-0 text-sm text-ink-subtle">
        {entry.date.slice(5).replace("-", "/")}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-ink">
          {entry.note ?? entry.category}
        </span>
        {entry.note ? (
          <span className="block text-xs text-ink-subtle">{entry.category}</span>
        ) : null}
      </span>

      <span className="shrink-0 text-right">
        <span className="tnum block text-sm text-ink">
          {formatAmount(entry.amount)}
          <span className="ml-1 text-xs text-ink-subtle">{entry.currency}</span>
        </span>
        {/*
          外币消费才显示折算值。本币消费显示「142 SEK ≈ 142 SEK」是纯噪音，
          而噪音多了，真正需要注意的那一行就不显眼了。
        */}
        {isForeign && entry.convertedAmount ? (
          <span className="tnum block text-xs text-ink-subtle">
            ≈ {formatAmount(entry.convertedAmount)} {BASE_CURRENCY}
          </span>
        ) : null}
      </span>
    </li>
  );
}

/** 环比。上涨用文字说明方向，不只靠颜色——色觉障碍者也要能读懂。 */
export function ChangeBadge({ percent }: { percent: number }) {
  const up = percent > 0;
  return (
    <span className="text-sm text-ink-muted">
      比上月 {up ? "多" : "少"}
      <span className="tnum mx-1">{Math.abs(percent).toFixed(1)}%</span>
    </span>
  );
}

/**
 * 英雄数字的字号，按长度自适应。
 *
 * 固定字号在 390px 宽度上撑不住：实测 `1,234,567.00` 会折成两行，币种标签
 * 孤零零飘到第一行右边。但直接把字号调小到「最长的金额也放得下」也不对——
 * 那样日常那些五六位数的金额跟着变小，焦点效果就没了。
 *
 * 所以让内容决定字号：短数字用最大号，长了自动降一档。配合 whitespace-nowrap
 * 兜底，保证任何情况下都是一行。
 */
export function heroSizeClass(formatted: string): string {
  const len = formatted.length;
  if (len <= 9) return "text-6xl";
  if (len <= 12) return "text-5xl";
  return "text-4xl";
}

/** 主操作按钮。 */
export function PrimaryAction({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`rounded-full bg-accent px-5 py-3 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 active:opacity-80 ${className}`}
    >
      {children}
    </button>
  );
}
