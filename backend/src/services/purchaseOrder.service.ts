import { prisma } from "../lib/prisma.js";
import { isUniqueViolation, uniqueViolationMentions } from "../lib/prismaErrors.js";
import { AppError } from "../utils/AppError.js";
import { formatPurchaseOrderNumber, parsePurchaseOrderNumber } from "../utils/documentNumbers.js";
import type {
  ListPurchaseOrdersQuery,
  PurchaseOrderInput,
  ReceivePurchaseOrderInput,
  PurchasePaymentInput,
} from "../validators/purchasing.schemas.js";
import { auditInclude, recordAudit, toAuditDto } from "./audit.service.js";
import { applyStockChange, TRANSACTION_OPTIONS } from "./inventory.service.js";
import { Prisma, type PurchaseOrderStatus } from "../generated/prisma/client.js";

/** DECIMAL(14,2) limit for an order total. */
const MAX_ORDER_TOTAL = new Prisma.Decimal("999999999999.99");

const OPEN_STATUSES: PurchaseOrderStatus[] = ["ORDERED", "PARTIALLY_RECEIVED"];

interface FieldIssue {
  path: (string | number)[];
  message: string;
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

const person = { select: { id: true, name: true } } as const;

const summaryInclude = {
  supplier: { select: { id: true, name: true, isActive: true } },
  store: { select: { id: true, name: true, code: true } },
  createdBy: person,
  lines: { select: { quantityOrdered: true, quantityReceived: true, unitCost: true } },
  payments: { select: { amount: true } },
} as const;

const detailInclude = {
  supplier: { select: { id: true, name: true, isActive: true, contactName: true, email: true, phone: true, paymentTerms: true } },
  store: { select: { id: true, name: true, code: true, isActive: true } },
  createdBy: person,
  orderedBy: person,
  cancelledBy: person,
  lines: { orderBy: { position: "asc" } },
  payments: { orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }, { id: "asc" }], include: { recordedBy: person } },
  receipts: {
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    include: { receivedBy: person, lines: true },
  },
} as const satisfies Prisma.PurchaseOrderInclude;

type OrderSummary = Prisma.PurchaseOrderGetPayload<{ include: typeof summaryInclude }>;
type OrderDetail = Prisma.PurchaseOrderGetPayload<{ include: typeof detailInclude }>;

