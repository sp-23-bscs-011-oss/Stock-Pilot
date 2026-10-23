/**
 * Exact money arithmetic for previews (order totals while editing). Amounts are handled as
 * integer cents in BigInt, so 3 × 0.10 is exactly 0.30. The API recomputes and is the
 * authority; these helpers only keep what the user sees in agreement with it.
 */

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export function isMoney(value: string): boolean {
  return MONEY_PATTERN.test(value.trim());
}

/** "12.5" → 1250n; null when the text isn't a valid non-negative amount. */
export function toCents(value: string): bigint | null {
  const trimmed = value.trim();
  if (!MONEY_PATTERN.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}

/** 1250n → "12.50" */
export function fromCents(cents: bigint): string {
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, "0")}`;
}

export function multiplyCents(cents: bigint, quantity: number): bigint {
  return cents * BigInt(quantity);
}
