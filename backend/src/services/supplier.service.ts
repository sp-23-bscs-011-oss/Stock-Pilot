import { prisma } from "../lib/prisma.js";
import { isUniqueViolation } from "../lib/prismaErrors.js";
import { AppError } from "../utils/AppError.js";
import type {
  CreateSupplierInput,
  ListSuppliersQuery,
  SupplierReportQuery,
  UpdateSupplierInput,
} from "../validators/purchasing.schemas.js";
import { auditInclude, changedFields, recordAudit, toAuditDto } from "./audit.service.js";
import { Prisma, type Supplier } from "../generated/prisma/client.js";

/** Same normalization as category names: trimmed, single-spaced, lower-cased. */
export function supplierNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

const nameTaken = () =>
  new AppError(409, "DUPLICATE_VALUE", "Another supplier already has this name", [
    { path: ["name"], message: "Another supplier already has this name" },
  ]);

function toSupplierDto(supplier: Supplier) {
  return {
    id: supplier.id,
    name: supplier.name,
    contactName: supplier.contactName,
    email: supplier.email,
    phone: supplier.phone,
    address: supplier.address,
    paymentTerms: supplier.paymentTerms,
    notes: supplier.notes,
    isActive: supplier.isActive,
    createdAt: supplier.createdAt,
    updatedAt: supplier.updatedAt,
  };
}

