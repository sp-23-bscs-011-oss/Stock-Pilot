import { prisma } from "../lib/prisma.js";
import { isUniqueViolation } from "../lib/prismaErrors.js";
import { AppError } from "../utils/AppError.js";

const codeTaken = () =>
  new AppError(409, "DUPLICATE_VALUE", "Another store already uses this code", [
    { path: ["code"], message: "Another store already uses this code" },
  ]);

export async function listStores(includeInactive: boolean) {
  return prisma.store.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
  });
}

export async function createStore(input: { name: string; code: string }) {
  try {
    return await prisma.store.create({ data: input });
  } catch (error) {
    if (isUniqueViolation(error)) throw codeTaken();
    throw error;
  }
}

/** Stores are deactivated rather than deleted: their stock movements are permanent history. */
export async function updateStore(id: string, input: { name?: string; code?: string; isActive?: boolean }) {
  const store = await prisma.store.findUnique({ where: { id } });
  if (!store) throw AppError.notFound("Store not found");

  if (input.isActive === false && store.isActive) {
    const otherActive = await prisma.store.count({ where: { isActive: true, NOT: { id } } });
    if (otherActive === 0) throw AppError.conflict("At least one store must stay active", "LAST_ACTIVE_STORE");
  }

  try {
    return await prisma.store.update({ where: { id }, data: input });
  } catch (error) {
    if (isUniqueViolation(error)) throw codeTaken();
    throw error;
  }
}
