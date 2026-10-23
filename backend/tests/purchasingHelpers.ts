import { randomUUID } from "node:crypto";
import { supplierNameKey } from "../src/services/supplier.service.js";
import { prisma, type Agent } from "./helpers.js";

let counter = 0;

export async function createSupplier(overrides: { name?: string; isActive?: boolean } = {}) {
  counter += 1;
  const name = overrides.name ?? `Supplier ${counter}`;
  return prisma.supplier.create({ data: { name, nameKey: supplierNameKey(name), isActive: overrides.isActive ?? true } });
}

/** A valid body for POST /api/suppliers. */
export function supplierBody(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return {
    name: `Acme Wholesale ${counter}`,
    contactName: "Jane Doe",
    email: `orders${counter}@acme.example`,
    phone: "+1 (555) 010-2000",
    address: "1 Market Street",
    paymentTerms: "Net 30",
    notes: "Delivers Tuesdays",
    ...overrides,
  };
}

export interface OrderLineBody {
  productId: string;
  quantity: number;
  unitCost: string | number;
}

export function createOrder(
  agent: Agent,
  csrf: string,
  body: { supplierId: string; storeId: string; lines: OrderLineBody[]; expectedAt?: string; note?: string },
) {
  return agent.post("/api/purchase-orders").set("X-CSRF-Token", csrf).send(body);
}

export function placeOrder(agent: Agent, csrf: string, id: string) {
  return agent.post(`/api/purchase-orders/${id}/order`).set("X-CSRF-Token", csrf).send();
}

export function receive(
  agent: Agent,
  csrf: string,
  id: string,
  lines: { lineId: string; quantity: number }[],
  idempotencyKey: string = randomUUID(),
  note?: string,
) {
  return agent
    .post(`/api/purchase-orders/${id}/receipts`)
    .set("X-CSRF-Token", csrf)
    .send({ idempotencyKey, lines, ...(note ? { note } : {}) });
}
