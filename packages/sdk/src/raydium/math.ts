/** Fee-rate denominator shared by LaunchLab and CPMM (rates are in 1e-6 units). */
export const FEE_RATE_DENOMINATOR = 1_000_000n;

export function ceilDiv(a: bigint, b: bigint, denom: bigint): bigint {
  if (denom === 0n) throw new RangeError("Division by zero");
  return (a * b + denom - 1n) / denom;
}

export function floorDiv(a: bigint, b: bigint, denom: bigint): bigint {
  if (denom === 0n) throw new RangeError("Division by zero");
  return (a * b) / denom;
}

/** Gross-up: smallest pre-fee amount whose fee-deducted value is >= `postFee`. */
export function preFeeAmount(postFee: bigint, feeRate: bigint): bigint {
  if (feeRate === 0n) return postFee;
  if (feeRate >= FEE_RATE_DENOMINATOR) throw new RangeError("feeRate must be < 1_000_000");
  const denom = FEE_RATE_DENOMINATOR - feeRate;
  return (postFee * FEE_RATE_DENOMINATOR + denom - 1n) / denom;
}

/** Constant-product output, rounding down (x*y=k). */
export function cpAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn <= 0n) return 0n;
  return (amountIn * reserveOut) / (reserveIn + amountIn);
}

/** Constant-product input required for `amountOut`, rounding up. */
export function cpAmountIn(amountOut: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountOut <= 0n) return 0n;
  if (amountOut >= reserveOut) throw new RangeError("amountOut exceeds reserve");
  const num = reserveIn * amountOut;
  const den = reserveOut - amountOut;
  return (num + den - 1n) / den;
}

/** Integer square root (floor). */
export function isqrt(n: bigint): bigint {
  if (n < 0n) throw new RangeError("isqrt of negative");
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

/** Converts raw integer amounts to a decimal string without floating point loss. */
export function formatUnits(amount: bigint, decimals: number): string {
  const neg = amount < 0n;
  const abs = neg ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
}

/** Parses a decimal string into raw integer units. Truncates excess precision. */
export function parseUnits(value: string, decimals: number): bigint {
  const v = value.trim();
  if (!/^-?\d*(\.\d*)?$/.test(v) || v === "" || v === "." || v === "-") {
    throw new Error(`Invalid amount "${value}"`);
  }
  const neg = v.startsWith("-");
  const [w = "0", f = ""] = (neg ? v.slice(1) : v).split(".");
  const raw = BigInt(w || "0") * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  return neg ? -raw : raw;
}
