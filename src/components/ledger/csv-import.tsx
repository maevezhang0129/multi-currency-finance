"use client";

import { useState } from "react";

import type { RateIndex } from "@/lib/ledger/convert";
import {
  guessMapping,
  inferDayFirst,
  parseCsv,
  type Field,
} from "@/lib/ledger/csv";
import { formatAmount } from "@/lib/ledger/format";
import { newCategoriesIn, planImport, type ImportPlan } from "@/lib/ledger/import";
import {
  SPENDABLE_CURRENCIES,
  type CategorySet,
  type Entry,
} from "@/lib/ledger/types";

/**
 * CSV 导入：选文件 → 确认映射 → 预览 → 写入。
 *
 * 中间那两步不能省。导入是少数几个能一次把整个账本搞乱的操作，而它出错时
 * 往往不报错——只是几百条记录悄悄记在了错误的月份或错误的方向上。
 * 所以先把「这份文件会变成什么」完整算出来给人看，确认之后才写。
 */

const FIELD_LABELS: Record<Field, string> = {
  date: "日期",
  amount: "金额",
  kind: "类型（收入/支出）",
  currency: "币种",
  category: "分类",
  note: "备注",
};

const REQUIRED: Field[] = ["date", "amount"];

interface Loaded {
  header: string[];
  rows: string[][];
  mapping: Partial<Record<Field, number>>;
  /** null 表示整列都判断不出日在前还是月在前，必须问用户。 */
  dayFirst: boolean | null;
}

