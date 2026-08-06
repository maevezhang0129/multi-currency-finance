/**
 * 汇率链路的固定配置。
 *
 * 这些不是环境变量：它们既不是密钥，也不随部署环境变化，属于产品定义的一部分。
 * 放进 env 只会让「改一个币种要动生产配置」这种事变得可能。
 */

/**
 * 基准币。
 *
 * 选 USD 而不是 EUR，是因为分析的落点是「以美元计的总资产与储蓄率」。
 * 需要注意的是数据源那边 USD 并非原生报价（见 README 的设计取舍），
 * 实测交叉换算误差在百万分之二以内。
 */
export const BASE_CURRENCY = "USD";

/** 关注的报价币。语义：1 USD = rate <quote>。 */
export const QUOTE_CURRENCIES = ["SEK", "THB", "CNY"] as const;

export type QuoteCurrency = (typeof QUOTE_CURRENCIES)[number];

/**
 * 允许回填的最早月份。
 *
 * ECB 参考汇率从 1999-01 开始，但各币种起点不同（CNY 要到 2005 年才有）。
 * 早于起点的月份会被 ingest 记为 skipped，不会当成故障。
 */
export const EARLIEST_MONTH = "1999-01";

/** 单次请求允许回填的月份数上限，防止手滑打出一个跨世纪的区间。 */
export const MAX_MONTHS_PER_RUN = 600;
