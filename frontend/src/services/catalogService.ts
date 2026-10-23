import type { Category, CategoryInput, Paginated, Product, ProductInput, ProductListParams } from "../types/catalog";
import { api } from "./apiClient";

type ProductResponse = { product: Product };
type CategoryResponse = { category: Category };

export const productService = {
  list(params: ProductListParams, signal?: AbortSignal): Promise<Paginated<Product>> {
    return api.get<Paginated<Product>>("/products", { params, signal });
  },

  async create(input: ProductInput): Promise<Product> {
    return (await api.post<ProductResponse>("/products", input)).product;
  },

  async update(id: string, input: Partial<ProductInput>): Promise<Product> {
    return (await api.patch<ProductResponse>(`/products/${id}`, input)).product;
  },

  async archive(id: string): Promise<Product> {
    return (await api.post<ProductResponse>(`/products/${id}/archive`)).product;
  },

  async restore(id: string): Promise<Product> {
    return (await api.post<ProductResponse>(`/products/${id}/restore`)).product;
  },
};

export const categoryService = {
  async list(signal?: AbortSignal): Promise<Category[]> {
    return (await api.get<{ categories: Category[] }>("/categories", { signal })).categories;
  },

  async create(input: CategoryInput): Promise<Category> {
    return (await api.post<CategoryResponse>("/categories", input)).category;
  },

  async update(id: string, input: Partial<CategoryInput>): Promise<Category> {
    return (await api.patch<CategoryResponse>(`/categories/${id}`, input)).category;
  },

  async remove(id: string): Promise<void> {
    await api.delete(`/categories/${id}`);
  },
};