/** DATE columns come back as UTC midnight; send them as plain yyyy-mm-dd. */
function toDateOnly(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function lineFigures(lines: { quantityOrdered: number; quantityReceived: number; unitCost: Prisma.Decimal }[]) {
  let unitsOrdered = 0;
  let unitsReceived = 0;
  let receivedValue = new Prisma.Decimal(0);
  for (const line of lines) {
    unitsOrdered += line.quantityOrdered;
    unitsReceived += line.quantityReceived;
    receivedValue = receivedValue.add(line.unitCost.mul(line.quantityReceived));
  }
  return { unitsOrdered, unitsReceived, receivedValue };
}

function toSummaryDto(order: OrderSummary | OrderDetail) {
  const figures = lineFigures(order.lines);
  const paid = order.payments.reduce((sum, payment) => sum.add(payment.amount), new Prisma.Decimal(0));
  const payable = order.status === "DRAFT" ? new Prisma.Decimal(0)
    : order.status === "CANCELLED" ? figures.receivedValue : order.total;
  const balance = payable.sub(paid);
  return {
    id: order.id,
    number: formatPurchaseOrderNumber(order.number),
    status: order.status,
    supplier: { id: order.supplier.id, name: order.supplier.name, isActive: order.supplier.isActive },
    store: { id: order.store.id, name: order.store.name, code: order.store.code },
    expectedAt: toDateOnly(order.expectedAt),
    total: order.total.toFixed(2),
    payableTotal: payable.toFixed(2),
    paidTotal: paid.toFixed(2),
    balanceDue: balance.toFixed(2),
    paymentStatus: payable.isZero() ? "NOT_DUE" as const : balance.isZero() ? "PAID" as const
      : paid.isZero() ? "UNPAID" as const : "PARTIALLY_PAID" as const,
    receivedValue: figures.receivedValue.toFixed(2),
    lineCount: order.lines.length,
    unitsOrdered: figures.unitsOrdered,
    unitsReceived: figures.unitsReceived,
    createdBy: order.createdBy,
    createdAt: order.createdAt,
    orderedAt: order.orderedAt,
    receivedAt: order.receivedAt,
    cancelledAt: order.cancelledAt,
    updatedAt: order.updatedAt,
  };
}

function toDetailDto(order: OrderDetail, activity: Prisma.AuditLogGetPayload<{ include: typeof auditInclude }>[]) {
  const open = OPEN_STATUSES.includes(order.status);
  const linesById = new Map(order.lines.map((line) => [line.id, line]));
  const outstandingValue = order.lines.reduce(
    (total, line) => total.add(line.unitCost.mul(line.quantityOrdered - line.quantityReceived)),
    new Prisma.Decimal(0),
  );

  return {
    ...toSummaryDto(order),
    supplier: order.supplier,
    store: order.store,
    note: order.note,
    orderedBy: order.orderedBy,
    cancelledBy: order.cancelledBy,
    cancelReason: order.cancelReason,
    payments: order.payments.map((payment) => ({
      id: payment.id,
      amount: payment.amount.toFixed(2),
      method: payment.method,
      reference: payment.reference,
      paidAt: toDateOnly(payment.paidAt)!,
      recordedBy: payment.recordedBy,
      createdAt: payment.createdAt,
    })),
    /** Value still due; 0 unless the order is open. */
    outstandingValue: (open ? outstandingValue : new Prisma.Decimal(0)).toFixed(2),
    lines: order.lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      position: line.position,
      sku: line.sku,
      productName: line.productName,
      quantityOrdered: line.quantityOrdered,
      quantityReceived: line.quantityReceived,
      quantityOutstanding: open ? line.quantityOrdered - line.quantityReceived : 0,
      unitCost: line.unitCost.toFixed(2),
      lineTotal: line.lineTotal.toFixed(2),
      receivedValue: line.unitCost.mul(line.quantityReceived).toFixed(2),
    })),
    receipts: order.receipts.map((receipt) => ({
      id: receipt.id,
      receivedAt: receipt.receivedAt,
      receivedBy: receipt.receivedBy,
      note: receipt.note,
      units: receipt.lines.reduce((total, line) => total + line.quantity, 0),
      value: receipt.lines
        .reduce((total, line) => total.add(line.unitCost.mul(line.quantity)), new Prisma.Decimal(0))
        .toFixed(2),
      lines: receipt.lines
        .map((line) => {
          const orderLine = linesById.get(line.purchaseOrderLineId);
          return {
            lineId: line.purchaseOrderLineId,
            productId: line.productId,
            sku: orderLine?.sku ?? "",
            productName: orderLine?.productName ?? "",
            position: orderLine?.position ?? 0,
            quantity: line.quantity,
            unitCost: line.unitCost.toFixed(2),
          };
        })
        .sort((a, b) => a.position - b.position)
        .map(({ position: _position, ...line }) => line),
    })),
    activity: activity.map(toAuditDto),
  };
}

