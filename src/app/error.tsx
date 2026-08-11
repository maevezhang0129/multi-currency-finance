"use client";

import { useEffect } from "react";

/**
 * 页面级错误界面。
 *
 * 没有它，任何一个组件抛异常都会让整个页面变成白屏。对账本来说这是最坏的
 * 失败方式——用户看到空白，第一反应是「我的数据没了」，而实际上数据好好地
 * 躺在 localStorage 里。
 *
 * 所以这个界面要做到三件事：说清数据还在、给一条能立刻带走数据的出路、
 * 露出真实错误好让人能报告问题。
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[ledger] 页面崩溃", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-6 py-12">
      <div>
        <h1 className="text-lg font-semibold text-ink">出了点问题</h1>
        <p className="mt-2 text-sm text-ink-muted">
          界面崩了，但<strong className="text-ink">你的账本数据没有受影响</strong>——
          它存在这台设备的浏览器里，不会因为界面出错而丢失。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90"
        >
          重试
        </button>
        {/*
          崩溃时最该给的一条出路。界面坏了不代表数据坏了，让人能立刻把数据
          带走，比任何安慰的话都有用。这里直接读原始字符串，不经过任何解析——
          正是解析出问题时也要能导出。
        */}
        <button
          type="button"
          onClick={downloadRaw}
          className="rounded-full border border-border-strong px-4 py-2 text-sm text-ink transition-colors hover:bg-surface-raised"
        >
          导出我的数据
        </button>
      </div>

      <details className="rounded-lg border border-border-subtle px-3 py-2">
        <summary className="cursor-pointer text-xs text-ink-muted">
          错误详情
        </summary>
        <pre className="mt-2 max-h-40 overflow-auto font-mono text-xs whitespace-pre-wrap text-ink-subtle">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
      </details>
    </main>
  );
}

/**
 * 直接从 localStorage 取原始字符串下载。
 *
 * 刻意不复用 storage.ts 里的导出函数：那条路径要先解析、再序列化，而这里
 * 的前提就是「某个环节已经出错了」。原样搬走最不容易再出错。
 */
function downloadRaw() {
  try {
    const payload = JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        note: "界面崩溃时导出的原始数据",
        ledger: window.localStorage.getItem("mcf.ledger"),
        settings: window.localStorage.getItem("mcf.settings"),
      },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([payload], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `账本救援备份-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (caught) {
    console.error("[ledger] 连导出都失败了", caught);
  }
}
