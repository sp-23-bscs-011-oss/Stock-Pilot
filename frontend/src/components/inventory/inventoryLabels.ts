import type { AdjustmentReason, StockStatus } from "../../types/inventory";

export const reasonLabels: Record<AdjustmentReason, string> = {
  STOCK_COUNT: "Stock count",
  RECEIVED: "Received",
  CUSTOMER_RETURN: "Customer return",
  DAMAGED: "Damaged",
  EXPIRED: "Expired",
  LOST: "Lost",
  THEFT: "Theft",
  RETURNED_TO_SUPPLIER: "Returned to supplier",
  OTHER: "Other",
};

export type AdjustmentAction = "add" | "remove" | "set";

/** Which reasons fit each action. Mirrors the direction rules the API enforces. */
export const reasonsByAction: Record<AdjustmentAction, AdjustmentReason[]> = {
  add: ["RECEIVED", "CUSTOMER_RETURN", "STOCK_COUNT", "OTHER"],
  remove: ["DAMAGED", "EXPIRED", "LOST", "THEFT", "RETURNED_TO_SUPPLIER", "STOCK_COUNT", "OTHER"],
  set: ["STOCK_COUNT", "OTHER"],
};

export const stockStatusLabels: Record<StockStatus, string> = {
  OK: "In stock",
  LOW: "Low stock",
  OUT: "Out of stock",
};

export function formatQuantityChange(change: number): string {
  return change > 0 ? `+${change}` : `−${Math.abs(change)}`;
}
