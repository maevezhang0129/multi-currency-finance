import { describe, expect, it } from "vitest";

import { monthlyAverages } from "./aggregate";
import type { DailyObservation } from "./frankfurter";

describe("monthlyAverages", () => {
  it("按月按币种取算术平均", () => {
    const observations: DailyObservation[] = [
      { date: "2026-07-01", rates: { SEK: 10, THB: 30 } },
      { date: "2026-07-02", rates: { SEK: 12, THB: 32 } },
      { date: "2026-07-03", rates: { SEK: 14, THB: 34 } },
    ];

    expect(monthlyAverages(observations)).toEqual([
      { month: "2026-07", quote: "SEK", rate: 12, observations: 3 },
      { month: "2026-07", quote: "THB", rate: 32, observations: 3 },
    ]);
  });

  it("跨月份分组，互不混淆", () => {
    const observations: DailyObservation[] = [
      { date: "2026-06-30", rates: { SEK: 100 } },
      { date: "2026-07-01", rates: { SEK: 10 } },
      { date: "2026-07-02", rates: { SEK: 20 } },
    ];

    expect(monthlyAverages(observations)).toEqual([
      { month: "2026-06", quote: "SEK", rate: 100, observations: 1 },
      { month: "2026-07", quote: "SEK", rate: 15, observations: 2 },
    ]);
  });

  it("某个币种在部分日期缺失时，只按它实际出现的天数平均", () => {
    // CNY 在早期数据里就是这样：SEK 有值而 CNY 没有。
    // 若按总天数平均会把结果压低，是一个很难被发现的错误。
    const observations: DailyObservation[] = [
      { date: "2026-07-01", rates: { SEK: 10, CNY: 7 } },
      { date: "2026-07-02", rates: { SEK: 20 } },
    ];

    expect(monthlyAverages(observations)).toEqual([
      { month: "2026-07", quote: "CNY", rate: 7, observations: 1 },
      { month: "2026-07", quote: "SEK", rate: 15, observations: 2 },
    ]);
  });

  it("空输入返回空数组", () => {
    expect(monthlyAverages([])).toEqual([]);
  });

  it("结果按 (月份, 币种) 稳定排序", () => {
    const observations: DailyObservation[] = [
      { date: "2026-08-01", rates: { THB: 33, CNY: 7 } },
      { date: "2026-07-01", rates: { SEK: 10 } },
    ];

    expect(monthlyAverages(observations).map((a) => `${a.month}|${a.quote}`)).toEqual([
      "2026-07|SEK",
      "2026-08|CNY",
      "2026-08|THB",
    ]);
  });
});