async function findOrThrow(id: string): Promise<Supplier> {
  const supplier = await prisma.supplier.findUnique({ where: { id } });
  if (!supplier) throw AppError.notFound("Supplier not found");
  return supplier;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function listSuppliers(query: ListSuppliersQuery) {
  const where: Prisma.SupplierWhereInput = {
    isActive: query.status === "all" ? undefined : query.status === "active",
    OR: query.search
      ? [
          { name: { contains: query.search, mode: "insensitive" } },
          { contactName: { contains: query.search, mode: "insensitive" } },
          { email: { contains: query.search, mode: "insensitive" } },
          { phone: { contains: query.search } },
        ]
      : undefined,
  };

  const [total, suppliers] = await prisma.$transaction([
    prisma.supplier.count({ where }),
    prisma.supplier.findMany({
      where,
      orderBy: [{ [query.sort]: query.order }, { id: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  const stats = await supplierStats(suppliers.map((supplier) => supplier.id), {});
  return {
    items: suppliers.map((supplier) => ({ ...toSupplierDto(supplier), stats: stats.get(supplier.id) ?? emptyStats() })),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}

export async function getSupplier(id: string) {
  const supplier = await findOrThrow(id);
  const [stats, activity] = await Promise.all([
    supplierStats([id], {}),
    prisma.auditLog.findMany({
      where: { entityType: "supplier", entityId: id },
      include: auditInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
  ]);
  return { ...toSupplierDto(supplier), stats: stats.get(id) ?? emptyStats(), activity: activity.map(toAuditDto) };
}

// ─── Mutations ───────────────────────────────────────────────────────────────

export async function createSupplier(input: CreateSupplierInput, actorId: string) {
  try {
    const supplier = await prisma.$transaction(async (tx) => {
      const created = await tx.supplier.create({
        data: { ...input, nameKey: supplierNameKey(input.name), createdById: actorId, updatedById: actorId },
      });
      await recordAudit(tx, {
        action: "supplier.created",
        entityType: "supplier",
        entityId: created.id,
        actorId,
        details: { name: created.name },
      });
      return created;
    });
    return { ...toSupplierDto(supplier), stats: emptyStats() };
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
}

export async function updateSupplier(id: string, input: UpdateSupplierInput, actorId: string) {
  const existing = await findOrThrow(id);
  try {
    const supplier = await prisma.$transaction(async (tx) => {
      const updated = await tx.supplier.update({
        where: { id },
        data: {
          ...input,
          nameKey: input.name === undefined ? undefined : supplierNameKey(input.name),
          updatedById: actorId,
        },
      });
      const changes = changedFields(existing, input);
      if (Object.keys(changes).length > 0) {
        const action =
          "isActive" in changes ? (updated.isActive ? "supplier.reactivated" : "supplier.deactivated") : "supplier.updated";
        await recordAudit(tx, { action, entityType: "supplier", entityId: id, actorId, details: { changes } });
      }
      return updated;
    });
    const stats = await supplierStats([id], {});
    return { ...toSupplierDto(supplier), stats: stats.get(id) ?? emptyStats() };
  } catch (error) {
    if (isUniqueViolation(error)) throw nameTaken();
    throw error;
  }
}

/**
 * Only suppliers that were never ordered from can be deleted; the rest are deactivated so
 * their purchase history keeps pointing at them.
 */
export async function deleteSupplier(id: string, actorId: string) {
  const supplier = await findOrThrow(id);
  const orders = await prisma.purchaseOrder.count({ where: { supplierId: id } });
  if (orders > 0) {
    throw AppError.conflict(
      `${supplier.name} has ${orders} purchase order${orders === 1 ? "" : "s"}. Deactivate the supplier instead, so the history stays intact.`,
      "SUPPLIER_HAS_ORDERS",
    );
  }
  try {
    await prisma.$transaction(async (tx) => {
      await tx.supplier.delete({ where: { id } });
      await recordAudit(tx, {
        action: "supplier.deleted",
        entityType: "supplier",
        entityId: id,
        actorId,
        details: { name: supplier.name },
      });
    });
  } catch (error) {
    // An order was created between the count and the delete.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw AppError.conflict("This supplier now has purchase orders. Deactivate it instead.", "SUPPLIER_HAS_ORDERS");
    }
    throw error;
  }
}

// ─── Statistics & reports ────────────────────────────────────────────────────

export interface SupplierStats {
  /** Orders placed (ORDERED or later), cancelled ones included. */
  orderCount: number;
  /** Orders still expecting goods. */
  openOrders: number;
  draftOrders: number;
  /** Total of placed orders that weren't cancelled. */
  orderedValue: string;
  /** Value of goods actually received (receipt quantity × unit cost). */
  receivedValue: string;
  unitsReceived: number;
  /** Value of goods still due on open orders. Always current, regardless of the date range. */
  outstandingValue: string;
  /** Mean days from placing an order to its first delivery; null without deliveries. */
  averageLeadTimeDays: number | null;
  lastOrderedAt: Date | null;
}

function emptyStats(): SupplierStats {
  return {
    orderCount: 0,
    openOrders: 0,
    draftOrders: 0,
    orderedValue: "0.00",
    receivedValue: "0.00",
    unitsReceived: 0,
    outstandingValue: "0.00",
    averageLeadTimeDays: null,
    lastOrderedAt: null,
  };
}

interface StatsRow {
  supplier_id: string;
  order_count: number;
  open_orders: number;
  draft_orders: number;
  ordered_value: string;
  received_value: string;
  units_received: number;
  outstanding_value: string;
  avg_lead_days: string | null;
  last_ordered_at: Date | null;
}

/**
 * Purchasing figures per supplier in one round trip. `range` limits order figures to orders
 * placed in it and received value to deliveries booked in it. Money is summed in SQL NUMERIC
 * and returned as 2-decimal strings, so totals are exact. `supplierIds` null means all.
 */
async function supplierStats(supplierIds: string[] | null, range: { from?: Date; to?: Date }) {
  const result = new Map<string, SupplierStats>();
  if (supplierIds && supplierIds.length === 0) return result;

  const between = (column: Prisma.Sql) => Prisma.sql`
    ${range.from ? Prisma.sql`AND ${column} >= ${range.from}` : Prisma.empty}
    ${range.to ? Prisma.sql`AND ${column} <= ${range.to}` : Prisma.empty}`;
  const onlySuppliers = (column: Prisma.Sql) =>
    supplierIds ? Prisma.sql`AND ${column} = ANY(${supplierIds}::uuid[])` : Prisma.empty;

  const rows = await prisma.$queryRaw<StatsRow[]>`
    WITH placed AS (
      SELECT po.supplier_id,
             COUNT(*)::int AS order_count,
             COALESCE(SUM(po.total) FILTER (WHERE po.status <> 'CANCELLED'), 0) AS ordered_value,
             MAX(po.ordered_at) AS last_ordered_at,
             AVG(EXTRACT(EPOCH FROM (fr.first_receipt - po.ordered_at)) / 86400) AS avg_lead_days
      FROM purchase_orders po
      LEFT JOIN LATERAL (
        SELECT MIN(r.received_at) AS first_receipt FROM purchase_receipts r WHERE r.purchase_order_id = po.id
      ) fr ON true
      WHERE po.ordered_at IS NOT NULL ${between(Prisma.sql`po.ordered_at`)} ${onlySuppliers(Prisma.sql`po.supplier_id`)}
      GROUP BY po.supplier_id
    ),
    received AS (
      SELECT po.supplier_id,
             SUM(rl.quantity * rl.unit_cost) AS received_value,
             SUM(rl.quantity)::int AS units_received
      FROM purchase_receipt_lines rl
      JOIN purchase_receipts r ON r.id = rl.receipt_id
      JOIN purchase_orders po ON po.id = r.purchase_order_id
      WHERE true ${between(Prisma.sql`r.received_at`)} ${onlySuppliers(Prisma.sql`po.supplier_id`)}
      GROUP BY po.supplier_id
    ),
    current_orders AS (
      SELECT po.supplier_id,
             (COUNT(DISTINCT po.id) FILTER (WHERE po.status IN ('ORDERED', 'PARTIALLY_RECEIVED')))::int AS open_orders,
             (COUNT(DISTINCT po.id) FILTER (WHERE po.status = 'DRAFT'))::int AS draft_orders,
             COALESCE(SUM((l.quantity_ordered - l.quantity_received) * l.unit_cost)
               FILTER (WHERE po.status IN ('ORDERED', 'PARTIALLY_RECEIVED')), 0) AS outstanding_value
      FROM purchase_orders po
      LEFT JOIN purchase_order_lines l ON l.purchase_order_id = po.id
      WHERE po.status IN ('DRAFT', 'ORDERED', 'PARTIALLY_RECEIVED') ${onlySuppliers(Prisma.sql`po.supplier_id`)}
      GROUP BY po.supplier_id
    )
    SELECT s.id AS supplier_id,
           COALESCE(p.order_count, 0) AS order_count,
           COALESCE(c.open_orders, 0) AS open_orders,
           COALESCE(c.draft_orders, 0) AS draft_orders,
           COALESCE(p.ordered_value, 0)::numeric(16, 2)::text AS ordered_value,
           COALESCE(r.received_value, 0)::numeric(16, 2)::text AS received_value,
           COALESCE(r.units_received, 0) AS units_received,
           COALESCE(c.outstanding_value, 0)::numeric(16, 2)::text AS outstanding_value,
           p.avg_lead_days::numeric(10, 1)::text AS avg_lead_days,
           p.last_ordered_at
    FROM suppliers s
    LEFT JOIN placed p ON p.supplier_id = s.id
    LEFT JOIN received r ON r.supplier_id = s.id
    LEFT JOIN current_orders c ON c.supplier_id = s.id
    WHERE true ${onlySuppliers(Prisma.sql`s.id`)}`;

  for (const row of rows) {
    result.set(row.supplier_id, {
      orderCount: row.order_count,
      openOrders: row.open_orders,
      draftOrders: row.draft_orders,
      orderedValue: row.ordered_value,
      receivedValue: row.received_value,
      unitsReceived: row.units_received,
      outstandingValue: row.outstanding_value,
      averageLeadTimeDays: row.avg_lead_days === null ? null : Number(row.avg_lead_days),
      lastOrderedAt: row.last_ordered_at,
    });
  }
  return result;
}

/**
 * Purchasing performance per supplier for a period: every active supplier, plus inactive ones
 * that had activity. Sorted by ordered value, largest first, with grand totals.
 */
export async function supplierReport(query: SupplierReportQuery) {
  const [suppliers, stats] = await Promise.all([
    prisma.supplier.findMany({ select: { id: true, name: true, isActive: true } }),
    supplierStats(null, query),
  ]);

  const rows = suppliers
    .map((supplier) => ({ supplier, stats: stats.get(supplier.id) ?? emptyStats() }))
    .filter(
      ({ supplier, stats: s }) =>
        supplier.isActive || s.orderCount > 0 || s.unitsReceived > 0 || s.openOrders > 0,
    )
    .sort(
      (a, b) =>
        new Prisma.Decimal(b.stats.orderedValue).comparedTo(a.stats.orderedValue) ||
        a.supplier.name.localeCompare(b.supplier.name),
    );

  const sum = (pick: (s: SupplierStats) => string) =>
    rows.reduce((total, row) => total.add(pick(row.stats)), new Prisma.Decimal(0)).toFixed(2);

  return {
    from: query.from ?? null,
    to: query.to ?? null,
    rows,
    totals: {
      orderCount: rows.reduce((total, row) => total + row.stats.orderCount, 0),
      openOrders: rows.reduce((total, row) => total + row.stats.openOrders, 0),
      orderedValue: sum((s) => s.orderedValue),
      receivedValue: sum((s) => s.receivedValue),
      unitsReceived: rows.reduce((total, row) => total + row.stats.unitsReceived, 0),
      outstandingValue: sum((s) => s.outstandingValue),
    },
  };
}
