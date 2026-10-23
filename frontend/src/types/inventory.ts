import type { Paginated, SortOrder } from "./catalog";

export interface Store {
  id: string;
  name: string;
  code: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export type StockStatus = "OUT" | "LOW" | "OK";
export type StockStatusFilter = "all" | "needs_reorder" | "low" | "out" | "ok";
export type InventorySortField = "name" | "sku" | "quantity" | "reorderThreshold" | "updatedAt";

export interface InventoryItem {
  productId: string;
  sku: string;
  barcode: string | null;
  name: string;
  category: { id: string; name: string } | null;
  quantity: number;
  reorderThreshold: number;
  status: StockStatus;
  /** When stock last changed in this store; null if it never has. */
  updatedAt: string | null;
}

export interface InventorySummary {
  products: number;
  units: number;
  low: number;
  out: number;
}

export interface InventoryList extends Paginated<InventoryItem> {
  summary: InventorySummary;
}

export interface InventoryListParams {
  storeId: string;
  page: number;
  pageSize: number;
  search?: string;
  categoryId?: string;
  stockStatus: StockStatusFilter;
  sort: InventorySortField;
  order: SortOrder;
}

export type AdjustmentReason =
  | "STOCK_COUNT"
  | "RECEIVED"
  | "CUSTOMER_RETURN"
  | "DAMAGED"
  | "EXPIRED"
  | "LOST"
  | "THEFT"
  | "RETURNED_TO_SUPPLIER"
  | "OTHER";

export interface StockMovement {
  id: string;
  type: "ADJUSTMENT" | "PURCHASE_RECEIPT";
  reason: AdjustmentReason | null;
  note: string | null;
  quantityChange: number;
  quantityBefore: number;
  quantityAfter: number;
  product: { id: string; sku: string; name: string };
  store: { id: string; name: string; code: string };
  createdBy: { id: string; name: string } | null;
  /** Set for PURCHASE_RECEIPT movements. */
  purchaseOrder: { id: string; number: string } | null;
  createdAt: string;
}

export interface MovementListParams {
  storeId?: string;
  productId?: string;
  reason?: AdjustmentReason;
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

export interface AdjustStockInput {
  storeId: string;
  productId: string;
  mode: "change" | "set";
  quantity: number;
  reason: AdjustmentReason;
  note: string | null;
  expectedQuantity?: number;
}

export interface AdjustStockResult {
  level: { productId: string; storeId: string; quantity: number; status: StockStatus };
  movement: StockMovement;
}
