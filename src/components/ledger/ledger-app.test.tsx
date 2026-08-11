/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LedgerApp } from "./ledger-app";

/**
 * 集成测试：按用户的操作路径走，不碰任何内部函数。
 *
 * 为什么需要这一层——项目里已经有两百多个纯函数测试，覆盖得很好，但它们测的是
 * 「算得对不对」，不是「接得通不通」。今天发现的那个 bug 就是明证：保存失败时
 * 浮层照常关闭、界面装作一切正常，而所有单元测试都是绿的。
 *
 * 所以这里的每一条都对应一件**用户真的会做的事**，断言的也是他真的会看到的东西。
 */

const RATES = {
  base: "USD",
  from: "2026-07",
  to: "2026-07",
  series: [
    { quote: "SEK", points: [{ month: "2026-07", rate: "10.0000000000" }] },
    { quote: "THB", points: [{ month: "2026-07", rate: "33.0000000000" }] },
    { quote: "CNY", points: [] },
  ],
};

function stubRates(response: unknown = RATES, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: async () => response,
    }),
  );
}

/** 一份已经选好本币、带若干条记录的账本。 */
function seed(entries: unknown[] = []) {
  localStorage.setItem(
    "mcf.settings",
    JSON.stringify({
      version: 2,
      homeCurrency: "SEK",
      categories: { expense: ["餐饮", "交通", "其他"], income: ["工资"] },
    }),
  );
  localStorage.setItem(
    "mcf.ledger",
    JSON.stringify({ version: 1, entries }),
  );
}

const entry = (over: Record<string, unknown> = {}) => ({
  id: "seeded-1",
  kind: "expense",
  date: "2026-07-15",
  amount: "100.00",
  currency: "SEK",
  category: "餐饮",
  note: "午餐",
  conversion: {
    base: "USD",
    amount: "10.00",
    rate: "10.0000000000",
    rateMonth: "2026-07",
    frozen: true,
  },
  createdAt: "2026-07-15T00:00:00.000Z",
  ...over,
});

function readLedger(): { entries: { amount: string; category: string }[] } {
  return JSON.parse(localStorage.getItem("mcf.ledger") ?? "null") as {
    entries: { amount: string; category: string }[];
  };
}

beforeEach(() => {
  localStorage.clear();
  stubRates();
  // 固定在 2026-07，让「本月」与种子数据同月
  vi.setSystemTime(new Date("2026-07-20T12:00:00Z"));
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  // 显式清理。Testing Library 的自动清理挂在全局 afterEach 上，而 vitest
  // 配置里 globals 是 false（不想为两百多个纯函数测试引入全局注入），
  // 所以这里要自己调——不调的话，下一个测试渲染出的是第二份组件，
  // 所有查询都会报「找到多个元素」。
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("首次使用", () => {
  it("先问本币，选完才进入账本", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LedgerApp />);

    await screen.findByRole("heading", { name: /你平时用哪种货币/ });
    await user.click(screen.getByRole("button", { name: "SEK" }));

    // 选完立刻进入账本，并且本币生效
    await screen.findByRole("button", { name: "记一笔" });
    expect(screen.getByText("SEK")).toBeInTheDocument();
  });
});

describe("记一笔", () => {
  it("填金额选分类保存后，记录出现在页面上并写进了存储", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seed();
    render(<LedgerApp />);

    await user.click(await screen.findByRole("button", { name: "记一笔" }));

    const dialog = await screen.findByRole("dialog", { name: "记一笔" });
    await user.type(within(dialog).getByLabelText("金额"), "142.50");
    await user.click(within(dialog).getByRole("button", { name: "交通" }));
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    // 用户看得到：金额会同时出现在英雄数字、分类条和记录行三处，
    // 所以断言那一行记录本身，而不是文本——那才是「记录出现了」的准确含义。
    await screen.findByRole("button", { name: /142\.50/ });
    // 也真的存下来了
    expect(readLedger().entries).toHaveLength(1);
    expect(readLedger().entries[0]).toMatchObject({
      amount: "142.50",
      category: "交通",
    });
  });

  it("金额没填时保存按钮不可点", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seed();
    render(<LedgerApp />);

    await user.click(await screen.findByRole("button", { name: "记一笔" }));
    const dialog = await screen.findByRole("dialog", { name: "记一笔" });
    expect(within(dialog).getByRole("button", { name: "保存" })).toBeDisabled();
  });

  it("重新打开浮层时，上一笔的金额不会留在输入框里", async () => {
    // 「看起来已经填好了」是最容易让人误记一笔的状态。
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seed();
    render(<LedgerApp />);

    await user.click(await screen.findByRole("button", { name: "记一笔" }));
    let dialog = await screen.findByRole("dialog", { name: "记一笔" });
    await user.type(within(dialog).getByLabelText("金额"), "99");
    await user.click(within(dialog).getByRole("button", { name: "取消" }));

    await user.click(screen.getByRole("button", { name: "记一笔" }));
    dialog = await screen.findByRole("dialog", { name: "记一笔" });
    expect(within(dialog).getByLabelText("金额")).toHaveValue("");
  });
});

