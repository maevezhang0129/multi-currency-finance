import { describe, expect, it } from "vitest";

import type { FxResponse } from "../fx/api-types";
import { buildRateIndex } from "./convert";
import { guessMapping, parseCsv } from "./csv";
import { newCategoriesIn, planImport, type ImportOptions } from "./import";
import type { Entry } from "./types";

const rates = buildRateIndex({
  base: "USD",
  from: "2026-07",
  to: "2026-07",
  series: [{ quote: "SEK", points: [{ month: "2026-07", rate: "10.0000000000" }] }],
} satisfies FxResponse);

const NOW = new Date("2026-08-11T00:00:00Z");

let counter = 0;
const baseOptions = (over: Partial<ImportOptions> = {}): ImportOptions => ({
  mapping: {},
  dayFirst: false,
  defaultCurrency: "SEK",
  defaultCategory: "其他",
  base: "USD",
  rates,
  existing: [],
  now: NOW,
  newId: () => `id${(counter += 1)}`,
  ...over,
});

const plan = (csv: string, over: Partial<ImportOptions> = {}) => {
  const rows = parseCsv(csv);
  return planImport(
    rows,
    baseOptions({ mapping: guessMapping(rows[0] ?? []), ...over }),
  );
};

describe("正常导入", () => {
  it("按表头自动映射并装配记录", () => {
    const result = plan(
      "日期,金额,分类,备注\n2026-07-15,142.50,餐饮,午餐\n2026-07-16,63,日用,洗衣液",
    );

    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toMatchObject({
      date: "2026-07-15",
      amount: "142.50",
      currency: "SEK",
      category: "餐饮",
      note: "午餐",
      kind: "expense",
    });
    // 金额补齐两位
    expect(result.entries[1]?.amount).toBe("63.00");
  });

  it("顺带算好折算", () => {
    const result = plan("日期,金额\n2026-07-15,100");
    expect(result.entries[0]?.conversion).toMatchObject({
      amount: "10.00",
      rateMonth: "2026-07",
      frozen: true,
    });
  });

  it("拿不到汇率时折算为 null，但记录照样导入", () => {
    // 汇率取不到不该阻塞导入，之后会被 refreshConversions 补上。
    const result = plan("日期,金额\n2026-07-15,100", { rates: null });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.conversion).toBeNull();
  });

  it("没有币种列时用默认币种", () => {
    const result = plan("日期,金额\n2026-07-15,100", { defaultCurrency: "THB" });
    expect(result.entries[0]?.currency).toBe("THB");
  });

  it("分类为空时落到默认分类", () => {
    const result = plan("日期,金额,分类\n2026-07-15,100,", {
      defaultCategory: "未分类",
    });
    expect(result.entries[0]?.category).toBe("未分类");
  });
});

describe("收支方向", () => {
  it("有类型列时以它为准", () => {
    const result = plan("日期,金额,类型\n2026-07-15,32000,收入");
    expect(result.entries[0]?.kind).toBe("income");
  });

  it("没有类型列时用金额正负号推断", () => {
    // 银行账单常用这种写法：一列金额，支出为负。
    const result = plan("日期,金额\n2026-07-15,-142.50\n2026-07-16,32000");
    expect(result.entries[0]?.kind).toBe("expense");
    expect(result.entries[1]?.kind).toBe("income");
  });

  it("整列全是正数时，一律按支出——这是自己记账最常见的形态", () => {
    // 曾经的 bug：逐行按符号判断，于是一份两百行的正数支出账单
    // 被整份导成了收入，而且没有任何提示。方向要看整列才能判断。
    const result = plan("日期,金额\n2026-07-15,142.50\n2026-07-16,63.00");
    expect(result.entries.map((e) => e.kind)).toEqual(["expense", "expense"]);
  });

  it("金额存成绝对值，方向由 kind 表达", () => {
    const result = plan("日期,金额\n2026-07-15,-142.50");
    expect(result.entries[0]?.amount).toBe("142.50");
  });
});

