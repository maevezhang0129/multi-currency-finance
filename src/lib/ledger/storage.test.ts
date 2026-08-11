import { describe, expect, it } from "vitest";

import {
  exportRaw,
  loadLedger,
  loadSettings,
  quarantineCorruptLedger,
  saveLedger,
  saveSettings,
  type KeyValueStore,
} from "./storage";
import { emptyLedger, LEDGER_VERSION, type Entry, type Ledger } from "./types";

/** 内存版存储，替代浏览器的 localStorage。 */
function memoryStore(initial: Record<string, string> = {}): KeyValueStore & {
  dump: () => Record<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
    dump: () => Object.fromEntries(data),
  };
}

const validEntry = (overrides: Partial<Entry> = {}): Entry => ({
  id: "e1",
  kind: "expense",
  date: "2026-08-10",
  amount: "142.00",
  currency: "SEK",
  category: "餐饮",
  note: "午餐",
  conversion: {
    base: "USD",
    amount: "14.68",
    rate: "9.6745652174",
    rateMonth: "2026-07",
    frozen: false,
  },
  createdAt: "2026-08-10T12:00:00.000Z",
  ...overrides,
});

const ledgerWith = (...entries: Entry[]): Ledger => ({
  version: LEDGER_VERSION,
  entries,
});

describe("首次使用", () => {
  it("键不存在时是 empty，不是 corrupt", () => {
    // 第一次打开应用走的就是这条路径，它不该被当成错误。
    expect(loadLedger(memoryStore()).status).toBe("empty");
  });
});

describe("存取往返", () => {
  it("写进去再读出来，内容一致", () => {
    const store = memoryStore();
    const ledger = ledgerWith(validEntry());
    saveLedger(store, ledger);

    const result = loadLedger(store);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.value).toEqual(ledger);
  });

  it("空账本也能正常往返", () => {
    const store = memoryStore();
    saveLedger(store, emptyLedger());
    const result = loadLedger(store);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.value.entries).toEqual([]);
  });

  it("金额和汇率读回来仍是字符串，没有被转成 number", () => {
    // 这是精度不丢的关键。一旦某处偷偷 Number() 了，这条会挂。
    const store = memoryStore();
    saveLedger(store, ledgerWith(validEntry({ amount: "0.10" })));
    const result = loadLedger(store);
    if (result.status !== "ok") throw new Error("应当读取成功");
    const entry = result.value.entries[0];
    expect(entry?.amount).toBe("0.10");
    expect(typeof entry?.amount).toBe("string");
    expect(typeof entry?.conversion?.rate).toBe("string");
  });
});

describe("坏数据不能被当成空账本", () => {
  it("不是 JSON 时返回 corrupt 并带上原文", () => {
    const store = memoryStore({ "mcf.ledger": "{ 这不是 json" });
    const result = loadLedger(store);
    expect(result.status).toBe("corrupt");
    if (result.status !== "corrupt") return;
    // 原文必须原样保留——上层要靠它把数据交还给用户。
    expect(result.raw).toBe("{ 这不是 json");
  });

  it("结构不对时返回 corrupt，并说清哪里不对", () => {
    const store = memoryStore({
      "mcf.ledger": JSON.stringify({ version: 1, entries: [{ id: "x" }] }),
    });
    const result = loadLedger(store);
    expect(result.status).toBe("corrupt");
    if (result.status !== "corrupt") return;
    expect(result.message.length).toBeGreaterThan(0);
  });

  it("来自未来版本的数据也算 corrupt，不会被误读", () => {
    // 装作能读懂新版本格式，比明确报错危险得多。
    const store = memoryStore({
      "mcf.ledger": JSON.stringify({ version: 999, entries: [] }),
    });
    expect(loadLedger(store).status).toBe("corrupt");
  });

  it("金额为负数会被拒绝", () => {
    const store = memoryStore({
      "mcf.ledger": JSON.stringify(ledgerWith(validEntry({ amount: "-5.00" }))),
    });
    expect(loadLedger(store).status).toBe("corrupt");
  });

  it("金额小数位过多会被拒绝", () => {
    const store = memoryStore({
      "mcf.ledger": JSON.stringify(ledgerWith(validEntry({ amount: "1.234" }))),
    });
    expect(loadLedger(store).status).toBe("corrupt");
  });

  it("不认识的币种会被拒绝", () => {
    const store = memoryStore({
      "mcf.ledger": JSON.stringify(
        ledgerWith(validEntry({ currency: "XXX" as never })),
      ),
    });
    expect(loadLedger(store).status).toBe("corrupt");
  });

  it("日期没补零会被拒绝", () => {
    const store = memoryStore({
      "mcf.ledger": JSON.stringify(ledgerWith(validEntry({ date: "2026-8-1" }))),
    });
    expect(loadLedger(store).status).toBe("corrupt");
  });
});

