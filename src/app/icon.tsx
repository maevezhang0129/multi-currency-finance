import { ImageResponse } from "next/og";

import { IconArt } from "@/lib/icon-art";

/** 浏览器标签页图标。文件约定，Next 自动注入 link 标签。 */
export const size = { width: 512, height: 512 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(<IconArt size={512} />, size);
}