export type PurchaseOrderDetailDto = ReturnType<typeof toDetailDto>;

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function listPurchaseOrders(query: ListPurchaseOrdersQuery) {
  const number = query.search ? parsePurchaseOrderNumber(query.search) : null;
  const where: Prisma.PurchaseOrderWhereInput = {
    status: query.status ?? (query.open ? { in: OPEN_STATUSES } : undefined),
    supplierId: query.supplierId,
    storeId: query.storeId,
    lines: query.productId ? { some: { productId: query.productId } } : undefined,
    createdAt: query.from || query.to ? { gte: query.from, lte: query.to } : undefined,
    OR: query.search
      ? [
          ...(number !== null ? [{ number }] : []),
          { supplier: { name: { contains: query.search, mode: "insensitive" } } },
          { lines: { some: { sku: { contains: query.search, mode: "insensitive" } } } },
          { lines: { some: { productName: { contains: query.search, mode: "insensitive" } } } },
        ]
      : undefined,
  };

  // Orders without an expected date sort last either way; the order number breaks ties.
  const orderBy: Prisma.PurchaseOrderOrderByWithRelationInput =
    query.sort === "expectedAt"
      ? { expectedAt: { sort: query.order, nulls: "last" } }
      : { [query.sort]: query.order };

  const [total, orders, counts] = await prisma.$transaction([
    prisma.purchaseOrder.count({ where }),
    prisma.purchaseOrder.findMany({
      where,
      include: summaryInclude,
      orderBy: [orderBy, { number: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    // Status counts ignore the status filter, so the tabs can show them all at once.
    prisma.purchaseOrder.groupBy({
      by: ["status"],
      where: { ...where, status: undefined },
      _count: { _all: true },
      orderBy: { status: "asc" },
    }),
  ]);

  const statusCounts = Object.fromEntries(
    (["DRAFT", "ORDERED", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED"] as const).map((status) => [status, 0]),
  ) as Record<PurchaseOrderStatus, number>;
  for (const row of counts) {
    const count = row._count;
    statusCounts[row.status] = typeof count === "object" && count ? (count._all ?? 0) : 0;
  }

  return {
    items: orders.map(toSummaryDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
    statusCounts,
  };
}

export async function getPurchaseOrder(id: string, client: Prisma.TransactionClient = prisma) {
  // Sequential: inside a transaction both queries share one connection.
  const order = await client.purchaseOrder.findUnique({ where: { id }, include: detailInclude });
  if (!order) throw AppError.notFound("Purchase order not found");
  const activity = await client.auditLog.findMany({
    where: { entityType: "purchase_order", entityId: id },
    include: auditInclude,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return toDetailDto(order, activity);
}

// ─── Drafts ──────────────────────────────────────────────────────────────────

async function assertSupplierUsable(tx: Prisma.TransactionClient, supplierId: string) {
  const supplier = await tx.supplier.findUnique({ where: { id: supplierId }, select: { isActive: true } });
  if (!supplier) {
    throw AppError.badRequest("Supplier not found", [{ path: ["supplierId"], message: "Supplier not found" }]);
  }
  if (!supplier.isActive) {
    throw new AppError(409, "SUPPLIER_INACTIVE", "This supplier is inactive. Reactivate it or choose another supplier.", [
      { path: ["supplierId"], message: "This supplier is inactive" },
    ]);
  }
}

async function assertStoreUsable(tx: Prisma.TransactionClient, storeId: string) {
  const store = await tx.store.findUnique({ where: { id: storeId }, select: { isActive: true } });
  if (!store) throw AppError.badRequest("Store not found", [{ path: ["storeId"], message: "Store not found" }]);
  if (!store.isActive) {
    throw new AppError(409, "STORE_INACTIVE", "This store is inactive", [
      { path: ["storeId"], message: "This store is inactive" },
    ]);
  }
}

/**
 * Turns requested lines into rows to insert: checks every product exists and is active,
 * copies its SKU and name, and computes exact line totals and the order total with decimal
 * arithmetic (never floats).
 */
async function buildLines(tx: Prisma.TransactionClient, lines: PurchaseOrderInput["lines"]) {
  const products = await tx.product.findMany({
    where: { id: { in: lines.map((line) => line.productId) } },
    select: { id: true, sku: true, name: true, archivedAt: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));

  const issues: FieldIssue[] = [];
  let total = new Prisma.Decimal(0);
  const rows = lines.map((line, index) => {
    const product = byId.get(line.productId);
    if (!product) issues.push({ path: ["lines", index, "productId"], message: "Product not found" });
    else if (product.archivedAt) {
      issues.push({ path: ["lines", index, "productId"], message: `${product.name} is archived and can't be ordered` });
    }
    const unitCost = new Prisma.Decimal(line.unitCost);
    const lineTotal = unitCost.mul(line.quantity);
    total = total.add(lineTotal);
    return {
      productId: line.productId,
      position: index + 1,
      sku: product?.sku ?? "",
      productName: product?.name ?? "",
      quantityOrdered: line.quantity,
      unitCost,
      lineTotal,
    };
  });

  if (issues.length > 0) throw AppError.badRequest(issues.map((issue) => issue.message).join(". "), issues);
  if (total.greaterThan(MAX_ORDER_TOTAL) || rows.some((row) => row.lineTotal.greaterThan(MAX_ORDER_TOTAL))) {
    throw AppError.badRequest("The order total is too large", [{ path: ["lines"], message: "The order total is too large" }]);
  }
  return { rows, total };
}

export async function createPurchaseOrder(input: PurchaseOrderInput, actorId: string) {
  return prisma.$transaction(async (tx) => {
    await assertSupplierUsable(tx, input.supplierId);
    await assertStoreUsable(tx, input.storeId);
    const { rows, total } = await buildLines(tx, input.lines);

    const order = await tx.purchaseOrder.create({
      data: {
        supplierId: input.supplierId,
        storeId: input.storeId,
        expectedAt: input.expectedAt,
        note: input.note,
        total,
        createdById: actorId,
        lines: { create: rows },
      },
    });
    await recordAudit(tx, {
      action: "purchase_order.created",
      entityType: "purchase_order",
      entityId: order.id,
      actorId,
      details: { number: formatPurchaseOrderNumber(order.number), lineCount: rows.length, total: total.toFixed(2) },
    });
    return getPurchaseOrder(order.id, tx);
  }, TRANSACTION_OPTIONS);
}

/**
 * Locks the order row for the rest of the transaction. Every status change and every receipt
 * goes through this lock, so two requests for the same order run one after the other and
 * each sees the other's committed result.
 */
async function lockOrder(tx: Prisma.TransactionClient, id: string) {
  const [order] = await tx.$queryRaw<{ id: string; number: number; status: PurchaseOrderStatus; store_id: string }[]>`
    SELECT id, number, status, store_id FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
  if (!order) throw AppError.notFound("Purchase order not found");
  return { id: order.id, number: order.number, status: order.status, storeId: order.store_id };
}

const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: "a draft",
  ORDERED: "ordered",
  PARTIALLY_RECEIVED: "partially received",
  RECEIVED: "fully received",
  CANCELLED: "cancelled",
};

function invalidStatus(number: number, status: PurchaseOrderStatus, action: string) {
  return new AppError(
    409,
    "INVALID_STATUS",
    `${formatPurchaseOrderNumber(number)} is ${STATUS_LABELS[status]}, so it can't be ${action}.`,
    { status },
  );
}

export async function updatePurchaseOrder(id: string, input: PurchaseOrderInput, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const locked = await lockOrder(tx, id);
    if (locked.status !== "DRAFT") throw invalidStatus(locked.number, locked.status, "edited");

    await assertSupplierUsable(tx, input.supplierId);
    await assertStoreUsable(tx, input.storeId);
    const { rows, total } = await buildLines(tx, input.lines);
    const before = await tx.purchaseOrder.findUniqueOrThrow({ where: { id }, select: { total: true, supplierId: true } });

    await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
    await tx.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: input.supplierId,
        storeId: input.storeId,
        expectedAt: input.expectedAt,
        note: input.note,
        total,
        lines: { create: rows },
      },
    });
    await recordAudit(tx, {
      action: "purchase_order.updated",
      entityType: "purchase_order",
      entityId: id,
      actorId,
      details: {
        lineCount: rows.length,
        total: { from: before.total.toFixed(2), to: total.toFixed(2) },
        ...(before.supplierId !== input.supplierId ? { supplierChanged: true } : {}),
      },
    });
    return getPurchaseOrder(id, tx);
  }, TRANSACTION_OPTIONS);
}

// ─── Status changes ──────────────────────────────────────────────────────────

/** DRAFT → ORDERED: the order has been sent to the supplier and its lines are now fixed. */
export async function placePurchaseOrder(id: string, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const locked = await lockOrder(tx, id);
    if (locked.status !== "DRAFT") throw invalidStatus(locked.number, locked.status, "placed");

    const order = await tx.purchaseOrder.findUniqueOrThrow({
      where: { id },
      select: { supplierId: true, storeId: true, total: true, lines: { select: { product: { select: { name: true, archivedAt: true } } } } },
    });
    if (order.lines.length === 0) {
      throw AppError.conflict("Add at least one product before placing the order.", "EMPTY_ORDER");
    }
    const archived = order.lines.filter((line) => line.product.archivedAt).map((line) => line.product.name);
    if (archived.length > 0) {
      throw AppError.conflict(`Remove archived products before ordering: ${archived.join(", ")}.`, "PRODUCT_ARCHIVED");
    }
    await assertSupplierUsable(tx, order.supplierId);
    await assertStoreUsable(tx, order.storeId);

    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "ORDERED", orderedAt: new Date(), orderedById: actorId },
    });
    await recordAudit(tx, {
      action: "purchase_order.ordered",
      entityType: "purchase_order",
      entityId: id,
      actorId,
      details: { total: order.total.toFixed(2), lineCount: order.lines.length },
    });
    return getPurchaseOrder(id, tx);
  }, TRANSACTION_OPTIONS);
}

