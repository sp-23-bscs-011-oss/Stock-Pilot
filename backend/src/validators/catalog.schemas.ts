import { z } from "zod";

// ─── Shared field rules ──────────────────────────────────────────────────────

const MONEY_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

/**
 * Money arrives as a string ("12.50") or a number (12.5) and leaves as a string Prisma can
 * store exactly in DECIMAL(12,2). Floats with representation noise (0.1 + 0.2) are rejected
 * rather than silently rounded.
 */
export const moneySchema = z
  .union([z.string().trim(), z.number()], { error: "Enter an amount" })
  .transform((value) => (typeof value === "number" ? String(value) : value))
  .pipe(z.string().regex(MONEY_PATTERN, "Enter a non-negative amount with at most 2 decimal places"));

/** Empty strings mean "no value" for optional text fields. */
export function optionalText(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .nullish()
    .transform((value) => value || null);
}

export const skuSchema = z
  .string({ error: "SKU is required" })
  .trim()
  .toUpperCase()
  .min(1, "SKU is required")
  .max(64, "SKU must be at most 64 characters")
  .regex(/^[A-Z0-9][A-Z0-9._/-]*$/, "Use letters, numbers, and . _ / - (starting with a letter or number)");

export const barcodeSchema = z
  .string()
  .trim()
  .max(64, "Barcode must be at most 64 characters")
  .regex(/^$|^[A-Za-z0-9.-]{3,64}$/, "Use 3–64 letters, numbers, dots or dashes")
  .nullish()
  .transform((value) => value || null);

const productNameSchema = z
  .string({ error: "Name is required" })
  .trim()
  .min(1, "Name is required")
  .max(160, "Name must be at most 160 characters");

const reorderThresholdSchema = z
  .number({ error: "Enter a whole number" })
  .int("Enter a whole number")
  .min(0, "Can't be negative")
  .max(1_000_000, "Must be at most 1,000,000");

// ─── Products ────────────────────────────────────────────────────────────────

const productFields = {
  sku: skuSchema,
  barcode: barcodeSchema,
  name: productNameSchema,
  description: optionalText(2000, "Description"),
  costPrice: moneySchema,
  sellingPrice: moneySchema,
  categoryId: z.uuid("Choose a valid category").nullish().transform((value) => value ?? null),
  reorderThreshold: reorderThresholdSchema,
};

export const createProductSchema = z.object({
  ...productFields,
  reorderThreshold: reorderThresholdSchema.default(0),
});

export const updateProductSchema = z
  .object(productFields)
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update");

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const PRODUCT_SORT_FIELDS = [
  "name",
  "sku",
  "sellingPrice",
  "costPrice",
  "reorderThreshold",
  "createdAt",
  "updatedAt",
] as const;

export const listProductsQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    search: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform((value) => value || undefined),
    /** A category id, or "none" for uncategorized products. */
    categoryId: z.union([z.uuid(), z.literal("none")]).optional(),
    status: z.enum(["active", "archived", "all"]).default("active"),
    sort: z.enum(PRODUCT_SORT_FIELDS).default("name"),
    order: z.enum(["asc", "desc"]).default("asc"),
    minPrice: moneySchema.optional(),
    maxPrice: moneySchema.optional(),
  })
  .refine(
    (query) => !query.minPrice || !query.maxPrice || Number(query.minPrice) <= Number(query.maxPrice),
    { path: ["maxPrice"], message: "Maximum price must be at least the minimum price" },
  );

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

// ─── Categories ──────────────────────────────────────────────────────────────

export const createCategorySchema = z.object({
  name: z
    .string({ error: "Name is required" })
    .trim()
    .min(1, "Name is required")
    .max(60, "Name must be at most 60 characters")
    .transform((value) => value.replace(/\s+/g, " ")),
  description: optionalText(255, "Description"),
});

export const updateCategorySchema = createCategorySchema
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Provide name or description to update");
