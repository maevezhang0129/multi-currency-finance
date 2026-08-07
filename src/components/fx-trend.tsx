"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { FxResponse, FxSeries } from "@/lib/fx/api-types";

/**
 * 汇率趋势。
 *
 * **为什么是三张图而不是一张三条线的图**：USD 对 SEK/THB/CNY 分别在 9.6 / 33 /
 * 6.8 量级。挤在一条线性轴上，THB 会占满纵向空间，另外两条被压成几乎水平的
 * 直线——图还在，但信息没了。双 y 轴更糟：两个刻度怎么对齐是任意的，等于凭空
 * 造出一种数据里并不存在的相关性。
 *
 * 所以拆成小倍数：每个币种一张图、各自的 y 轴，纵向对齐后仍然能比较「形状」，
 * 而每张图里的数值都是真实汇率。另一种做法是归一到基期=100，但那会让
 * 「1 美元换多少克朗」这个对记账有直接意义的数字消失。
 */

/** 与配色变量一一对应，颜色跟着币种走，不跟着顺序走。 */
const SERIES_STYLE: Record<string, { color: string; label: string }> = {
  SEK: { color: "var(--viz-series-1)", label: "瑞典克朗" },
  THB: { color: "var(--viz-series-2)", label: "泰铢" },
  CNY: { color: "var(--viz-series-3)", label: "人民币" },
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: FxResponse };

export function FxTrend() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch("/api/fx", { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`接口返回 ${response.status}`);
        }
        setState({ status: "ready", data: (await response.json()) as FxResponse });
      } catch (caught) {
        // 组件卸载导致的 abort 不是错误，不该弹错误界面。
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message: caught instanceof Error ? caught.message : String(caught),
        });
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  if (state.status === "loading") return <LoadingState />;
  if (state.status === "error") return <ErrorState message={state.message} />;

  const withData = state.data.series.filter((s) => s.points.length > 0);
  if (withData.length === 0) return <EmptyState />;

  return (
    <section className="viz flex flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">月度汇率趋势</h2>
          <p className="mt-1 text-sm text-black/55 dark:text-white/55">
            以 {state.data.base} 为基准的当月均值。数据来源：欧洲央行参考汇率。
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="rounded-md border border-black/12 px-3 py-1.5 text-sm transition-colors hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.06]"
          aria-expanded={showTable}
        >
          {showTable ? "隐藏数据表" : "显示数据表"}
        </button>
      </header>

      <div className="flex flex-col gap-5">
        {withData.map((series) => (
          <SeriesChart key={series.quote} base={state.data.base} series={series} />
        ))}
      </div>

      {showTable ? <DataTable base={state.data.base} series={withData} /> : null}
    </section>
  );
}

