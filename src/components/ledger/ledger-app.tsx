"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { FxResponse } from "@/lib/fx/api-types";
import { BASE_CURRENCY } from "@/lib/fx/config";
import { addMonths, monthOf } from "@/lib/fx/month";
import { buildRateIndex, convertToBase, type RateIndex } from "@/lib/ledger/convert";
import { formatAmount, formatMonthLabel } from "@/lib/ledger/format";
import { exportRaw, type KeyValueStore } from "@/lib/ledger/storage";
import { changePercent, recentEntries, summarizeMonth } from "@/lib/ledger/summary";
import {
  emptyLedger,
  SPENDABLE_CURRENCIES,
  type Entry,
  type SpendableCurrency,
} from "@/lib/ledger/types";
import { useHydrated, useLedger } from "@/lib/ledger/use-ledger";

import { EntrySheet, type EntryDraft } from "./entry-sheet";
import {
  CategoryBars,
  ChangeBadge,
  EntryRow,
  heroSizeClass,
  PrimaryAction,
} from "./primitives";

/**
 * 账本主界面。
 *
 * 账本数据不放在组件 state 里，而是通过 useLedger 订阅 localStorage
 * （理由见那个文件）。这里只持有真正属于界面的状态：看的是哪个月、
 * 浮层开没开、汇率取到了没。
 *
 * 加载中、存储不可用、数据损坏三种状态都要如实呈现。尤其是损坏——
 * 账本数据损坏时最不能做的事就是当作空账本，那等于把用户的记录悄悄删掉。
 */
type RatesState =
  | { status: "loading" }
  | { status: "ready"; index: RateIndex }
  | { status: "unavailable" };

