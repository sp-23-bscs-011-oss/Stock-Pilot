import type { AuditEntry, PurchaseOrderStatus } from "../../types/purchasing";

export const statusLabels: Record<PurchaseOrderStatus, string> = {
  DRAFT: "Draft",
  ORDERED: "Ordered",
  PARTIALLY_RECEIVED: "Partially received",
  RECEIVED: "Received",
  CANCELLED: "Cancelled",
};

export const ORDER_STATUSES = Object.keys(statusLabels) as PurchaseOrderStatus[];

/** yyyy-mm-dd (a calendar date, no time zone) for display. */
export function formatDay(day: string | null, fallback = "—"): string {
  if (!day) return fallback;
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date).toLocaleDateString(undefined, { dateStyle: "medium" });
}

/** Local midnight at the start (or end) of a yyyy-mm-dd day, as an ISO timestamp for the API. */
export function dayBoundary(day: string, end: boolean): string | undefined {
  if (!day) return undefined;
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return undefined;
  return (end ? new Date(year, month - 1, date, 23, 59, 59, 999) : new Date(year, month - 1, date)).toISOString();
}

const actionLabels: Record<string, string> = {
  "supplier.created": "Supplier added",
  "supplier.updated": "Details updated",
  "supplier.deactivated": "Supplier deactivated",
  "supplier.reactivated": "Supplier reactivated",
  "supplier.deleted": "Supplier deleted",
  "purchase_order.created": "Draft created",
  "purchase_order.updated": "Draft edited",
  "purchase_order.ordered": "Marked as ordered",
  "purchase_order.received": "Stock received",
  "purchase_order.cancelled": "Order cancelled",
  "purchase_order.payment_recorded": "Supplier payment recorded",
};

export function auditActionLabel(entry: AuditEntry): string {
  return actionLabels[entry.action] ?? entry.action;
}
