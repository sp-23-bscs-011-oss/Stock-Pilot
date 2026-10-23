import { z } from "zod";

/** Largest on-hand quantity a single product may have in one store. */
export const MAX_STOCK_QUANTITY = 10_000_000;

export const ADJUSTMENT_REASONS = [
  "STOCK_COUNT",
  "RECEIVED",
  "CUSTOMER_RETURN",
  "DAMAGED",
  "EXPIRED",
  "LOST",
  "THEFT",
  "RETURNED_TO_SUPPLIER",
  "OTHER",
] as const;

export type AdjustmentReasonCode = (typeof ADJUSTMENT_REASONS)[number];

/** Reasons that only make sense in one direction. STOCK_COUNT and OTHER can go either way. */
const INCREASE_ONLY: readonly AdjustmentReasonCode[] = ["RECEIVED", "CUSTOMER_RETURN"];
const DECREASE_ONLY: readonly AdjustmentReasonCode[] = ["DAMAGED", "EXPIRED", "LOST", "THEFT", "RETURNED_TO_SUPPLIER"];

const quantitySchema = z
  .number({ error: "Enter a whole number" })
  .int("Enter a whole number")
  .min(-MAX_STOCK_QUANTITY, "Quantity is too large")
  .max(MAX_STOCK_QUANTITY, "Quantity is too large");

/**
 * A manual stock adjustment. Either
 * - `mode: "change"`: add or remove `quantity` units (signed, non-zero), or
 * - `mode: "set"`: a physical count, setting on-hand to `quantity` (>= 0).
 * `expectedQuantity` is the on-hand value the user was looking at; if stock moved in the
 * meantime the server refuses with 409 STOCK_CHANGED instead of applying a stale decision.
 */
export const adjustStockSchema = z
  .object({
    storeId: z.uuid("Choose a store"),
    productId: z.uuid("Choose a product"),
    mode: z.enum(["change", "set"], { error: 'Mode must be "change" or "set"' }),
    quantity: quantitySchema,
    reason: z.enum(ADJUSTMENT_REASONS, { error: "Choose a reason" }),
    note: z
      .string()
      .trim()
      .max(500, "Note must be at most 500 characters")
      .nullish()
      .transform((value) => value || null),
    expectedQuantity: z.number().int().min(0).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });

    if (body.mode === "change") {
      if (body.quantity === 0) issue("quantity", "Enter a quantity other than 0");
      if (body.quantity > 0 && DECREASE_ONLY.includes(body.reason)) {
        issue("reason", "This reason can only remove stock");
      }
      if (body.quantity < 0 && INCREASE_ONLY.includes(body.reason)) {
        issue("reason", "This reason can only add stock");
      }
    } else {
      if (body.quantity < 0) issue("quantity", "A counted quantity can't be negative");
      if (body.reason !== "STOCK_COUNT" && body.reason !== "OTHER") {
        issue("reason", 'Setting a counted quantity needs the reason "Stock count" or "Other"');
      }
    }
    if (body.reason === "OTHER" && !body.note) issue("note", 'Describe the reason when choosing "Other"');
  });

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;

export const STOCK_STATUS_FILTERS = ["all", "needs_reorder", "low", "out", "ok"] as const;
export const INVENTORY_SORT_FIELDS = ["name", "sku", "quantity", "reorderThreshold", "updatedAt"] as const;

export const listInventoryQuerySchema = z.object({
  storeId: z.uuid("storeId is required"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((value) => value || undefined),
  categoryId: z.union([z.uuid(), z.literal("none")]).optional(),
  stockStatus: z.enum(STOCK_STATUS_FILTERS).default("all"),
  sort: z.enum(INVENTORY_SORT_FIELDS).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

export type ListInventoryQuery = z.infer<typeof listInventoryQuerySchema>;

export const listMovementsQuerySchema = z
  .object({
    storeId: z.uuid().optional(),
    productId: z.uuid().optional(),
    type: z.enum(["ADJUSTMENT", "PURCHASE_RECEIPT"]).optional(),
    reason: z.enum(ADJUSTMENT_REASONS).optional(),
    userId: z.uuid().optional(),
    /** ISO timestamps; the client converts local day boundaries. */
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ["to"],
    message: "The end date must be after the start date",
  });

export type ListMovementsQuery = z.infer<typeof listMovementsQuerySchema>;

// ─── Stores ──────────────────────────────────────────────────────────────────

const storeCodeSchema = z
  .string({ error: "Code is required" })
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9-]{1,15}$/, "Use 2–16 letters, numbers or dashes");

const storeNameSchema = z
  .string({ error: "Name is required" })
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(80, "Name must be at most 80 characters");

export const createStoreSchema = z.object({ name: storeNameSchema, code: storeCodeSchema });

export const updateStoreSchema = z
  .object({ name: storeNameSchema, code: storeCodeSchema, isActive: z.boolean() })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update");