export function LedgerApp() {
  const hydrated = useHydrated();
  const { store, ledger, settings, saveEntries, saveHomeCurrency } = useLedger();

  // 汇率的三种状态合成一个对象。分成 rates + ratesLoaded 两个 state 会让
  // 每次加载完连着触发两次渲染，React 的 set-state-in-effect 规则正是拦这个。
  const [ratesState, setRatesState] = useState<RatesState>({ status: "loading" });
  const [monthOffset, setMonthOffset] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);

  // 取汇率。失败不阻塞记账——拿不到汇率只是折算不了，账还是要能记。
  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch("/api/fx", { signal: controller.signal });
        if (!response.ok) throw new Error(`接口返回 ${response.status}`);
        const data = (await response.json()) as FxResponse;
        setRatesState({ status: "ready", index: buildRateIndex(data) });
      } catch {
        // 组件卸载导致的 abort 不是错误，不该切成「取不到汇率」的提示。
        if (controller.signal.aborted) return;
        setRatesState({ status: "unavailable" });
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  // 日期在浏览器里算。服务端算会用服务器时区，跨时区时「今天」会差一天。
  const now = hydrated ? new Date() : null;
  const today = now === null ? "" : toLocalDate(now);
  const month = now === null ? "" : addMonths(monthOf(now), monthOffset);

  // 包成 useMemo，否则每次渲染都是新数组，下面两个 useMemo 的依赖恒变。
  const entries = useMemo(
    () => (ledger.status === "ok" ? ledger.value.entries : []),
    [ledger],
  );

  const homeCurrency: SpendableCurrency =
    settings.status === "ok" ? settings.value.homeCurrency : "SEK";

  const rates = ratesState.status === "ready" ? ratesState.index : null;

  const summary = useMemo(() => {
    if (month === "" || rates === null) return null;
    return summarizeMonth(entries, month, homeCurrency, BASE_CURRENCY, rates);
  }, [entries, month, homeCurrency, rates]);

  const previousSummary = useMemo(() => {
    if (month === "" || rates === null) return null;
    return summarizeMonth(
      entries, addMonths(month, -1), homeCurrency, BASE_CURRENCY, rates,
    );
  }, [entries, month, homeCurrency, rates]);

  const addEntry = useCallback(
    (draft: EntryDraft) => {
      const conversion =
        rates === null
          ? null
          : convertToBase({
              amount: draft.amount,
              currency: draft.currency,
              date: draft.date,
              base: BASE_CURRENCY,
              rates,
            });

      const entry: Entry = {
        id: crypto.randomUUID(),
        kind: draft.kind,
        date: draft.date,
        amount: draft.amount,
        currency: draft.currency as Entry["currency"],
        category: draft.category as Entry["category"],
        ...(draft.note.length > 0 ? { note: draft.note } : {}),
        conversion,
        createdAt: new Date().toISOString(),
      };

      const base = ledger.status === "ok" ? ledger.value : emptyLedger();
      saveEntries({ ...base, entries: [...base.entries, entry] });
      setSheetOpen(false);
    },
    [ledger, rates, saveEntries],
  );

  if (!hydrated || ratesState.status === "loading") return <LoadingState />;
  if (store === null) return <NoStorageState />;
  if (ledger.status === "corrupt") {
    return <CorruptState message={ledger.message} raw={ledger.raw} />;
  }
  if (settings.status !== "ok") {
    return (
      <FirstRun
        onPick={(currency) =>
          saveHomeCurrency({ version: 1, homeCurrency: currency })
        }
      />
    );
  }

  const total = formatAmount(summary?.total ?? "0.00");
  const recent = recentEntries(entries, 6);

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
      <main className="flex-1 px-6 pb-28">
        <header className="flex items-center justify-between pt-10 pb-8">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="上个月"
              onClick={() => setMonthOffset((v) => v - 1)}
              className="px-1 text-sm text-ink-subtle transition-colors hover:text-ink"
            >
              ‹
            </button>
            <span className="text-sm text-ink-muted">{formatMonthLabel(month)}</span>
            <button
              type="button"
              aria-label="下个月"
              disabled={monthOffset >= 0}
              onClick={() => setMonthOffset((v) => Math.min(0, v + 1))}
              className="px-1 text-sm text-ink-subtle transition-colors hover:text-ink disabled:opacity-25"
            >
              ›
            </button>
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => downloadExport(store)}
              className="text-sm text-ink-muted transition-colors hover:text-ink"
            >
              导出
            </button>
            <Link
              href="/rates"
              className="text-sm text-ink-muted transition-colors hover:text-ink"
            >
              汇率
            </Link>
          </div>
        </header>

        <section className="pb-10">
          <p className="tnum flex items-baseline gap-2 whitespace-nowrap text-ink">
            <span className={`${heroSizeClass(total)} font-semibold tracking-tight`}>
              {total}
            </span>
            <span className="text-xl text-ink-subtle">{homeCurrency}</span>
          </p>

          <p className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            {summary !== null && homeCurrency !== BASE_CURRENCY ? (
              <span className="tnum text-sm text-ink-muted">
                ≈ {formatAmount(summary.baseTotal)} {BASE_CURRENCY}
              </span>
            ) : null}
            <ChangeBadge
              percent={
                summary && previousSummary
                  ? changePercent(summary.total, previousSummary.total)
                  : null
              }
            />
          </p>

          {/* 合计不完整时必须说出来，不能只给一个看起来正常的数字。 */}
          {summary !== null && summary.unconvertedCount > 0 ? (
            <p className="mt-2 text-xs text-ink-subtle">
              有 {summary.unconvertedCount} 笔还没折算，未计入合计
            </p>
          ) : null}
          {rates === null ? (
            <p className="mt-2 text-xs text-ink-subtle">
              汇率数据暂时取不到，折算稍后补上
            </p>
          ) : null}
        </section>

        {summary !== null && summary.categories.length > 0 ? (
          <section className="border-t border-border-subtle pt-7">
            <h2 className="pb-4 text-xs font-medium tracking-wide text-ink-subtle">
              分类
            </h2>
            <CategoryBars categories={summary.categories} currency={homeCurrency} />
          </section>
        ) : null}

        <section className="mt-8 border-t border-border-subtle pt-7">
          <h2 className="pb-2 text-xs font-medium tracking-wide text-ink-subtle">
            最近
          </h2>
          {recent.length === 0 ? (
            <EmptyLedger />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {recent.map((e) => (
                <EntryRow key={e.id} entry={e} homeCurrency={homeCurrency} />
              ))}
            </ul>
          )}
        </section>
      </main>

      <div className="pointer-events-none sticky bottom-0 bg-gradient-to-t from-background via-background to-transparent px-6 pt-8 pb-6">
        <PrimaryAction
          className="pointer-events-auto w-full"
          onClick={() => setSheetOpen(true)}
        >
          记一笔
        </PrimaryAction>
      </div>

      {/*
        关闭时整个卸载，而不是让组件内部返回 null。这样重新打开就是全新实例，
        上一笔的金额不会留在输入框里——「看起来已经填好了」是最容易让人误记
        一笔的状态。
      */}
      {sheetOpen ? (
        <EntrySheet
          homeCurrency={homeCurrency}
          today={today}
          onClose={() => setSheetOpen(false)}
          onSubmit={addEntry}
        />
      ) : null}
    </div>
  );
}

