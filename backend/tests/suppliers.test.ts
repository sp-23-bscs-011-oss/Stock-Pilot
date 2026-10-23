import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createProduct } from "./catalogHelpers.js";
import { buildApp, prisma, resetDatabase, signedInAgent } from "./helpers.js";
import { createStore } from "./inventoryHelpers.js";
import { createOrder, createSupplier, placeOrder, receive, supplierBody } from "./purchasingHelpers.js";

const app = buildApp();

beforeEach(resetDatabase);

describe("authorization", () => {
  it("requires authentication", async () => {
    await request(app).get("/api/suppliers").expect(401);
    await request(app).get("/api/purchase-orders").expect(401);
    await request(app).get("/api/audit-logs").expect(401);
  });

  it("keeps cashiers out of purchasing entirely", async () => {
    const { agent, csrf } = await signedInAgent(app, "CASHIER");
    const supplier = await createSupplier();
    await agent.get("/api/suppliers").expect(403);
    await agent.get(`/api/suppliers/${supplier.id}`).expect(403);
    await agent.get("/api/suppliers/report").expect(403);
    await agent.post("/api/suppliers").set("X-CSRF-Token", csrf).send(supplierBody()).expect(403);
    await agent.get("/api/purchase-orders").expect(403);
    await agent.get("/api/audit-logs").expect(403);
  });

  it("requires the CSRF token for writes", async () => {
    const { agent } = await signedInAgent(app, "MANAGER");
    await agent.post("/api/suppliers").send(supplierBody()).expect(403);
  });
});

