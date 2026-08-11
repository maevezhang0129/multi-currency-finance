import { describe, expect, it } from "vitest";

import {
  fingerprint,
  guessMapping,
  inferDayFirst,
  parseAmount,
  parseCsv,
  parseDate,
  parseKind,
  toCsv,
} from "./csv";
import type { Entry } from "./types";

describe("parseCsv", () => {
  it("基本解析", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("引号里的逗号不切分", () => {
    // 用 split(",") 的话这一行会错位，而且不会报错——账会悄悄变形。
    expect(parseCsv('日期,备注\n2026-08-11,"午餐,加咖啡"')).toEqual([
      ["日期", "备注"],
      ["2026-08-11", "午餐,加咖啡"],
    ]);
  });

  it("两个连续引号表示一个字面引号", () => {
    expect(parseCsv('note\n"他说""好"""')).toEqual([["note"], ['他说"好"']]);
  });

  it("引号里的换行属于同一个字段", () => {
    expect(parseCsv('note\n"第一行\n第二行"')).toEqual([
      ["note"],
      ["第一行\n第二行"],
    ]);
  });

  it("处理 CRLF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("去掉 Excel 写的 BOM", () => {
    // 不去掉的话第一个列名会变成「﻿日期」，映射就永远猜不中。
    const rows = parseCsv("﻿日期,金额\n2026-08-11,100");
    expect(rows[0]?.[0]).toBe("日期");
  });

  it("跳过空行", () => {
    expect(parseCsv("a\n\n1\n\n")).toEqual([["a"], ["1"]]);
  });
});

describe("guessMapping", () => {
  it("认出中文列名", () => {
    expect(guessMapping(["日期", "金额", "分类", "备注"])).toEqual({
      date: 0,
      amount: 1,
      category: 2,
      note: 3,
    });
  });

  it("认出英文列名，忽略大小写", () => {
    expect(guessMapping(["Date", "AMOUNT", "Note"])).toMatchObject({
      date: 0,
      amount: 1,
      note: 2,
    });
  });

  it("认不出的字段不出现在结果里", () => {
    const mapping = guessMapping(["日期", "神秘列"]);
    expect(mapping.date).toBe(0);
    expect(mapping.amount).toBeUndefined();
  });
});

describe("parseAmount", () => {
  it("普通数字", () => {
    expect(parseAmount("142.50")).toEqual({ amount: "142.50", negative: false });
  });

  it("补齐两位小数", () => {
    expect(parseAmount("142")).toEqual({ amount: "142.00", negative: false });
    expect(parseAmount("142.5")).toEqual({ amount: "142.50", negative: false });
  });

  it("去掉货币符号和千分位", () => {
    expect(parseAmount("¥1,234.56")).toEqual({ amount: "1234.56", negative: false });
    expect(parseAmount("$1,000")).toEqual({ amount: "1000.00", negative: false });
  });

  it("负号", () => {
    expect(parseAmount("-142.50")).toEqual({ amount: "142.50", negative: true });
  });

  it("会计写法的括号表示负数", () => {
    expect(parseAmount("(142.50)")).toEqual({ amount: "142.50", negative: true });
  });

  it("多余的小数位截断而不是四舍五入", () => {
    // 账单写着 12.345 时我们无从判断它到底是多少，截断至少不会凭空多出一分钱。
    expect(parseAmount("12.345")).toEqual({ amount: "12.34", negative: false });
  });

  it("空、零和非数字返回 null", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("0")).toBeNull();
    expect(parseAmount("待定")).toBeNull();
  });
});

describe("parseDate", () => {
  it("ISO 格式", () => {
    expect(parseDate("2026-08-11", false)).toBe("2026-08-11");
  });

  it("斜杠且未补零", () => {
    expect(parseDate("2026/8/1", false)).toBe("2026-08-01");
  });

  it("日在前", () => {
    expect(parseDate("11/08/2026", true)).toBe("2026-08-11");
  });

  it("月在前", () => {
    expect(parseDate("11/08/2026", false)).toBe("2026-11-08");
  });

  it("不存在的日期被拒绝", () => {
    // 2 月 30 日这种，放进去之后没有任何地方会再发现它是错的。
    expect(parseDate("2026-02-30", false)).toBeNull();
    expect(parseDate("2026-13-01", false)).toBeNull();
  });

  it("闰年 2 月 29 日是合法的", () => {
    expect(parseDate("2024-02-29", false)).toBe("2024-02-29");
    expect(parseDate("2026-02-29", false)).toBeNull();
  });

  it("认不出的格式返回 null", () => {
    expect(parseDate("Aug 11, 2026", false)).toBeNull();
    expect(parseDate("", false)).toBeNull();
  });
});

