import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Multi-Currency Finance",
  description:
    "多币种个人财务分析工具：账本数据只留在浏览器本地，后端只负责公共汇率数据。",
  // iOS 不读 manifest，得靠这个才能全屏启动
  appleWebApp: {
    capable: true,
    title: "账本",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  /*
   * `viewport-fit=cover` 让页面延伸到刘海和底部横条区域，配合下面的
   * safe-area 内边距，全屏模式下才不会出现两条空白带。
   *
   * `maximumScale: 1` 是为了阻止 iOS 在聚焦输入框时自动放大页面——
   * 记一笔的金额框一聚焦屏幕就跳一下，那种感觉很廉价。代价是禁用了双指缩放，
   * 对无障碍是有损的；这里接受这个取舍，因为文字本身没有小到需要放大。
   */
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  // 地址栏/状态栏颜色跟随主题，避免深色模式下顶部一条白边
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
