import type { ReactElement } from "react";

/**
 * 应用图标的图形，三处共用（浏览器 favicon、iOS 主屏幕、PWA manifest）。
 *
 * 图案是一条汇率折线加一个末端强调点——这个账本区别于其他账本的地方就是汇率，
 * 图标该说的就是这件事。用代码画而不是放 PNG：改配色时跟着设计变量一起改，
 * 也不用往仓库里塞二进制资源。
 */
export function IconArt({
  size,
  /** maskable 版本要把图案缩小，给 Android 的裁剪留安全边距。 */
  inset = false,
}: {
  size: number;
  inset?: boolean;
}): ReactElement {
  const points = inset
    ? "152,312 208,256 264,284 320,200 368,228"
    : "96,336 176,256 256,296 336,176 416,216";
  const [dotX, dotY] = inset ? [368, 228] : [416, 216];
  const stroke = inset ? 26 : 34;
  const dot = inset ? 20 : 26;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#2a78d6",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 512 512" fill="none">
        <polyline
          points={points}
          stroke="#ffffff"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx={dotX} cy={dotY} r={dot} fill="#ffffff" />
      </svg>
    </div>
  );
}
