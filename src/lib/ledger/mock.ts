/**
 * 排版阶段用的假数据。**步骤 2 接上真实存储后会删掉这个文件。**
 *
 * 为什么用假数据先排版：布局一旦和数据结构绑在一起，改布局就要动数据层，
 * 试错成本立刻变高。先用一组「像真的」的数据把版面排顺，再回头设计存储结构，
 * 两边都能改得更自由。
 *
 * 数据刻意做得不规整——金额有长有短、分类多寡不一、其中一笔是外币。
 * 用整齐的假数据排版是自欺：真实数据一进来，对齐和溢出的问题才会全部冒出来。
 */

export interface MockEntry {
  id: string;
  date: string;
  amount: string;
  currency: string;
  category: string;
  note?: string;
  /** 折算成基准币后的金额。外币消费才有意义。 */
  convertedAmount?: string;
}

export const HOME_CURRENCY = "SEK";
export const BASE_CURRENCY = "USD";

export const MOCK_MONTH = "2026-08";

/** 本月支出，本币合计。 */
export const MOCK_TOTAL = "12340.00";
/** 折合基准币。 */
export const MOCK_TOTAL_BASE = "1276.40";
/** 上月同口径，用来算环比。 */
export const MOCK_PREV_TOTAL = "11426.00";
/**
 * 汇率影响：本币视角与基准币视角的差额。
 * 长期住一国的人平时这一项接近 0，只有出国那个月才有值。
 */
export const MOCK_FX_IMPACT = "-34.20";

export interface MockCategory {
  name: string;
  amount: string;
}

export const MOCK_CATEGORIES: MockCategory[] = [
  { name: "住宿", amount: "5000.00" },
  { name: "餐饮", amount: "4218.50" },
  { name: "交通", amount: "1140.00" },
  { name: "日用", amount: "986.50" },
  { name: "娱乐", amount: "620.00" },
  { name: "其他", amount: "375.00" },
];

export const MOCK_ENTRIES: MockEntry[] = [
  { id: "1", date: "2026-08-10", amount: "142.00", currency: "SEK", category: "餐饮", note: "午餐" },
  { id: "2", date: "2026-08-09", amount: "890.00", currency: "SEK", category: "交通", note: "地铁月票" },
  {
    id: "3",
    date: "2026-08-07",
    amount: "1250.00",
    currency: "THB",
    category: "娱乐",
    note: "曼谷 · 潜水课",
    convertedAmount: "37.31",
  },
  { id: "4", date: "2026-08-06", amount: "63.50", currency: "SEK", category: "日用", note: "洗衣液" },
  { id: "5", date: "2026-08-05", amount: "5000.00", currency: "SEK", category: "住宿", note: "8 月房租" },
];

/**
 * 千分位 + 固定两位小数。展示用，不参与任何计算。
 *
 * 用 en-US 而不是跟着本币走（sv-SE 会给出 `12 340,00`，空格分隔、逗号做小数点）。
 * 界面是中文的，`12,340.00` 这种写法在中文语境里最不容易读错——
 * 尤其是逗号当小数点这件事，看惯了英美格式的人会直接读错一百倍。
 */
export function formatAmount(value: string): string {
  const n = Number(value);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** 环比百分比，正数表示比上月多花。 */
export function changeVsPrevious(): number {
  const now = Number(MOCK_TOTAL);
  const prev = Number(MOCK_PREV_TOTAL);
  return ((now - prev) / prev) * 100;
}
