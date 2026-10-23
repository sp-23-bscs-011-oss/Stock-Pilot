import { prisma } from "../lib/prisma.js";
import type { ListAuditLogsQuery } from "../validators/audit.schemas.js";
import type { Prisma } from "../generated/prisma/client.js";

export type AuditEntityType = "supplier" | "purchase_order";

export interface AuditEntry {
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  actorId: string | null;
  details?: Prisma.InputJsonObject;
}

/**
 * Records a business event. Pass the transaction that makes the change, so the event is
 * written if and only if the change commits.
 */
export async function recordAudit(tx: Prisma.TransactionClient, entry: AuditEntry) {
  await tx.auditLog.create({
    data: {
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      actorId: entry.actorId,
      details: entry.details,
    },
  });
}

/**
 * The fields whose values differ between two snapshots, as `{ field: { from, to } }`.
 * Only keys present in `next` are compared (partial updates).
 */
export function changedFields<T extends Record<string, unknown>>(previous: T, next: Partial<T>) {
  const changes: Record<string, { from: Prisma.InputJsonValue | null; to: Prisma.InputJsonValue | null }> = {};
  for (const [key, value] of Object.entries(next)) {
    if (value === undefined) continue;
    const before = previous[key];
    if (String(before ?? "") !== String(value ?? "")) {
      changes[key] = { from: toJson(before), to: toJson(value) };
    }
  }
  return changes;
}

function toJson(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

export const auditInclude = { actor: { select: { id: true, name: true } } } as const;

type AuditLogWithActor = Prisma.AuditLogGetPayload<{ include: typeof auditInclude }>;

export function toAuditDto(log: AuditLogWithActor) {
  return {
    id: log.id,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    actor: log.actor,
    details: log.details,
    createdAt: log.createdAt,
  };
}

export async function listAuditLogs(query: ListAuditLogsQuery) {
  const where: Prisma.AuditLogWhereInput = {
    entityType: query.entityType,
    entityId: query.entityId,
    action: query.action,
    actorId: query.actorId,
    createdAt: query.from || query.to ? { gte: query.from, lte: query.to } : undefined,
  };

  const [total, logs] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: auditInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return {
    items: logs.map(toAuditDto),
    page: query.page,
    pageSize: query.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
