"use client";

/**
 * 根布局崩溃时的兜底。
 *
 * `error.tsx` 接不住根布局自己抛的异常，只有这个能。它会替换掉整个文档，
 * 所以必须自带 `<html>` 和 `<body>`，也用不上任何 CSS 变量（样式表可能
 * 正是没加载成功的那一环），所以这里的样式全部内联写死。
 *
 * 这个界面几乎不会被看到。但它被看到的那一次，一定是最糟的时刻——
 * 所以它唯一的任务是：告诉用户数据还在，并让他能把数据带走。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          background: "#ffffff",
          color: "#171717",
          fontFamily: "system-ui, -apple-system, sans-serif",
          lineHeight: 1.7,
        }}
      >
        <div style={{ maxWidth: "26rem" }}>
          <h1 style={{ fontSize: "1.1rem", margin: 0 }}>应用启动失败</h1>
          <p style={{ fontSize: "0.9rem", color: "#52514e" }}>
            你的账本数据存在这台设备上，没有受到影响。可以先把它导出，再重试。
          </p>

          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={reset}
              style={{
                border: 0,
                borderRadius: 999,
                padding: "0.55rem 1.1rem",
                fontSize: "0.875rem",
                background: "#2a78d6",
                color: "#ffffff",
                cursor: "pointer",
              }}
            >
              重试
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  const data = JSON.stringify({
                    exportedAt: new Date().toISOString(),
                    ledger: localStorage.getItem("mcf.ledger"),
                    settings: localStorage.getItem("mcf.settings"),
                  });
                  const url = URL.createObjectURL(
                    new Blob([data], { type: "application/json" }),
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "账本救援备份.json";
                  a.click();
                  URL.revokeObjectURL(url);
                } catch {
                  /* 已经是最后一道防线，这里再失败就只能作罢 */
                }
              }}
              style={{
                borderRadius: 999,
                border: "1px solid #dbd8d1",
                background: "transparent",
                padding: "0.55rem 1.1rem",
                fontSize: "0.875rem",
                color: "#171717",
                cursor: "pointer",
              }}
            >
              导出我的数据
            </button>
          </div>

          <pre
            style={{
              marginTop: "1.25rem",
              fontSize: "0.75rem",
              color: "#6b6a65",
              whiteSpace: "pre-wrap",
            }}
          >
            {error.message}
          </pre>
        </div>
      </body>
    </html>
  );
}
