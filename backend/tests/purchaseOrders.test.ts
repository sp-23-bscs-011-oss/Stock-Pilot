import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createProduct } from "./catalogHelpers.js";
import { buildApp, prisma, resetDatabase, signedInAgent, type Agent } from "./helpers.js";
import { createStore, ledgerTotal, onHand, seedStock } from "./inventoryHelpers.js";
import { createOrder, createSupplier, placeOrder, receive, type OrderLineBody } from "./purchasingHelpers.js";

const app = buildApp();

beforeEach(resetDatabase);

interface OrderLine {
  id: string;
  productId: string;
  quantityOrdered: number;
  quantityReceived: number;
  quantityOutstanding: number;
}

async function setup(role: "OWNER" | "MANAGER" = "MANAGER") {
  const session = await signedInAgent(app, role);
  const supplier = await createSupplier({ name: "Acme Wholesale" });
  const store = await createStore();
  const cola = await createProduct({ name: "Cola 330ml", sku: "COLA" });
  const chips = await createProduct({ name: "Chips 50g", sku: "CHIPS" });
  return { ...session, supplier, store, cola, chips };
}

/** Creates and places an order; returns its id and lines keyed by product id. */
async function placedOrder(agent: Agent, csrf: string, supplierId: string, storeId: string, lines: OrderLineBody[]) {
  const created = await createOrder(agent, csrf, { supplierId, storeId, lines }).expect(201);
  const placed = await placeOrder(agent, csrf, created.body.order.id).expect(200);
  const byProduct = new Map<string, OrderLine>(placed.body.order.lines.map((line: OrderLine) => [line.productId, line]));
  return { id: created.body.order.id as string, line: (productId: string) => byProduct.get(productId)! };
}

