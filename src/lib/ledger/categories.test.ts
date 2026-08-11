import { describe, expect, it } from "vitest";

import {
  addCategory,
  moveCategory,
  orphanCategories,
  removeCategory,
  renameCategory,
  usageCount,
} from "./categories";
import type { CategorySet, Entry } from "./types";

const set = (): CategorySet => ({
  expense: ["餐饮", "交通", "住房"],
  income: ["工资", "奖金"],
});

let seq = 0;
const entry = (over: Partial<Entry> = {}): Entry => ({
  id: `e${(seq += 1)}`,
  kind: "expense",
  date: "2026-08-10",
  amount: "100.00",
  currency: "SEK",
  category: "餐饮",
  conversion: null,
  createdAt: "2026-08-10T00:00:00.000Z",
  ...over,
});

describe("addCategory", () => {
  it("加到列表末尾", () => {
    const r = addCategory(set(), "expense", "宠物");
    expect(r.ok && r.categories.expense).toEqual(["餐饮", "交通", "住房", "宠物"]);
  });

  it("不影响另一种收支的列表", () => {
    const r = addCategory(set(), "expense", "宠物");
    expect(r.ok && r.categories.income).toEqual(["工资", "奖金"]);
  });

  it("重名被拒绝", () => {
    const r = addCategory(set(), "expense", "餐饮");
    expect(r).toEqual({ ok: false, reason: "已经有「餐饮」了" });
  });

  it("首尾空格会被去掉，据此判定重名", () => {
    // 不归一化的话，「餐饮 」会被当成一个新分类，界面上出现两个看起来一样的选项。
    const r = addCategory(set(), "expense", "  餐饮  ");
    expect(r.ok).toBe(false);
  });

  it("空名字被拒绝", () => {
    expect(addCategory(set(), "expense", "   ").ok).toBe(false);
  });

  it("过长的名字被拒绝", () => {
    expect(addCategory(set(), "expense", "一二三四五六七八九十十一十二十三").ok).toBe(
      false,
    );
  });
});

describe("removeCategory", () => {
  it("从列表移除", () => {
    const r = removeCategory(set(), "expense", "交通");
    expect(r.ok && r.categories.expense).toEqual(["餐饮", "住房"]);
  });

  it("删掉还在用的分类是允许的，已有记录不受影响", () => {
    // 记录里存的是名字而不是引用，所以删除不会制造孤儿数据。
    const entries = [entry({ category: "交通" })];
    const r = removeCategory(set(), "expense", "交通");
    expect(r.ok).toBe(true);
    expect(entries[0]?.category).toBe("交通");
  });

  it("不能删到一个不剩", () => {
    const only: CategorySet = { expense: ["餐饮"], income: ["工资"] };
    expect(removeCategory(only, "expense", "餐饮")).toEqual({
      ok: false,
      reason: "至少要保留一个分类",
    });
  });

  it("删不存在的分类会明确报错", () => {
    expect(removeCategory(set(), "expense", "不存在").ok).toBe(false);
  });
});

describe("renameCategory", () => {
  it("同时更新列表和已有记录", () => {
    // 只改列表的话，历史记录会停在旧名字上，界面里就同时出现新旧两个分类。
    const entries = [
      entry({ category: "餐饮" }),
      entry({ category: "交通" }),
      entry({ category: "餐饮" }),
    ];
    const r = renameCategory(set(), entries, "expense", "餐饮", "吃饭");

    expect(r.ok && r.categories.expense).toEqual(["吃饭", "交通", "住房"]);
    expect(r.ok && r.entries?.map((e) => e.category)).toEqual([
      "吃饭",
      "交通",
      "吃饭",
    ]);
  });

  it("只改同一种收支的记录", () => {
    const entries = [
      entry({ kind: "expense", category: "其他" }),
      entry({ kind: "income", category: "其他" }),
    ];
    const withOther: CategorySet = {
      expense: ["其他"],
      income: ["其他"],
    };
    const r = renameCategory(withOther, entries, "expense", "其他", "杂项");
    expect(r.ok && r.entries?.map((e) => e.category)).toEqual(["杂项", "其他"]);
  });

  it("改成已存在的名字被拒绝", () => {
    const r = renameCategory(set(), [], "expense", "餐饮", "交通");
    expect(r).toEqual({ ok: false, reason: "已经有「交通」了" });
  });

  it("改成同名是空操作，不报错", () => {
    const r = renameCategory(set(), [], "expense", "餐饮", "餐饮");
    expect(r.ok).toBe(true);
  });
});

describe("moveCategory", () => {
  it("上移", () => {
    const r = moveCategory(set(), "expense", "交通", -1);
    expect(r.ok && r.categories.expense).toEqual(["交通", "餐饮", "住房"]);
  });

  it("下移", () => {
    const r = moveCategory(set(), "expense", "餐饮", 1);
    expect(r.ok && r.categories.expense).toEqual(["交通", "餐饮", "住房"]);
  });

  it("已经在头尾时是空操作，不报错也不越界", () => {
    const r = moveCategory(set(), "expense", "餐饮", -1);
    expect(r.ok && r.categories.expense).toEqual(["餐饮", "交通", "住房"]);
  });
});

describe("usageCount", () => {
  it("统计每个分类被用了多少次", () => {
    const counts = usageCount(
      [
        entry({ category: "餐饮" }),
        entry({ category: "餐饮" }),
        entry({ category: "交通" }),
        entry({ kind: "income", category: "工资" }),
      ],
      "expense",
    );
    expect(counts.get("餐饮")).toBe(2);
    expect(counts.get("交通")).toBe(1);
    expect(counts.get("工资")).toBeUndefined();
  });
});

describe("orphanCategories", () => {
  it("找出记录里有、列表里已经没有的分类", () => {
    // 用户删掉某个分类后，历史记录仍带着它。管理界面必须列出来，
    // 否则统计里会冒出一个「设置里根本没有」的分类，无从解释。
    const orphans = orphanCategories(
      [entry({ category: "餐饮" }), entry({ category: "已删除的分类" })],
      set(),
      "expense",
    );
    expect(orphans).toEqual(["已删除的分类"]);
  });

  it("没有孤儿时返回空数组", () => {
    expect(orphanCategories([entry({ category: "餐饮" })], set(), "expense")).toEqual(
      [],
    );
  });
});
