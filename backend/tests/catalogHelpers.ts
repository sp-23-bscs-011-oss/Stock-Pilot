import { categoryNameKey } from "../src/services/category.service.js";
import { prisma } from "./helpers.js";

let counter = 0;

export async function createCategory(name = `Category ${++counter}`) {
  return prisma.category.create({ data: { name, nameKey: categoryNameKey(name) } });
}

export async function createProduct(
  overrides: Partial<{
    sku: string;
    barcode: string | null;
    name: string;
    costPrice: string;
    sellingPrice: string;
    categoryId: string | null;
    archivedAt: Date | null;
  }> = {},
) {
  counter += 1;
  return prisma.product.create({
    data: {
      sku: `SKU-${counter}`,
      name: `Product ${counter}`,
      costPrice: "5.00",
      sellingPrice: "9.99",
      ...overrides,
    },
  });
}

/** A valid request body for POST /api/products. */
export function productBody(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    sku: `new-${counter}`,
    barcode: `400000${counter}`,
    name: `New product ${counter}`,
    description: "A test product",
    costPrice: "4.20",
    sellingPrice: 7.5,
    reorderThreshold: 10,
    ...overrides,
  };
}