describe("drafts", () => {
  it("creates a draft with exact line and order totals", async () => {
    const { agent, csrf, supplier, store, cola, chips, user } = await setup();
    const res = await createOrder(agent, csrf, {
      supplierId: supplier.id,
      storeId: store.id,
      expectedAt: "2026-11-30",
      note: "Rush order",
      lines: [
        // 3 × 0.10 is 0.30000000000000004 in floating point; it must come out as 0.30.
        { productId: cola.id, quantity: 3, unitCost: "0.10" },
        { productId: chips.id, quantity: 12, unitCost: 1.15 },
      ],
    }).expect(201);

    const order = res.body.order;
    expect(order).toMatchObject({
      status: "DRAFT",
      number: expect.stringMatching(/^PO-\d{5}$/),
      supplier: { id: supplier.id, name: "Acme Wholesale" },
      store: { id: store.id },
      expectedAt: "2026-11-30",
      note: "Rush order",
      total: "14.10",
      lineCount: 2,
      unitsOrdered: 15,
      unitsReceived: 0,
      createdBy: { id: user.id },
    });
    expect(order.lines).toEqual([
      expect.objectContaining({ position: 1, sku: "COLA", productName: "Cola 330ml", quantityOrdered: 3, unitCost: "0.10", lineTotal: "0.30" }),
      expect.objectContaining({ position: 2, sku: "CHIPS", quantityOrdered: 12, unitCost: "1.15", lineTotal: "13.80" }),
    ]);
    expect(order.activity.map((log: { action: string }) => log.action)).toEqual(["purchase_order.created"]);

    // Creating a draft never touches stock.
    expect(await onHand(cola.id, store.id)).toBe(0);
    expect(await prisma.stockMovement.count()).toBe(0);
  });

  it("numbers orders sequentially", async () => {
    const { agent, csrf, supplier, store } = await setup();
    const first = await createOrder(agent, csrf, { supplierId: supplier.id, storeId: store.id, lines: [] }).expect(201);
    const second = await createOrder(agent, csrf, { supplierId: supplier.id, storeId: store.id, lines: [] }).expect(201);
    const n = (number: string) => Number(number.slice(3));
    expect(n(second.body.order.number)).toBe(n(first.body.order.number) + 1);
  });

  it.each([
    [{ lines: [{ quantity: 1, unitCost: "1.00" }] }, "lines"],
    [{ lines: [{ productId: "PRODUCT", quantity: 0, unitCost: "1.00" }] }, "lines"],
    [{ lines: [{ productId: "PRODUCT", quantity: 1.5, unitCost: "1.00" }] }, "lines"],
    [{ lines: [{ productId: "PRODUCT", quantity: 1, unitCost: "-1" }] }, "lines"],
    [{ lines: [{ productId: "PRODUCT", quantity: 1, unitCost: "1.005" }] }, "lines"],
    [{ supplierId: "nope" }, "supplierId"],
    [{ expectedAt: "30/11/2026" }, "expectedAt"],
  ])("rejects invalid input %j", async (overrides, field) => {
    const { agent, csrf, supplier, store, cola } = await setup();
    const body = JSON.parse(
      JSON.stringify({ supplierId: supplier.id, storeId: store.id, lines: [], ...overrides }).replaceAll("PRODUCT", cola.id),
    );
    const res = await agent.post("/api/purchase-orders").set("X-CSRF-Token", csrf).send(body).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((issue: { path: string[] }) => issue.path[0])).toContain(field);
  });

  it("rejects the same product twice on one order", async () => {
    const { agent, csrf, supplier, store, cola } = await setup();
    const res = await createOrder(agent, csrf, {
      supplierId: supplier.id,
      storeId: store.id,
      lines: [
        { productId: cola.id, quantity: 1, unitCost: "1.00" },
        { productId: cola.id, quantity: 2, unitCost: "1.00" },
      ],
    }).expect(400);
    expect(res.body.error.details[0].path).toEqual(["lines", 1, "productId"]);
  });

  it("refuses unknown or archived products, and inactive suppliers", async () => {
    const { agent, csrf, supplier, store } = await setup();
    const archived = await createProduct({ archivedAt: new Date() });
    const unknown = await createOrder(agent, csrf, {
      supplierId: supplier.id,
      storeId: store.id,
      lines: [{ productId: randomUUID(), quantity: 1, unitCost: "1.00" }],
    }).expect(400);
    expect(unknown.body.error.details[0]).toMatchObject({ path: ["lines", 0, "productId"], message: "Product not found" });

    const archivedRes = await createOrder(agent, csrf, {
      supplierId: supplier.id,
      storeId: store.id,
      lines: [{ productId: archived.id, quantity: 1, unitCost: "1.00" }],
    }).expect(400);
    expect(archivedRes.body.error.details[0].message).toMatch(/archived/);

    const inactive = await createSupplier({ isActive: false });
    const res = await createOrder(agent, csrf, { supplierId: inactive.id, storeId: store.id, lines: [] }).expect(409);
    expect(res.body.error.code).toBe("SUPPLIER_INACTIVE");
    expect(await prisma.purchaseOrder.count()).toBe(0);
  });

  it("replaces a draft's lines and recomputes the total", async () => {
    const { agent, csrf, supplier, store, cola, chips } = await setup();
    const created = await createOrder(agent, csrf, {
      supplierId: supplier.id,
      storeId: store.id,
      lines: [{ productId: cola.id, quantity: 10, unitCost: "2.00" }],
    }).expect(201);

    const res = await agent
      .put(`/api/purchase-orders/${created.body.order.id}`)
      .set("X-CSRF-Token", csrf)
      .send({
        supplierId: supplier.id,
        storeId: store.id,
        lines: [
          { productId: chips.id, quantity: 7, unitCost: "0.99" },
          { productId: cola.id, quantity: 2, unitCost: "2.00" },
        ],
      })
      .expect(200);

    expect(res.body.order.total).toBe("10.93");
    expect(res.body.order.lines.map((line: { sku: string }) => line.sku)).toEqual(["CHIPS", "COLA"]);
    expect(await prisma.purchaseOrderLine.count()).toBe(2);
    const audit = res.body.order.activity.at(-1);
    expect(audit).toMatchObject({ action: "purchase_order.updated", details: { total: { from: "20.00", to: "10.93" } } });
  });
});

