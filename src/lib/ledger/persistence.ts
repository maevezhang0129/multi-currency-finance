"use client";

/**
 * 持久化存储与 service worker 的注册。
 *
 * 这两件事解决的是同一个焦虑的两半：**账本存在浏览器里，会不会哪天就没了。**
 *
 * - 持久化存储：告诉浏览器「这些数据别在空间紧张时自动清掉」
 * - service worker：让应用本身断网也能打开
 */

export type PersistState =
  | { status: "unknown" }
  /** 浏览器不支持这个 API（Safari 较老版本、部分内嵌浏览器）。 */
  | { status: "unsupported" }
  /** 数据受保护，浏览器不会自动清理。 */
  | { status: "persisted" }
  /**
   * 没拿到许可。浏览器通常按「使用频率、是否被安装到主屏幕、是否加了书签」
   * 自行判断，不一定弹窗询问。多用几次、装到主屏幕之后往往就会批准。
   */
  | { status: "best-effort" };

/**
 * 查询并尝试申请持久化存储。
 *
 * 为什么重要：浏览器在磁盘紧张时会清理网站数据，iOS 历来最激进。对普通网站
 * 无所谓，对一个存着几个月账本的应用是致命的。拿到持久化许可之后，数据只会
 * 因为用户主动清除而消失。
 *
 * 拿不到也不是灾难——导出功能一直都在。所以这里返回状态让界面如实呈现，
 * 而不是弹窗吓人。
 */
export async function ensurePersistentStorage(): Promise<PersistState> {
  if (
    typeof navigator === "undefined" ||
    navigator.storage === undefined ||
    typeof navigator.storage.persist !== "function"
  ) {
    return { status: "unsupported" };
  }

  try {
    if (await navigator.storage.persisted()) {
      return { status: "persisted" };
    }
    // 这个调用在多数浏览器里不会弹窗，而是按站点参与度自动判断
    const granted = await navigator.storage.persist();
    return granted ? { status: "persisted" } : { status: "best-effort" };
  } catch {
    return { status: "unsupported" };
  }
}

/**
 * 注册 service worker。
 *
 * 只在生产环境注册：开发时它会缓存住旧的构建产物，让人改了代码却看不到变化，
 * 而那种问题极难联想到 service worker 头上。
 */
export function registerServiceWorker(): void {
  if (typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;
  if (process.env.NODE_ENV !== "production") return;

  navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
    // 注册失败不影响使用，只是没有离线能力
    console.warn("[pwa] service worker 注册失败", error);
  });
}
