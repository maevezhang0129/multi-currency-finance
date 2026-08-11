/**
 * 十进制金额运算。纯函数，不依赖任何浮点。
 *
 * 为什么不能直接用 JS 的数字乘法：二进制浮点存不下 0.1 这类十进制小数。
 * `0.1 + 0.2` 得到 0.30000000000000004 是最出名的例子，但乘法一样会错——
 * 一笔一笔攒下来，月度合计就会出现「差一分钱」这种最难解释的 bug。
 *
 * 这里的做法是把小数当整数算：`142.00` 记成「14200，两位小数」，
 * 乘完再按需要的位数四舍五入。全程用 BigInt，中间结果多大都不会溢出。
 */

interface Decimal {
  /** 去掉小数点后的整数值。 */
  digits: bigint;
  /** 小数位数。 */
  scale: number;
}

const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;

function parse(value: string, label: string): Decimal {
  const matched = DECIMAL_PATTERN.exec(value);
  if (!matched) {
    throw new Error(`${label}不是合法的十进制数字：${value}`);
  }
  // 正则已保证第一组存在，但 noUncheckedIndexedAccess 下仍需收窄。
  const intPart = matched[1];
  if (intPart === undefined) {
    throw new Error(`${label}不是合法的十进制数字：${value}`);
  }
  const fracPart = matched[2] ?? "";
  return {
    digits: BigInt(intPart + fracPart),
    scale: fracPart.length,
  };
}

/** 按指定小数位四舍五入，并格式化回字符串。 */
function render(value: Decimal, targetScale: number): string {
  let digits = value.digits;

  if (value.scale < targetScale) {
    digits *= 10n ** BigInt(targetScale - value.scale);
  } else if (value.scale > targetScale) {
    const divisor = 10n ** BigInt(value.scale - targetScale);
    const quotient = digits / divisor;
    const remainder = digits % divisor;
    // 四舍五入。余数的两倍达到除数就进位，等价于「余数 >= 0.5 个单位」。
    // 这里的输入恒为非负（金额和汇率都要求大于 0），不必处理负数方向。
    digits = remainder * 2n >= divisor ? quotient + 1n : quotient;
  }

  if (targetScale === 0) return digits.toString();

  const text = digits.toString().padStart(targetScale + 1, "0");
  const cut = text.length - targetScale;
  return `${text.slice(0, cut)}.${text.slice(cut)}`;
}

/**
 * 金额 × 汇率，结果保留 `scale` 位小数。
 *
 * 例：`multiply("1250.00", "0.0298507463", 2)` → `"37.31"`
 */
export function multiply(amount: string, rate: string, scale = 2): string {
  const a = parse(amount, "金额");
  const b = parse(rate, "汇率");
  return render(
    { digits: a.digits * b.digits, scale: a.scale + b.scale },
    scale,
  );
}

/**
 * 金额 ÷ 汇率，结果保留 `scale` 位小数。
 *
 * 汇率的语义是「1 base = rate quote」，所以把 quote 币金额换回 base 币要用除法。
 * 除法除不尽，先放大再整除，才能在目标位数上正确四舍五入。
 */
export function divide(amount: string, rate: string, scale = 2): string {
  const a = parse(amount, "金额");
  const b = parse(rate, "汇率");

  if (b.digits === 0n) throw new Error("汇率不能为 0");

  // 先把被除数放大到「目标位数再多一位」，多出来的那位用于四舍五入。
  const shift = BigInt(scale + 1 + b.scale - a.scale);
  const scaled =
    shift >= 0n
      ? a.digits * 10n ** shift
      : a.digits / 10n ** -shift;

  return render({ digits: scaled / b.digits, scale: scale + 1 }, scale);
}

/** 多个金额相加，全部按相同位数对齐。 */
export function sum(amounts: readonly string[], scale = 2): string {
  let total = 0n;
  for (const amount of amounts) {
    const parsed = parse(amount, "金额");
    total +=
      parsed.scale <= scale
        ? parsed.digits * 10n ** BigInt(scale - parsed.scale)
        : BigInt(render(parsed, scale).replace(".", ""));
  }
  return render({ digits: total, scale }, scale);
}
