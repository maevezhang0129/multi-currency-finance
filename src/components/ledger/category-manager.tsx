"use client";

import { useState } from "react";

import {
  addCategory,
  moveCategory,
  orphanCategories,
  removeCategory,
  renameCategory,
} from "@/lib/ledger/categories";
import { usageCount } from "@/lib/ledger/categories";
import type { CategorySet, Entry, EntryKind } from "@/lib/ledger/types";

/**
 * 分类管理。
 *
 * 一条贯穿的设计：**删除分类是安全的，界面要让用户看到这一点。**
 * 记录里存的是分类名字而不是引用，删掉一个分类不会让任何记录失去归属。
 * 但用户不知道这件事，所以每个分类旁边写着「N 笔在用」，删除时也说明后果。
 */
export function CategoryManager({
  categories,
  entries,
  onChange,
}: {
  categories: CategorySet;
  entries: readonly Entry[];
  /** 分类和记录可能同时变化（改名会同步更新记录）。 */
  onChange: (next: CategorySet, nextEntries?: Entry[]) => void;
}) {
  const [kind, setKind] = useState<EntryKind>("expense");
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const list = kind === "expense" ? categories.expense : categories.income;
  const counts = usageCount(entries, kind);
  const orphans = orphanCategories(entries, categories, kind);

  function apply(result: ReturnType<typeof addCategory>) {
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setError(null);
    onChange(result.categories, result.entries);
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">分类</h2>
        <div className="flex gap-1 rounded-full bg-surface-raised p-1">
          {(["expense", "income"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                setEditing(null);
                setError(null);
              }}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                kind === k
                  ? "bg-accent text-accent-ink"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {k === "expense" ? "支出" : "收入"}
            </button>
          ))}
        </div>
      </div>

      <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle">
        {list.map((name, index) => (
          <li key={name} className="flex items-center gap-2 px-3 py-2">
            {editing === name ? (
              <>
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      apply(
                        renameCategory(categories, entries, kind, name, editValue),
                      );
                      setEditing(null);
                    }
                    if (e.key === "Escape") setEditing(null);
                  }}
                  maxLength={12}
                  className="min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-2 py-1 text-sm text-ink outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    apply(renameCategory(categories, entries, kind, name, editValue));
                    setEditing(null);
                  }}
                  className="text-xs text-accent"
                >
                  保存
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="text-xs text-ink-subtle"
                >
                  取消
                </button>
              </>
            ) : (
              <>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {name}
                </span>
                {/* 让删除这个动作的后果一眼可见 */}
                <span className="tnum shrink-0 text-xs text-ink-subtle">
                  {counts.get(name) ?? 0} 笔
                </span>
                <button
                  type="button"
                  aria-label={`把${name}上移`}
                  disabled={index === 0}
                  onClick={() => apply(moveCategory(categories, kind, name, -1))}
                  className="px-1 text-xs text-ink-subtle transition-colors hover:text-ink disabled:opacity-25"
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`把${name}下移`}
                  disabled={index === list.length - 1}
                  onClick={() => apply(moveCategory(categories, kind, name, 1))}
                  className="px-1 text-xs text-ink-subtle transition-colors hover:text-ink disabled:opacity-25"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditing(name);
                    setEditValue(name);
                    setError(null);
                  }}
                  className="px-1 text-xs text-ink-muted transition-colors hover:text-ink"
                >
                  改名
                </button>
                <button
                  type="button"
                  onClick={() => apply(removeCategory(categories, kind, name))}
                  className="px-1 text-xs text-ink-muted transition-colors hover:text-ink"
                >
                  删除
                </button>
              </>
            )}
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            apply(addCategory(categories, kind, draft));
            setDraft("");
          }}
          maxLength={12}
          placeholder="新分类名"
          className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-border-strong"
        />
        <button
          type="button"
          onClick={() => {
            apply(addCategory(categories, kind, draft));
            setDraft("");
          }}
          className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          添加
        </button>
      </div>

      {error !== null ? (
        <p role="alert" className="text-sm text-ink-muted">
          {error}
        </p>
      ) : null}

      <p className="text-xs text-ink-subtle">
        删除分类不会影响已有记录——记录里存的是分类名字，删掉之后它们照常显示，
        只是不再出现在记账时的选项里。改名会同步更新所有用了这个名字的记录。
      </p>

      {/*
        已删除但历史记录仍在用的分类。不列出来的话，用户会在统计里看到一个
        「设置里根本没有」的分类，完全无从解释。
      */}
      {orphans.length > 0 ? (
        <div className="rounded-lg border border-border-subtle bg-surface-raised px-3 py-2.5">
          <p className="text-xs text-ink-muted">
            这些分类已经从列表里移除，但历史记录仍在使用：
          </p>
          <p className="mt-1 text-xs text-ink">{orphans.join("、")}</p>
          <button
            type="button"
            onClick={() => {
              const missing = orphans.filter((o) => !list.includes(o));
              let next = categories;
              for (const name of missing) {
                const r = addCategory(next, kind, name);
                if (r.ok) next = r.categories;
              }
              onChange(next);
            }}
            className="mt-2 text-xs text-accent"
          >
            重新加回列表
          </button>
        </div>
      ) : null}
    </section>
  );
}
