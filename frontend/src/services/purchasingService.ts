import type {
  PurchaseOrderDetail,
  PurchaseOrderInput,
  PurchaseOrderList,
  PurchaseOrderListParams,
  ReceiveInput,
  ReceiveResult,
  Supplier,
  SupplierDetail,
  SupplierInput,
  SupplierListParams,
  SupplierReport,
} from "../types/purchasing";
import type { Paginated } from "../types/catalog";
import { api } from "./apiClient";

type SupplierResponse = { supplier: Supplier };
type OrderResponse = { order: PurchaseOrderDetail };

export const supplierService = {
  list(params: SupplierListParams, signal?: AbortSignal): Promise<Paginated<Supplier>> {
    return api.get<Paginated<Supplier>>("/suppliers", { params, signal });
  },

  async get(id: string, signal?: AbortSignal): Promise<SupplierDetail> {
    return (await api.get<{ supplier: SupplierDetail }>(`/suppliers/${id}`, { signal })).supplier;
  },

  report(params: { from?: string; to?: string }, signal?: AbortSignal): Promise<SupplierReport> {
    return api.get<SupplierReport>("/suppliers/report", { params, signal });
  },

  async create(input: SupplierInput): Promise<Supplier> {
    return (await api.post<SupplierResponse>("/suppliers", input)).supplier;
  },

  async update(id: string, input: Partial<SupplierInput & { isActive: boolean }>): Promise<Supplier> {
    return (await api.patch<SupplierResponse>(`/suppliers/${id}`, input)).supplier;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/suppliers/${id}`);
  },
};

export const purchaseOrderService = {
  list(params: PurchaseOrderListParams, signal?: AbortSignal): Promise<PurchaseOrderList> {
    return api.get<PurchaseOrderList>("/purchase-orders", { params, signal });
  },

  async get(id: string, signal?: AbortSignal): Promise<PurchaseOrderDetail> {
    return (await api.get<OrderResponse>(`/purchase-orders/${id}`, { signal })).order;
  },

  async create(input: PurchaseOrderInput): Promise<PurchaseOrderDetail> {
    return (await api.post<OrderResponse>("/purchase-orders", input)).order;
  },

  async update(id: string, input: PurchaseOrderInput): Promise<PurchaseOrderDetail> {
    return (await api.put<OrderResponse>(`/purchase-orders/${id}`, input)).order;
  },

  async place(id: string): Promise<PurchaseOrderDetail> {
    return (await api.post<OrderResponse>(`/purchase-orders/${id}/order`)).order;
  },

  async cancel(id: string, reason: string | null): Promise<PurchaseOrderDetail> {
    return (await api.post<OrderResponse>(`/purchase-orders/${id}/cancel`, { reason })).order;
  },

  receive(id: string, input: ReceiveInput): Promise<ReceiveResult> {
    return api.post<ReceiveResult>(`/purchase-orders/${id}/receipts`, input);
  },
};
