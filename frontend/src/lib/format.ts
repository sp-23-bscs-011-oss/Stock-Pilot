import { env } from "../config/env";

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

const moneyFormat = createMoneyFormat(env.currency);

function createMoneyFormat(currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency });
  } catch {
    // An invalid VITE_CURRENCY shouldn't take the whole app down.
    return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}

/** Formats a decimal string from the API ("12.50") for display. */
export function formatMoney(value: string | null | undefined): string {
  return value == null ? "—" : moneyFormat.format(Number(value));
}

/** Gross margin as a percentage of the selling price, or null when it can't be computed. */
export function marginPercent(cost: string | undefined, price: string): number | null {
  const selling = Number(price);
  const unitCost = Number(cost);
  if (cost === undefined || !Number.isFinite(unitCost) || !Number.isFinite(selling) || selling <= 0) return null;
  return ((selling - unitCost) / selling) * 100;
}

export function formatDateTime(value: string | null | undefined, fallback = "Never"): string {
  return value ? dateTimeFormat.format(new Date(value)) : fallback;
}
