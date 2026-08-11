"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

import {
  browserStore,
  parseStored,
  saveLedger,
  saveSettings,
  type KeyValueStore,
  type LoadResult,
} from "./storage";
import { ledgerSchema, settingsSchema, type Ledger, type Settings } from "./types";

/**
 * 把 localStorage 当作外部数据源订阅，而不是在 effect 里读一次塞进 state。
 *
 * 两个理由：
 *
 * 1. **单一数据源。** 存在 state 里就有两份数据（内存一份、localStorage 一份），
 *    任何一次忘记同步都会让界面和实际存的对不上。这样写只有一份，
 *    写完通知一下，界面自己重新读。
 * 2. **多标签页自动同步。** 浏览器在别的标签页改了 localStorage 会发
 *    `storage` 事件，订阅之后当前页面立刻跟上。用 effect 读一次做不到这点。
 *
 * 顺带也满足了 React 的 set-state-in-effect 规则——那条规则拦下的正是
 * 「在 effect 里同步 setState」这种把外部状态往组件里搬的写法。
 */

/** 同一个标签页内的写入不会触发 storage 事件，得自己广播。 */
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * 判断是否已经在浏览器里跑起来了。
 *
 * 服务端渲染时没有 localStorage，也没有「今天是几号」的正确答案（服务器时区
 * 可能和用户差一天）。所以这些东西一律等挂载之后再算，避免水合不一致。
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

/** 订阅原始字符串。返回基本类型，React 才能靠引用相等判断有没有变。 */
function useRawItem(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (typeof window === "undefined" ? null : window.localStorage.getItem(key)),
    () => null,
  );
}

export interface LedgerAccess {
  /** null 表示本地存储不可用（隐私模式或服务端）。 */
  store: KeyValueStore | null;
  ledger: LoadResult<Ledger>;
  settings: LoadResult<Settings>;
  saveEntries: (next: Ledger) => void;
  saveHomeCurrency: (settings: Settings) => void;
}

export function useLedger(): LedgerAccess {
  const hydrated = useHydrated();
  // 订阅原始字符串，解析放在 useMemo 里——这样只有内容真的变了才会重新解析。
  const rawLedger = useRawItem("mcf.ledger");
  const rawSettings = useRawItem("mcf.settings");

  const store = useMemo(() => (hydrated ? browserStore() : null), [hydrated]);

  // 直接解析订阅到的原始字符串，依赖是真实的：内容变了才重新解析。
  const ledger = useMemo<LoadResult<Ledger>>(
    () => parseStored(rawLedger, ledgerSchema),
    [rawLedger],
  );

  const settings = useMemo<LoadResult<Settings>>(
    () => parseStored(rawSettings, settingsSchema),
    [rawSettings],
  );

  const saveEntries = useCallback(
    (next: Ledger) => {
      if (store === null) return;
      saveLedger(store, next);
      notify();
    },
    [store],
  );

  const saveHomeCurrency = useCallback(
    (next: Settings) => {
      if (store === null) return;
      saveSettings(store, next);
      notify();
    },
    [store],
  );

  return { store, ledger, settings, saveEntries, saveHomeCurrency };
}
