import { describe, expect, it } from "vitest";

import type { FxResponse } from "../fx/api-types";
import {
  buildRateIndex,
  convertToBase,
  needsRefreeze,
  refreshConversions,
} from "./convert";
import type { Entry } from "./types";

const response: FxResponse = {
  base: "USD",
  from: "2026-05",
  to: "2026-07",
  series: [
    {
      quote: "SEK",
      points: [
        { month: "2026-05", rate: "9.4000000000" },
        { month: "2026-06", rate: "9.5124363636" },
        { month: "2026-07", rate: "9.6745652174" },
      ],
    },
    {
      quote: "THB",
      points: [{ month: "2026-07", rate: "33.5097826087" }],
    },
    // 一个币种一条数据都没有，模拟历史起点较晚的情况
    { quote: "CNY", points: [] },
  ],
};

const rates = buildRateIndex(response);
const NOW = new Date("2026-08-11T00:00:00Z");

const convert = (amount: string, currency: string, date: string) =>
  convertToBase({ amount, currency, date, base: "USD", rates, now: NOW });

describe("buildRateIndex", () => {
  it("按币种记住最近可得的月份", () => {
    expect(rates.latestByCurrency.get("SEK")).toEqual({
      month: "2026-07",
      rate: "9.6745652174",
    });
  });

  it("没有数据的币种不会出现在索引里", () => {
    expect(rates.latestByCurrency.get("CNY")).toBeUndefined();
  });
});

describe("已结束月份：用当月汇率并冻结", () => {
  it("折算正确且 frozen 为 true", () => {
    const result = convert("142.00", "SEK", "2026-07-15");
    expect(result).toEqual({
      base: "USD",
      amount: "14.68",
      rate: "9.6745652174",
      rateMonth: "2026-07",
      frozen: true,
    });
  });

  it("同一笔在不同时间折算，结果完全一样", () => {
    // 「历史不会变」的核心含义：折算只取决于交易发生月，与何时录入无关。
    const a = convertToBase({
      amount: "142.00", currency: "SEK", date: "2026-06-15",
      base: "USD", rates, now: new Date("2026-07-01T00:00:00Z"),
    });
    const b = convertToBase({
      amount: "142.00", currency: "SEK", date: "2026-06-15",
      base: "USD", rates, now: new Date("2027-01-01T00:00:00Z"),
    });
    expect(a).toEqual(b);
  });
});

describe("当月：临时折算，不冻结", () => {
  it("本月还没有汇率时，退回到最近可得的那个月", () => {
    // 今天是 2026-08-11，8 月均值要到 9 月初才有。
    const result = convert("142.00", "SEK", "2026-08-05");
    expect(result?.rateMonth).toBe("2026-07");
    expect(result?.frozen).toBe(false);
    expect(result?.amount).toBe("14.68");
  });

  it("临时折算的月份与交易月份不同，界面据此可以标明", () => {
    const result = convert("100.00", "SEK", "2026-08-05");
    expect(result?.rateMonth).not.toBe("2026-08");
  });
});

describe("基准币本身", () => {
  it("不需要汇率，直接恒等且冻结", () => {
    const result = convert("50.00", "USD", "2026-08-05");
    expect(result).toEqual({
      base: "USD",
      amount: "50.00",
      rate: "1",
      rateMonth: "2026-08",
      frozen: true,
    });
  });
});

describe("拿不到汇率", () => {
  it("返回 null，而不是编一个数", () => {
    // CNY 一条数据都没有。宁可显示「待折算」，也不能给一个看起来像真的的错数。
    expect(convert("100.00", "CNY", "2026-07-15")).toBeNull();
  });
});

describe("needsRefreeze", () => {
  it("已冻结的永不重算", () => {
    const frozen = {
      base: "USD", amount: "14.68", rate: "9.67", rateMonth: "2026-07", frozen: true,
    };
    expect(needsRefreeze("2026-07-15", frozen, rates, "SEK")).toBe(false);
  });

  it("临时折算且所属月份汇率已入库时，需要重算", () => {
    const provisional = {
      base: "USD", amount: "14.68", rate: "9.51", rateMonth: "2026-06", frozen: false,
    };
    expect(needsRefreeze("2026-07-15", provisional, rates, "SEK")).toBe(true);
  });

  it("临时折算但所属月份汇率仍未入库时，先不动", () => {
    const provisional = {
      base: "USD", amount: "14.68", rate: "9.67", rateMonth: "2026-07", frozen: false,
    };
    expect(needsRefreeze("2026-08-05", provisional, rates, "SEK")).toBe(false);
  });

  it("完全没折算过的记录需要处理", () => {
    expect(needsRefreeze("2026-07-15", null, rates, "SEK")).toBe(true);
  });
});

describe("refreshConversions", () => {
  const entry = (over: Partial<Entry>): Entry => ({
    id: "x",
    kind: "expense",
    date: "2026-07-15",
    amount: "142.00",
    currency: "SEK",
    category: "餐饮",
    conversion: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    ...over,
  });

  it("把从没折算过的记录补上", () => {
    // 没有这一步，录入时离线的那笔会永远显示「待折算」、永远不计入合计。
    const result = refreshConversions([entry({})], "USD", rates, NOW);
    expect(result?.[0]?.conversion).toMatchObject({
      amount: "14.68",
      rateMonth: "2026-07",
      frozen: true,
    });
  });

  it("把临时折算换成当月真实汇率并冻结", () => {
    const provisional = entry({
      date: "2026-07-15",
      conversion: {
        base: "USD", amount: "15.11", rate: "9.4000000000",
        rateMonth: "2026-05", frozen: false,
      },
    });
    const result = refreshConversions([provisional], "USD", rates, NOW);
    expect(result?.[0]?.conversion).toMatchObject({
      rate: "9.6745652174",
      rateMonth: "2026-07",
      frozen: true,
    });
  });

  it("已冻结的记录一个字都不动", () => {
    const frozen = entry({
      conversion: {
        base: "USD", amount: "99.99", rate: "1.0000000000",
        rateMonth: "2026-07", frozen: true,
      },
    });
    expect(refreshConversions([frozen], "USD", rates, NOW)).toBeNull();
  });

  it("没有任何变化时返回 null，避免无谓写库", () => {
    const frozen = entry({
      conversion: {
        base: "USD", amount: "14.68", rate: "9.6745652174",
        rateMonth: "2026-07", frozen: true,
      },
    });
    expect(refreshConversions([frozen], "USD", rates, NOW)).toBeNull();
  });

  it("仍然拿不到汇率时保持原样，不把已有的值抹掉", () => {
    const cny = entry({
      currency: "CNY",
      conversion: {
        base: "USD", amount: "13.99", rate: "7.1000000000",
        rateMonth: "2026-06", frozen: false,
      },
    });
    const result = refreshConversions([cny], "USD", rates, NOW);
    // CNY 没有任何汇率数据，这条不该被改动
    expect(result).toBeNull();
  });
});
