import type { MetadataRoute } from "next";

/**
 * PWA 清单。让这个账本能被「添加到主屏幕」，像原生应用一样打开。
 *
 * 为什么值得做：核心场景是「花完当场就记」。没有它，记一笔要先解锁手机、
 * 打开浏览器、找到书签、等页面加载——四步。每多一步，都会在某个赶时间的
 * 时刻让人干脆不记了，而漏记一笔的代价是这个月的数字整个不准。
 *
 * `display: standalone` 去掉浏览器地址栏，屏幕高度多出约 100px；
 * 对一个「录入框在顶部、按钮在底部」的界面来说，这一条本身就值得。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Multi-Currency Finance",
    short_name: "账本",
    description: "多币种记账。数据只存在你自己的设备上。",
    start_url: "/",
    display: "standalone",
    // 与 globals.css 里的 --background 一致，避免启动瞬间闪一下白底
    background_color: "#ffffff",
    theme_color: "#2a78d6",
    orientation: "portrait",
    icons: [
      {
        src: "/app-icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/maskable-icon",
        sizes: "512x512",
        type: "image/png",
        // Android 会把图标裁成圆形/圆角矩形。maskable 版本四周留了安全边距，
        // 不留的话图标边缘会被切掉。
        purpose: "maskable",
      },
    ],
  };
}
