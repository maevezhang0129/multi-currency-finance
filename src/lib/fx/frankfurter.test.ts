import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchDailyRates, FxFetchError } from "./frankfurter";

/** 不真的等待，否则重试测试要跑几十秒。 */
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
    "2026-07-02": { SEK: 9.718, THB: 33.4 },
    "2026-07-01": { SEK: 9.7474, THB: 33.2 },
    "2026-07-03": { SEK: 9.6362, THB: 33.3 },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchDailyRates", () => {
  it("解析出每日观测值并按日期升序排列", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(validPayload)));

    const daily = await fetchDailyRates(
      "USD",
      ["SEK", "THB"],
      "2026-07-01",
      "2026-07-31",
      { sleep: noSleep },
    );

    expect(daily.map((d) => d.date)).toEqual([
      "2026-07-01",
      "2026-07-02",
      "2026-07-03",
    ]);
    expect(daily[0]?.rates).toEqual({ SEK: 9.7474, THB: 33.2 });
  });

  it("一次请求带上全部币种，而不是每个币种一个请求", async () => {
    // 这是本模块的核心约束：接口对连续快速请求是静默丢弃的，
    // 请求数必须压到个位数。
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(validPayload));
    vi.stubGlobal("fetch", fetchMock);

    await fetchDailyRates("USD", ["SEK", "THB", "CNY"], "2026-07-01", "2026-07-31", {
      sleep: noSleep,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain("2026-07-01..2026-07-31");
    expect(url).toContain("symbols=SEK%2CTHB%2CCNY");
  });

  it("丢弃请求区间之外的日期", async () => {
    // 实测：请求 2019-01-01 起，接口会把 2018-12-31 也带回来。
    // 不丢掉的话 2018-12 会凭一条观测值算出一个假的月均值。
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          ...validPayload,
          rates: {
            "2026-06-30": { SEK: 9.9 },
            "2026-07-01": { SEK: 9.7474 },
            "2026-08-01": { SEK: 9.5 },
          },
        }),
      ),
    );

    const daily = await fetchDailyRates("USD", ["SEK"], "2026-07-01", "2026-07-31", {
      sleep: noSleep,
    });

    expect(daily.map((d) => d.date)).toEqual(["2026-07-01"]);
  });

  it("空 rates 返回空数组，不当作错误", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ...validPayload, rates: {} })),
    );

    await expect(
      fetchDailyRates("USD", ["CNY"], "2001-05-01", "2001-05-31", {
        sleep: noSleep,
      }),
    ).resolves.toEqual([]);
  });

  it("5xx 会重试，成功后返回结果", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: "boom" }, 503))
      .mockResolvedValueOnce(jsonResponse(validPayload));
    vi.stubGlobal("fetch", fetchMock);

    const daily = await fetchDailyRates(
      "USD",
      ["SEK"],
      "2026-07-01",
      "2026-07-31",
      { sleep: noSleep },
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(daily).toHaveLength(3);
  });

  it("4xx 不重试，直接抛错", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchDailyRates("USD", ["XXX"], "2026-07-01", "2026-07-31", {
        sleep: noSleep,
      }),
    ).rejects.toThrow(FxFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("超时会重试，且错误信息里说清是超时", async () => {
    // 限流表现为超时而非 429，错误信息必须让人看懂发生了什么。
    const timeout = new DOMException("The operation was aborted", "TimeoutError");
    const fetchMock = vi.fn().mockRejectedValue(timeout);
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchDailyRates("USD", ["SEK"], "2026-07-01", "2026-07-31", {
        attempts: 2,
        sleep: noSleep,
      }),
    ).rejects.toThrow(/超时/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("网络错误的信息里带上底层原因", async () => {
    // 早先版本只说「请求失败」，根因被吞掉，日志等于没记。
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed: ECONNRESET")),
    );

    await expect(
      fetchDailyRates("USD", ["SEK"], "2026-07-01", "2026-07-31", {
        attempts: 1,
        sleep: noSleep,
      }),
    ).rejects.toThrow(/ECONNRESET/);
  });

  it("退避间隔按 2 的幂增长", async () => {
    const waits: number[] = [];
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("down")));

    await expect(
      fetchDailyRates("USD", ["SEK"], "2026-07-01", "2026-07-31", {
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
      fetchDailyRates("USD", ["SEK"], "2026-07-01", "2026-07-31", {
        sleep: noSleep,
      }),
    ).rejects.toThrow(/结构不符合预期/);
  });

  it("返回的基准币与请求不符时抛错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ ...validPayload, base: "EUR" })),
    );

    await expect(
      fetchDailyRates("USD", ["SEK"], "2026-07-01", "2026-07-31", {
        sleep: noSleep,
      }),
    ).rejects.toThrow(/基准币是 EUR/);
  });
});
