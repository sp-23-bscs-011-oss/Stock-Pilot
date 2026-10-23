import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { formatPurchaseOrderNumber } from "../utils/documentNumbers.js";
import {
  MAX_STOCK_QUANTITY,
  type AdjustStockInput,
  type ListInventoryQuery,
  type ListMovementsQuery,
} from "../validators/inventory.schemas.js";
import { Prisma, type AdjustmentReason, type StockMovementType } from "../generated/prisma/client.js";

export type StockStatus = "OUT" | "LOW" | "OK";

/**
 * OUT when nothing is on hand; LOW when at or below the product's reorder threshold;
 * otherwise OK. Mirrors the SQL CASE in listInventory().
 */
export function stockStatus(quantity: number, reorderThreshold: number): StockStatus {
  if (quantity <= 0) return "OUT";
  if (quantity <= reorderThreshold) return "LOW";
  return "OK";
}

// Interactive transactions hold a pooled connection. Under contention requests queue for the
// row lock, so allow more than Prisma's defaults before giving up.
export const TRANSACTION_OPTIONS = { maxWait: 15_000, timeout: 15_000 } as const;

// ─── The one way stock changes ───────────────────────────────────────────────

export interface StockChange {
  productId: string;
  storeId: string;
  /** Exactly one of `change` (signed delta) or `setTo` (absolute count). */
  change?: number;
  setTo?: number;
  /** Optimistic check: refuse if on-hand differs from what the caller based its decision on. */
  expectedQuantity?: number;
  type: StockMovementType;
  reason: AdjustmentReason | null;
  note: string | null;
  userId: string | null;
  /** Required for PURCHASE_RECEIPT movements: the receipt the stock arrived on. */
  purchaseReceiptId?: string | null;
}

/**
 * Applies one stock change inside the caller's transaction and records it in the ledger.
 *
 * Concurrency: the (product, store) row is created if missing, then locked with
 * SELECT ... FOR UPDATE. Concurrent changes to the same row queue behind the lock, so each
 * one sees the committed result of the previous one and the "never below zero" check can't
 * be raced. The CHECK (quantity >= 0) constraint backs this up at the database level.
 *
 * Purchase receipts (and later, sales) call this for each line inside their own transaction.
 * To avoid deadlocks, multi-line callers must apply changes in a consistent order (by productId).
 */
export async function applyStockChange(tx: Prisma.TransactionClient, input: StockChange) {
  // Make sure there is a row to lock; a concurrent insert of the same row is harmless.
  await tx.$executeRaw`
    INSERT INTO inventory_levels (product_id, store_id, quantity, updated_at)
    VALUES (${input.productId}::uuid, ${input.storeId}::uuid, 0, now())
    ON CONFLICT (product_id, store_id) DO NOTHING`;

  const [locked] = await tx.$queryRaw<{ quantity: number }[]>`
    SELECT quantity FROM inventory_levels
    WHERE product_id = ${input.productId}::uuid AND store_id = ${input.storeId}::uuid
    FOR UPDATE`;
  if (!locked) throw new Error("Inventory row vanished after insert");

  const before = locked.quantity;
  if (input.expectedQuantity !== undefined && input.expectedQuantity !== before) {
    throw new AppError(
      409,
      "STOCK_CHANGED",
      `Stock changed while you were editing: there are now ${before} on hand. Review and try again.`,
      { currentQuantity: before },
    );
  }

  const after = input.setTo ?? before + (input.change ?? 0);
  const change = after - before;

  if (change === 0) {
    throw new AppError(409, "NO_STOCK_CHANGE", `On-hand is already ${before}; nothing to adjust.`, {
      currentQuantity: before,
    });
  }
  if (after < 0) {
    throw new AppError(
      409,
      "INSUFFICIENT_STOCK",
      `Only ${before} on hand; can't remove ${-change}.`,
      { currentQuantity: before, requested: change },
    );
  }
  if (after > MAX_STOCK_QUANTITY) {
    throw AppError.badRequest(`On-hand quantity can't exceed ${MAX_STOCK_QUANTITY.toLocaleString("en-US")}`, [
      { path: ["quantity"], message: "The resulting quantity is too large" },
    ]);
  }

  await tx.$executeRaw`
    UPDATE inventory_levels SET quantity = ${after}, updated_at = now()
    WHERE product_id = ${input.productId}::uuid AND store_id = ${input.storeId}::uuid`;

  const movement = await tx.stockMovement.create({
    data: {
      productId: input.productId,
      storeId: input.storeId,
      type: input.type,
      quantityChange: change,
      quantityBefore: before,
      quantityAfter: after,
      reason: input.reason,
      note: input.note,
      purchaseReceiptId: input.purchaseReceiptId ?? null,
      createdById: input.userId,
    },
    include: movementInclude,
  });

  return { quantityBefore: before, quantityAfter: after, movement };
}