describe("写入前自校验", () => {
  it("拒绝写入不合法的数据，而不是默默写坏", () => {
    const store = memoryStore();
    const broken = ledgerWith(validEntry({ amount: "abc" }));
    expect(() => saveLedger(store, broken)).toThrow(/拒绝写入/);
    // 抛错之后不能留下半截数据
    expect(store.getItem("mcf.ledger")).toBeNull();
  });
});

describe("隔离损坏数据", () => {
  it("把原文挪到备份键，主键重置为空账本", () => {
    const raw = "{ 坏掉的数据";
    const store = memoryStore({ "mcf.ledger": raw });

    const backupKey = quarantineCorruptLedger(
      store,
      raw,
      new Date("2026-08-11T09:00:00.000Z"),
    );

    // 损坏的数据仍然是用户的数据，不能直接删——里面可能有能人工救回来的记录。
    expect(store.getItem(backupKey)).toBe(raw);
    expect(backupKey).toContain("2026-08-11");
    expect(loadLedger(store).status).toBe("ok");
  });
});

describe("设置", () => {
  it("往返正常", () => {
    const store = memoryStore();
    saveSettings(store, {
      version: 2,
      homeCurrency: "SEK",
      categories: { expense: ["餐饮"], income: ["工资"] },
    });
    const result = loadSettings(store);
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.value.homeCurrency).toBe("SEK");
  });

  it("v1 的旧设置会被升级，而不是判成损坏", () => {
    // 版本号存在的意义就在这里。判成损坏的话，用户会被要求重新选一次本币——
    // 一个纯粹由我们改结构造成的麻烦，不该让他承担。
    const store = memoryStore({
      "mcf.settings": JSON.stringify({ version: 1, homeCurrency: "THB" }),
    });
    const result = loadSettings(store);

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    // 他之前选的本币原样保留
    expect(result.value.homeCurrency).toBe("THB");
    expect(result.value.version).toBe(2);
    // 分类补上默认值
    expect(result.value.categories.expense.length).toBeGreaterThan(5);
    expect(result.value.categories.income).toContain("工资");
  });

  it("既不是 v2 也不是 v1 时才判成损坏", () => {
    const store = memoryStore({
      "mcf.settings": JSON.stringify({ version: 99, homeCurrency: "SEK" }),
    });
    expect(loadSettings(store).status).toBe("corrupt");
  });

  it("分类不能为空数组", () => {
    const store = memoryStore({
      "mcf.settings": JSON.stringify({
        version: 2,
        homeCurrency: "SEK",
        categories: { expense: [], income: ["工资"] },
      }),
    });
    expect(loadSettings(store).status).toBe("corrupt");
  });

  it("不认识的本币会被拒绝", () => {
    const store = memoryStore({
      "mcf.settings": JSON.stringify({
        version: 2,
        homeCurrency: "JPY",
        categories: { expense: ["餐饮"], income: ["工资"] },
      }),
    });
    expect(loadSettings(store).status).toBe("corrupt");
  });
});

describe("导出", () => {
  it("导出的是原始字符串，即使数据是坏的也能带走", () => {
    // 数据坏了恰恰是最需要导出的时候。
    const store = memoryStore({ "mcf.ledger": "{ 坏的" });
    const dump = JSON.parse(exportRaw(store)) as Record<string, unknown>;
    expect(dump.ledger).toBe("{ 坏的");
    expect(dump.settings).toBeNull();
    expect(typeof dump.exportedAt).toBe("string");
  });
});

describe("账本版本迁移", () => {
  it("当前版本正常读取", () => {
    const store = memoryStore({
      "mcf.ledger": JSON.stringify(ledgerWith(validEntry())),
    });
    expect(loadLedger(store).status).toBe("ok");
  });

  it("不认识的版本仍判为 corrupt，绝不猜着读", () => {
    // 装作能读懂一个不认识的格式，比明确报错危险得多：前者会静默改写用户的
    // 财务记录，后者只是显示一条错误，而原始数据还在。
    const store = memoryStore({
      "mcf.ledger": JSON.stringify({ version: 7, entries: [] }),
    });
    const result = loadLedger(store);
    expect(result.status).toBe("corrupt");
    if (result.status !== "corrupt") return;
    // 原文必须保留，用户还要靠它救数据
    expect(result.raw).toContain('"version":7');
  });

  it("迁移路径上出问题时，返回的仍是原始的 corrupt 结果", () => {
    const store = memoryStore({ "mcf.ledger": "{ 根本不是 JSON" });
    expect(loadLedger(store).status).toBe("corrupt");
  });
});
