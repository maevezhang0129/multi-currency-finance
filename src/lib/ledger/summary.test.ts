import { describe, expect, it } from "vitest";

import type { FxResponse } from "../fx/api-types";
import { buildRateIndex } from "./convert";
import {
  amountInDisplayCurrency,
  changePercent,
  recentEntries,
  summarizeMonth,
} from "./summary";
import type { Entry } from "./types";

const rates = buildRateIndex({
  base: "USD",
  from: "2026-07",
  to: "2026-07",
  series: [
    { quote: "SEK", points: [{ month: "2026-07", rate: "10.0000000000" }] },
    { quote: "THB", points: [{ month: "2026-07", rate: "33.0000000000" }] },
    { quote: "CNY", points: [] },
  ],
} satisfies FxResponse);

let seq = 0;
const entry = (over: Partial<Entry> = {}): Entry => ({
  id: `e${(seq += 1)}`,
  kind: "expense",
  date: "2026-07-10",
  amount: "100.00",
  currency: "SEK",
  category: "餐饮",
  conversion: {
    base: "USD",
    amount: "10.00",
    rate: "10.0000000000",
    rateMonth: "2026-07",
    frozen: true,
  },
  createdAt: "2026-07-10T00:00:00.000Z",
  ...over,
});

describe("amountInDisplayCurrency", () => {
  it("原币就是展示币时原样返回", () => {
    expect(amountInDisplayCurrency(entry(), "SEK", "USD", rates)).toBe("100.00");
  });

  it("展示币是基准币时用存下来的折算值", () => {
    expect(amountInDisplayCurrency(entry(), "USD", "USD", rates)).toBe("10.00");
  });

  it("外币折算到本币：走原币→基准币→本币两段", () => {
    // 330 THB → 10 USD → 100 SEK
    const thb = entry({
      currency: "THB",
      amount: "330.00",
      conversion: {
        base: "USD", amount: "10.00", rate: "33.0000000000",
        rateMonth: "2026-07", frozen: true,
      },
    });
    expect(amountInDisplayCurrency(thb, "SEK", "USD", rates)).toBe("100.00");
  });

  it("没有折算结果时返回 null，不返回 0", () => {
    // 返回 0 会让合计看起来正常，实际少了一笔——这是最难发现的那种错。
    const pending = entry({ currency: "CNY", conversion: null });
    expect(amountInDisplayCurrency(pending, "SEK", "USD", rates)).toBeNull();
  });
});

describe("summarizeMonth", () => {
  it("跨币种的记录先折算再求和", () => {
    const result = summarizeMonth(
      [
        entry({ amount: "100.00", currency: "SEK" }),
        entry({
          amount: "330.00", currency: "THB",
          conversion: {
            base: "USD", amount: "10.00", rate: "33.0000000000",
            rateMonth: "2026-07", frozen: true,
          },
        }),
      ],
      "2026-07", "SEK", "USD", rates,
    );

    expect(result.total).toBe("200.00");
    expect(result.baseTotal).toBe("20.00");
    expect(result.count).toBe(2);
  });

  it("只统计当月", () => {
    const result = summarizeMonth(
      [entry({ date: "2026-07-10" }), entry({ date: "2026-06-30" })],
      "2026-07", "SEK", "USD", rates,
    );
    expect(result.count).toBe(1);
  });

  it("收入不计入支出合计", () => {
    const result = summarizeMonth(
      [entry({ amount: "100.00" }), entry({ kind: "income", amount: "5000.00" })],
      "2026-07", "SEK", "USD", rates,
    );
    expect(result.total).toBe("100.00");
    expect(result.count).toBe(1);
  });

  it("分类按金额降序", () => {
    const result = summarizeMonth(
      [
        entry({ amount: "100.00", category: "餐饮" }),
        entry({ amount: "500.00", category: "住宿" }),
        entry({ amount: "50.00", category: "餐饮" }),
      ],
      "2026-07", "SEK", "USD", rates,
    );
    expect(result.categories).toEqual([
      { category: "住宿", amount: "500.00" },
      { category: "餐饮", amount: "150.00" },
    ]);
  });

  it("如实报告未折算和临时折算的条数", () => {
    const result = summarizeMonth(
      [
        entry(),
        entry({ currency: "CNY", conversion: null }),
        entry({
          conversion: {
            base: "USD", amount: "10.00", rate: "10.0000000000",
            rateMonth: "2026-06", frozen: false,
          },
        }),
      ],
      "2026-07", "SEK", "USD", rates,
    );
    // 合计不完整这件事必须能被界面说出来，不能只给一个看起来正常的数字。
    expect(result.unconvertedCount).toBe(1);
    expect(result.provisionalCount).toBe(1);
  });

  it("没有记录时合计是 0 而不是报错", () => {
    const result = summarizeMonth([], "2026-07", "SEK", "USD", rates);
    expect(result.total).toBe("0.00");
    expect(result.categories).toEqual([]);
  });
});

describe("changePercent", () => {
  it("正常计算", () => {
    expect(changePercent("110.00", "100.00")).toBeCloseTo(10);
  });

  it("下降是负数", () => {
    expect(changePercent("90.00", "100.00")).toBeCloseTo(-10);
  });

  it("上月为 0 时返回 null，不返回 Infinity", () => {
    expect(changePercent("100.00", "0.00")).toBeNull();
  });
});

describe("recentEntries", () => {
  it("按日期倒序并截断", () => {
    const list = recentEntries(
      [
        entry({ date: "2026-07-01" }),
        entry({ date: "2026-07-20" }),
        entry({ date: "2026-07-10" }),
      ],
      2,
    );
    expect(list.map((e) => e.date)).toEqual(["2026-07-20", "2026-07-10"]);
  });
});