// ─── Manual adjustments ──────────────────────────────────────────────────────

export async function adjustStock(input: AdjustStockInput, userId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const [product, store] = await Promise.all([
      tx.product.findUnique({ where: { id: input.productId }, select: { archivedAt: true, reorderThreshold: true } }),
      tx.store.findUnique({ where: { id: input.storeId }, select: { isActive: true } }),
    ]);
    if (!product) throw AppError.badRequest("Product not found", [{ path: ["productId"], message: "Product not found" }]);
    if (!store) throw AppError.badRequest("Store not found", [{ path: ["storeId"], message: "Store not found" }]);
    if (product.archivedAt) {
      throw AppError.conflict("Archived products can't have their stock adjusted. Restore it first.", "PRODUCT_ARCHIVED");
    }
    if (!store.isActive) throw AppError.conflict("This store is inactive", "STORE_INACTIVE");

    const applied = await applyStockChange(tx, {
      productId: input.productId,
      storeId: input.storeId,
      ...(input.mode === "set" ? { setTo: input.quantity } : { change: input.quantity }),
      expectedQuantity: input.expectedQuantity,
      type: "ADJUSTMENT",
      reason: input.reason,
      note: input.note,
      userId,
    });
    return { ...applied, reorderThreshold: product.reorderThreshold };
  }, TRANSACTION_OPTIONS);

  return {
    level: {
      productId: input.productId,
      storeId: input.storeId,
      quantity: result.quantityAfter,
      status: stockStatus(result.quantityAfter, result.reorderThreshold),
    },
    movement: toMovementDto(result.movement),
  };
}

// ─── Stock levels ────────────────────────────────────────────────────────────

const SORT_COLUMNS: Record<ListInventoryQuery["sort"], string> = {
  name: "p.name",
  sku: "p.sku",
  quantity: "quantity",
  reorderThreshold: "p.reorder_threshold",
  updatedAt: "stock_updated_at",
};

const QUANTITY = Prisma.sql`COALESCE(il.quantity, 0)`;

const STATUS_CONDITIONS: Record<ListInventoryQuery["stockStatus"], Prisma.Sql> = {
  all: Prisma.empty,
  needs_reorder: Prisma.sql`AND ${QUANTITY} <= p.reorder_threshold`,
  low: Prisma.sql`AND ${QUANTITY} > 0 AND ${QUANTITY} <= p.reorder_threshold`,
  out: Prisma.sql`AND ${QUANTITY} <= 0`,
  ok: Prisma.sql`AND ${QUANTITY} > p.reorder_threshold`,
};

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

interface InventoryRow {
  product_id: string;
  sku: string;
  barcode: string | null;
  name: string;
  reorder_threshold: number;
  category_id: string | null;
  category_name: string | null;
  quantity: number;
  stock_updated_at: Date | null;
}

/**
 * Active products with their on-hand quantity in one store (0 when never stocked), plus a
 * store-wide summary. Raw SQL because filtering and sorting compare columns across the
 * products and inventory_levels tables, which Prisma's query API can't express. Every value
 * is a bound parameter; sort columns come from a fixed whitelist.
 */
