import { z } from "zod";
import type { Product, ProductInput } from "../../types/catalog";

// Mirrors backend/src/validators/catalog.schemas.ts so mistakes show up before a round trip.
// The API remains the authority and re-validates everything.

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

const money = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${label}`)
    .regex(MONEY_PATTERN, "Use a non-negative amount with up to 2 decimals, e.g. 4.99");

/** Form values are the raw strings from the inputs; the schema converts them to an API payload. */
export const productFormSchema = z
  .object({
    sku: z
      .string()
      .trim()
      .min(1, "Enter an SKU")
      .max(64, "SKU must be at most 64 characters")
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Use letters, numbers, and . _ / - (no spaces)"),
    barcode: z
      .string()
      .trim()
      .regex(/^$|^[A-Za-z0-9.-]{3,64}$/, "Use 3–64 letters, numbers, dots or dashes"),
    name: z.string().trim().min(1, "Enter a product name").max(160, "Name must be at most 160 characters"),
    description: z.string().trim().max(2000, "Description must be at most 2,000 characters"),
    categoryId: z.string(),
    costPrice: money("cost price"),
    sellingPrice: money("selling price"),
    reorderThreshold: z
      .string()
      .trim()
      .regex(/^\d+$/, "Enter a whole number, 0 or more")
      .refine((value) => Number(value) <= 1_000_000, "Must be at most 1,000,000"),
  })
  .transform(
    (values): ProductInput => ({
      sku: values.sku.toUpperCase(),
      barcode: values.barcode || null,
      name: values.name,
      description: values.description || null,
      categoryId: values.categoryId || null,
      costPrice: values.costPrice,
      sellingPrice: values.sellingPrice,
      reorderThreshold: Number(values.reorderThreshold),
    }),
  );

export type ProductFormValues = z.input<typeof productFormSchema>;
export type ProductFormField = keyof ProductFormValues;

export function emptyProductForm(): ProductFormValues {
  return {
    sku: "",
    barcode: "",
    name: "",
    description: "",
    categoryId: "",
    costPrice: "",
    sellingPrice: "",
    reorderThreshold: "0",
  };
}

export function productToForm(product: Product): ProductFormValues {
  return {
    sku: product.sku,
    barcode: product.barcode ?? "",
    name: product.name,
    description: product.description ?? "",
    categoryId: product.category?.id ?? "",
    costPrice: product.costPrice ?? "",
    sellingPrice: product.sellingPrice,
    reorderThreshold: String(product.reorderThreshold),
  };
}

export type ProductFormErrors = Partial<Record<ProductFormField, string>>;

export function validateProductForm(
  values: ProductFormValues,
): { ok: true; data: ProductInput } | { ok: false; errors: ProductFormErrors } {
  const result = productFormSchema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };

  const errors: ProductFormErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as ProductFormField | undefined;
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}
