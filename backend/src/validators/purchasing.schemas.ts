import { z } from "zod";
import { moneySchema, optionalText } from "./catalog.schemas.js";

/** Largest quantity of one product on a single purchase order line. */
export const MAX_LINE_QUANTITY = 1_000_000;
export const MAX_ORDER_LINES = 200;

const pagination = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

const searchText = z
  .string()
  .trim()
  .max(100)
  .optional()
  .transform((value) => value || undefined);

const dateRange = {
  /** ISO timestamps; the client converts local day boundaries. */
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
};

const rangeIsOrdered: [(query: { from?: Date; to?: Date }) => boolean, { path: string[]; message: string }] = [
  (query) => !query.from || !query.to || query.from <= query.to,
  { path: ["to"], message: "The end date must be after the start date" },
];

// ─── Suppliers ───────────────────────────────────────────────────────────────

const supplierNameSchema = z
  .string({ error: "Name is required" })
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(120, "Name must be at most 120 characters")
  .transform((value) => value.replace(/\s+/g, " "));

const supplierEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .refine((value) => value === "" || z.email().safeParse(value).success, "Enter a valid email address")
  .nullish()
  .transform((value) => value || null);

const phoneSchema = z
  .string()
  .trim()
  .max(40, "Phone must be at most 40 characters")
  .regex(/^$|^[+0-9(][0-9 ()./x-]{3,39}$/i, "Use digits, spaces and + ( ) - .")
  .nullish()
  .transform((value) => value || null);

const supplierFields = {
  name: supplierNameSchema,
  contactName: optionalText(100, "Contact name"),
  email: supplierEmailSchema,
  phone: phoneSchema,
  address: optionalText(500, "Address"),
  paymentTerms: optionalText(120, "Payment terms"),
  notes: optionalText(2000, "Notes"),
};

export const createSupplierSchema = z.object(supplierFields).strict();

export const updateSupplierSchema = z
  .object({ ...supplierFields, isActive: z.boolean() })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Provide at least one field to update");

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;

export const supplierStatusSchema = z.object({ isActive: z.boolean() }).strict();

export const purchasePaymentSchema = z.object({
  idempotencyKey: z.uuid(),
  // Payments can cover an entire DECIMAL(14,2) order; require strings to preserve precision.
  amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount with at most 2 decimal places")
    .refine((value) => /[1-9]/.test(value), "Payment must be greater than zero"),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "OTHER"]),
  reference: optionalText(160, "Reference"),
  paidAt: z.iso.date().refine((value) => value <= new Date().toISOString().slice(0, 10), "Payment date cannot be in the future")
    .transform((value) => new Date(`${value}T00:00:00.000Z`)),
}).strict();

export type PurchasePaymentInput = z.infer<typeof purchasePaymentSchema>;

export const SUPPLIER_SORT_FIELDS = ["name", "createdAt", "updatedAt"] as const;

export const listSuppliersQuerySchema = z.object({
  ...pagination,
  search: searchText,
  status: z.enum(["active", "inactive", "all"]).default("active"),
  sort: z.enum(SUPPLIER_SORT_FIELDS).default("name"),
  order: z.enum(["asc", "desc"]).default("asc"),
});

export type ListSuppliersQuery = z.infer<typeof listSuppliersQuerySchema>;

export const supplierReportQuerySchema = z.object(dateRange).refine(...rangeIsOrdered);

export type SupplierReportQuery = z.infer<typeof supplierReportQuerySchema>;

// ─── Purchase orders ─────────────────────────────────────────────────────────

export const PURCHASE_ORDER_STATUSES = ["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const;

const orderLineSchema = z
  .object({
    productId: z.uuid("Choose a product"),
    quantity: z
      .number({ error: "Enter a whole number" })
      .int("Enter a whole number")
      .min(1, "Order at least 1")
      .max(MAX_LINE_QUANTITY, "Quantity is too large"),
    unitCost: moneySchema,
  })
  .strict();

/**
 * A draft purchase order. Creating and editing both send the whole order: editing replaces
 * every line. A draft may be saved without lines; it needs at least one to be placed.
 */
export const purchaseOrderSchema = z
  .object({
    supplierId: z.uuid("Choose a supplier"),
    storeId: z.uuid("Choose a store"),
    expectedAt: z.iso
      .date("Use a date like 2026-11-30")
      .nullish()
      .transform((value) => (value ? new Date(`${value}T00:00:00.000Z`) : null)),
    note: optionalText(1000, "Note"),
    lines: z.array(orderLineSchema).max(MAX_ORDER_LINES, `An order can have at most ${MAX_ORDER_LINES} lines`).default([]),
  })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.lines.forEach((line, index) => {
      if (seen.has(line.productId)) {
        ctx.addIssue({
          code: "custom",
          path: ["lines", index, "productId"],
          message: "This product is already on the order; change that line's quantity instead",
        });
      }
      seen.add(line.productId);
    });
  });

export type PurchaseOrderInput = z.infer<typeof purchaseOrderSchema>;

export const cancelPurchaseOrderSchema = z
  .object({ reason: optionalText(500, "Reason") })
  .strict();

/**
 * Booking a delivery. `idempotencyKey` is generated by the client once per receiving attempt
 * and reused on retries; lines with quantity 0 are ignored, so the form can send every row.
 */
export const receivePurchaseOrderSchema = z
  .object({
    idempotencyKey: z.uuid("idempotencyKey must be a UUID"),
    note: optionalText(500, "Note"),
    lines: z
      .array(
        z
          .object({
            lineId: z.uuid("Unknown order line"),
            quantity: z
              .number({ error: "Enter a whole number" })
              .int("Enter a whole number")
              .min(0, "Can't be negative")
              .max(MAX_LINE_QUANTITY, "Quantity is too large"),
          })
          .strict(),
      )
      .min(1, "Enter the quantities received")
      .max(MAX_ORDER_LINES),
  })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.lines.forEach((line, index) => {
      if (seen.has(line.lineId)) {
        ctx.addIssue({ code: "custom", path: ["lines", index, "lineId"], message: "This line appears twice" });
      }
      seen.add(line.lineId);
    });
    if (!body.lines.some((line) => line.quantity > 0)) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "Enter a quantity for at least one line" });
    }
  });

export type ReceivePurchaseOrderInput = z.infer<typeof receivePurchaseOrderSchema>;

export const PURCHASE_ORDER_SORT_FIELDS = ["number", "createdAt", "expectedAt", "total"] as const;

export const listPurchaseOrdersQuerySchema = z
  .object({
    ...pagination,
    search: searchText,
    status: z.enum(PURCHASE_ORDER_STATUSES).optional(),
    /** Orders still expecting goods: ORDERED or PARTIALLY_RECEIVED. Ignored when `status` is set. */
    open: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
    supplierId: z.uuid().optional(),
    storeId: z.uuid().optional(),
    productId: z.uuid().optional(),
    ...dateRange,
    sort: z.enum(PURCHASE_ORDER_SORT_FIELDS).default("number"),
    order: z.enum(["asc", "desc"]).default("desc"),
  })
  .refine(...rangeIsOrdered);

export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;