export async function listInventory(query: ListInventoryQuery) {
  const store = await prisma.store.findUnique({ where: { id: query.storeId }, select: { id: true } });
  if (!store) throw AppError.notFound("Store not found");

  const from = Prisma.sql`
    FROM products p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN inventory_levels il ON il.product_id = p.id AND il.store_id = ${query.storeId}::uuid
    WHERE p.archived_at IS NULL`;

  const pattern = query.search ? `%${escapeLike(query.search)}%` : null;
  const filters = Prisma.sql`
    ${pattern ? Prisma.sql`AND (p.name ILIKE ${pattern} OR p.sku ILIKE ${pattern} OR p.barcode ILIKE ${pattern})` : Prisma.empty}
    ${query.categoryId === "none" ? Prisma.sql`AND p.category_id IS NULL` : Prisma.empty}
    ${query.categoryId && query.categoryId !== "none" ? Prisma.sql`AND p.category_id = ${query.categoryId}::uuid` : Prisma.empty}
    ${STATUS_CONDITIONS[query.stockStatus]}`;

  const direction = query.order === "desc" ? Prisma.raw("DESC NULLS LAST") : Prisma.raw("ASC NULLS FIRST");
  const orderBy = Prisma.raw(SORT_COLUMNS[query.sort]);

  const [rows, [counted], [summary]] = await Promise.all([
    prisma.$queryRaw<InventoryRow[]>`
      SELECT p.id AS product_id, p.sku, p.barcode, p.name, p.reorder_threshold,
             p.category_id, c.name AS category_name,
             ${QUANTITY} AS quantity, il.updated_at AS stock_updated_at
      ${from} ${filters}
      ORDER BY ${orderBy} ${direction}, p.id ASC
      LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS total ${from} ${filters}`,
    prisma.$queryRaw<{ products: number; units: number; low: number; out: number }[]>`
      SELECT COUNT(*)::int AS products,
             COALESCE(SUM(${QUANTITY}), 0)::int AS units,
             (COUNT(*) FILTER (WHERE ${QUANTITY} > 0 AND ${QUANTITY} <= p.reorder_threshold))::int AS low,
             (COUNT(*) FILTER (WHERE ${QUANTITY} <= 0))::int AS out
      ${from}`,
  ]);

  const total = counted?.total ?? 0;
  return {
    items: rows.map((row) => ({
      productId: row.product_id,
      sku: row.sku,
      barcode: row.barcode,
      name: row.name,
      category: row.category_id ? { id: row.category_id, name: row.category_name ?? "" } : null,
      quantity: row.quantity,
      reorderThreshold: row.reorder_threshold,
      status: stockStatus(row.quantity, row.reorder_threshold),
      updatedAt: row.stock_updated_at,
    })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    summary: summary ?? { products: 0, units: 0, low: 0, out: 0 },
  };
}

// ─── Movement history ────────────────────────────────────────────────────────

const movementInclude = {
  product: { select: { id: true, sku: true, name: true } },
  store: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, name: true } },
  purchaseReceipt: { select: { purchaseOrder: { select: { id: true, number: true } } } },
} as const;

type MovementWithRelations = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

function toMovementDto(movement: MovementWithRelations) {
  return {
    id: movement.id,
    type: movement.type,
    reason: movement.reason,
    note: movement.note,
    quantityChange: movement.quantityChange,
    quantityBefore: movement.quantityBefore,
    quantityAfter: movement.quantityAfter,
    product: movement.product,
    store: movement.store,
    createdBy: movement.createdBy,
    /** The purchase order a PURCHASE_RECEIPT movement came from. */
    purchaseOrder: movement.purchaseReceipt
      ? {
          id: movement.purchaseReceipt.purchaseOrder.id,
          number: formatPurchaseOrderNumber(movement.purchaseReceipt.purchaseOrder.number),
        }
      : null,
    createdAt: movement.createdAt,
  };
}

export async function listMovements(query: ListMovementsQuery) {
  const where: Prisma.StockMovementWhereInput = {
    storeId: query.storeId,
    productId: query.productId,
    type: query.type,
    reason: query.reason,
    createdById: query.userId,
    createdAt: query.from || query.to ? { gte: query.from, lte: query.to } : undefined,
  };

  const [total, movements] = await prisma.$transaction([
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({
      where,
      include: movementInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: movements.map(toMovementDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
