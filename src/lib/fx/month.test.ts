import { describe, expect, it } from "vitest";

import {
  addMonths,
  formatMonth,
  isMonth,
  monthOf,
  monthRange,
  monthsBetween,
  parseMonth,
  previousMonth,
} from "./month";

describe("isMonth", () => {
  it("接受合法月份", () => {
    expect(isMonth("2026-01")).toBe(true);
    expect(isMonth("1999-12")).toBe(true);
  });

  it("拒绝没补零和越界的月份", () => {
    // 这几个正是数据库 CHECK 约束会拒绝的形状，前后要一致。
    expect(isMonth("2026-1")).toBe(false);
    expect(isMonth("2026-00")).toBe(false);
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-01-01")).toBe(false);
    expect(isMonth("")).toBe(false);
  });
});

describe("parseMonth", () => {
  it("解析出年和月", () => {
    expect(parseMonth("2026-07")).toEqual({ year: 2026, month: 7 });
  });

  it("格式非法时抛错而不是返回 NaN", () => {
    expect(() => parseMonth("2026-13")).toThrow(/月份格式非法/);
  });
});

describe("formatMonth", () => {
  it("月份补零", () => {
    expect(formatMonth(2026, 7)).toBe("2026-07");
  });
});

describe("addMonths", () => {
  it("同年内加减", () => {
    expect(addMonths("2026-03", 2)).toBe("2026-05");
    expect(addMonths("2026-05", -2)).toBe("2026-03");
  });

  it("跨年进位", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });

  it("跨多年", () => {
    expect(addMonths("2026-06", 25)).toBe("2028-07");
    expect(addMonths("2026-06", -25)).toBe("2024-05");
  });

  it("偏移 0 返回自身", () => {
    expect(addMonths("2026-06", 0)).toBe("2026-06");
  });
});

describe("monthOf / previousMonth", () => {
  it("按 UTC 取月份，不受本地时区影响", () => {
    // 这个时刻在 UTC 是 1 月 1 日，在 UTC-5 却还是去年 12 月 31 日。
    // 用本地时区实现的话这条会挂。
    expect(monthOf(new Date("2026-01-01T02:00:00Z"))).toBe("2026-01");
  });

  it("月初触发时取到的是上一个完整月", () => {
    expect(previousMonth(new Date("2026-01-01T00:05:00Z"))).toBe("2025-12");
    expect(previousMonth(new Date("2026-08-01T00:05:00Z"))).toBe("2026-07");
  });
});

describe("monthRange", () => {
  it("31 天的月份", () => {
    expect(monthRange("2026-07")).toEqual({ start: "2026-07-01", end: "2026-07-31" });
  });

  it("30 天的月份", () => {
    expect(monthRange("2026-04")).toEqual({ start: "2026-04-01", end: "2026-04-30" });
  });

  it("平年 2 月是 28 天", () => {
    expect(monthRange("2026-02").end).toBe("2026-02-28");
  });

  it("闰年 2 月是 29 天", () => {
    expect(monthRange("2024-02").end).toBe("2024-02-29");
  });

  it("百年不闰：1900 年 2 月是 28 天", () => {
    expect(monthRange("1900-02").end).toBe("1900-02-28");
  });

  it("四百年又闰：2000 年 2 月是 29 天", () => {
    expect(monthRange("2000-02").end).toBe("2000-02-29");
  });
});

describe("monthsBetween", () => {
  it("闭区间，含首尾", () => {
    expect(monthsBetween("2026-01", "2026-04")).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
  });

  it("首尾同月时返回单个月", () => {
    expect(monthsBetween("2026-01", "2026-01")).toEqual(["2026-01"]);
  });

  it("跨年", () => {
    expect(monthsBetween("2025-11", "2026-02")).toEqual([
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("起点晚于终点时返回空数组，而不是死循环", () => {
    expect(monthsBetween("2026-05", "2026-01")).toEqual([]);
  });
});
