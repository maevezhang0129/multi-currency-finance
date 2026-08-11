import { ImageResponse } from "next/og";

import { IconArt } from "@/lib/icon-art";

/**
 * iOS 主屏幕图标。iOS 不读 manifest 的 icons，只认 apple-touch-icon。
 * 不能自带圆角——iOS 自己会加，否则会出现双重圆角。
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(<IconArt size={180} />, size);
}
