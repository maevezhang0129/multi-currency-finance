"use client";

import { useEffect, useRef, useState } from "react";

import { CATEGORIES, SPENDABLE_CURRENCIES, type Entry } from "@/lib/ledger/types";

/**
 * 「记一笔」录入浮层。
 *
 * 目标是**三次点击完成一笔**：点开 → 输金额 → 点分类 → 点保存。
 * 你说花完当场就记，那这个流程里每多一步，都会在某个赶时间的时刻让你干脆不记了。
 *
 * 几个为速度做的取舍：
 * - 金额框自动聚焦并唤起数字键盘，打开就能直接输
 * - 分类做成一排可点的标签，而不是下拉菜单——下拉要点两次才能选中一个
 * - 币种默认本币，只有一个候选时整行不显示
 * - 日期默认今天，折叠在「更多」里
 * - 备注是可选的，也折叠起来
 */

export interface EntryDraft {
  amount: string;
  currency: string;
  category: string;
  date: string;
  note: string;
  kind: Entry["kind"];
}

export function EntrySheet({
  homeCurrency,
  today,
  onClose,
  onSubmit,
}: {
  homeCurrency: string;
  /** YYYY-MM-DD。由调用方给，组件自己不读时钟，方便测试与预览。 */
  today: string;
  onClose: () => void;
  onSubmit: (draft: EntryDraft) => void;
}) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(homeCurrency);
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<Entry["kind"]>("expense");
  const [showMore, setShowMore] = useState(false);

  const amountRef = useRef<HTMLInputElement>(null);

  // 打开时聚焦金额框，省掉一次点击。
  //
  // 这里不需要「每次打开重置表单」的逻辑：浮层关闭时由父组件整个卸载，
  // 重新打开就是一个全新实例，useState 的初始值自然生效。用 effect 去手动
  // 重置一堆 state 不但啰嗦，还会连着触发多次渲染。
  useEffect(() => {
    amountRef.current?.focus();
  }, []);

  // Esc 关闭。桌面上没有这个会让人觉得被困住。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const amountValid = /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0;

  function submit() {
    if (!amountValid) return;
    onSubmit({ amount, currency, category, date, note: note.trim(), kind });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      {/* 点遮罩关闭。移动端浮层的默认预期，没有会显得不听话。 */}
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="记一笔"
        className="relative w-full max-w-md rounded-t-3xl bg-surface px-6 pt-5 pb-7 shadow-xl sm:rounded-3xl"
      >
        {/* 顶部那道小横条是移动端浮层的通用信号：这个东西可以往下拖走。 */}
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-border-strong sm:hidden" />

        <div className="flex items-center justify-between pb-4">
          <div className="flex gap-1 rounded-full bg-surface-raised p-1">
            {(["expense", "income"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`rounded-full px-3 py-1 text-sm transition-colors ${
                  kind === k
                    ? "bg-accent text-accent-ink"
                    : "text-ink-muted hover:text-ink"
                }`}
              >
                {k === "expense" ? "支出" : "收入"}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-ink-muted transition-colors hover:text-ink"
          >
            取消
          </button>
        </div>

        {/* 金额。整个浮层里唯一的大字号，因为它是唯一必填的东西。 */}
        <div className="flex items-baseline gap-2 border-b border-border-subtle pb-4">
          <input
            ref={amountRef}
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            // inputMode 让手机弹数字键盘；type 仍是 text，
            // 因为 type="number" 在各家浏览器上的行为差异很大（滚轮改值、
            // 前导零、小数点被吞），对金额输入弊大于利。
            inputMode="decimal"
            placeholder="0"
            aria-label="金额"
            className="tnum min-w-0 flex-1 bg-transparent text-5xl font-semibold tracking-tight text-ink outline-none placeholder:text-ink-subtle/40"
          />
          <CurrencyPicker
            value={currency}
            homeCurrency={homeCurrency}
            onChange={setCurrency}
          />
        </div>

        {/* 分类。一排标签，点一次就选中。 */}
        <div className="flex flex-wrap gap-2 pt-4">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                category === c
                  ? "bg-ink text-background"
                  : "bg-surface-raised text-ink-muted hover:text-ink"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* 日期和备注不是每笔都要改，折叠起来省掉两行视觉负担。 */}
        <div className="pt-4">
          {showMore ? (
            <div className="flex flex-col gap-3">
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm text-ink-muted">日期</span>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="tnum rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-sm text-ink outline-none focus:border-border-strong"
                />
              </label>
              <label className="flex items-center gap-3">
                <span className="shrink-0 text-sm text-ink-muted">备注</span>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  placeholder="可不填"
                  className="min-w-0 flex-1 rounded-lg border border-border-subtle bg-surface px-3 py-1.5 text-sm text-ink outline-none placeholder:text-ink-subtle focus:border-border-strong"
                />
              </label>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowMore(true)}
              className="text-sm text-ink-muted transition-colors hover:text-ink"
            >
              日期 · 备注
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={!amountValid}
          className="mt-6 w-full rounded-full bg-accent py-3.5 text-sm font-medium text-accent-ink transition-opacity hover:opacity-90 active:opacity-80 disabled:cursor-not-allowed disabled:opacity-30"
        >
          保存
        </button>
      </div>
    </div>
  );
}

/**
 * 币种选择。
 *
 * 默认只显示当前币种，点一下才展开全部——「长期住一国，偶尔出国」意味着
 * 九成以上的记录都是本币，那一行常驻的币种选择就是九成时间里的噪音。
 */
function CurrencyPicker({
  value,
  homeCurrency,
  onChange,
}: {
  value: string;
  homeCurrency: string;
  onChange: (next: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="shrink-0 text-lg text-ink-subtle transition-colors hover:text-ink"
      >
        {value}
        {value !== homeCurrency ? null : " ▾"}
      </button>
    );
  }

  return (
    <div className="flex shrink-0 flex-wrap justify-end gap-1">
      {SPENDABLE_CURRENCIES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => {
            onChange(c);
            setExpanded(false);
          }}
          className={`rounded-md px-2 py-1 text-sm transition-colors ${
            value === c
              ? "bg-ink text-background"
              : "bg-surface-raised text-ink-muted hover:text-ink"
          }`}
        >
          {c}
        </button>
      ))}
    </div>
  );
}
