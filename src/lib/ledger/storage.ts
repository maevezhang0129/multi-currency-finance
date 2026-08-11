import { z } from "zod";

import {
  emptyLedger,
  ledgerSchema,
  settingsSchema,
  type Ledger,
  type Settings,
} from "./types";

/**
 * 账本的本地存储。
 *
 * 这里最重要的一条设计：**读不出来时绝不当作空的。**
 *
 * 一般应用里「解析失败就 fallback 到默认值」是合理的。账本不行——那等于把
 * 用户几个月的财务记录悄悄删掉，而且下一次写入就会把损坏的原始数据彻底覆盖，
 * 再也找不回来。所以读取失败是一种明确的返回值，并且**把原始字符串原样带出来**，
 * 让上层有机会导出、人工修复。
 */

const LEDGER_KEY = "mcf.ledger";
const SETTINGS_KEY = "mcf.settings";

/**
 * 存储接口。抽象成参数是为了能测——vitest 默认跑在 Node 里，没有 localStorage。
 * 顺带也让「存哪里」这件事可以替换。
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LoadResult<T> =
  | { status: "ok"; value: T }
  /** 键不存在。首次使用就是这个状态，不是错误。 */
  | { status: "empty" }
  /**
   * 数据存在但读不懂。可能是手工改坏了，也可能来自还不认识的将来版本。
   * `raw` 必须保留——上层要靠它把数据交还给用户。
   */
  | { status: "corrupt"; message: string; raw: string };

/**
 * 拿浏览器的 localStorage。
 *
 * 服务端渲染时 window 不存在，隐私模式下 localStorage 也可能直接抛异常。
 * 这两种情况都返回 null 而不是抛错，让调用方决定怎么降级。
 */
export function browserStore(): KeyValueStore | null {
  if (typeof window === "undefined") return null;
  try {
    const probe = "__mcf_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 解析一段存下来的字符串。纯函数——不读存储，只处理内容。
 *
 * 单独拆出来是为了让「订阅原始字符串 → 解析」这条链上的依赖是真实的：
 * 调用方拿到 raw 之后可以只在 raw 变化时重新解析，而不是传一个用不到的
 * 依赖去骗 useMemo。
 */
export function parseStored<T>(
  raw: string | null,
  schema: z.ZodType<T>,
): LoadResult<T> {
  if (raw === null) return { status: "empty" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: "corrupt", message: "不是合法的 JSON", raw };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { status: "corrupt", message: z.prettifyError(result.error), raw };
  }

  return { status: "ok", value: result.data };
}

export function loadLedger(store: KeyValueStore): LoadResult<Ledger> {
  return parseStored(store.getItem(LEDGER_KEY), ledgerSchema);
}

/**
 * 写入前先自校验。
 *
 * 看起来多余——数据是我们自己构造的，怎么会不合法？但正因为写进去之后就没有
 * 第二道防线了，这里多花一次校验的代价，换的是「不可能写出一份自己都读不回来
 * 的数据」。真出问题时抛错也比默默写坏强。
 */
export function saveLedger(store: KeyValueStore, ledger: Ledger): void {
  const result = ledgerSchema.safeParse(ledger);
  if (!result.success) {
    throw new Error(`拒绝写入不合法的账本数据：\n${z.prettifyError(result.error)}`);
  }
  store.setItem(LEDGER_KEY, JSON.stringify(result.data));
}

export function loadSettings(store: KeyValueStore): LoadResult<Settings> {
  return parseStored(store.getItem(SETTINGS_KEY), settingsSchema);
}

export function saveSettings(store: KeyValueStore, settings: Settings): void {
  const result = settingsSchema.safeParse(settings);
  if (!result.success) {
    throw new Error(`拒绝写入不合法的设置：\n${z.prettifyError(result.error)}`);
  }
  store.setItem(SETTINGS_KEY, JSON.stringify(result.data));
}

/**
 * 把损坏的数据挪到一个备份键下，然后从空账本重新开始。
 *
 * 不直接删除——损坏的数据仍然是用户的数据，里面很可能有能人工救回来的记录。
 * 返回备份键名，好让界面告诉用户「你的旧数据还在这里」。
 */
export function quarantineCorruptLedger(
  store: KeyValueStore,
  raw: string,
  now: Date = new Date(),
): string {
  const backupKey = `${LEDGER_KEY}.corrupt.${now.toISOString()}`;
  store.setItem(backupKey, raw);
  store.setItem(LEDGER_KEY, JSON.stringify(emptyLedger()));
  return backupKey;
}

/** 导出全部原始数据。用户必须随时能把自己的数据带走。 */
export function exportRaw(store: KeyValueStore): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      ledger: store.getItem(LEDGER_KEY),
      settings: store.getItem(SETTINGS_KEY),
    },
    null,
    2,
  );
}