describe("status changes", () => {
  it("places a draft, which then can't be edited", async () => {
    const { agent, csrf, supplier, store, cola, user } = await setup();
    const { id } = await placedOrder(agent, csrf, supplier.id, store.id, [{ productId: cola.id, quantity: 5, unitCost: "1.00" }]);

    const detail = await agent.get(`/api/purchase-orders/${id}`).expect(200);
    expect(detail.body.order).toMatchObject({ status: "ORDERED", orderedBy: { id: user.id }, outstandingValue: "5.00" });
    expect(detail.body.order.orderedAt).toBeTruthy();

    const edit = await agent
      .put(`/api/purchase-orders/${id}`)
      .set("X-CSRF-Token", csrf)
      .send({ supplierId: supplier.id, storeId: store.id, lines: [] })
      .expect(409);
    expect(edit.body.error.code).toBe("INVALID_STATUS");

    const again = await placeOrder(agent, csrf, id).expect(409);
    expect(again.body.error.code).toBe("INVALID_STATUS");
  });

  it("won't place an empty order", async () => {
    const { agent, csrf, supplier, store } = await setup();
    const created = await createOrder(agent, csrf, { supplierId: supplier.id, storeId: store.id, lines: [] }).expect(201);
    const res = await placeOrder(agent, csrf, created.body.order.id).expect(409);
    expect(res.body.error.code).toBe("EMPTY_ORDER");
  });

  it("won't place an order whose product was archived after drafting", async () => {
    const { agent, csrf, supplier, store, cola } = await setup();
    const created = await createOrder(agent, csrf, {
      supplierId: supplier.id,
      storeId: store.id,
      lines: [{ productId: cola.id, quantity: 1, unitCost: "1.00" }],
    }).expect(201);
    await prisma.product.update({ where: { id: cola.id }, data: { archivedAt: new Date() } });
    const res = await placeOrder(agent, csrf, created.body.order.id).expect(409);
    expect(res.body.error.code).toBe("PRODUCT_ARCHIVED");
  });

  it("cancels drafts and open orders but not received or cancelled ones", async () => {
    const { agent, csrf, supplier, store, cola } = await setup();
    const draft = await createOrder(agent, csrf, { supplierId: supplier.id, storeId: store.id, lines: [] }).expect(201);
    const cancelled = await agent
      .post(`/api/purchase-orders/${draft.body.order.id}/cancel`)
      .set("X-CSRF-Token", csrf)
      .send({ reason: "Supplier out of stock" })
      .expect(200);
    expect(cancelled.body.order).toMatchObject({ status: "CANCELLED", cancelReason: "Supplier out of stock" });

    const again = await agent.post(`/api/purchase-orders/${draft.body.order.id}/cancel`).set("X-CSRF-Token", csrf).send({}).expect(409);
    expect(again.body.error.code).toBe("INVALID_STATUS");

    const order = await placedOrder(agent, csrf, supplier.id, store.id, [{ productId: cola.id, quantity: 2, unitCost: "1.00" }]);
    await receive(agent, csrf, order.id, [{ lineId: order.line(cola.id).id, quantity: 2 }]).expect(201);
    const received = await agent.post(`/api/purchase-orders/${order.id}/cancel`).set("X-CSRF-Token", csrf).send({}).expect(409);
    expect(received.body.error.code).toBe("INVALID_STATUS");
  });

  it("cancelling a partially received order keeps the stock already received", async () => {
    const { agent, csrf, supplier, store, cola } = await setup();
    const order = await placedOrder(agent, csrf, supplier.id, store.id, [{ productId: cola.id, quantity: 10, unitCost: "1.00" }]);
    await receive(agent, csrf, order.id, [{ lineId: order.line(cola.id).id, quantity: 4 }]).expect(201);

    const res = await agent.post(`/api/purchase-orders/${order.id}/cancel`).set("X-CSRF-Token", csrf).send({}).expect(200);
    expect(res.body.order).toMatchObject({ status: "CANCELLED", unitsReceived: 4, outstandingValue: "0.00" });
    expect(res.body.order.activity.at(-1)).toMatchObject({
      action: "purchase_order.cancelled",
      details: { previousStatus: "PARTIALLY_RECEIVED", unitsCancelled: 6 },
    });
    expect(await onHand(cola.id, store.id)).toBe(4);

    const late = await receive(agent, csrf, order.id, [{ lineId: order.line(cola.id).id, quantity: 1 }]).expect(409);
    expect(late.body.error.code).toBe("ORDER_CANCELLED");
  });
});

