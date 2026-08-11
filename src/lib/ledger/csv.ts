import type { Entry, EntryKind } from "./types";

/**
 * CSV 导入导出。纯函数，不碰文件系统也不碰 DOM。
 *
 * 一条贯穿的原则：**导出的格式就是导入能直接吃的格式。** 你在 Excel 里整理
 * 账单时，最省事的做法是先导出一份看看列名该怎么写——所以这两件事必须对得上，
 * 而不是各写各的。
 *
 * 导出会多带几列（折算后的金额、用的汇率），导入时直接忽略：那些是给人看的，
 * 重新导入时会按当前汇率重算，不该从文件里读回来。
 */

/** 导入时认得的字段。 */
export type Field = "date" | "kind" | "amount" | "currency" | "category" | "note";

/** 列名 → 字段。自己整理 Excel 时列名多半就是这些，对不上再走手动映射。 */
const ALIASES: Record<Field, string[]> = {
  date: ["日期", "date", "交易日期", "记账日期", "时间", "transaction date"],
  kind: ["类型", "收支", "kind", "type", "收支类型"],
  amount: ["金额", "amount", "发生额", "价格"],
  currency: ["币种", "货币", "currency"],
  category: ["分类", "类别", "category", "类型分类"],
  note: ["备注", "note", "摘要", "说明", "description", "memo", "商户"],
};

/** 导出时的列顺序。前六列是导入认的，后面是给人看的。 */
const EXPORT_HEADER = [
  "日期",
  "类型",
  "金额",
  "币种",
  "分类",
  "备注",
  "折算金额",
  "折算币种",
  "汇率",
  "汇率月份",
  "折算状态",
] as const;

/* ---------------------------------- 解析 ---------------------------------- */

/**
 * 解析 CSV 文本。处理引号包裹、字段内换行、CRLF 和 Excel 写的 BOM。
 *
 * 不用现成库是因为这里的规则很小且固定，而一个依赖要跟着升级、要审安全公告。
 * 但也不能用 `split(",")` 糊弄——备注里出现一个逗号就会把整行错位，
 * 而那种错位不会报错，只会让你的账悄悄变形。
 */
export function parseCsv(text: string): string[][] {
  // Excel 存 UTF-8 时会写一个 BOM，不去掉的话第一个列名会变成「﻿日期」
  const input = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    // 跳过完全空白的行，Excel 常在末尾留一行
    if (row.some((c) => c.trim().length > 0)) rows.push(row);
    row = [];
  };

  while (i < input.length) {
    const char = input[i];

    if (quoted) {
      if (char === '"') {
        // 连续两个引号表示一个字面引号
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
      i += 1;
      continue;
    }
    if (char === ",") {
      endField();
      i += 1;
      continue;
    }
    if (char === "\r") {
      i += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      i += 1;
      continue;
    }

    field += char ?? "";
    i += 1;
  }

  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}

/** 根据表头猜每个字段在第几列。猜不到的不出现在结果里。 */
export function guessMapping(header: readonly string[]): Partial<Record<Field, number>> {
  const mapping: Partial<Record<Field, number>> = {};
  const normalized = header.map((h) => h.trim().toLowerCase());

  for (const [field, aliases] of Object.entries(ALIASES) as [Field, string[]][]) {
    const index = normalized.findIndex((h) =>
      aliases.some((a) => h === a.toLowerCase()),
    );
    if (index !== -1) mapping[field] = index;
  }

  return mapping;
}

/* -------------------------------- 清洗单元格 -------------------------------- */

/**
 * 金额。返回绝对值字符串加一个「是不是负数」，因为账本里金额恒为正，
 * 方向由收支类型表达。
 *
 * 要处理的形态：`¥142.50`、`1,234.56`、`(142.50)`（会计上的负数）、`-142.5`、
 * 以及 Excel 偶尔留下的前后空格。
 */
export function parseAmount(
  raw: string,
): { amount: string; negative: boolean } | null {
  let text = raw.trim();
  if (text.length === 0) return null;

  let negative = false;

  // 会计写法：括号表示负数
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  }

  // 去掉货币符号、千分位、空格
  text = text.replace(/[¥$€£元\s,]/g, "");

  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  if (Number(text) === 0) return null;

  // 统一成两位小数。多余的位直接截断而不是四舍五入——
  // 账单上写着 12.345 时，我们无从判断它到底是多少，截断至少不会凭空多出一分钱。
  const [intPart = "0", fracPart = ""] = text.split(".");
  const amount = `${intPart}.${fracPart.padEnd(2, "0").slice(0, 2)}`;

  return { amount, negative };
}

