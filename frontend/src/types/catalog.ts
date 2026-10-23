export interface Category {
  id: string;
  name: string;
  description: string | null;
  /** Active products in the category. */
  productCount: number;
  /** Including archived products; only categories with 0 can be deleted. */
  totalProductCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  /** Decimal string such as "12.50". */
  sellingPrice: string;
  /** Only present for owners and managers. */
  costPrice?: string;
  reorderThreshold: number;
  category: { id: string; name: string } | null;
  isArchived: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ProductSortField = "name" | "sku" | "sellingPrice" | "costPrice" | "reorderThreshold" | "createdAt" | "updatedAt";
export type ProductStatusFilter = "active" | "archived" | "all";
export type SortOrder = "asc" | "desc";

export interface ProductListParams {
  page: number;
  pageSize: number;
  search?: string;
  /** A category id, or "none" for uncategorized. */
  categoryId?: string;
  status: ProductStatusFilter;
  sort: ProductSortField;
  order: SortOrder;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ProductInput {
  sku: string;
  barcode: string | null;
  name: string;
  description: string | null;
  costPrice: string;
  sellingPrice: string;
  categoryId: string | null;
  reorderThreshold: number;
}

export interface CategoryInput {
  name: string;
  description?: string | null;
}