describe("receiving", () => {
  it("doesn't receive against a draft", async () => {
    const { agent, csrf, supplier, store, cola } = await setup();
    const created = await createOrder(agent, csrf, {
      supplierId: supplier.id,
      storeId: store.id,
      lines: [{ productId: cola.id, quantity: 5, unitCost: "1.00" }],
    }).expect(201);
    const res = await receive(agent, csrf, created.body.order.id, [{ lineId: created.body.order.lines[0].id, quantity: 5 }]).expect(409);
    expect(res.body.error.code).toBe("ORDER_NOT_PLACED");
    expect(await onHand(cola.id, store.id)).toBe(0);
  });

  it("receives partially, then fully, updating stock, ledger, status and audit log", async () => {
    const { agent, csrf, supplier, store, cola, chips, user } = await setup();
    await seedStock(cola.id, store.id, 3);
    const order = await placedOrder(agent, csrf, supplier.id, store.id, [
      { productId: cola.id, quantity: 10, unitCost: "2.50" },
      { productId: chips.id, quantity: 6, unitCost: "1.20" },
    ]);

    // First delivery: 4 cola, no chips (zero lines are ignored).
    const first = await receive(
      agent,
      csrf,
      order.id,
      [
        { lineId: order.line(cola.id).id, quantity: 4 },
        { lineId: order.line(chips.id).id, quantity: 0 },
      ],
      randomUUID(),
      "First pallet",
    ).expect(201);
    expect(first.body.replayed).toBe(false);
    expect(first.body.order).toMatchObject({ status: "PARTIALLY_RECEIVED", unitsReceived: 4, receivedValue: "10.00", outstandingValue: "22.20" });
    expect(first.body.order.receivedAt).toBeNull();
    expect(first.body.order.receipts).toHaveLength(1);
    expect(first.body.order.receipts[0]).toMatchObject({
      note: "First pallet",
      units: 4,
      value: "10.00",
      receivedBy: { id: user.id },
      lines: [{ sku: "COLA", quantity: 4, unitCost: "2.50" }],
    });
    expect(await onHand(cola.id, store.id)).toBe(7);
    expect(await onHand(chips.id, store.id)).toBe(0);

    // Second delivery: the rest.
    const second = await receive(agent, csrf, order.id, [
      { lineId: order.line(cola.id).id, quantity: 6 },
      { lineId: order.line(chips.id).id, quantity: 6 },
    ]).expect(201);
    expect(second.body.order).toMatchObject({ status: "RECEIVED", unitsReceived: 16, receivedValue: "32.20", outstandingValue: "0.00" });
    expect(second.body.order.receivedAt).toBeTruthy();
    expect(second.body.order.lines.every((line: OrderLine) => line.quantityOutstanding === 0)).toBe(true);

    expect(await onHand(cola.id, store.id)).toBe(13);
    expect(await onHand(chips.id, store.id)).toBe(6);
    // The ledger still explains every unit on hand.
    expect(await ledgerTotal(cola.id, store.id)).toBe(13);
    expect(await ledgerTotal(chips.id, store.id)).toBe(6);

    const movements = await prisma.stockMovement.findMany({ where: { type: "PURCHASE_RECEIPT" }, orderBy: { createdAt: "asc" } });
    expect(movements).toHaveLength(3);
    expect(movements[0]).toMatchObject({ productId: cola.id, quantityBefore: 3, quantityChange: 4, quantityAfter: 7, createdById: user.id });
    expect(movements.every((movement) => movement.purchaseReceiptId)).toBe(true);

    // The movement history links back to the order.
    const history = await agent.get(`/api/inventory/movements?type=PURCHASE_RECEIPT&productId=${chips.id}`).expect(200);
    expect(history.body.items[0]).toMatchObject({
      type: "PURCHASE_RECEIPT",
      quantityChange: 6,
      purchaseOrder: { id: order.id, number: second.body.order.number },
    });

    expect(second.body.order.activity.map((log: { action: string }) => log.action)).toEqual([
      "purchase_order.created",
      "purchase_order.ordered",
      "purchase_order.received",
      "purchase_order.received",
    ]);
    expect(second.body.order.activity.at(-1).details).toMatchObject({ units: 12, value: "22.20", status: "RECEIVED" });

    const done = await receive(agent, csrf, order.id, [{ lineId: order.line(cola.id).id, quantity: 1 }]).expect(409);
    expect(done.body.error.code).toBe("ALREADY_RECEIVED");
  });

  it("rejects over-receipt and changes nothing", async () => {
    const { agent, csrf, supplier, store, cola, chips } = await setup();
    const order = await placedOrder(agent, csrf, supplier.id, store.id, [
      { productId: cola.id, quantity: 5, unitCost: "1.00" },
      { productId: chips.id, quantity: 5, unitCost: "1.00" },
    ]);
    await receive(agent, csrf, order.id, [{ lineId: order.line(cola.id).id, quantity: 3 }]).expect(201);

    // Chips is fine, cola exceeds what is outstanding: the whole receipt is refused.
    const res = await receive(agent, csrf, order.id, [
      { lineId: order.line(chips.id).id, quantity: 5 },
      { lineId: order.line(cola.id).id, quantity: 3 },
    ]).expect(409);
    expect(res.body.error).toMatchObject({
      code: "OVER_RECEIPT",
      details: [{ path: ["lines", 1, "quantity"], message: "Only 2 of Cola 330ml still outstanding" }],
    });

    expect(await onHand(cola.id, store.id)).toBe(3);
    expect(await onHand(chips.id, store.id)).toBe(0);
    expect(await prisma.purchaseReceipt.count()).toBe(1);
    expect(await prisma.stockMovement.count()).toBe(1);
  });

  it("rejects lines from another order and requests that receive nothing", async () => {
    const { agent, csrf, supplier, store, cola } = await setup();
    const order = await placedOrder(agent, csrf, supplier.id, store.id, [{ productId: cola.id, quantity: 5, unitCost: "1.00" }]);
    const other = await placedOrder(agent, csrf, supplier.id, store.id, [{ productId: cola.id, quantity: 5, unitCost: "1.00" }]);

    const foreign = await receive(agent, csrf, order.id, [{ lineId: other.line(cola.id).id, quantity: 1 }]).expect(400);
    expect(foreign.body.error.details[0].path).toEqual(["lines", 0, "lineId"]);

    const nothing = await receive(agent, csrf, order.id, [{ lineId: order.line(cola.id).id, quantity: 0 }]).expect(400);
    expect(nothing.body.error.code).toBe("VALIDATION_ERROR");

    await agent
      .post(`/api/purchase-orders/${order.id}/receipts`)
      .set("X-CSRF-Token", csrf)
      .send({ lines: [{ lineId: order.line(cola.id).id, quantity: 1 }] })
      .expect(400); // idempotency key is required
    expect(await onHand(cola.id, store.id)).toBe(0);
  });

  it("treats a repeated request as the same receipt (idempotent)", async () => {
    const { agent, csrf, supplier, store, cola } = await setup();
    const order = await placedOrder(agent, csrf, supplier.id, store.id, [{ productId: cola.id, quantity: 10, unitCost: "1.00" }]);
    const key = randomUUID();
    const lines = [{ lineId: order.line(cola.id).id, quantity: 4 }];

    const first = await receive(agent, csrf, order.id, lines, key).expect(201);
    const retry = await receive(agent, csrf, order.id, lines, key).expect(200);
    expect(retry.body).toMatchObject({ replayed: true, receiptId: first.body.receiptId });

    expect(await onHand(cola.id, store.id)).toBe(4);
    expect(await prisma.purchaseReceipt.count()).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "purchase_order.received" } })).toBe(1);

    // The same key can't be spent on a different order.
    const other = await placedOrder(agent, csrf, supplier.id, store.id, [{ productId: cola.id, quantity: 1, unitCost: "1.00" }]);
    const reused = await receive(agent, csrf, other.id, [{ lineId: other.line(cola.id).id, quantity: 1 }], key).expect(409);
    expect(reused.body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("double-submitting concurrently receives the goods once", async () => {
    const { agent, csrf, supplier, store, cola } = await setup();
    const order = await placedOrder(agent, csrf, supplier.id, store.id, [{ productId: cola.id, quantity: 10, unitCost: "1.00" }]);
    const key = randomUUID();
    const lines = [{ lineId: order.line(cola.id).id, quantity: 10 }];

    const responses = await Promise.all(Array.from({ length: 5 }, () => receive(agent, csrf, order.id, lines, key)));
    expect(responses.map((res) => res.status).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(await onHand(cola.id, store.id)).toBe(10);
    expect(await prisma.purchaseReceipt.count()).toBe(1);
  });

  it("concurrent different receipts can never over-receive", async () => {
    const { agent, csrf, supplier, store, cola } = await setup();
    const order = await placedOrder(agent, csrf, supplier.id, store.id, [{ productId: cola.id, quantity: 10, unitCost: "1.00" }]);
    const lines = [{ lineId: order.line(cola.id).id, quantity: 4 }];

    // Six clerks each try to book 4 of the 10 ordered: only two can succeed.
    const responses = await Promise.all(Array.from({ length: 6 }, () => receive(agent, csrf, order.id, lines)));
    const statuses = responses.map((res) => res.status);
    expect(statuses.filter((status) => status === 201)).toHaveLength(2);
    expect(statuses.filter((status) => status === 409)).toHaveLength(4);

    expect(await onHand(cola.id, store.id)).toBe(8);
    expect(await ledgerTotal(cola.id, store.id)).toBe(8);
    const line = await prisma.purchaseOrderLine.findUniqueOrThrow({ where: { id: order.line(cola.id).id } });
    expect(line.quantityReceived).toBe(8);
  });

  it("rolls back the whole receipt when a stock update fails", async () => {
    const { agent, csrf, supplier, store, cola, chips } = await setup();
    // Chips is already at the maximum on-hand quantity, so adding to it fails mid-transaction.
    await seedStock(chips.id, store.id, 10_000_000);
    const order = await placedOrder(agent, csrf, supplier.id, store.id, [
      { productId: cola.id, quantity: 5, unitCost: "1.00" },
      { productId: chips.id, quantity: 5, unitCost: "1.00" },
    ]);

    await receive(agent, csrf, order.id, [
      { lineId: order.line(cola.id).id, quantity: 5 },
      { lineId: order.line(chips.id).id, quantity: 5 },
    ]).expect(400);

    expect(await onHand(cola.id, store.id)).toBe(0);
    expect(await prisma.purchaseReceipt.count()).toBe(0);
    expect(await prisma.purchaseReceiptLine.count()).toBe(0);
    expect(await prisma.stockMovement.count({ where: { type: "PURCHASE_RECEIPT" } })).toBe(0);
    const lines = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: order.id } });
    expect(lines.every((line) => line.quantityReceived === 0)).toBe(true);
    expect((await prisma.purchaseOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("ORDERED");
  });

  it("refuses to receive into an inactive store", async () => {
    const { agent, csrf, supplier, store, cola } = await setup();
    const order = await placedOrder(agent, csrf, supplier.id, store.id, [{ productId: cola.id, quantity: 5, unitCost: "1.00" }]);
    await prisma.store.update({ where: { id: store.id }, data: { isActive: false } });
    const res = await receive(agent, csrf, order.id, [{ lineId: order.line(cola.id).id, quantity: 5 }]).expect(409);
    expect(res.body.error.code).toBe("STORE_INACTIVE");
  });
});

