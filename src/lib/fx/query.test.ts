import { describe, expect, it } from "vitest";

import { parseFxQuery } from "./query";

const parse = (search: string) => parseFxQuery(new URLSearchParams(search));

function expectOk(search: string) {
  const result = parse(search);
  if (!result.ok) {
    throw new Error(`预期解析成功，实际失败：${JSON.stringify(result.issues)}`);
  }
  return result.query;
}

function expectFail(search: string) {
  const result = parse(search);
  if (result.ok) {
    throw new Error(`预期解析失败，实际成功：${JSON.stringify(result.query)}`);
  }
  return result.issues;
}

describe("parseFxQuery 默认值", () => {
  it("全部省略时给出全部关注币种且不设边界", () => {
    // 裸调用 /api/fx 就能拿到完整数据，前端画图不必先知道有哪些币种。
    expect(expectOk("")).toEqual({
      base: "USD",
      quotes: ["SEK", "THB", "CNY"],
      from: undefined,
      to: undefined,
    });
  });

  it("只给 from 时上界仍为不限", () => {
    const q = expectOk("from=2020-01");
    expect(q.from).toBe("2020-01");
    expect(q.to).toBeUndefined();
  });
});

describe("parseFxQuery 币种", () => {
  it("逗号分隔的多个币种", () => {
    expect(expectOk("quote=SEK,THB").quotes).toEqual(["SEK", "THB"]);
  });

  it("保持调用方给定的顺序", () => {
    // 响应里 series 的顺序与之一致，图表的图例顺序才可预期。
    expect(expectOk("quote=CNY,SEK").quotes).toEqual(["CNY", "SEK"]);
  });

  it("去重", () => {
    expect(expectOk("quote=SEK,SEK,THB").quotes).toEqual(["SEK", "THB"]);
  });

  it("容忍逗号周围的空格", () => {
    expect(expectOk("quote=SEK, THB").quotes).toEqual(["SEK", "THB"]);
  });

  it("未跟踪的币种返回失败，而不是放行成空结果", () => {
    // 放行会让调用方拿到 200 空数组，然后怀疑是数据没灌进去，
    // 而真正的问题是币种名写错了。
    expectFail("quote=XXX");
  });

  it("混入一个未跟踪币种也失败", () => {
    expectFail("quote=SEK,XXX");
  });

  it("空字符串失败", () => {
    expectFail("quote=");
  });

  it("小写币种失败", () => {
    expectFail("quote=sek");
  });
});

describe("parseFxQuery 基准币", () => {
  it("显式传 USD 可以", () => {
    expect(expectOk("base=USD").base).toBe("USD");
  });

  it("其他基准币失败", () => {
    // 换基准需要交叉换算，那是另一个设计决定，不该由查询参数悄悄触发。
    expectFail("base=EUR");
  });
});

describe("parseFxQuery 月份", () => {
  it("合法月份", () => {
    const q = expectOk("from=2019-01&to=2026-07");
    expect(q.from).toBe("2019-01");
    expect(q.to).toBe("2026-07");
  });

  it("月份没补零失败", () => {
    expectFail("from=2026-7");
  });

  it("月份越界失败", () => {
    expectFail("from=2026-13");
  });

  it("完整日期失败", () => {
    expectFail("from=2026-01-01");
  });

  it("from 晚于 to 失败", () => {
    expectFail("from=2026-07&to=2019-01");
  });

  it("from 等于 to 可以", () => {
    const q = expectOk("from=2026-07&to=2026-07");
    expect(q.from).toBe("2026-07");
    expect(q.to).toBe("2026-07");
  });

  it("超出已有数据范围的区间仍然是合法查询", () => {
    // 1990 年没有数据，但这是一个合法的问题，答案恰好是空。
    // 该由路由返回 200 空数组，而不是在这里判失败。
    const q = expectOk("from=1990-01&to=1990-12");
    expect(q.from).toBe("1990-01");
  });
});

describe("parseFxQuery 错误信息", () => {
  it("指明是哪个字段出错", () => {
    const issues = expectFail("from=2026-7&quote=XXX");
    const text = JSON.stringify(issues);
    expect(text).toContain("from");
    expect(text).toContain("quote");
  });
});