/**
 * Cancels a draft or an open order. For a partially received order this cancels only what is
 * still outstanding: goods already received stay in stock and their receipts stay on record.
 */
export async function cancelPurchaseOrder(id: string, reason: string | null, actorId: string) {
  return prisma.$transaction(async (tx) => {
    const locked = await lockOrder(tx, id);
    if (locked.status === "RECEIVED" || locked.status === "CANCELLED") {
      throw invalidStatus(locked.number, locked.status, "cancelled");
    }

    // Cancelling removes the unreceived liability. Never strand an advance payment:
    // a refund workflow would be required before allowing this cancellation.
    const current = await getPurchaseOrder(id, tx);
    if (new Prisma.Decimal(current.paidTotal).greaterThan(current.receivedValue)) {
      throw AppError.conflict("Payments exceed the value already received. This order cannot be cancelled while it has an unallocated advance payment.", "PAYMENTS_PREVENT_CANCELLATION");
    }

    const lines = await tx.purchaseOrderLine.findMany({
      where: { purchaseOrderId: id },
      select: { quantityOrdered: true, quantityReceived: true },
    });
    await tx.purchaseOrder.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actorId, cancelReason: reason },
    });
    await recordAudit(tx, {
      action: "purchase_order.cancelled",
      entityType: "purchase_order",
      entityId: id,
      actorId,
      details: {
        previousStatus: locked.status,
        reason,
        unitsCancelled: lines.reduce((total, line) => total + line.quantityOrdered - line.quantityReceived, 0),
      },
    });
    return getPurchaseOrder(id, tx);
  }, TRANSACTION_OPTIONS);
}

