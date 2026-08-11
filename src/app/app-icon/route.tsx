import { ImageResponse } from "next/og";

import { IconArt } from "@/lib/icon-art";

/** manifest 里 purpose: "any" 的那个图标。 */
export function GET() {
  return new ImageResponse(<IconArt size={512} />, {
    width: 512,
    height: 512,
  });
}
