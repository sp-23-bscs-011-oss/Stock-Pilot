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
  PurchasePaymentInput,
  PaymentResult,
  PurchaseReceipt,
} from "../types/purchasing";
import type { Paginated } from "../types/catalog";
import { api } from "./apiClient";

type SupplierResponse = { supplier: Supplier };
type OrderResponse = { order: PurchaseOrderDetail };

export const supplierService = {
  async options(status: "active" | "all", signal?: AbortSignal): Promise<Supplier[]> {
    const items: Supplier[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const result = await api.get<Paginated<Supplier>>("/suppliers", {
        params: { page, pageSize: 100, status, sort: "name", order: "asc" }, signal,
      });
      items.push(...result.items);
      totalPages = result.totalPages;
      page += 1;
    } while (page <= totalPages);
    return items;
  },

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

  async setStatus(id: string, isActive: boolean): Promise<Supplier> {
    return (await api.patch<SupplierResponse>(`/suppliers/${id}/status`, { isActive })).supplier;
  },
};

export const purchaseOrderService = {
  list(params: PurchaseOrderListParams, signal?: AbortSignal): Promise<PurchaseOrderList> {
    return api.get<PurchaseOrderList>("/purchases", { params, signal });
  },

  async get(id: string, signal?: AbortSignal): Promise<PurchaseOrderDetail> {
    return (await api.get<OrderResponse>(`/purchases/${id}`, { signal })).order;
  },

  async create(input: PurchaseOrderInput): Promise<PurchaseOrderDetail> {
    return (await api.post<OrderResponse>("/purchases", input)).order;
  },

  async update(id: string, input: PurchaseOrderInput): Promise<PurchaseOrderDetail> {
    return (await api.patch<OrderResponse>(`/purchases/${id}`, input)).order;
  },

  async place(id: string): Promise<PurchaseOrderDetail> {
    return (await api.post<OrderResponse>(`/purchases/${id}/submit`)).order;
  },

  async cancel(id: string, reason: string | null): Promise<PurchaseOrderDetail> {
    return (await api.post<OrderResponse>(`/purchases/${id}/cancel`, { reason })).order;
  },

  receive(id: string, input: ReceiveInput): Promise<ReceiveResult> {
    return api.post<ReceiveResult>(`/purchases/${id}/receipts`, input);
  },

  async receipts(id: string, signal?: AbortSignal): Promise<PurchaseReceipt[]> {
    return (await api.get<{ receipts: PurchaseReceipt[] }>(`/purchases/${id}/receipts`, { signal })).receipts;
  },

  pay(id: string, input: PurchasePaymentInput): Promise<PaymentResult> {
    return api.post<PaymentResult>(`/purchases/${id}/payments`, input);
  },
};
