/**
 * 月份运算。全部是纯函数，不碰时区也不碰 Date 的本地时区行为。
 *
 * 这里刻意不用 `new Date()` 做月份加减：Date 的月份运算会受运行环境时区影响，
 * 而「2026-01」这种月份标识本身是无时区的。用字符串和整数算，跨年、月末、
 * 闰年都不会出意外。
 */

/** 月份标识，形如 `2026-01`。与数据库 fx_rates.month 列同格式。 */
export type Month = string;

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(value: string): value is Month {
  return MONTH_PATTERN.test(value);
}

/** 解析成 { year, month }，month 为 1..12。格式非法时抛错。 */
export function parseMonth(value: Month): { year: number; month: number } {
  const matched = MONTH_PATTERN.exec(value);
  if (!matched) {
    throw new Error(`月份格式非法：${value}，应为 YYYY-MM`);
  }
  // 正则已保证两个捕获组存在，但 noUncheckedIndexedAccess 下仍需收窄。
  const [, yearText, monthText] = matched;
  if (yearText === undefined || monthText === undefined) {
    throw new Error(`月份格式非法：${value}，应为 YYYY-MM`);
  }
  return { year: Number(yearText), month: Number(monthText) };
}

export function formatMonth(year: number, month: number): Month {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** 相对某个月偏移若干个月，offset 可为负。 */
export function addMonths(value: Month, offset: number): Month {
  const { year, month } = parseMonth(value);
  // 转成「从 0 年 1 月起的第几个月」再加减，跨年由整除自然处理。
  const total = year * 12 + (month - 1) + offset;
  return formatMonth(Math.floor(total / 12), (total % 12) + 1);
}

/** 某个 UTC 时刻所属的月份。用 UTC 取值，避免部署环境时区把月初/月末算偏。 */
export function monthOf(date: Date): Month {
  return formatMonth(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

/**
 * 上一个自然月。cron 在月初触发，要抓的是刚过去的那个完整月份。
 */
export function previousMonth(now: Date): Month {
  return addMonths(monthOf(now), -1);
}

/**
 * 某个月的起止日期（含首尾），格式 YYYY-MM-DD，供汇率接口的区间查询使用。
 *
 * 末日用 `Date.UTC(year, month, 0)` 取：把「下个月的第 0 天」解释为
 * 「本月最后一天」，闰年 2 月自然得到 29，不需要自己判断闰年规则。
 */
export function monthRange(value: Month): { start: string; end: string } {
  const { year, month } = parseMonth(value);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    start: `${year}-${pad(month)}-01`,
    end: `${year}-${pad(month)}-${pad(lastDay)}`,
  };
}

/** 生成 [from, to] 闭区间内的所有月份，升序。from 晚于 to 时返回空数组。 */
export function monthsBetween(from: Month, to: Month): Month[] {
  const months: Month[] = [];
  let cursor = from;
  // 月份定长零填充，字典序即时间序，可以直接比较字符串。
  while (cursor <= to) {
    months.push(cursor);
    cursor = addMonths(cursor, 1);
  }
  return months;
}
