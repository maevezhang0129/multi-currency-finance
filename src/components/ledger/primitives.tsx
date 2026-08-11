import { formatAmount, formatDayMonth } from "@/lib/ledger/format";
import type { CategoryTotal } from "@/lib/ledger/summary";
import type { Entry } from "@/lib/ledger/types";

/** 分类横条。 */
export function CategoryBars({
  categories,
  currency,
}: {
  categories: readonly CategoryTotal[];
  currency: string;
}) {
  const max = Math.max(...categories.map((c) => Number(c.amount)), 0);

  return (
    <ul className="flex flex-col gap-2.5">
      {categories.map((c) => (
        <li key={c.category} className="flex items-center gap-3">
          <span className="w-10 shrink-0 text-sm text-ink-muted">
            {c.category}
          </span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-border-subtle">
            {/*
              所有横条同一个颜色，长度表示多少。
              分类之间没有天然顺序，用深浅去编码金额是把「长度已经说过的事」
              再用颜色说一遍，白白烧掉一个本可以承载别的信息的通道。
            */}
            <span
              className="block h-full rounded-full bg-accent"
              style={{ width: max > 0 ? `${(Number(c.amount) / max) * 100}%` : "0%" }}
            />
          </span>
          <span className="tnum w-24 shrink-0 text-right text-sm text-ink">
            {formatAmount(c.amount)}
          </span>
        </li>
      ))}
      <li className="pt-1 text-right text-xs text-ink-subtle">
        金额单位：{currency}
      </li>
    </ul>
  );
}

/** 一条记录。 */
export function EntryRow({
  entry,
  homeCurrency,
  onClick,
}: {
  entry: Entry;
  homeCurrency: string;
  onClick?: () => void;
}) {
  const isForeign = entry.currency !== homeCurrency;
  const isIncome = entry.kind === "income";

  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="flex w-full items-baseline gap-3 py-2.5 text-left transition-colors hover:bg-surface-raised"
      >
        <span className="tnum w-11 shrink-0 text-sm text-ink-subtle">
          {formatDayMonth(entry.date)}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">
            {entry.note && entry.note.length > 0 ? entry.note : entry.category}
          </span>
          {entry.note && entry.note.length > 0 ? (
            <span className="block text-xs text-ink-subtle">
              {entry.category}
            </span>
          ) : null}
        </span>

        <span className="shrink-0 text-right">
          <span className="tnum block text-sm text-ink">
            {isIncome ? "+" : ""}
            {formatAmount(entry.amount)}
            <span className="ml-1 text-xs text-ink-subtle">
              {entry.currency}
            </span>
          </span>
          {/*
            本币消费不显示折算值。「142 SEK ≈ 142 SEK」是纯噪音，
            噪音多了真正需要注意的那一行就不显眼了。
          */}
          {isForeign && entry.conversion !== null ? (
            <span className="tnum block text-xs text-ink-subtle">
              ≈ {formatAmount(entry.conversion.amount)} {entry.conversion.base}
              {entry.conversion.frozen ? null : " ·临时"}
            </span>
          ) : null}
          {entry.conversion === null ? (
            <span className="block text-xs text-ink-subtle">待折算</span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

/** 环比。方向用文字说明，不只靠颜色——色觉障碍者也要能读懂。 */
export function ChangeBadge({ percent }: { percent: number | null }) {
  if (percent === null) return null;
  return (
    <span className="text-sm text-ink-muted">
      比上月 {percent > 0 ? "多" : "少"}
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
 * 所以让内容决定字号：短数字用最大号，长了自动降一档。
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
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full bg-accent px-5 py-3 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 active:opacity-80 ${className}`}
    >
      {children}
    </button>
  );
}
