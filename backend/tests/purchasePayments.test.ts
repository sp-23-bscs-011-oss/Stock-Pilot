import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createProduct } from "./catalogHelpers.js";
import { buildApp, newAgent, prisma, resetDatabase, signedInAgent, type Agent } from "./helpers.js";
import { createStore, onHand } from "./inventoryHelpers.js";
import { createSupplier, receive } from "./purchasingHelpers.js";

const app = buildApp();
beforeEach(resetDatabase);

async function setup(role: "OWNER" | "MANAGER" = "OWNER", submit = true) {
  const session = await signedInAgent(app, role);
  const supplier = await createSupplier();
  const store = await createStore();
  const product = await createProduct();
  const input = { supplierId: supplier.id, storeId: store.id, lines: [{ productId: product.id, quantity: 3, unitCost: "0.10" }] };
  const created = await session.agent.post("/api/purchases").set("X-CSRF-Token", session.csrf).send(input).expect(201);
  const order = created.body.order as { id: string; lines: { id: string }[] };
  if (submit) await session.agent.post(`/api/purchases/${order.id}/submit`).set("X-CSRF-Token", session.csrf).send().expect(200);
  return { ...session, supplier, store, product, order, input };
}

function payment(overrides: Record<string, unknown> = {}) {
  return { idempotencyKey: randomUUID(), amount: "0.10", method: "BANK_TRANSFER", paidAt: "2026-01-01", reference: "BANK-123", ...overrides };
}
function pay(agent: Agent, csrf: string, id: string, input = payment()) {
  return agent.post(`/api/purchases/${id}/payments`).set("X-CSRF-Token", csrf).send(input);
}

describe("Phase 5 API contract", () => {
  it("supports supplier status, PATCH drafts, submit and receipt-list routes", async () => {
    const { agent, csrf, supplier, order, input, product, store } = await setup("MANAGER", false);
    await agent.patch(`/api/suppliers/${supplier.id}/status`).set("X-CSRF-Token", csrf).send({ isActive: false }).expect(200);
    await agent.patch(`/api/suppliers/${supplier.id}/status`).set("X-CSRF-Token", csrf).send({ isActive: true }).expect(200);
    const updated = await agent.patch(`/api/purchases/${order.id}`).set("X-CSRF-Token", csrf).send({ ...input, note: "Updated" }).expect(200);
    await agent.post(`/api/purchases/${order.id}/submit`).set("X-CSRF-Token", csrf).send().expect(200);
    expect(await onHand(product.id, store.id)).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
    await agent.post(`/api/purchases/${order.id}/receipts`).set("X-CSRF-Token", csrf)
      .send({ idempotencyKey: randomUUID(), lines: [{ lineId: updated.body.order.lines[0].id, quantity: 1 }] }).expect(201);
    const list = await agent.get(`/api/purchases/${order.id}/receipts`).expect(200);
    expect(list.body.receipts).toHaveLength(1);
    expect(list.body.receipts[0].receivedBy).toBeTruthy();
    expect(await onHand(product.id, store.id)).toBe(1);
  });

  it("rejects unauthenticated users and cashiers on all new routes", async () => {
    const { order, supplier } = await setup();
    await newAgent(app).get("/api/purchases").expect(401);
    const { agent, csrf } = await signedInAgent(app, "CASHIER");
    for (const path of ["/api/purchases", `/api/purchases/${order.id}`, `/api/purchases/${order.id}/receipts`]) {
      await agent.get(path).expect(403);
    }
    for (const suffix of ["submit", "cancel", "receipts", "payments"]) {
      await agent.post(`/api/purchases/${order.id}/${suffix}`).set("X-CSRF-Token", csrf).send({}).expect(403);
    }
    await agent.post("/api/purchases").set("X-CSRF-Token", csrf).send({}).expect(403);
    await agent.patch(`/api/purchases/${order.id}`).set("X-CSRF-Token", csrf).send({}).expect(403);
    await agent.patch(`/api/suppliers/${supplier.id}/status`).set("X-CSRF-Token", csrf).send({ isActive: false }).expect(403);
  });
});

