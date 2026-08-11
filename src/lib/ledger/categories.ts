import type { CategorySet, Entry, EntryKind } from "./types";

/**
 * 分类的增删改。纯函数，输入输出都是新对象，不改动传进来的东西。
 *
 * 这一层要回答的是自定义分类绕不开的三个问题：改名之后已有记录怎么办、
 * 删掉一个还在用的分类会不会留下孤儿数据、重名怎么处理。
 */

/** 归一化：去掉首尾空格。比较是否重名时用它，避免「餐饮」和「餐饮 」被当成两个。 */
function normalize(name: string): string {
  return name.trim();
}

export function categoriesOf(set: CategorySet, kind: EntryKind): string[] {
  return kind === "expense" ? set.expense : set.income;
}

function withKind(
  set: CategorySet,
  kind: EntryKind,
  next: string[],
): CategorySet {
  return kind === "expense"
    ? { ...set, expense: next }
    : { ...set, income: next };
}

export type CategoryResult =
  | { ok: true; categories: CategorySet; entries?: Entry[] }
  | { ok: false; reason: string };

export function addCategory(
  set: CategorySet,
  kind: EntryKind,
  rawName: string,
): CategoryResult {
  const name = normalize(rawName);
  if (name.length === 0) return { ok: false, reason: "分类名不能为空" };
  if (name.length > 12) return { ok: false, reason: "分类名最多 12 个字" };

  const current = categoriesOf(set, kind);
  if (current.includes(name)) return { ok: false, reason: `已经有「${name}」了` };

  return { ok: true, categories: withKind(set, kind, [...current, name]) };
}

/**
 * 删除一个分类。
 *
 * **不检查是否还有记录在用，也不需要检查。** 记录里存的是分类名字，
 * 删掉列表里的条目不会让那些记录失去归属——它们照常显示原来的名字，
 * 只是这个分类不再出现在录入界面的候选里。
 *
 * 唯一的限制是不能删光：一个都不剩的话，下次记账就没有分类可选了。
 */
export function removeCategory(
  set: CategorySet,
  kind: EntryKind,
  name: string,
): CategoryResult {
  const current = categoriesOf(set, kind);
  const next = current.filter((c) => c !== name);

  if (next.length === current.length) {
    return { ok: false, reason: `没有找到「${name}」` };
  }
  if (next.length === 0) {
    return { ok: false, reason: "至少要保留一个分类" };
  }

  return { ok: true, categories: withKind(set, kind, next) };
}

/**
 * 改名，并同步更新所有用了这个名字的记录。
 *
 * 只改列表不改记录的话，历史记录会停在旧名字上，界面上就会同时出现
 * 「餐饮」和「吃饭」两个分类，而用户以为自己只是改了个称呼。
 */
export function renameCategory(
  set: CategorySet,
  entries: readonly Entry[],
  kind: EntryKind,
  from: string,
  rawTo: string,
): CategoryResult {
  const to = normalize(rawTo);
  if (to.length === 0) return { ok: false, reason: "分类名不能为空" };
  if (to.length > 12) return { ok: false, reason: "分类名最多 12 个字" };
  if (to === from) return { ok: true, categories: set, entries: [...entries] };

  const current = categoriesOf(set, kind);
  if (!current.includes(from)) return { ok: false, reason: `没有找到「${from}」` };
  if (current.includes(to)) return { ok: false, reason: `已经有「${to}」了` };

  return {
    ok: true,
    categories: withKind(
      set,
      kind,
      current.map((c) => (c === from ? to : c)),
    ),
    entries: entries.map((e) =>
      e.kind === kind && e.category === from ? { ...e, category: to } : e,
    ),
  };
}

/** 调整顺序。常用的排前面，能少滑一次。 */
export function moveCategory(
  set: CategorySet,
  kind: EntryKind,
  name: string,
  direction: -1 | 1,
): CategoryResult {
  const current = categoriesOf(set, kind);
  const index = current.indexOf(name);
  if (index === -1) return { ok: false, reason: `没有找到「${name}」` };

  const target = index + direction;
  if (target < 0 || target >= current.length) {
    return { ok: true, categories: set };
  }

  const next = [...current];
  const moved = next[index];
  const displaced = next[target];
  // noUncheckedIndexedAccess 下必须收窄，尽管索引已经检查过范围。
  if (moved === undefined || displaced === undefined) {
    return { ok: false, reason: "顺序调整失败" };
  }
  next[index] = displaced;
  next[target] = moved;

  return { ok: true, categories: withKind(set, kind, next) };
}

/**
 * 统计每个分类被多少条记录使用。
 *
 * 界面用它来提示「删掉这个分类不会影响已有的 N 笔记录」——
 * 删除是安全的，但用户需要看到这一点才敢点。
 */
export function usageCount(
  entries: readonly Entry[],
  kind: EntryKind,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== kind) continue;
    counts.set(entry.category, (counts.get(entry.category) ?? 0) + 1);
  }
  return counts;
}

/**
 * 记录里出现过、但已经不在分类列表里的名字。
 *
 * 用户删掉某个分类之后，历史记录仍然带着它。管理界面要把这些列出来，
 * 否则用户会发现统计里冒出一个「设置里根本没有」的分类，无从解释。
 */
export function orphanCategories(
  entries: readonly Entry[],
  set: CategorySet,
  kind: EntryKind,
): string[] {
  const known = new Set(categoriesOf(set, kind));
  const orphans = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === kind && !known.has(entry.category)) {
      orphans.add(entry.category);
    }
  }
  return [...orphans].sort();
}
