import { afterEach, describe, expect, it, vi } from "vitest";

import {
  averageRate,
  fetchDailyRatesForMonth,
  FxFetchError,
} from "./frankfurter";

/** 不真的等待，否则重试测试要跑好几秒。 */
const noSleep = () => Promise.resolve();

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const validPayload = {
  amount: 1,
  base: "USD",
  start_date: "2026-07-01",
  end_date: "2026-07-31",
  rates: {
    "2026-07-02": { SEK: 9.718 },
    "2026-07-01": { SEK: 9.7474 },
    "2026-07-03": { SEK: 9.6362 },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDailyRatesForMonth", () => {
  it("解析出每日汇率并按日期升序排列", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(validPayload)));

    const daily = await fetchDailyRatesForMonth("USD", "SEK", "2026-07", {
      sleep: noSleep,
    });

    expect(daily.map((d) => d.date)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
    expect(daily[0]?.rate).toBe(9.7474);
  });

  it("请求的区间是整个月", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(validPayload));
    vi.stubGlobal("fetch", fetchMock);

    await fetchDailyRatesForMonth("USD", "SEK", "2026-07", { sleep: noSleep });

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("2026-07-01..2026-07-31");
    expect(url).toContain("base=USD");
    expect(url).toContain("symbols=SEK");
  });

  it("空 rates 返回空数组，不当作错误", async () => {
    // CNY 在 2005 年前没有数据，这是正常情况，调用方跳过该月即可。
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ...validPayload, rates: {} })),
    );

    await expect(
      fetchDailyRatesForMonth("USD", "CNY", "2001-05", { sleep: noSleep }),
    ).resolves.toEqual([]);
  });

  it("5xx 会重试，成功后返回结果", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 503))
      .mockResolvedValueOnce(jsonResponse(validPayload));
    vi.stubGlobal("fetch", fetchMock);

    const daily = await fetchDailyRatesForMonth("USD", "SEK", "2026-07", {
      sleep: noSleep,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(daily).toHaveLength(3);
  });

  it("4xx 不重试，直接抛错", async () => {
    // 重点：请求本身有问题时重试多少次都一样，白白拖长故障时间。
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchDailyRatesForMonth("USD", "XXX", "2026-07", { sleep: noSleep }),
    ).rejects.toThrow(FxFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("网络错误会重试，耗尽次数后抛错", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchDailyRatesForMonth("USD", "SEK", "2026-07", {
        attempts: 3,
        sleep: noSleep,
      }),
    ).rejects.toThrow(/请求汇率接口失败/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("退避间隔按 2 的幂增长", async () => {
    const waits: number[] = [];
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("network down"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchDailyRatesForMonth("USD", "SEK", "2026-07", {
        attempts: 4,
        backoffMs: 100,
        sleep: async (ms) => {
          waits.push(ms);
        },
      }),
    ).rejects.toThrow(FxFetchError);

    expect(waits).toEqual([100, 200, 400]);
  });

  it("结构不符合预期时抛错，而不是放脏数据进来", async () => {
    // 上游把 rate 变成字符串——最典型的悄悄破坏。
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          ...validPayload,
          rates: { "2026-07-01": { SEK: "9.7474" } },
        }),
      ),
    );

    await expect(
      fetchDailyRatesForMonth("USD", "SEK", "2026-07", { sleep: noSleep }),
    ).rejects.toThrow(/结构不符合预期/);
  });

  it("返回的基准币与请求不符时抛错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ...validPayload, base: "EUR" })),
    );

    await expect(
      fetchDailyRatesForMonth("USD", "SEK", "2026-07", { sleep: noSleep }),
    ).rejects.toThrow(/基准币是 EUR/);
  });
});

describe("averageRate", () => {
  it("算术平均", () => {
    expect(
      averageRate([
        { date: "2026-07-01", rate: 10 },
        { date: "2026-07-02", rate: 12 },
        { date: "2026-07-03", rate: 14 },
      ]),
    ).toBe(12);
  });

  it("空数组返回 undefined，而不是 0 或 NaN", () => {
    // 返回 0 会被当成一个真实汇率写进库，是最坏的失败方式。
    expect(averageRate([])).toBeUndefined();
  });

  it("单个观测值就是它自己", () => {
    expect(averageRate([{ date: "2026-07-01", rate: 9.5 }])).toBe(9.5);
  });
});
