"use client";

import { formatAmount, formatDayMonth } from "@/lib/ledger/format";
import { sum } from "@/lib/ledger/money";
import type { Entry } from "@/lib/ledger/types";

/**
 * 明细列表，按日期分组。
 *
 * 分组用日期而不是月份：一屏里通常就是几天的事，按天分组能让「今天花了多少」
 * 这种最常问的问题直接被答出来，不用自己心算。月份切换在上层做。
 */

export function EntryList({
  entries,
  homeCurrency,
  onSelect,
}: {
  entries: readonly Entry[];
  homeCurrency: string;
  onSelect: (entry: Entry) => void;
}) {
  const groups = groupByDate(entries);

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border-strong px-5 py-10 text-center">
        <p className="text-sm text-ink">这个月还没有记录</p>
        <p className="mt-1 text-sm text-ink-muted">
          翻到别的月份看看，或者记一笔新的。
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.date} className="flex flex-col gap-1">
          <header className="flex items-baseline justify-between border-b border-border-subtle pb-1.5">
            <span className="tnum text-xs text-ink-subtle">
              {formatDayMonth(group.date)}
            </span>
            {/*
              当天小计只在同币种时显示。混了外币的那天，把不同币种的数字加起来
              是没有意义的，宁可不给。
            */}
            {group.singleCurrency !== null ? (
              <span className="tnum text-xs text-ink-subtle">
                {formatAmount(group.total)} {group.singleCurrency}
              </span>
            ) : null}
          </header>

          <ul className="divide-y divide-border-subtle">
            {group.entries.map((entry) => (
              <ListRow
                key={entry.id}
                entry={entry}
                homeCurrency={homeCurrency}
                onSelect={() => onSelect(entry)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ListRow({
  entry,
  homeCurrency,
  onSelect,
}: {
  entry: Entry;
  homeCurrency: string;
  onSelect: () => void;
}) {
  const isForeign = entry.currency !== homeCurrency;
  const isIncome = entry.kind === "income";

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="-mx-2 flex w-[calc(100%+1rem)] items-baseline gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-raised"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">
            {entry.note && entry.note.length > 0 ? entry.note : entry.category}
          </span>
          <span className="block text-xs text-ink-subtle">
            {entry.category}
            {isIncome ? " · 收入" : ""}
          </span>
        </span>

        <span className="shrink-0 text-right">
          <span className="tnum block text-sm text-ink">
            {isIncome ? "+" : ""}
            {formatAmount(entry.amount)}
            <span className="ml-1 text-xs text-ink-subtle">{entry.currency}</span>
          </span>
          {isForeign && entry.conversion !== null ? (
            <span className="tnum block text-xs text-ink-subtle">
              ≈ {formatAmount(entry.conversion.amount)} {entry.conversion.base}
              {entry.conversion.frozen ? "" : " ·临时"}
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

interface DateGroup {
  date: string;
  entries: Entry[];
  total: string;
  /** 当天所有记录是同一币种时给出币种，否则为 null。 */
  singleCurrency: string | null;
}

function groupByDate(entries: readonly Entry[]): DateGroup[] {
  const byDate = new Map<string, Entry[]>();

  for (const entry of entries) {
    const bucket = byDate.get(entry.date);
    if (bucket === undefined) byDate.set(entry.date, [entry]);
    else bucket.push(entry);
  }

  return [...byDate.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([date, list]) => {
      const expenses = list.filter((e) => e.kind === "expense");
      const currencies = new Set(expenses.map((e) => e.currency));
      const singleCurrency =
        currencies.size === 1 ? (expenses[0]?.currency ?? null) : null;

      return {
        date,
        entries: [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        // 用 money.ts 的精确求和，不在这里临时凑数字运算——
        // 金额相加是这个项目里最不该出现浮点的地方。
        total: sum(expenses.map((e) => e.amount)),
        singleCurrency,
      };
    });
}