/**
 * 日期。
 *
 * `03/04/2026` 这种写法光看一行判断不了是 3 月 4 日还是 4 月 3 日，所以
 * `dayFirst` 由调用方从整列推断后传进来（见 inferDayFirst）。
 */
export function parseDate(raw: string, dayFirst: boolean): string | null {
  const text = raw.trim();
  if (text.length === 0) return null;

  const pad = (n: string) => n.padStart(2, "0");

  // ISO：2026-08-11 或 2026/8/11
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(text);
  if (iso) {
    const [, y, m, d] = iso;
    if (y === undefined || m === undefined || d === undefined) return null;
    return validate(`${y}-${pad(m)}-${pad(d)}`);
  }

  // 两段在前、年在后：11/08/2026 或 11-08-2026
  const dmy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/.exec(text);
  if (dmy) {
    const [, a, b, y] = dmy;
    if (a === undefined || b === undefined || y === undefined) return null;
    const day = dayFirst ? a : b;
    const month = dayFirst ? b : a;
    return validate(`${y}-${pad(month)}-${pad(day)}`);
  }

  return null;
}

function validate(candidate: string): string | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(candidate);
  if (!matched) return null;
  const [, y, m, d] = matched;
  if (y === undefined || m === undefined || d === undefined) return null;

  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12) return null;
  // 「下个月的第 0 天」就是本月最后一天，闰年规则交给平台
  const lastDay = new Date(Date.UTC(Number(y), month, 0)).getUTCDate();
  if (day < 1 || day > lastDay) return null;

  return candidate;
}

/**
 * 从整列日期推断「日在前」还是「月在前」。
 *
 * 只要有一行的第一段大于 12，它就只可能是「日」。全列都小于等于 12 时无从判断，
 * 返回 null——这时候必须问用户，猜错会让半年的账全部记错月份。
 */
export function inferDayFirst(values: readonly string[]): boolean | null {
  let sawFirstOver12 = false;
  let sawSecondOver12 = false;
  let sawAmbiguous = false;

  for (const value of values) {
    const matched = /^(\d{1,2})[-/](\d{1,2})[-/]\d{4}/.exec(value.trim());
    if (!matched) continue;
    const first = Number(matched[1]);
    const second = Number(matched[2]);
    if (first > 12) sawFirstOver12 = true;
    else if (second > 12) sawSecondOver12 = true;
    else sawAmbiguous = true;
  }

  if (sawFirstOver12 && !sawSecondOver12) return true;
  if (sawSecondOver12 && !sawFirstOver12) return false;
  // 没有任何一行是 ISO 或含两段以上的斜杠格式时，不需要判断
  if (!sawAmbiguous && !sawFirstOver12 && !sawSecondOver12) return false;
  return null;
}

/** 收支类型。认不出来时按支出处理——账本里绝大多数是支出。 */
export function parseKind(raw: string | undefined): EntryKind {
  const text = (raw ?? "").trim().toLowerCase();
  if (["收入", "income", "收", "+", "credit"].includes(text)) return "income";
  return "expense";
}

/* --------------------------------- 去重 ---------------------------------- */

/**
 * 一条记录的指纹。用来在导入时跳过已经有的。
 *
 * 不含 id 和录入时间：同一笔账从 CSV 导进来时 id 是新生成的，
 * 按 id 判重等于永远判不出来。
 */
export function fingerprint(entry: {
  date: string;
  amount: string;
  currency: string;
  note?: string;
  kind: EntryKind;
}): string {
  return [entry.date, entry.kind, entry.amount, entry.currency, entry.note ?? ""].join(
    "|",
  );
}

/* --------------------------------- 导出 ---------------------------------- */

function escapeCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * 导出成 CSV。
 *
 * 开头写 BOM 是为了 Excel——没有它，Excel 在中文 Windows 上会用本地编码去猜，
 * 于是所有中文变成乱码。这个坑很常见，而用户只会觉得「你的导出坏了」。
 */
export function toCsv(entries: readonly Entry[]): string {
  const lines = [EXPORT_HEADER.join(",")];

  for (const entry of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
    lines.push(
      [
        entry.date,
        entry.kind === "income" ? "收入" : "支出",
        entry.amount,
        entry.currency,
        entry.category,
        entry.note ?? "",
        entry.conversion?.amount ?? "",
        entry.conversion?.base ?? "",
        entry.conversion?.rate ?? "",
        entry.conversion?.rateMonth ?? "",
        entry.conversion === null
          ? "待折算"
          : entry.conversion.frozen
            ? "已冻结"
            : "临时",
      ]
        .map(escapeCell)
        .join(","),
    );
  }

  return `﻿${lines.join("\r\n")}\r\n`;
}