describe("inferDayFirst", () => {
  it("有一行第一段大于 12 就能确定是日在前", () => {
    expect(inferDayFirst(["03/04/2026", "25/04/2026"])).toBe(true);
  });

  it("有一行第二段大于 12 就能确定是月在前", () => {
    expect(inferDayFirst(["03/04/2026", "04/25/2026"])).toBe(false);
  });

  it("全都小于等于 12 时无法判断，返回 null", () => {
    // 猜错会让半年的账全部记错月份，所以这里必须问用户。
    expect(inferDayFirst(["03/04/2026", "05/06/2026"])).toBeNull();
  });

  it("全是 ISO 格式时不需要判断", () => {
    expect(inferDayFirst(["2026-08-11", "2026-08-12"])).toBe(false);
  });

  it("两种都出现时无法判断", () => {
    expect(inferDayFirst(["25/04/2026", "04/25/2026"])).toBeNull();
  });
});

describe("parseKind", () => {
  it("认出收入", () => {
    expect(parseKind("收入")).toBe("income");
    expect(parseKind("Income")).toBe("income");
  });

  it("其余一律按支出", () => {
    expect(parseKind("支出")).toBe("expense");
    expect(parseKind(undefined)).toBe("expense");
    expect(parseKind("莫名其妙")).toBe("expense");
  });
});

describe("fingerprint", () => {
  it("同样的内容给出同样的指纹", () => {
    const a = { date: "2026-08-11", kind: "expense" as const, amount: "142.50", currency: "SEK", note: "午餐" };
    expect(fingerprint(a)).toBe(fingerprint({ ...a }));
  });

  it("金额不同则指纹不同", () => {
    const base = { date: "2026-08-11", kind: "expense" as const, amount: "142.50", currency: "SEK" };
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, amount: "142.51" }));
  });

  it("备注不同则指纹不同", () => {
    const base = { date: "2026-08-11", kind: "expense" as const, amount: "142.50", currency: "SEK" };
    expect(fingerprint({ ...base, note: "午餐" })).not.toBe(
      fingerprint({ ...base, note: "晚餐" }),
    );
  });
});

describe("toCsv", () => {
  const entry = (over: Partial<Entry> = {}): Entry => ({
    id: "e1",
    kind: "expense",
    date: "2026-08-11",
    amount: "142.50",
    currency: "SEK",
    category: "餐饮",
    note: "午餐",
    conversion: {
      base: "USD",
      amount: "14.73",
      rate: "9.6745652174",
      rateMonth: "2026-07",
      frozen: false,
    },
    createdAt: "2026-08-11T00:00:00.000Z",
    ...over,
  });

  it("带 BOM，否则 Excel 打开是乱码", () => {
    expect(toCsv([])).toMatch(/^﻿/);
  });

  it("表头前六列就是导入认的字段", () => {
    const header = toCsv([]).replace(/^﻿/, "").split("\r\n")[0];
    expect(header?.split(",").slice(0, 6)).toEqual([
      "日期", "类型", "金额", "币种", "分类", "备注",
    ]);
  });

  it("含逗号的备注会被引号包裹", () => {
    const csv = toCsv([entry({ note: "午餐,加咖啡" })]);
    expect(csv).toContain('"午餐,加咖啡"');
  });

  it("导出再解析能拿回原来的核心字段", () => {
    // 往返一致：你在 Excel 里改完再导回来，不该丢东西。
    const rows = parseCsv(toCsv([entry()]));
    const mapping = guessMapping(rows[0] ?? []);
    const row = rows[1] ?? [];

    expect(row[mapping.date ?? -1]).toBe("2026-08-11");
    expect(row[mapping.amount ?? -1]).toBe("142.50");
    expect(row[mapping.currency ?? -1]).toBe("SEK");
    expect(row[mapping.category ?? -1]).toBe("餐饮");
    expect(row[mapping.note ?? -1]).toBe("午餐");
  });

  it("按日期升序排列", () => {
    const csv = toCsv([entry({ date: "2026-08-20" }), entry({ date: "2026-08-01" })]);
    const dates = csv.split("\r\n").slice(1, 3).map((l) => l.split(",")[0]);
    expect(dates).toEqual(["2026-08-01", "2026-08-20"]);
  });

  it("待折算的记录如实标注", () => {
    expect(toCsv([entry({ conversion: null })])).toContain("待折算");
  });
});
