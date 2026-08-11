import { convertToBase, type RateIndex } from "./convert";
import {
  fingerprint,
  parseAmount,
  parseDate,
  parseKind,
  type Field,
} from "./csv";
import type { Entry, EntryKind } from "./types";

/**
 * 把 CSV 的行装配成账本记录。纯函数——不写存储，只把「这份文件会变成什么」
 * 算出来交给界面预览。
 *
 * 之所以分成「算出来」和「写进去」两步：导入是少数几个能一次毁掉整个账本的
 * 操作。先让人看清楚会发生什么，再决定要不要发生。
 */

export interface ImportOptions {
  mapping: Partial<Record<Field, number>>;
  /** 日期是「日在前」还是「月在前」。ISO 格式用不到这个。 */
  dayFirst: boolean;
  /** CSV 里没有币种列时用它。 */
  defaultCurrency: string;
  /** CSV 里没有分类列，或者某行分类为空时用它。 */
  defaultCategory: string;
  base: string;
  rates: RateIndex | null;
  /** 已有的记录，用来判重。 */
  existing: readonly Entry[];
  now?: Date;
  /**
   * 没有类型列时，怎么决定收支方向。
   *
   * `auto`：整列出现过负数就按符号判，否则全按支出。
   * 但这个猜测会错——一份全是支出的账单里出现一笔退款（负数），
   * 就会让其余所有正数被判成收入。所以界面要允许显式指定。
   */
  kindFallback?: "auto" | "all-expense" | "by-sign";
  /** 生成 id。注入是为了让测试拿到稳定结果。 */
  newId?: () => string;
}

export interface SkippedRow {
  /** 第几行，从 1 开始且含表头，与 Excel 里看到的行号一致。 */
  line: number;
  reason: string;
}

export interface ImportPlan {
  /** 可以写入的记录。 */
  entries: Entry[];
  /** 因为重复而跳过的行数。 */
  duplicates: number;
  /** 因为解析不了而跳过的行，带原因。 */
  skipped: SkippedRow[];
}

/**
 * 算出一份导入计划。
 *
 * 遇到读不懂的行不中断整份导入，而是记下行号和原因继续——一份两百行的账单里
 * 有三行格式不对，正确的做法是导入其余 197 行并告诉你哪三行有问题，
 * 而不是整份拒绝。
 */
export function planImport(
  rows: readonly (readonly string[])[],
  options: ImportOptions,
): ImportPlan {
  const {
    mapping,
    dayFirst,
    defaultCurrency,
    defaultCategory,
    base,
    rates,
    existing,
    now = new Date(),
    kindFallback = "auto",
    newId = () => crypto.randomUUID(),
  } = options;

  const seen = new Set(existing.map((e) => fingerprint(e)));
  const entries: Entry[] = [];
  const skipped: SkippedRow[] = [];
  let duplicates = 0;

  const cell = (row: readonly string[], field: Field): string | undefined => {
    const index = mapping[field];
    if (index === undefined) return undefined;
    return row[index];
  };

  /*
   * 金额列里到底有没有负数，要看整列才知道。
   *
   * 银行账单常用「一列金额、支出为负」的写法，但自己在 Excel 里记的支出账本
   * 通常全是正数。逐行按符号判断的话，后者会被整份判成收入——一份两百行的
   * 支出账单导进来全变成收入，而且没有任何提示。
   */
  const hasNegativeAmounts = rows
    .slice(1)
    .some((row) => {
      const raw = cell(row, "amount");
      return raw !== undefined && parseAmount(raw)?.negative === true;
    });

  const useSign =
    kindFallback === "by-sign" ||
    (kindFallback === "auto" && hasNegativeAmounts);

  // 第 0 行是表头，数据从第 1 行开始；+1 让行号与 Excel 里看到的一致
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (row === undefined) continue;
    const line = i + 1;

    const rawDate = cell(row, "date");
    if (rawDate === undefined) {
      skipped.push({ line, reason: "没有指定日期所在的列" });
      continue;
    }
    const date = parseDate(rawDate, dayFirst);
    if (date === null) {
      skipped.push({ line, reason: `日期读不懂：${rawDate.trim() || "(空)"}` });
      continue;
    }

    const rawAmount = cell(row, "amount");
    const parsed = rawAmount === undefined ? null : parseAmount(rawAmount);
    if (parsed === null) {
      skipped.push({
        line,
        reason: `金额读不懂：${(rawAmount ?? "").trim() || "(空)"}`,
      });
      continue;
    }

    /*
     * 收支方向按这个顺序判断：
     * 1. 有类型列就以它为准，最明确
     * 2. 整列出现过负数，说明这份文件用符号表达方向，按符号判
     * 3. 全是正数，说明这是一份纯支出账本（自己记的账几乎都是这样）
     */
    const kindColumn = cell(row, "kind");
    const kind: EntryKind =
      kindColumn !== undefined && kindColumn.trim().length > 0
        ? parseKind(kindColumn)
        : !useSign
          ? "expense"
          : parsed.negative
            ? "expense"
            : "income";

    const currency = (cell(row, "currency") ?? "").trim() || defaultCurrency;
    const category = (cell(row, "category") ?? "").trim() || defaultCategory;
    const note = (cell(row, "note") ?? "").trim();

    const draft = {
      date,
      kind,
      amount: parsed.amount,
      currency,
      ...(note.length > 0 ? { note } : {}),
    };

    const print = fingerprint(draft);
    if (seen.has(print)) {
      duplicates += 1;
      continue;
    }
    // 加进 seen，让同一份文件内部的重复行也只导入一条
    seen.add(print);

    entries.push({
      id: newId(),
      ...draft,
      category,
      conversion:
        rates === null
          ? null
          : convertToBase({
              amount: parsed.amount,
              currency,
              date,
              base,
              rates,
              now,
            }),
      createdAt: now.toISOString(),
    } as Entry);
  }

  return { entries, duplicates, skipped };
}

/**
 * 从 CSV 里出现过、但当前分类列表没有的分类。
 *
 * 导入时把它们一并加进分类列表，否则这些记录的分类会立刻变成「孤儿」——
 * 统计里看得到，设置里找不到。
 */
export function newCategoriesIn(
  entries: readonly Entry[],
  known: readonly string[],
  kind: EntryKind,
): string[] {
  const set = new Set(known);
  const found = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === kind && !set.has(entry.category)) found.add(entry.category);
  }
  return [...found].sort();
}