describe("读不懂的行", () => {
  it("跳过并记下行号和原因，不中断其余行", () => {
    // 两百行里有三行格式不对，正确做法是导入其余 197 行并告诉你是哪三行，
    // 而不是整份拒绝。
    const result = plan(
      "日期,金额\n2026-07-15,100\n坏日期,50\n2026-07-17,不是数字\n2026-07-18,80",
    );

    expect(result.entries).toHaveLength(2);
    expect(result.skipped).toEqual([
      { line: 3, reason: "日期读不懂：坏日期" },
      { line: 4, reason: "金额读不懂：不是数字" },
    ]);
  });

  it("行号与 Excel 里看到的一致（含表头）", () => {
    const result = plan("日期,金额\n坏的,100");
    expect(result.skipped[0]?.line).toBe(2);
  });

  it("没有映射日期列时明确说明", () => {
    const result = plan("神秘列A,神秘列B\nx,y", { mapping: {} });
    expect(result.skipped[0]?.reason).toContain("没有指定日期");
  });

  it("金额为 0 的行被跳过", () => {
    const result = plan("日期,金额\n2026-07-15,0");
    expect(result.entries).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
  });
});

describe("去重", () => {
  const existing: Entry[] = [
    {
      id: "old",
      kind: "expense",
      date: "2026-07-15",
      amount: "142.50",
      currency: "SEK",
      category: "餐饮",
      note: "午餐",
      conversion: null,
      createdAt: "2026-07-15T00:00:00.000Z",
    },
  ];

  it("已经存在的记录被跳过", () => {
    const result = plan("日期,金额,备注\n2026-07-15,142.50,午餐", { existing });
    expect(result.entries).toHaveLength(0);
    expect(result.duplicates).toBe(1);
  });

  it("同一份文件里的重复行也只导入一条", () => {
    const result = plan(
      "日期,金额,备注\n2026-07-20,50,咖啡\n2026-07-20,50,咖啡",
    );
    expect(result.entries).toHaveLength(1);
    expect(result.duplicates).toBe(1);
  });

  it("金额或备注不同就不算重复", () => {
    const result = plan(
      "日期,金额,备注\n2026-07-15,142.51,午餐\n2026-07-15,142.50,晚餐",
      { existing },
    );
    expect(result.entries).toHaveLength(2);
    expect(result.duplicates).toBe(0);
  });

  it("同一天真的花了两笔一样的钱，第二笔会被误判为重复", () => {
    // 这是自动去重的已知代价，界面要把跳过的条数告诉用户，让他有机会发现。
    const result = plan("日期,金额,备注\n2026-07-20,30,地铁\n2026-07-20,30,地铁");
    expect(result.duplicates).toBe(1);
  });
});

describe("日期格式", () => {
  it("日在前", () => {
    const result = plan("日期,金额\n15/07/2026,100", { dayFirst: true });
    expect(result.entries[0]?.date).toBe("2026-07-15");
  });

  it("月在前", () => {
    const result = plan("日期,金额\n07/15/2026,100", { dayFirst: false });
    expect(result.entries[0]?.date).toBe("2026-07-15");
  });
});

describe("newCategoriesIn", () => {
  it("找出 CSV 带进来、分类列表里还没有的", () => {
    // 不加进列表的话，这些记录的分类会立刻变成孤儿：统计里看得到，设置里找不到。
    const entries = plan(
      "日期,金额,分类\n2026-07-15,100,宠物\n2026-07-16,50,餐饮",
    ).entries;

    expect(newCategoriesIn(entries, ["餐饮", "交通"], "expense")).toEqual(["宠物"]);
  });
});

describe("显式指定收支方向", () => {
  const csv = "日期,金额\n2026-07-15,142.50\n2026-07-16,-30.00";

  it("auto：整列有负数就按符号判", () => {
    const result = plan(csv, { kindFallback: "auto" });
    expect(result.entries.map((e) => e.kind)).toEqual(["income", "expense"]);
  });

  it("all-expense：无视符号，一律按支出", () => {
    // 一份全是支出的账单里出现一笔退款，auto 会把其余正数全判成收入。
    // 这个选项让用户能直接纠正，而不是从预览里那些加号自己看出问题。
    const result = plan(csv, { kindFallback: "all-expense" });
    expect(result.entries.map((e) => e.kind)).toEqual(["expense", "expense"]);
  });

  it("by-sign：即使整列没有负数也按符号判", () => {
    const result = plan("日期,金额\n2026-07-15,142.50", {
      kindFallback: "by-sign",
    });
    expect(result.entries[0]?.kind).toBe("income");
  });
});
