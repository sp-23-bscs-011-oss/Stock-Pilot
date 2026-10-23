import { applyStockChange } from "../src/services/inventory.service.js";
import { prisma } from "./helpers.js";

let counter = 0;

export async function createStore(overrides: { name?: string; code?: string; isActive?: boolean } = {}) {
  counter += 1;
  return prisma.store.create({
    data: { name: overrides.name ?? `Store ${counter}`, code: overrides.code ?? `S${counter}`, isActive: overrides.isActive ?? true },
  });
}

/** Puts stock in place through the real ledger, so level and movements stay consistent. */
export async function seedStock(productId: string, storeId: string, quantity: number) {
  await prisma.$transaction((tx) =>
    applyStockChange(tx, {
      productId,
      storeId,
      setTo: quantity,
      type: "ADJUSTMENT",
      reason: "STOCK_COUNT",
      note: "test seed",
      userId: null,
    }),
  );
}

export async function onHand(productId: string, storeId: string): Promise<number> {
  const level = await prisma.inventoryLevel.findUnique({ where: { productId_storeId: { productId, storeId } } });
  return level?.quantity ?? 0;
}

/** The ledger invariant: movements for a (product, store) sum to its on-hand quantity. */
export async function ledgerTotal(productId: string, storeId: string): Promise<number> {
  const { _sum } = await prisma.stockMovement.aggregate({ where: { productId, storeId }, _sum: { quantityChange: true } });
  return _sum.quantityChange ?? 0;
}
