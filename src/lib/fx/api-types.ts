/**
 * `/api/fx` 的响应形状。前后端共用同一份定义——接口契约只写在一处，
 * 后端改了形状而前端没跟上时，`tsc` 会先于用户发现。
 *
 * 这个文件刻意不带 `server-only`：它只有类型，没有任何运行时代码或密钥，
 * 客户端组件需要 import 它。
 */

export interface FxSeriesPoint {
  /** YYYY-MM */
  month: string;
  /**
   * 汇率，字符串。
   *
   * 库里是 numeric，Drizzle 映射为 string 正是为了不丢精度。要画图时才
   * `Number()`，转出来的是展示值——不要在类型里把它改成 number，那等于
   * 把「什么时候允许丢精度」这个决定从代码里抹掉。
   */
  rate: string;
}

export interface FxSeries {
  quote: string;
  /** 该币种在请求区间内的月度汇率，按月份升序。无数据时为空数组。 */
  points: FxSeriesPoint[];
}

export interface FxResponse {
  base: string;
  /** 请求时省略则为 null，表示不设边界。 */
  from: string | null;
  to: string | null;
  /** 顺序与请求给定的币种顺序一致。 */
  series: FxSeries[];
}