describe("supplier payments", () => {
  it("tracks exact partial/full payments independently of receiving and audits the actor", async () => {
    const { agent, csrf, order, user, product, store, supplier } = await setup();
    const partial = await pay(agent, csrf, order.id).expect(201);
    expect(partial.body.order).toMatchObject({ total: "0.30", paidTotal: "0.10", balanceDue: "0.20", paymentStatus: "PARTIALLY_PAID", status: "ORDERED" });
    const supplierProfile = await agent.get(`/api/suppliers/${supplier.id}`).expect(200);
    expect(supplierProfile.body.supplier.stats).toMatchObject({ paidTotal: "0.10", balanceDue: "0.20", outstandingValue: "0.30" });
    const report = await agent.get("/api/suppliers/report").expect(200);
    expect(report.body.totals).toMatchObject({ paidTotal: "0.10", balanceDue: "0.20" });
    const full = await pay(agent, csrf, order.id, payment({ amount: "0.20" })).expect(201);
    expect(full.body.order).toMatchObject({ paidTotal: "0.30", balanceDue: "0.00", paymentStatus: "PAID", status: "ORDERED" });
    expect(full.body.order.payments[0].recordedBy.id).toBe(user.id);
    expect(await onHand(product.id, store.id)).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "purchase_order.payment_recorded", actorId: user.id } })).toBe(2);
    const received = await receive(agent, csrf, order.id, [{ lineId: order.lines[0]!.id, quantity: 3 }]).expect(201);
    expect(received.body.order).toMatchObject({ status: "RECEIVED", paymentStatus: "PAID", balanceDue: "0.00" });
    const list = await agent.get("/api/purchases").expect(200);
    expect(list.body.items[0]).toMatchObject({ paymentStatus: "PAID", paidTotal: "0.30" });
    await agent.patch(`/api/suppliers/${supplier.id}/status`).set("X-CSRF-Token", csrf).send({ isActive: false }).expect(200);
    const historical = await agent.get("/api/suppliers/report?from=2020-01-01&to=2020-12-31").expect(200);
    expect(historical.body.totals).toMatchObject({ paidTotal: "0.30", balanceDue: "0.00" });
  });

  it("restricts payment writes to owners and requires CSRF", async () => {
    const { agent, csrf, order } = await setup("MANAGER");
    await pay(agent, csrf, order.id).expect(403);
    const owner = await signedInAgent(app, "OWNER");
    await owner.agent.post(`/api/purchases/${order.id}/payments`).send(payment()).expect(403);
    await pay(owner.agent, owner.csrf, order.id).expect(201);
  });

  it.each(["0", "0.00", "-1.00", "0.001", "NaN", "1e2", "1000000000000.00", 0.1])("rejects invalid amount %s", async (amount) => {
    const { agent, csrf, order } = await setup();
    await pay(agent, csrf, order.id, payment({ amount })).expect(400);
    expect(await prisma.purchasePayment.count()).toBe(0);
  });

  it("rejects invalid dates/methods, excessive payments and draft payments", async () => {
    const { agent, csrf, order } = await setup("OWNER", false);
    await pay(agent, csrf, order.id).expect(409);
    await agent.post(`/api/purchases/${order.id}/submit`).set("X-CSRF-Token", csrf).send().expect(200);
    for (const change of [{ paidAt: "2999-01-01" }, { paidAt: "2026-02-30" }, { method: "CRYPTO" }, { reference: "x".repeat(161) }]) {
      await pay(agent, csrf, order.id, payment(change)).expect(400);
    }
    expect((await pay(agent, csrf, order.id, payment({ amount: "0.31" })).expect(409)).body.error.code).toBe("OVERPAYMENT");
    expect(await prisma.purchasePayment.count()).toBe(0);
  });

  it("deduplicates concurrent retries and rejects changed payloads using the same key", async () => {
    const { agent, csrf, order } = await setup();
    const input = payment();
    const results = await Promise.all([pay(agent, csrf, order.id, input), pay(agent, csrf, order.id, input)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(new Set(results.map((r) => r.body.paymentId)).size).toBe(1);
    await pay(agent, csrf, order.id, { ...input, amount: "0.20" }).expect(409);
    await pay(agent, csrf, order.id, { ...input, reference: "changed" }).expect(409);
    expect(await prisma.purchasePayment.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "purchase_order.payment_recorded" } })).toBe(1);
  });

  it("serializes different concurrent payments so they cannot overpay", async () => {
    const { agent, csrf, order } = await setup();
    const results = await Promise.all([pay(agent, csrf, order.id, payment({ amount: "0.20" })), pay(agent, csrf, order.id, payment({ amount: "0.20" }))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.purchasePayment.count()).toBe(1);
    expect((await agent.get(`/api/purchases/${order.id}`)).body.order.balanceDue).toBe("0.10");
  });

  it("rejects concurrent reuse of a payment key across different orders", async () => {
    const { agent, csrf, order, input } = await setup();
    const second = await agent.post("/api/purchases").set("X-CSRF-Token", csrf).send(input).expect(201);
    await agent.post(`/api/purchases/${second.body.order.id}/submit`).set("X-CSRF-Token", csrf).send().expect(200);
    const body = payment();
    const results = await Promise.all([pay(agent, csrf, order.id, body), pay(agent, csrf, second.body.order.id, body)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.purchasePayment.count()).toBe(1);
  });

  it("blocks cancellation of unallocated advances and settles only received value after cancellation", async () => {
    const { agent, csrf, order, product, store } = await setup();
    await pay(agent, csrf, order.id).expect(201);
    const cancel = () => agent.post(`/api/purchases/${order.id}/cancel`).set("X-CSRF-Token", csrf).send({ reason: "Remainder unavailable" });
    expect((await cancel().expect(409)).body.error.code).toBe("PAYMENTS_PREVENT_CANCELLATION");
    await receive(agent, csrf, order.id, [{ lineId: order.lines[0]!.id, quantity: 2 }]).expect(201);
    const cancelled = await cancel().expect(200);
    expect(cancelled.body.order).toMatchObject({ status: "CANCELLED", payableTotal: "0.20", balanceDue: "0.10" });
    const settled = await pay(agent, csrf, order.id).expect(201);
    expect(settled.body.order).toMatchObject({ paymentStatus: "PAID", balanceDue: "0.00" });
    await pay(agent, csrf, order.id).expect(409);
    expect(await onHand(product.id, store.id)).toBe(2);
  });

  it("serializes payment against cancellation", async () => {
    const { agent, csrf, order } = await setup();
    const results = await Promise.all([
      pay(agent, csrf, order.id),
      agent.post(`/api/purchases/${order.id}/cancel`).set("X-CSRF-Token", csrf).send({}),
    ]);
    expect(results.filter((r) => r.status >= 200 && r.status < 300)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(1);
    const final = (await agent.get(`/api/purchases/${order.id}`).expect(200)).body.order;
    expect(Number(final.balanceDue)).toBeGreaterThanOrEqual(0);
  });

  it("keeps payments immutable and validates positive amounts in PostgreSQL", async () => {
    const { agent, csrf, order, user } = await setup();
    await pay(agent, csrf, order.id).expect(201);
    await expect(prisma.purchasePayment.updateMany({ data: { amount: "0.20" } })).rejects.toThrow();
    await expect(prisma.purchasePayment.deleteMany()).rejects.toThrow();
    await expect(prisma.purchasePayment.create({ data: {
      purchaseOrderId: order.id, idempotencyKey: randomUUID(), amount: "0", method: "CASH", paidAt: new Date("2026-01-01"), recordedById: user.id,
    } })).rejects.toThrow();
  });
});

describe("receipt retry integrity", () => {
  it("rejects changed quantities or notes with an existing key", async () => {
    const { agent, csrf, order, product, store } = await setup();
    const key = randomUUID();
    const lines = [{ lineId: order.lines[0]!.id, quantity: 1 }];
    await receive(agent, csrf, order.id, lines, key, "delivery one").expect(201);
    await receive(agent, csrf, order.id, [{ ...lines[0]!, quantity: 2 }], key, "delivery one").expect(409);
    await receive(agent, csrf, order.id, lines, key, "different delivery").expect(409);
    await receive(agent, csrf, order.id, lines, key, "delivery one").expect(200);
    expect(await onHand(product.id, store.id)).toBe(1);
  });
});
