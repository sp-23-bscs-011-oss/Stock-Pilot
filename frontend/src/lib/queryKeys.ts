import type { ProductListParams } from "../types/catalog";
import type { InventoryListParams, MovementListParams } from "../types/inventory";
import type { PurchaseOrderListParams, SupplierListParams } from "../types/purchasing";

/** Central registry of TanStack Query keys, so invalidation stays consistent. */
export const queryKeys = {
  health: ["health"] as const,
  auth: {
    me: ["auth", "me"] as const,
    setupStatus: ["auth", "setup-status"] as const,
  },
  users: ["users"] as const,
  categories: ["categories"] as const,
  products: {
    all: ["products"] as const,
    list: (params: ProductListParams) => ["products", "list", params] as const,
  },
  stores: (includeInactive = false) => ["stores", { includeInactive }] as const,
  storesAll: ["stores"] as const,
  inventory: {
    all: ["inventory"] as const,
    list: (params: InventoryListParams) => ["inventory", "list", params] as const,
    movements: (params: MovementListParams) => ["inventory", "movements", params] as const,
  },
  suppliers: {
    all: ["suppliers"] as const,
    list: (params: SupplierListParams) => ["suppliers", "list", params] as const,
    /** Every active supplier, for pickers. */
    options: ["suppliers", "options"] as const,
    detail: (id: string) => ["suppliers", "detail", id] as const,
    report: (params: { from?: string; to?: string }) => ["suppliers", "report", params] as const,
  },
  purchaseOrders: {
    all: ["purchase-orders"] as const,
    list: (params: PurchaseOrderListParams) => ["purchase-orders", "list", params] as const,
    detail: (id: string) => ["purchase-orders", "detail", id] as const,
  },
};