describe("database guarantees", () => {
  it("rejects over-receipt and inconsistent line totals even from direct writes", async () => {
    const { agent, csrf, supplier, store, cola } = await setup();
    const order = await placedOrder(agent, csrf, supplier.id, store.id, [{ productId: cola.id, quantity: 5, unitCost: "1.00" }]);
    const lineId = order.line(cola.id).id;

    await expect(prisma.purchaseOrderLine.update({ where: { id: lineId }, data: { quantityReceived: 6 } })).rejects.toThrow();
    await expect(prisma.purchaseOrderLine.update({ where: { id: lineId }, data: { lineTotal: "4.99" } })).rejects.toThrow();
  });

  it("keeps receipts and audit logs immutable", async () => {
    const { agent, csrf, supplier, store, cola } = await setup();
    const order = await placedOrder(agent, csrf, supplier.id, store.id, [{ productId: cola.id, quantity: 5, unitCost: "1.00" }]);
    await receive(agent, csrf, order.id, [{ lineId: order.line(cola.id).id, quantity: 5 }]).expect(201);

    // The triggers raise restrict_violation, which Prisma reports as a constraint error.
    await expect(prisma.purchaseReceipt.updateMany({ data: { note: "edited" } })).rejects.toThrow();
    await expect(prisma.purchaseReceiptLine.deleteMany()).rejects.toThrow();
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow();

    expect(await prisma.purchaseReceipt.count({ where: { note: "edited" } })).toBe(0);
    expect(await prisma.purchaseReceiptLine.count()).toBe(1);
    expect(await prisma.auditLog.count()).toBe(3);
  });
});