/**
 * 本地日期，YYYY-MM-DD。
 *
 * 不用 toISOString()——那个转成 UTC，在东八区凌晨会给出昨天的日期，
 * 于是「花完当场记」的那笔账被记到了前一天。
 */
function toLocalDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function download(content: string, filename: string) {
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadExport(store: KeyValueStore) {
  download(exportRaw(store), `账本备份-${new Date().toISOString().slice(0, 10)}.json`);
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
      {children}
    </main>
  );
}

function LoadingState() {
  return (
    <Shell>
      <div className="flex flex-col gap-4" aria-busy="true">
        <div className="h-4 w-24 animate-pulse rounded bg-border-subtle" />
        <div className="h-14 w-2/3 animate-pulse rounded bg-border-subtle" />
        <div className="h-32 w-full animate-pulse rounded-xl bg-border-subtle" />
      </div>
      <span className="sr-only">正在读取账本</span>
    </Shell>
  );
}

function EmptyLedger() {
  return (
    <div className="rounded-xl border border-dashed border-border-strong px-5 py-8 text-center">
      <p className="text-sm text-ink">还没有记录</p>
      <p className="mt-1 text-sm text-ink-muted">
        点下面的按钮记第一笔。数据只存在这台设备的浏览器里。
      </p>
    </div>
  );
}

function NoStorageState() {
  return (
    <Shell>
      <div className="rounded-xl border border-border-strong px-5 py-6">
        <p className="text-sm font-medium text-ink">无法访问本地存储</p>
        <p className="mt-2 text-sm text-ink-muted">
          浏览器的隐私模式会禁用本地存储。这个账本把数据全部存在你自己的浏览器里，
          没有本地存储就无法保存记录。换一个普通窗口打开即可。
        </p>
      </div>
    </Shell>
  );
}

/**
 * 数据损坏。
 *
 * 这里刻意**不提供「清空重来」按钮**。损坏的数据仍然是用户的财务记录，
 * 里面很可能有能人工救回来的内容。先让他把原始数据下载走，之后再谈重置。
 */
function CorruptState({ message, raw }: { message: string; raw: string }) {
  return (
    <Shell>
      <div className="rounded-xl border border-border-strong px-5 py-6">
        <p className="text-sm font-medium text-ink">账本数据读不出来</p>
        <p className="mt-2 text-sm text-ink-muted">
          本地存储里的数据格式不符合预期。你的原始数据没有被改动，
          请先下载备份，再决定下一步。
        </p>
        <button
          type="button"
          onClick={() =>
            download(raw, `账本原始数据-${new Date().toISOString().slice(0, 10)}.json`)
          }
          className="mt-4 rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          下载原始数据
        </button>
        <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-surface-raised p-3 font-mono text-xs text-ink-subtle">
          {message}
        </pre>
      </div>
    </Shell>
  );
}

function FirstRun({ onPick }: { onPick: (currency: SpendableCurrency) => void }) {
  return (
    <Shell>
      <h1 className="text-xl font-semibold tracking-tight text-ink">
        你平时用哪种货币？
      </h1>
      <p className="mt-2 text-sm text-ink-muted">
        这会成为界面上的主视角，以后可以改。所有分析同时会折算成 {BASE_CURRENCY}，
        方便跨币种对比。
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        {SPENDABLE_CURRENCIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onPick(c)}
            className="rounded-full border border-border-strong px-4 py-2 text-sm text-ink transition-colors hover:bg-surface-raised"
          >
            {c}
          </button>
        ))}
      </div>
    </Shell>
  );
}
