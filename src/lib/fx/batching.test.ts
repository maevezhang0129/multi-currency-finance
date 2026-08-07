import { describe, expect, it } from "vitest";

import type { MonthlyAverage } from "./aggregate";
import {
  classifyBatch,
  failBatch,
  planBatches,
  summarize,
  type IngestOutcome,
} from "./batching";

const index = (rates: MonthlyAverage[]) =>
  new Map(rates.map((r) => [`${r.month}|${r.quote}`, r]));

describe("planBatches", () => {
  it("整除时均分", () => {
    expect(planBatches(["a", "b", "c", "d"], 2)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("除不尽时最后一批是余数", () => {
    expect(planBatches(["a", "b", "c"], 2)).toEqual([["a", "b"], ["c"]]);
  });

  it("批次大于总数时只有一批", () => {
    expect(planBatches(["a", "b"], 60)).toEqual([["a", "b"]]);
  });

  it("空输入返回空数组", () => {
    expect(planBatches([], 60)).toEqual([]);
  });

  it("91 个月按 60 分成两批 —— 实际回填区间走的就是这条", () => {
    const months = Array.from({ length: 91 }, (_, i) => `m${i}`);
    const batches = planBatches(months, 60);
    expect(batches.map((b) => b.length)).toEqual([60, 31]);
    // 不能漏也不能重
    expect(batches.flat()).toEqual(months);
  });

  it("批次大小非法时抛错而不是死循环", () => {
    // size 为 0 会让 for 循环永远不前进。
    expect(() => planBatches(["a"], 0)).toThrow(/必须为正整数/);
  });
});

describe("classifyBatch", () => {
  const quotes = ["SEK", "CNY"];

  it("有数据的记 written 并产出待写入行", () => {
    const { rows, outcomes } = classifyBatch(
      "USD",
      quotes,
      ["2026-07"],
      index([
        { month: "2026-07", quote: "SEK", rate: 9.5, observations: 22 },
        { month: "2026-07", quote: "CNY", rate: 6.8, observations: 22 },
      ]),
      "test-source",
    );

    expect(rows).toEqual([
      {
        baseCurrency: "USD",
        quoteCurrency: "SEK",
        month: "2026-07",
        rate: "9.5000000000",
        source: "test-source",
      },
      {
        baseCurrency: "USD",
        quoteCurrency: "CNY",
        month: "2026-07",
        rate: "6.8000000000",
        source: "test-source",
      },
    ]);
    expect(summarize(outcomes)).toEqual({ written: 2, skipped: 0, failed: 0 });
  });

  it("rate 按 numeric(20,10) 的小数位格式化成字符串", () => {
    const { rows } = classifyBatch(
      "USD",
      ["SEK"],
      ["2026-07"],
      index([{ month: "2026-07", quote: "SEK", rate: 9.674565217391, observations: 23 }]),
      "s",
    );
    expect(rows[0]?.rate).toBe("9.6745652174");
  });

  it("缺数据的记 skipped，不是 failed", () => {
    // CNY 早于 2005 年就是没有数据。这是事实不是故障——混为一谈会让
    // 真正的故障淹没在噪音里。
    const { rows, outcomes } = classifyBatch(
      "USD",
      quotes,
      ["2001-05"],
      index([{ month: "2001-05", quote: "SEK", rate: 10, observations: 21 }]),
      "s",
    );

    expect(rows).toHaveLength(1);
    expect(summarize(outcomes)).toEqual({ written: 1, skipped: 1, failed: 0 });
    const skipped = outcomes.find((o) => o.status === "skipped");
    expect(skipped).toMatchObject({ month: "2001-05", quote: "CNY" });
  });

  it("整批无数据时不产出任何待写入行", () => {
    const { rows, outcomes } = classifyBatch("USD", quotes, ["1990-01"], index([]), "s");
    expect(rows).toEqual([]);
    expect(summarize(outcomes)).toEqual({ written: 0, skipped: 2, failed: 0 });
  });

  it("每个 (月份, 币种) 都有且只有一条结果", () => {
    const months = ["2026-05", "2026-06", "2026-07"];
    const { outcomes } = classifyBatch("USD", quotes, months, index([]), "s");
    expect(outcomes).toHaveLength(months.length * quotes.length);
    expect(new Set(outcomes.map((o) => `${o.month}|${o.quote}`)).size).toBe(6);
  });
});

describe("failBatch", () => {
  it("整批失败时每个组合都记 failed 并带上原因", () => {
    const outcomes = failBatch(["SEK", "CNY"], ["2026-06", "2026-07"], "TimeoutError: 超时");

    expect(summarize(outcomes)).toEqual({ written: 0, skipped: 0, failed: 4 });
    // 原因必须原样带上，否则日志里只剩「失败了」，排查没有方向。
    for (const o of outcomes) {
      expect(o).toMatchObject({ status: "failed", error: "TimeoutError: 超时" });
    }
  });
});

describe("summarize", () => {
  it("三态分别计数", () => {
    const outcomes: IngestOutcome[] = [
      { status: "written", month: "2026-07", quote: "SEK", rate: "9.5", observations: 22 },
      { status: "skipped", month: "2001-05", quote: "CNY", reason: "无数据" },
      { status: "failed", month: "2026-06", quote: "THB", error: "boom" },
      { status: "failed", month: "2026-06", quote: "SEK", error: "boom" },
    ];

    expect(summarize(outcomes)).toEqual({ written: 1, skipped: 1, failed: 2 });
  });

  it("空清单全为 0", () => {
    expect(summarize([])).toEqual({ written: 0, skipped: 0, failed: 0 });
  });
});