describe("supplier CRUD", () => {
  it("creates a supplier with contact details and audits it", async () => {
    const { agent, csrf, user } = await signedInAgent(app, "MANAGER");
    const res = await agent
      .post("/api/suppliers")
      .set("X-CSRF-Token", csrf)
      .send(supplierBody({ name: "  Fresh   Farms ", email: "Orders@Fresh.Example" }))
      .expect(201);

    expect(res.body.supplier).toMatchObject({
      name: "Fresh Farms",
      email: "orders@fresh.example",
      contactName: "Jane Doe",
      phone: "+1 (555) 010-2000",
      paymentTerms: "Net 30",
      isActive: true,
      stats: { orderCount: 0, orderedValue: "0.00", outstandingValue: "0.00" },
    });

    const logs = await prisma.auditLog.findMany({ where: { entityId: res.body.supplier.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "supplier.created", entityType: "supplier", actorId: user.id });
  });

  it("treats blank optional fields as empty", async () => {
    const { agent, csrf } = await signedInAgent(app, "MANAGER");
    const res = await agent
      .post("/api/suppliers")
      .set("X-CSRF-Token", csrf)
      .send({ name: "Minimal Supplier", email: "", phone: "  ", contactName: "" })
      .expect(201);
    expect(res.body.supplier).toMatchObject({ email: null, phone: null, contactName: null, notes: null });
  });

  it.each([
    [{ name: "" }, "name"],
    [{ name: "A" }, "name"],
    [{ email: "not-an-email" }, "email"],
    [{ phone: "call me" }, "phone"],
    [{ notes: "x".repeat(2001) }, "notes"],
  ])("rejects invalid input %j", async (overrides, field) => {
    const { agent, csrf } = await signedInAgent(app, "MANAGER");
    const res = await agent.post("/api/suppliers").set("X-CSRF-Token", csrf).send(supplierBody(overrides)).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.map((issue: { path: string[] }) => issue.path[0])).toContain(field);
  });

  it("rejects duplicate names regardless of case and spacing", async () => {
    const { agent, csrf } = await signedInAgent(app, "MANAGER");
    await createSupplier({ name: "Acme Foods" });
    const res = await agent
      .post("/api/suppliers")
      .set("X-CSRF-Token", csrf)
      .send(supplierBody({ name: " acme   FOODS" }))
      .expect(409);
    expect(res.body.error).toMatchObject({ code: "DUPLICATE_VALUE", details: [{ path: ["name"] }] });
  });

  it("updates, deactivates and reactivates, recording each change", async () => {
    const { agent, csrf } = await signedInAgent(app, "OWNER");
    const supplier = await createSupplier({ name: "Old Name" });

    const updated = await agent
      .patch(`/api/suppliers/${supplier.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ name: "New Name", paymentTerms: "Net 15" })
      .expect(200);
    expect(updated.body.supplier).toMatchObject({ name: "New Name", paymentTerms: "Net 15" });

    await agent.patch(`/api/suppliers/${supplier.id}`).set("X-CSRF-Token", csrf).send({ isActive: false }).expect(200);
    await agent.patch(`/api/suppliers/${supplier.id}`).set("X-CSRF-Token", csrf).send({ isActive: true }).expect(200);

    const detail = await agent.get(`/api/suppliers/${supplier.id}`).expect(200);
    expect(detail.body.supplier.activity.map((log: { action: string }) => log.action)).toEqual([
      "supplier.reactivated",
      "supplier.deactivated",
      "supplier.updated",
    ]);
    expect(detail.body.supplier.activity[2].details.changes).toEqual({
      name: { from: "Old Name", to: "New Name" },
      paymentTerms: { from: null, to: "Net 15" },
    });
  });

  it("rejects empty and unknown update fields", async () => {
    const { agent, csrf } = await signedInAgent(app, "MANAGER");
    const supplier = await createSupplier();
    await agent.patch(`/api/suppliers/${supplier.id}`).set("X-CSRF-Token", csrf).send({}).expect(400);
    await agent.patch(`/api/suppliers/${supplier.id}`).set("X-CSRF-Token", csrf).send({ rating: 5 }).expect(400);
  });

  it("returns 404 for unknown or malformed ids", async () => {
    const { agent } = await signedInAgent(app, "MANAGER");
    await agent.get("/api/suppliers/00000000-0000-4000-8000-000000000000").expect(404);
    await agent.get("/api/suppliers/not-a-uuid").expect(404);
  });

  it("deletes a supplier with no orders", async () => {
    const { agent, csrf } = await signedInAgent(app, "MANAGER");
    const supplier = await createSupplier();
    await agent.delete(`/api/suppliers/${supplier.id}`).set("X-CSRF-Token", csrf).expect(204);
    expect(await prisma.supplier.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: "supplier.deleted", entityId: supplier.id } })).toBe(1);
  });

  it("refuses to delete a supplier that has purchase orders", async () => {
    const { agent, csrf } = await signedInAgent(app, "MANAGER");
    const supplier = await createSupplier();
    const store = await createStore();
    await createOrder(agent, csrf, { supplierId: supplier.id, storeId: store.id, lines: [] }).expect(201);

    const res = await agent.delete(`/api/suppliers/${supplier.id}`).set("X-CSRF-Token", csrf).expect(409);
    expect(res.body.error.code).toBe("SUPPLIER_HAS_ORDERS");
    expect(await prisma.supplier.count()).toBe(1);
  });
});

describe("listing", () => {
  it("lists active suppliers by default, with search and status filters", async () => {
    const { agent } = await signedInAgent(app, "MANAGER");
    await createSupplier({ name: "Bravo Beverages" });
    await createSupplier({ name: "Alpha Snacks" });
    await createSupplier({ name: "Charlie Closed", isActive: false });

    const active = await agent.get("/api/suppliers").expect(200);
    expect(active.body.items.map((s: { name: string }) => s.name)).toEqual(["Alpha Snacks", "Bravo Beverages"]);
    expect(active.body.total).toBe(2);

    const inactive = await agent.get("/api/suppliers?status=inactive").expect(200);
    expect(inactive.body.items.map((s: { name: string }) => s.name)).toEqual(["Charlie Closed"]);

    const search = await agent.get("/api/suppliers?status=all&search=bev").expect(200);
    expect(search.body.items.map((s: { name: string }) => s.name)).toEqual(["Bravo Beverages"]);

    const paged = await agent.get("/api/suppliers?status=all&pageSize=2&page=2").expect(200);
    expect(paged.body).toMatchObject({ total: 3, totalPages: 2, page: 2 });
    expect(paged.body.items).toHaveLength(1);

    await agent.get("/api/suppliers?status=bogus").expect(400);
  });
});

describe("supplier report", () => {
  it("summarizes ordered, received and outstanding value per supplier", async () => {
    const { agent, csrf } = await signedInAgent(app, "MANAGER");
    const store = await createStore();
    const big = await createSupplier({ name: "Big Supplier" });
    const small = await createSupplier({ name: "Small Supplier" });
    await createSupplier({ name: "Idle Supplier" });
    const cola = await createProduct();
    const chips = await createProduct();

    // Big: 10 × 2.50 + 4 × 1.25 = 30.00, half the cola received.
    const bigOrder = await createOrder(agent, csrf, {
      supplierId: big.id,
      storeId: store.id,
      lines: [
        { productId: cola.id, quantity: 10, unitCost: "2.50" },
        { productId: chips.id, quantity: 4, unitCost: "1.25" },
      ],
    }).expect(201);
    await placeOrder(agent, csrf, bigOrder.body.order.id).expect(200);
    const colaLine = bigOrder.body.order.lines.find((line: { productId: string }) => line.productId === cola.id);
    await receive(agent, csrf, bigOrder.body.order.id, [{ lineId: colaLine.id, quantity: 5 }]).expect(201);

    // Small: placed then cancelled, so its value doesn't count as ordered.
    const smallOrder = await createOrder(agent, csrf, {
      supplierId: small.id,
      storeId: store.id,
      lines: [{ productId: cola.id, quantity: 1, unitCost: "9.99" }],
    }).expect(201);
    await placeOrder(agent, csrf, smallOrder.body.order.id).expect(200);
    await agent.post(`/api/purchase-orders/${smallOrder.body.order.id}/cancel`).set("X-CSRF-Token", csrf).send({}).expect(200);

    const res = await agent.get("/api/suppliers/report").expect(200);
    expect(res.body.rows.map((row: { supplier: { name: string } }) => row.supplier.name)).toEqual([
      "Big Supplier",
      "Idle Supplier",
      "Small Supplier",
    ]);
    expect(res.body.rows[0].stats).toMatchObject({
      orderCount: 1,
      openOrders: 1,
      orderedValue: "30.00",
      receivedValue: "12.50",
      unitsReceived: 5,
      outstandingValue: "17.50",
    });
    expect(res.body.rows[0].stats.averageLeadTimeDays).toBeGreaterThanOrEqual(0);
    expect(res.body.rows[2].stats).toMatchObject({ orderCount: 1, openOrders: 0, orderedValue: "0.00", outstandingValue: "0.00" });
    expect(res.body.totals).toMatchObject({
      orderCount: 2,
      orderedValue: "30.00",
      receivedValue: "12.50",
      outstandingValue: "17.50",
    });

    // A period before anything happened shows no activity (outstanding is always current).
    const past = await agent.get("/api/suppliers/report?from=2020-01-01T00:00:00Z&to=2020-12-31T23:59:59Z").expect(200);
    expect(past.body.totals).toMatchObject({ orderCount: 0, orderedValue: "0.00", receivedValue: "0.00", outstandingValue: "17.50" });

    await agent.get("/api/suppliers/report?from=2021-01-01&to=2020-01-01").expect(400);
  });
});
