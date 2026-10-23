import { Prisma } from "../generated/prisma/client.js";

export function isUniqueViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function isForeignKeyViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

/**
 * Whether a unique violation involved the given column or index. Driver adapters report the
 * constraint in different places within `meta`, so search all of it.
 */
export function uniqueViolationMentions(error: Prisma.PrismaClientKnownRequestError, ...names: string[]): boolean {
  const meta = JSON.stringify(error.meta ?? {});
  return names.some((name) => meta.includes(name));
}
