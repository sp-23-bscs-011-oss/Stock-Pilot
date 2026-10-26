import type { Paginated, SortOrder } from "./catalog";

type Person = { id: string; name: string } | null;

export interface SupplierStats {
  orderCount: number;
  openOrders: number;
  draftOrders: number;
  /** Decimal strings such as "120.50". */
  orderedValue: string;
  receivedValue: string;
  unitsReceived: number;
  outstandingValue: string;
  paidTotal: string;
  balanceDue: string;
  averageLeadTimeDays: number | null;
  lastOrderedAt: string | null;
}

export interface Supplier {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTerms: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  stats: SupplierStats;
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: Person;
  details: Record<string, unknown> | null;
  createdAt: string;
}

export interface SupplierDetail extends Supplier {
  activity: AuditEntry[];
}

export interface SupplierInput {
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  paymentTerms: string | null;
  notes: string | null;
}

export type SupplierStatusFilter = "active" | "inactive" | "all";

export interface SupplierListParams {
  page: number;
  pageSize: number;
  search?: string;
  status: SupplierStatusFilter;
  sort: "name" | "createdAt" | "updatedAt";
  order: SortOrder;
}

export interface SupplierReport {
  from: string | null;
  to: string | null;
  rows: { supplier: { id: string; name: string; isActive: boolean }; stats: SupplierStats }[];
  totals: {
    orderCount: number;
    openOrders: number;
    orderedValue: string;
    receivedValue: string;
    unitsReceived: number;
    outstandingValue: string;
    paidTotal: string;
    balanceDue: string;
  };
}

export type PurchaseOrderStatus = "DRAFT" | "ORDERED" | "PARTIALLY_RECEIVED" | "RECEIVED" | "CANCELLED";
export type PaymentStatus = "NOT_DUE" | "UNPAID" | "PARTIALLY_PAID" | "PAID";
export type PaymentMethod = "CASH" | "BANK_TRANSFER" | "CARD" | "CHEQUE" | "OTHER";

export interface PurchasePaymentInput {
  idempotencyKey: string;
  amount: string;
  method: PaymentMethod;
  reference: string | null;
  paidAt: string;
}

export interface PurchasePayment {
  id: string;
  amount: string;
  method: PaymentMethod;
  reference: string | null;
  paidAt: string;
  recordedBy: Person;
  createdAt: string;
}

export interface PaymentResult {
  replayed: boolean;
  paymentId: string;
  order: PurchaseOrderDetail;
}

export interface PurchaseOrderSummary {
  id: string;
  /** "PO-00042" */
  number: string;
  status: PurchaseOrderStatus;
  supplier: { id: string; name: string; isActive: boolean };
  store: { id: string; name: string; code: string };
  /** yyyy-mm-dd */
  expectedAt: string | null;
  total: string;
  payableTotal: string;
  paidTotal: string;
  balanceDue: string;
  paymentStatus: PaymentStatus;
  receivedValue: string;
  lineCount: number;
  unitsOrdered: number;
  unitsReceived: number;
  createdBy: Person;
  createdAt: string;
  orderedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  updatedAt: string;
}

export interface PurchaseOrderLine {
  id: string;
  productId: string;
  position: number;
  sku: string;
  productName: string;
  quantityOrdered: number;
  quantityReceived: number;
  /** 0 unless the order is open. */
  quantityOutstanding: number;
  unitCost: string;
  lineTotal: string;
  receivedValue: string;
}

export interface PurchaseReceipt {
  id: string;
  receivedAt: string;
  receivedBy: Person;
  note: string | null;
  units: number;
  value: string;
  lines: { lineId: string; productId: string; sku: string; productName: string; quantity: number; unitCost: string }[];
}

export interface PurchaseOrderDetail extends Omit<PurchaseOrderSummary, "supplier" | "store"> {
  supplier: {
    id: string;
    name: string;
    isActive: boolean;
    contactName: string | null;
    email: string | null;
    phone: string | null;
    paymentTerms: string | null;
  };
  store: { id: string; name: string; code: string; isActive: boolean };
  note: string | null;
  orderedBy: Person;
  cancelledBy: Person;
  cancelReason: string | null;
  outstandingValue: string;
  lines: PurchaseOrderLine[];
  receipts: PurchaseReceipt[];
  payments: PurchasePayment[];
  activity: AuditEntry[];
}

export interface PurchaseOrderList extends Paginated<PurchaseOrderSummary> {
  statusCounts: Record<PurchaseOrderStatus, number>;
}

export type PurchaseOrderSortField = "number" | "createdAt" | "expectedAt" | "total";

export interface PurchaseOrderListParams {
  page: number;
  pageSize: number;
  search?: string;
  status?: PurchaseOrderStatus;
  open?: "true";
  supplierId?: string;
  storeId?: string;
  productId?: string;
  from?: string;
  to?: string;
  sort: PurchaseOrderSortField;
  order: SortOrder;
}

export interface PurchaseOrderInput {
  supplierId: string;
  storeId: string;
  expectedAt: string | null;
  note: string | null;
  lines: { productId: string; quantity: number; unitCost: string }[];
}

export interface ReceiveInput {
  idempotencyKey: string;
  note: string | null;
  lines: { lineId: string; quantity: number }[];
}

export interface ReceiveResult {
  replayed: boolean;
  receiptId: string;
  order: PurchaseOrderDetail;
}
