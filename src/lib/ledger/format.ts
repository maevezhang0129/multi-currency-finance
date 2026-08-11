/**
 * 展示层的格式化。只影响「怎么显示」，不参与任何计算——
 * 传进来的是字符串，出去的还是字符串，中途不经过 number 运算。
 */

/**
 * 千分位 + 固定两位小数。
 *
 * 固定用 en-US 而不是跟随本币的地区习惯：瑞典格式是 `12 340,00`（空格分隔、
 * 逗号做小数点），在中文界面里很容易被读成一百倍。金额读错的代价太大，
 * 不值得为「本地化正确」冒这个险。
 */
export function formatAmount(value: string): string {
  const [intPart = "0", fracPart = "00"] = value.split(".");
  const withSeparators = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${withSeparators}.${fracPart.padEnd(2, "0").slice(0, 2)}`;
}

/** `2026-08-10` → `08/10`。列表里年份是冗余的，同一屏基本都是同一年。 */
export function formatDayMonth(date: string): string {
  return date.slice(5).replace("-", "/");
}

/** `2026-08` → `2026 年 8 月`。 */
export function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  return `${year} 年 ${Number(m)} 月`;
}
