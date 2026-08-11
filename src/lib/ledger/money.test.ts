import { describe, expect, it } from "vitest";

import { divide, multiply, sum } from "./money";

describe("multiply", () => {
  it("基本乘法", () => {
    expect(multiply("100.00", "9.50")).toBe("950.00");
  });

  it("按汇率折算的真实例子", () => {
    // 1250 THB，汇率 1 USD = 33.5097826087 THB
    expect(divide("1250.00", "33.5097826087")).toBe("37.30");
  });

  it("浮点会算错的那些例子，这里必须算对", () => {
    // 0.1 * 3 在浮点里是 0.30000000000000004
    expect(multiply("0.10", "3")).toBe("0.30");
    // 1.005 * 100 在浮点里是 100.49999999999999，四舍五入会少一分
    expect(multiply("1.005", "100", 2)).toBe("100.50");
  });

  it("四舍五入按半进位", () => {
    expect(multiply("1", "0.125", 2)).toBe("0.13");
    expect(multiply("1", "0.124", 2)).toBe("0.12");
    // 正好落在一半上要进位
    expect(multiply("1", "0.005", 2)).toBe("0.01");
  });

  it("结果位数不足时补零", () => {
    expect(multiply("2", "3")).toBe("6.00");
  });

  it("大金额不会溢出", () => {
    // JS number 在 2^53 之后就开始丢整数精度，BigInt 不会
    expect(multiply("99999999999999.99", "2")).toBe("199999999999999.98");
  });

  it("非法输入抛错而不是返回 NaN", () => {
    expect(() => multiply("abc", "1")).toThrow(/不是合法的十进制数字/);
  });
});

describe("divide", () => {
  it("基本除法", () => {
    expect(divide("100.00", "4")).toBe("25.00");
  });

  it("除不尽时四舍五入", () => {
    expect(divide("100.00", "3")).toBe("33.33");
    expect(divide("200.00", "3")).toBe("66.67");
  });

  it("汇率折算：SEK 换 USD", () => {
    // 142 SEK，1 USD = 9.6745652174 SEK
    expect(divide("142.00", "9.6745652174")).toBe("14.68");
  });

  it("汇率为 0 时抛错，不产生 Infinity", () => {
    expect(() => divide("100", "0")).toThrow(/汇率不能为 0/);
  });
});

describe("sum", () => {
  it("累加多笔", () => {
    expect(sum(["142.00", "890.00", "63.50"])).toBe("1095.50");
  });

  it("空数组是 0", () => {
    expect(sum([])).toBe("0.00");
  });

  it("小数位不同的金额能正确对齐", () => {
    expect(sum(["1", "0.5", "0.25"])).toBe("1.75");
  });

  it("大量小额累加不会积累误差", () => {
    // 0.1 加一百次，浮点会得到 9.99999999999998
    expect(sum(Array.from({ length: 100 }, () => "0.10"))).toBe("10.00");
  });
});
