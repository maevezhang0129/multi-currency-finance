/*
 * Service worker：让这个账本断网也能打开。
 *
 * 手写而不用 Workbox，理由和自己写 CSV 解析一样：需要的规则很少且固定，
 * 而一个依赖要跟着升级、要读它的迁移说明、要审它的安全公告。这里一共四条
 * 缓存策略，写清楚比引一个框架更容易在半年后看懂。
 *
 * 缓存的是「运行时遇到什么就存什么」，不是构建期预缓存清单——后者要在打包
 * 时生成带哈希的文件列表，得引构建插件。代价是：**第一次访问必须联网**，
 * 从第二次起才能离线。对一个每天都会打开的应用，这个代价可以接受。
 */

const VERSION = "v1";
const SHELL = `mcf-shell-${VERSION}`;
const ASSETS = `mcf-assets-${VERSION}`;
const DATA = `mcf-data-${VERSION}`;
const OWNED = [SHELL, ASSETS, DATA];

self.addEventListener("install", (event) => {
  // 先把首页存下来，这样即使用户装完就断网，也还能打开
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(["/", "/rates"])),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 清掉上一个版本的缓存，否则每次发版都会留下一份，越积越多
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("mcf-") && !OWNED.includes(n))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

/*
 * 刻意不调用 skipWaiting()。
 *
 * 调了的话，新版 service worker 会立刻接管当前正在运行的页面，而那个页面
 * 的 JS 分片可能刚被 activate 里的清理删掉——用户会遇到「点一下就白屏」。
 * 不调的话，新版本要等所有标签页关掉才生效，代价是更新慢一步，
 * 换来的是不会在用户操作到一半时把页面弄坏。
 */

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // 只管自己域名下的 GET。POST 之类有副作用，缓存它们是灾难
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 定时任务端点绝不能碰缓存
  if (url.pathname.startsWith("/api/cron/")) return;

  // 一、页面导航：网络优先，断网时回落到缓存
  //     网络优先是为了让发版能立刻生效；回落是为了断网时还能打开
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL));
    return;
  }

  // 二、构建产物：缓存优先。文件名带内容哈希，同一个 URL 的内容永不改变，
  //     所以命中缓存就是正确答案，没必要再问网络
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request, ASSETS));
    return;
  }

  // 三、汇率接口：网络优先，断网时给上一次的结果。
  //     汇率一个月才变一次，拿个旧的远好过什么都没有
  if (url.pathname === "/api/fx") {
    event.respondWith(networkFirst(request, DATA));
    return;
  }

  // 四、图标和清单：缓存优先，它们几乎不变
  if (
    url.pathname === "/manifest.webmanifest" ||
    url.pathname.startsWith("/icon") ||
    url.pathname.startsWith("/apple-icon") ||
    url.pathname.startsWith("/app-icon") ||
    url.pathname.startsWith("/maskable-icon")
  ) {
    event.respondWith(cacheFirst(request, ASSETS));
    return;
  }

  // 其余一律走网络，不缓存
});

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  // 只缓存成功的响应。把 404 存下来，用户会一直看到 404
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    // 导航请求断网且没缓存时，回落到首页——总比浏览器的错误页强
    if (request.mode === "navigate") {
      const shell = await caches.match("/");
      if (shell) return shell;
    }
    throw new Error("离线且没有缓存");
  }
}