function SeriesChart({ base, series }: { base: string; series: FxSeries }) {
  const style = SERIES_STYLE[series.quote] ?? {
    color: "var(--viz-series-1)",
    label: series.quote,
  };

  // 只在这里 Number()：转出来的是画图用的展示值，不回写任何地方。
  const data = series.points.map((p) => ({
    month: p.month,
    rate: Number(p.rate),
  }));

  const values = data.map((d) => d.rate);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // 上下各留 8% 余量，避免极值贴边。汇率图不需要从 0 起——这不是比较
  // 大小的柱图，强行归零只会把全部波动压成一条直线。
  const pad = (max - min) * 0.08 || max * 0.02;

  const latest = data[data.length - 1];

  return (
    // color 在容器上，SVG 里一律 currentColor：主题切换只改 CSS 变量。
    <figure style={{ color: style.color }} className="flex flex-col gap-2">
      <figcaption className="flex items-baseline gap-2">
        {/* 图元颜色只出现在这个小色块上；文字一律用文本色，
            不给文字穿上系列色。 */}
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full bg-[currentColor]"
        />
        <span className="text-sm font-medium text-black/85 dark:text-white/85">
          {base}/{series.quote}
        </span>
        <span className="text-xs text-black/45 dark:text-white/45">
          {style.label}
        </span>
        {latest ? (
          <span className="ml-auto text-sm tabular-nums text-black/70 dark:text-white/70">
            {latest.rate.toFixed(4)}
            <span className="ml-1 text-xs text-black/40 dark:text-white/40">
              {latest.month}
            </span>
          </span>
        ) : null}
      </figcaption>

      <div className="h-40 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            {/* 只留横向网格线，实线、极淡——网格是背景，不该和数据抢注意力。 */}
            <CartesianGrid
              vertical={false}
              stroke="var(--viz-grid)"
              strokeWidth={1}
            />
            <XAxis
              dataKey="month"
              // 91 个月全部标出来会糊成一片，按年抽稀。
              ticks={yearlyTicks(data.map((d) => d.month))}
              tickFormatter={(m: string) => m.slice(0, 4)}
              stroke="var(--viz-axis)"
              tick={{ fill: "var(--viz-text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--viz-grid)" }}
              minTickGap={8}
            />
            <YAxis
              domain={[min - pad, max + pad]}
              tickFormatter={(v: number) => v.toFixed(1)}
              stroke="var(--viz-axis)"
              tick={{ fill: "var(--viz-text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={44}
            />
            <Tooltip
              // 折线图默认带十字准星 + 悬浮值，这是图表本来就该有的交互。
              cursor={{ stroke: "var(--viz-axis)", strokeWidth: 1 }}
              contentStyle={{
                background: "var(--viz-surface)",
                border: "1px solid var(--viz-grid)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--viz-text)",
              }}
              labelStyle={{ color: "var(--viz-text-muted)" }}
              // 不标注 value 的类型，让它从 Recharts 的 Formatter 签名推断——
              // 那里的 ValueType 比 number 宽，手写 number 会对不上。
              formatter={(value) => [
                Number(value).toFixed(4),
                `${base}/${series.quote}`,
              ]}
            />
            <Line
              type="monotone"
              dataKey="rate"
              stroke="currentColor"
              strokeWidth={2}
              // 91 个点每个都画圆点会变成一条毛毛虫；只在悬浮时给一个。
              dot={false}
              activeDot={{
                r: 4,
                stroke: "var(--viz-surface)",
                strokeWidth: 2,
                fill: "currentColor",
              }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

/** 每年取第一个出现的月份作为刻度。 */
function yearlyTicks(months: readonly string[]): string[] {
  const seen = new Set<string>();
  const ticks: string[] = [];
  for (const month of months) {
    const year = month.slice(0, 4);
    if (seen.has(year)) continue;
    seen.add(year);
    ticks.push(month);
  }
  return ticks;
}

/**
 * 数据表。
 *
 * 不只是「顺手加的」：浅色模式下 aqua 那一档对比度低于 3:1，配色规范要求以
 * 可见标签或表格视图作补偿。而且对财务工具来说，能读到精确数值本来就是需求。
 */
function DataTable({ base, series }: { base: string; series: FxSeries[] }) {
  const months = [...new Set(series.flatMap((s) => s.points.map((p) => p.month)))]
    .sort()
    .reverse();
  const lookup = new Map(
    series.flatMap((s) => s.points.map((p) => [`${s.quote}|${p.month}`, p.rate])),
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/12">
      <table className="w-full min-w-[24rem] border-collapse text-sm">
        <caption className="sr-only">
          以 {base} 为基准的月度汇率数值表
        </caption>
        <thead>
          <tr className="border-b border-black/10 text-left dark:border-white/12">
            <th scope="col" className="px-3 py-2 font-medium">
              月份
            </th>
            {series.map((s) => (
              <th
                key={s.quote}
                scope="col"
                className="px-3 py-2 text-right font-medium tabular-nums"
              >
                {base}/{s.quote}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr
              key={month}
              className="border-b border-black/5 last:border-0 dark:border-white/8"
            >
              <th scope="row" className="px-3 py-1.5 text-left font-normal">
                {month}
              </th>
              {series.map((s) => (
                <td key={s.quote} className="px-3 py-1.5 text-right tabular-nums">
                  {/* 表里保留完整精度，不做 toFixed —— 图是给人看趋势的，
                      表是给人查数的。 */}
                  {lookup.get(`${s.quote}|${month}`) ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LoadingState() {
  return (
    <section className="flex flex-col gap-5" aria-busy="true" aria-live="polite">
      <div className="h-5 w-40 animate-pulse rounded bg-black/8 dark:bg-white/10" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="h-4 w-28 animate-pulse rounded bg-black/8 dark:bg-white/10" />
          <div className="h-40 w-full animate-pulse rounded-lg bg-black/5 dark:bg-white/6" />
        </div>
      ))}
      <span className="sr-only">正在加载汇率数据</span>
    </section>
  );
}

function EmptyState() {
  return (
    <section className="rounded-lg border border-dashed border-black/15 px-6 py-10 text-center dark:border-white/15">
      <p className="text-sm font-medium">还没有汇率数据</p>
      <p className="mt-1 text-sm text-black/55 dark:text-white/55">
        抓取任务每月运行一次。也可以在本地手动触发一次回填，见 README。
      </p>
    </section>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <section
      role="alert"
      className="rounded-lg border border-black/15 px-6 py-8 dark:border-white/15"
    >
      <p className="text-sm font-medium">汇率数据加载失败</p>
      <p className="mt-1 text-sm text-black/55 dark:text-white/55">
        这通常是网络或数据库连接问题，稍后重试即可。
      </p>
      {/* 把原始错误露出来而不是藏起来：这是给开发者看的仓库，
          一个「出错了」的提示对排查毫无帮助。 */}
      <p className="mt-3 font-mono text-xs text-black/45 dark:text-white/45">
        {message}
      </p>
    </section>
  );
}