describe("history", () => {
  it("lists orders with filters, search and status counts", async () => {
    const { agent, csrf, supplier, store, cola, chips } = await setup();
    const other = await createSupplier({ name: "Zeta Imports" });
    const draft = await createOrder(agent, csrf, {
      supplierId: supplier.id,
      storeId: store.id,
      lines: [{ productId: chips.id, quantity: 1, unitCost: "1.00" }],
    }).expect(201);
    const open = await placedOrder(agent, csrf, other.id, store.id, [{ productId: cola.id, quantity: 2, unitCost: "3.00" }]);

    const all = await agent.get("/api/purchase-orders").expect(200);
    expect(all.body.total).toBe(2);
    // Newest number first by default.
    expect(all.body.items.map((order: { id: string }) => order.id)).toEqual([open.id, draft.body.order.id]);
    expect(all.body.statusCounts).toMatchObject({ DRAFT: 1, ORDERED: 1, RECEIVED: 0 });

    const ordered = await agent.get("/api/purchase-orders?status=ORDERED").expect(200);
    expect(ordered.body.items.map((order: { id: string }) => order.id)).toEqual([open.id]);
    // Counts ignore the status filter so every tab can show its number.
    expect(ordered.body.statusCounts).toMatchObject({ DRAFT: 1, ORDERED: 1 });

    const openOnly = await agent.get("/api/purchase-orders?open=true").expect(200);
    expect(openOnly.body.total).toBe(1);

    const bySupplier = await agent.get(`/api/purchase-orders?supplierId=${supplier.id}`).expect(200);
    expect(bySupplier.body.items.map((order: { id: string }) => order.id)).toEqual([draft.body.order.id]);

    const byProduct = await agent.get(`/api/purchase-orders?productId=${cola.id}`).expect(200);
    expect(byProduct.body.items.map((order: { id: string }) => order.id)).toEqual([open.id]);

    const byNumber = await agent.get(`/api/purchase-orders?search=${draft.body.order.number.toLowerCase()}`).expect(200);
    expect(byNumber.body.items.map((order: { id: string }) => order.id)).toEqual([draft.body.order.id]);

    const bySupplierName = await agent.get("/api/purchase-orders?search=zeta").expect(200);
    expect(bySupplierName.body.items.map((order: { id: string }) => order.id)).toEqual([open.id]);

    const bySku = await agent.get("/api/purchase-orders?search=chips").expect(200);
    expect(bySku.body.items.map((order: { id: string }) => order.id)).toEqual([draft.body.order.id]);

    const byTotal = await agent.get("/api/purchase-orders?sort=total&order=asc").expect(200);
    expect(byTotal.body.items.map((order: { total: string }) => order.total)).toEqual(["1.00", "6.00"]);

    await agent.get("/api/purchase-orders?status=SHIPPED").expect(400);
    await agent.get("/api/purchase-orders/not-a-uuid").expect(404);
  });

  it("exposes the audit trail", async () => {
    const { agent, csrf, supplier, store, cola } = await setup("OWNER");
    const order = await placedOrder(agent, csrf, supplier.id, store.id, [{ productId: cola.id, quantity: 1, unitCost: "1.00" }]);

    const res = await agent.get(`/api/audit-logs?entityType=purchase_order&entityId=${order.id}`).expect(200);
    expect(res.body.items.map((log: { action: string }) => log.action)).toEqual(["purchase_order.ordered", "purchase_order.created"]);
    expect(res.body.items[0].actor).toMatchObject({ name: expect.any(String) });

    const byAction = await agent.get("/api/audit-logs?action=purchase_order.created").expect(200);
    expect(byAction.body.total).toBe(1);
  });
});
