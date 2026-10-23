import type { Paginated } from "../types/catalog";
import type {
  AdjustStockInput,
  AdjustStockResult,
  InventoryList,
  InventoryListParams,
  MovementListParams,
  StockMovement,
  Store,
} from "../types/inventory";
import { api } from "./apiClient";

export const inventoryService = {
  list(params: InventoryListParams, signal?: AbortSignal): Promise<InventoryList> {
    return api.get<InventoryList>("/inventory", { params, signal });
  },

  adjust(input: AdjustStockInput): Promise<AdjustStockResult> {
    return api.post<AdjustStockResult>("/inventory/adjustments", input);
  },

  movements(params: MovementListParams, signal?: AbortSignal): Promise<Paginated<StockMovement>> {
    return api.get<Paginated<StockMovement>>("/inventory/movements", { params, signal });
  },
};

type StoreResponse = { store: Store };

export const storeService = {
  async list(options: { includeInactive?: boolean } = {}, signal?: AbortSignal): Promise<Store[]> {
    const params = options.includeInactive ? { includeInactive: "true" } : undefined;
    return (await api.get<{ stores: Store[] }>("/stores", { params, signal })).stores;
  },

  async create(input: { name: string; code: string }): Promise<Store> {
    return (await api.post<StoreResponse>("/stores", input)).store;
  },

  async update(id: string, input: Partial<{ name: string; code: string; isActive: boolean }>): Promise<Store> {
    return (await api.patch<StoreResponse>(`/stores/${id}`, input)).store;
  },
};