export function CsvImport({
  entries,
  categories,
  homeCurrency,
  base,
  rates,
  onImport,
}: {
  entries: readonly Entry[];
  categories: CategorySet;
  homeCurrency: string;
  base: string;
  rates: RateIndex | null;
  onImport: (added: Entry[], newCategories: string[]) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [dayFirst, setDayFirst] = useState(false);
  const [defaultCurrency, setDefaultCurrency] = useState(homeCurrency);
  const [defaultCategory, setDefaultCategory] = useState(
    categories.expense[0] ?? "其他",
  );
  const [kindFallback, setKindFallback] =
    useState<"auto" | "all-expense" | "by-sign">("auto");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function pickFile(file: File) {
    setError(null);
    setDone(null);
    try {
      const rows = parseCsv(await file.text());
      const header = rows[0];
      if (header === undefined || rows.length < 2) {
        setError("这个文件里没有数据行");
        return;
      }
      const mapping = guessMapping(header);
      const dateColumn = mapping.date;
      const inferred =
        dateColumn === undefined
          ? false
          : inferDayFirst(rows.slice(1).map((r) => r[dateColumn] ?? ""));

      setLoaded({ header, rows, mapping, dayFirst: inferred });
      setDayFirst(inferred ?? false);
      setKindFallback("auto");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "读不了这个文件");
    }
  }

  const plan: ImportPlan | null =
    loaded === null
      ? null
      : planImport(loaded.rows, {
          mapping: loaded.mapping,
          dayFirst,
          defaultCurrency,
          defaultCategory,
          base,
          rates,
          existing: entries,
          kindFallback,
        });

  const missing = REQUIRED.filter((f) => loaded?.mapping[f] === undefined);

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">从 CSV 导入</h2>
        <p className="mt-1 text-xs text-ink-subtle">
          导出的文件可以直接导回来。列名不一样也没关系，下一步能手动指定。
        </p>
      </div>

      <label className="self-start rounded-full border border-border-strong px-4 py-2 text-sm text-ink transition-colors hover:bg-surface-raised">
        选择 CSV 文件
        <input
          type="file"
          accept=".csv,text/csv"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pickFile(file);
            // 清空，好让同一个文件能再次选择
            e.target.value = "";
          }}
        />
      </label>

      {error !== null ? (
        <p role="alert" className="text-sm text-ink-muted">
          {error}
        </p>
      ) : null}

      {done !== null ? (
        <p className="rounded-lg border border-border-subtle bg-surface-raised px-3 py-2 text-sm text-ink">
          {done}
        </p>
      ) : null}

      {loaded !== null && plan !== null ? (
        <div className="flex flex-col gap-5 rounded-xl border border-border-subtle p-4">
          {/* 一、列映射 */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-ink-subtle">
              每一列是什么
            </h3>
            {(Object.keys(FIELD_LABELS) as Field[]).map((field) => (
              <label key={field} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0 text-ink-muted">
                  {FIELD_LABELS[field]}
                  {REQUIRED.includes(field) ? (
                    <span className="text-ink-subtle"> *</span>
                  ) : null}
                </span>
                <select
                  value={loaded.mapping[field] ?? -1}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setLoaded({
                      ...loaded,
                      mapping: {
                        ...loaded.mapping,
                        [field]: value === -1 ? undefined : value,
                      },
                    });
                  }}
                  className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface px-2 py-1.5 text-sm text-ink outline-none focus:border-border-strong"
                >
                  <option value={-1}>（不导入）</option>
                  {loaded.header.map((name, index) => (
                    <option key={`${name}-${index}`} value={index}>
                      {name || `第 ${index + 1} 列`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {/* 二、CSV 里没有的东西，整份统一给一个值 */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-ink-subtle">
              文件里没有的，统一设为
            </h3>
            <label className="flex items-center gap-3 text-sm">
              <span className="w-28 shrink-0 text-ink-muted">币种</span>
              <select
                value={defaultCurrency}
                onChange={(e) => setDefaultCurrency(e.target.value)}
                className="rounded-lg border border-border-subtle bg-surface px-2 py-1.5 text-sm text-ink outline-none"
              >
                {SPENDABLE_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-3 text-sm">
              <span className="w-28 shrink-0 text-ink-muted">分类</span>
              <select
                value={defaultCategory}
                onChange={(e) => setDefaultCategory(e.target.value)}
                className="rounded-lg border border-border-subtle bg-surface px-2 py-1.5 text-sm text-ink outline-none"
              >
                {categories.expense.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/*
            日期歧义。03/04/2026 光看一行判断不了是 3 月 4 日还是 4 月 3 日，
            猜错会让整份账单记错月份，所以只在真的无法推断时才问，
            但一定要问。
          */}
          {loaded.dayFirst === null ? (
            <div className="flex flex-col gap-2 rounded-lg border border-border-strong px-3 py-2.5">
              <p className="text-xs text-ink">
                日期像 03/04/2026 这样，判断不出哪个是月哪个是日。
              </p>
              <div className="flex gap-2">
                {[
                  { value: true, label: "日 / 月 / 年" },
                  { value: false, label: "月 / 日 / 年" },
                ].map((option) => (
                  <button
                    key={String(option.value)}
                    type="button"
                    onClick={() => setDayFirst(option.value)}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${
                      dayFirst === option.value
                        ? "bg-ink text-background"
                        : "bg-surface-raised text-ink-muted hover:text-ink"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/*
            收支方向。没有类型列时，方向只能靠猜：整列有负数就按符号判，
            否则全按支出。但一份全是支出的账单里出现一笔退款，就会让其余
            所有正数被判成收入——所以这里给出显式选项，而不是让人从预览里
            那些加号自己看出问题。
          */}
          {loaded.mapping.kind === undefined ? (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-medium tracking-wide text-ink-subtle">
                这份文件的收支方向
              </h3>
              <div className="flex flex-wrap gap-2">
                {([
                  { value: "auto", label: "自动判断" },
                  { value: "all-expense", label: "全部是支出" },
                  { value: "by-sign", label: "按正负号" },
                ] as const).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setKindFallback(option.value)}
                    className={`rounded-full px-3 py-1 text-xs transition-colors ${
                      kindFallback === option.value
                        ? "bg-ink text-background"
                        : "bg-surface-raised text-ink-muted hover:text-ink"
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* 三、预览 */}
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium tracking-wide text-ink-subtle">
              预览
            </h3>

            {missing.length > 0 ? (
              <p className="text-sm text-ink-muted">
                还需要指定：{missing.map((f) => FIELD_LABELS[f]).join("、")}
              </p>
            ) : (
              <>
                <p className="text-sm text-ink">
                  将导入 <span className="tnum">{plan.entries.length}</span> 条
                  {plan.entries.some((e) => e.kind === "income") ? (
                    <span className="text-ink-muted">
                      （其中{" "}
                      <span className="tnum">
                        {plan.entries.filter((e) => e.kind === "income").length}
                      </span>{" "}
                      条是收入）
                    </span>
                  ) : null}
                  {plan.duplicates > 0 ? (
                    <span className="text-ink-muted">
                      ，跳过 <span className="tnum">{plan.duplicates}</span> 条重复
                    </span>
                  ) : null}
                  {plan.skipped.length > 0 ? (
                    <span className="text-ink-muted">
                      ，<span className="tnum">{plan.skipped.length}</span> 条读不懂
                    </span>
                  ) : null}
                </p>

                {plan.entries.length > 0 ? (
                  <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
                    {plan.entries.slice(0, 5).map((e) => (
                      <li
                        key={e.id}
                        className="flex items-baseline gap-3 px-3 py-2 text-sm"
                      >
                        <span className="tnum w-20 shrink-0 text-ink-subtle">
                          {e.date}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-ink">
                          {e.note ?? e.category}
                          <span className="ml-2 text-xs text-ink-subtle">
                            {e.category}
                          </span>
                        </span>
                        <span className="tnum shrink-0 text-ink">
                          {e.kind === "income" ? "+" : ""}
                          {formatAmount(e.amount)}
                          <span className="ml-1 text-xs text-ink-subtle">
                            {e.currency}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {/* 读不懂的行要给出行号，好让人回 Excel 里对着改 */}
                {plan.skipped.length > 0 ? (
                  <details className="rounded-lg border border-border-subtle px-3 py-2">
                    <summary className="cursor-pointer text-xs text-ink-muted">
                      看看哪几行读不懂
                    </summary>
                    <ul className="mt-2 flex flex-col gap-1">
                      {plan.skipped.slice(0, 20).map((s) => (
                        <li key={s.line} className="text-xs text-ink-subtle">
                          第 {s.line} 行：{s.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    disabled={plan.entries.length === 0}
                    onClick={() => {
                      const added = newCategoriesIn(
                        plan.entries,
                        categories.expense,
                        "expense",
                      );
                      onImport(plan.entries, added);
                      setDone(
                        `已导入 ${plan.entries.length} 条` +
                          (plan.duplicates > 0 ? `，跳过 ${plan.duplicates} 条重复` : "") +
                          (added.length > 0
                            ? `，新增分类：${added.join("、")}`
                            : ""),
                      );
                      setLoaded(null);
                    }}
                    className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-30"
                  >
                    确认导入
                  </button>
                  <button
                    type="button"
                    onClick={() => setLoaded(null)}
                    className="rounded-full border border-border-strong px-4 py-2 text-sm text-ink-muted transition-colors hover:text-ink"
                  >
                    取消
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