// ─── Receiving ───────────────────────────────────────────────────────────────

/**
 * Books a delivery against an open order, all in one transaction:
 * receipt + receipt lines, a PURCHASE_RECEIPT stock movement and inventory increase per
 * line, the lines' received quantities, the order's new status, and an audit entry. If any
 * step fails, none of it happens.
 *
 * Safety:
 * - The order row is locked first, so concurrent receipts for the same order are serialized
 *   and the over-receipt check always sees the latest received quantities.
 * - The idempotency key makes retries and double-submits safe: a request whose key was
 *   already used gets the original result back (`replayed: true`) and changes nothing.
 * - CHECK (quantity_received <= quantity_ordered) backs the over-receipt rule in the database.
 */
export async function receivePurchaseOrder(id: string, input: ReceivePurchaseOrderInput, actorId: string) {
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockOrder(tx, id);

      const previous = await tx.purchaseReceipt.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { lines: true },
      });
      if (previous) {
        if (previous.purchaseOrderId !== id) throw keyReused();
        assertReceiptReplay(previous, input);
        return { replayed: true, receiptId: previous.id, order: await getPurchaseOrder(id, tx) };
      }

      if (locked.status === "DRAFT") {
        throw AppError.conflict("Mark the order as ordered before receiving stock against it.", "ORDER_NOT_PLACED");
      }
      if (locked.status === "RECEIVED") {
        throw AppError.conflict(`${formatPurchaseOrderNumber(locked.number)} has already been fully received.`, "ALREADY_RECEIVED");
      }
      if (locked.status === "CANCELLED") {
        throw AppError.conflict(`${formatPurchaseOrderNumber(locked.number)} was cancelled; nothing more can be received.`, "ORDER_CANCELLED");
      }
      await assertStoreUsable(tx, locked.storeId);

      const orderLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } });
      const linesById = new Map(orderLines.map((line) => [line.id, line]));

      const issues: FieldIssue[] = [];
      const overReceipt: FieldIssue[] = [];
      const toReceive: { line: (typeof orderLines)[number]; quantity: number }[] = [];
      input.lines.forEach((requested, index) => {
        const line = linesById.get(requested.lineId);
        if (!line) {
          issues.push({ path: ["lines", index, "lineId"], message: "This line isn't on the order" });
          return;
        }
        if (requested.quantity === 0) return;
        const outstanding = line.quantityOrdered - line.quantityReceived;
        if (requested.quantity > outstanding) {
          overReceipt.push({
            path: ["lines", index, "quantity"],
            message:
              outstanding === 0
                ? `${line.productName} has already been fully received`
                : `Only ${outstanding} of ${line.productName} still outstanding`,
          });
          return;
        }
        toReceive.push({ line, quantity: requested.quantity });
      });
      if (issues.length > 0) throw AppError.badRequest(issues.map((issue) => issue.message).join(". "), issues);
      if (overReceipt.length > 0) {
        throw new AppError(
          409,
          "OVER_RECEIPT",
          `Can't receive more than was ordered. ${overReceipt.map((issue) => issue.message).join(". ")}.`,
          overReceipt,
        );
      }

      const receipt = await tx.purchaseReceipt.create({
        data: { purchaseOrderId: id, idempotencyKey: input.idempotencyKey, note: input.note, receivedById: actorId },
      });

      const number = formatPurchaseOrderNumber(locked.number);
      let units = 0;
      let value = new Prisma.Decimal(0);
      // Product order keeps lock acquisition consistent with every other multi-line stock change.
      toReceive.sort((a, b) => a.line.productId.localeCompare(b.line.productId));
      for (const { line, quantity } of toReceive) {
        await applyStockChange(tx, {
          productId: line.productId,
          storeId: locked.storeId,
          change: quantity,
          type: "PURCHASE_RECEIPT",
          reason: null,
          note: `Received on ${number}`,
          userId: actorId,
          purchaseReceiptId: receipt.id,
        });
        await tx.purchaseReceiptLine.create({
          data: { receiptId: receipt.id, purchaseOrderLineId: line.id, productId: line.productId, quantity, unitCost: line.unitCost },
        });
        await tx.purchaseOrderLine.update({ where: { id: line.id }, data: { quantityReceived: { increment: quantity } } });
        units += quantity;
        value = value.add(line.unitCost.mul(quantity));
      }

      const received = new Map(toReceive.map(({ line, quantity }) => [line.id, quantity]));
      const complete = orderLines.every(
        (line) => line.quantityReceived + (received.get(line.id) ?? 0) >= line.quantityOrdered,
      );
      const status: PurchaseOrderStatus = complete ? "RECEIVED" : "PARTIALLY_RECEIVED";
      await tx.purchaseOrder.update({
        where: { id },
        data: { status, receivedAt: complete ? receipt.receivedAt : null },
      });

      await recordAudit(tx, {
        action: "purchase_order.received",
        entityType: "purchase_order",
        entityId: id,
        actorId,
        details: { receiptId: receipt.id, units, value: value.toFixed(2), lineCount: toReceive.length, status },
      });

      return { replayed: false, receiptId: receipt.id, order: await getPurchaseOrder(id, tx) };
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    // Two requests with the same key for different orders raced past the lookup: the unique
    // index rejected the second. (Same-order duplicates are already serialized by the lock.)
    if (isUniqueViolation(error) && uniqueViolationMentions(error, "idempotency_key")) {
      const previous = await prisma.purchaseReceipt.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { lines: true } });
      if (previous?.purchaseOrderId === id) {
        assertReceiptReplay(previous, input);
        return { replayed: true, receiptId: previous.id, order: await getPurchaseOrder(id) };
      }
      throw keyReused();
    }
    throw error;
  }
}