describe("编辑与删除", () => {
  it("点已有记录能改金额，改完页面和存储都更新", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seed([entry()]);
    render(<LedgerApp />);

    await user.click(await screen.findByRole("button", { name: /午餐/ }));
    const dialog = await screen.findByRole("dialog", { name: "记一笔" });

    const amount = within(dialog).getByLabelText("金额");
    await user.clear(amount);
    await user.type(amount, "250");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(readLedger().entries[0]?.amount).toBe("250");
    });
    // 编辑而不是新增
    expect(readLedger().entries).toHaveLength(1);
  });

  it("删除后记录从存储里消失", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seed([entry()]);
    render(<LedgerApp />);

    await user.click(await screen.findByRole("button", { name: /午餐/ }));
    const dialog = await screen.findByRole("dialog", { name: "记一笔" });
    await user.click(within(dialog).getByRole("button", { name: "删除这笔" }));

    await waitFor(() => {
      expect(readLedger().entries).toHaveLength(0);
    });
  });
});

describe("保存失败不能是静默的", () => {
  it("写入失败时提示用户、保留浮层、不丢已填内容", async () => {
    /*
     * 这条测试锁住的是一个真实发生过的 bug：保存抛异常后，浮层照常关闭、
     * 界面装作一切正常，用户以为记上了其实没有。
     *
     * 根因是 React 的 error boundary 接不住事件处理函数里的异常，所以
     * 保存路径必须自己 try/catch。这里模拟 localStorage 写满。
     */
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    seed();
    render(<LedgerApp />);

    await user.click(await screen.findByRole("button", { name: "记一笔" }));
    const dialog = await screen.findByRole("dialog", { name: "记一笔" });
    await user.type(within(dialog).getByLabelText("金额"), "88");

    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });

    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    // 必须告诉用户
    await screen.findByRole("alert");
    expect(screen.getByText("这一笔没能保存")).toBeInTheDocument();
    expect(screen.getByText(/QuotaExceededError/)).toBeInTheDocument();

    // 浮层保留，刚填的内容还在——不用重填
    expect(screen.getByRole("dialog", { name: "记一笔" })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("金额")).toHaveValue("88");

    setItem.mockRestore();
  });
});

describe("数据损坏时不当作空账本", () => {
  it("显示损坏界面，且不覆盖原始数据", async () => {
    localStorage.setItem("mcf.settings", JSON.stringify({ version: 2, homeCurrency: "SEK", categories: { expense: ["餐饮"], income: ["工资"] } }));
    localStorage.setItem("mcf.ledger", "{ 这不是合法 JSON");
    render(<LedgerApp />);

    await screen.findByText("账本数据读不出来");
    // 原始数据必须原样保留，用户还要靠它救数据
    expect(localStorage.getItem("mcf.ledger")).toBe("{ 这不是合法 JSON");
    // 刻意不提供「清空重来」
    expect(screen.queryByRole("button", { name: /清空/ })).toBeNull();
  });
});

describe("汇率取不到时仍然能记账", () => {
  it("提示汇率不可用，但记账不受阻塞", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    stubRates(null, false);
    seed();
    render(<LedgerApp />);

    await screen.findByText(/汇率数据暂时取不到/);

    await user.click(screen.getByRole("button", { name: "记一笔" }));
    const dialog = await screen.findByRole("dialog", { name: "记一笔" });
    await user.type(within(dialog).getByLabelText("金额"), "60");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(readLedger().entries).toHaveLength(1);
    });
    // 折算暂时为空，之后由 refreshConversions 补上
    expect(readLedger().entries[0]).toMatchObject({ conversion: null });
  });
});
