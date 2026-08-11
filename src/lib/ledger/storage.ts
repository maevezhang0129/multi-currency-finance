import { z } from "zod";

import {
  defaultCategories,
  emptyLedger,
  ledgerSchema,
  settingsSchema,
  settingsSchemaV1,
  SETTINGS_VERSION,
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

/**
 * 账本的版本迁移。
 *
 * 现在只有 v1，所以这个函数看起来是多余的——但它存在的时机恰恰是现在。
 * 等真的要给记录加字段（账户、标签、附件）时，版本号一改，用户手里所有
 * 老数据会立刻被判成「损坏」。到那时再补迁移，得先想清楚怎么在不破坏
 * 已有数据的前提下改，压力大得多。
 *
 * 迁移链的写法：每个 migrator 只负责把 n 升到 n+1，逐级串起来。
 * 这样加第三个版本时不用改前两个。
 *
 * 没有服务端可以帮忙做迁移——数据在用户浏览器里，只能在读的那一刻升级。
 */
type Migration = {
  /** 这个 migrator 认得的旧版本号 */
  from: number;
  /** 认出旧格式；认不出就返回 null，交给下一个 */
  detect: (raw: unknown) => boolean;
  /** 升到下一个版本 */
  upgrade: (raw: unknown) => unknown;
};

const LEDGER_MIGRATIONS: Migration[] = [
  // 例（等真的有 v2 时照这个写）：
  // {
  //   from: 1,
  //   detect: (raw) =>
  //     typeof raw === "object" && raw !== null && (raw as { version?: number }).version === 1,
  //   upgrade: (raw) => ({
  //     ...(raw as object),
  //     version: 2,
  //     entries: (raw as { entries: unknown[] }).entries.map((e) => ({
  //       ...(e as object),
  //       account: "默认",   // 新字段给一个不改变语义的默认值
  //     })),
  //   }),
  // },
];

/**
 * 逐级升级，直到当前版本能解析为止。
 *
 * 升级失败或没有对应的 migrator 时，返回原始的 corrupt 结果——**绝不猜**。
 * 装作能读懂一个不认识的格式，比明确报错危险得多：前者会静默地改写用户的
 * 财务记录，后者只是让他看到一条错误信息，而原始数据还在。
 */
export function parseLedger(raw: string | null): LoadResult<Ledger> {
  const current = parseStored(raw, ledgerSchema);
  if (current.status !== "corrupt") return current;
  if (raw === null) return current;

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    // 连 JSON 都不是，迁移无从谈起
    return current;
  }

  // 最多走 10 级，防止 migrator 写错造成死循环
  for (let step = 0; step < 10; step += 1) {
    const migration = LEDGER_MIGRATIONS.find((m) => m.detect(payload));
    if (migration === undefined) break;

    try {
      payload = migration.upgrade(payload);
    } catch {
      return current;
    }

    const upgraded = ledgerSchema.safeParse(payload);
    if (upgraded.success) return { status: "ok", value: upgraded.data };
  }

  return current;
}

export function loadLedger(store: KeyValueStore): LoadResult<Ledger> {
  return parseLedger(store.getItem(LEDGER_KEY));
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

/**
 * 解析设置，并把旧版本升上来。
 *
 * 版本号存在的意义就在这里：v1 只有本币，没有分类列表。直接用 v2 的 schema 去
 * 解析会判定为「损坏」，于是用户被要求重新选一次本币——一个纯粹由我们改结构
 * 造成的麻烦，不该让他承担。
 *
 * 升级是补默认值，不是清空重来：他之前选的本币原样保留。
 */
export function parseSettings(raw: string | null): LoadResult<Settings> {
  const current = parseStored(raw, settingsSchema);
  if (current.status !== "corrupt") return current;

  // 当前版本解析不了，试试认识的旧版本。
  const v1 = parseStored(raw, settingsSchemaV1);
  if (v1.status === "ok") {
    return {
      status: "ok",
      value: {
        version: SETTINGS_VERSION,
        homeCurrency: v1.value.homeCurrency,
        categories: defaultCategories(),
      },
    };
  }

  // 旧版本也不认识，那是真的坏了。
  return current;
}

export function loadSettings(store: KeyValueStore): LoadResult<Settings> {
  return parseSettings(store.getItem(SETTINGS_KEY));
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