function keyReused() {
  return AppError.conflict("This request key was already used for a different order or different details.", "IDEMPOTENCY_KEY_REUSED");
}

function assertReceiptReplay(
  receipt: { note: string | null; lines: { purchaseOrderLineId: string; quantity: number }[] },
  input: ReceivePurchaseOrderInput,
) {
  const requested = input.lines.filter((line) => line.quantity > 0);
  if (receipt.note !== input.note || requested.length !== receipt.lines.length ||
    requested.some((line) => !receipt.lines.some((saved) => saved.purchaseOrderLineId === line.lineId && saved.quantity === line.quantity))) {
    throw keyReused();
  }
}

/** Every payment shares the order row lock with receipts and cancellation. Sum using
 * decimals under that lock, so concurrent payments cannot both spend the same balance. */
export async function recordPurchasePayment(id: string, input: PurchasePaymentInput, actorId: string) {
  const replay = async (tx: Prisma.TransactionClient) => {
    const previous = await tx.purchasePayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (!previous) return null;
    if (previous.purchaseOrderId !== id || !previous.amount.equals(input.amount) || previous.method !== input.method ||
      previous.reference !== input.reference || previous.paidAt.getTime() !== input.paidAt.getTime()) throw keyReused();
    return { replayed: true, paymentId: previous.id, order: await getPurchaseOrder(id, tx) };
  };
  try {
    return await prisma.$transaction(async (tx) => {
      const locked = await lockOrder(tx, id);
      const previous = await replay(tx);
      if (previous) return previous;
      if (locked.status === "DRAFT") throw invalidStatus(locked.number, locked.status, "paid");
      const order = await getPurchaseOrder(id, tx);
      const amount = new Prisma.Decimal(input.amount);
      if (amount.greaterThan(order.balanceDue)) {
        throw AppError.conflict(`Payment exceeds the outstanding balance of ${order.balanceDue}.`, "OVERPAYMENT");
      }
      const payment = await tx.purchasePayment.create({ data: {
        purchaseOrderId: id, idempotencyKey: input.idempotencyKey, amount,
        method: input.method, reference: input.reference, paidAt: input.paidAt, recordedById: actorId,
      } });
      await recordAudit(tx, {
        action: "purchase_order.payment_recorded", entityType: "purchase_order", entityId: id, actorId,
        details: { paymentId: payment.id, amount: amount.toFixed(2), method: input.method, reference: input.reference },
      });
      return { replayed: false, paymentId: payment.id, order: await getPurchaseOrder(id, tx) };
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (isUniqueViolation(error) && uniqueViolationMentions(error, "idempotency_key")) {
      const previous = await replay(prisma);
      if (previous) return previous;
      throw keyReused();
    }
    throw error;
  }
}
