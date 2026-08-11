import { ImageResponse } from "next/og";

import { IconArt } from "@/lib/icon-art";

/**
 * manifest 里 purpose: "maskable" 的那个图标。
 *
 * Android 会按自己的形状（圆形、圆角矩形、水滴）裁剪图标，规范要求关键内容
 * 落在中心直径 80% 的圆内。用普通图标的话边缘会被切掉，所以图案要缩进。
 */
export function GET() {
  return new ImageResponse(<IconArt size={512} inset />, {
    width: 512,
    height: 512,
  });
}
