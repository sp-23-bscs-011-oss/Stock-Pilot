/** PO-00042. Numbers come from a database sequence, so they are unique and never reused. */
export function formatPurchaseOrderNumber(number: number): string {
  return `PO-${String(number).padStart(5, "0")}`;
}

/** Reads "PO-00042", "po42" or "42" back into 42; null when the text isn't an order number. */
export function parsePurchaseOrderNumber(text: string): number | null {
  const match = /^(?:po-?)?0*(\d{1,9})$/i.exec(text.trim());
  return match ? Number(match[1]) : null;
}
