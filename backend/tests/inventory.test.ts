import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createCategory, createProduct } from "./catalogHelpers.js";
import { buildApp, prisma, resetDatabase, signedInAgent, type Agent } from "./helpers.js";
import { createStore, ledgerTotal, onHand, seedStock } from "./inventoryHelpers.js";

const app = buildApp();

beforeEach(resetDatabase);

async function setup(role: "OWNER" | "MANAGER" | "CASHIER" = "MANAGER") {
  const session = await signedInAgent(app, role);
  const store = await createStore();
  const product = await createProduct({ name: "Cola 330ml", sku: "COLA" });
  return { ...session, store, product };
}

function adjust(agent: Agent, csrf: string, body: Record<string, unknown>) {
  return agent.post("/api/inventory/adjustments").set("X-CSRF-Token", csrf).send(body);
}

describe("authorization", () => {
  it("requires authentication", async () => {
    await request(app).get("/api/inventory").expect(401);
    await request(app).post("/api/inventory/adjustments").send({}).expect(401);
  });

  it("lets cashiers view stock but not change it or read the audit trail", async () => {
    const { agent, csrf, store, product } = await setup("CASHIER");
    await agent.get(`/api/inventory?storeId=${store.id}`).expect(200);

    const res = await adjust(agent, csrf, {
      storeId: store.id,
      productId: product.id,
      mode: "change",
      quantity: 5,
      reason: "RECEIVED",
    }).expect(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
    await agent.get("/api/inventory/movements").expect(403);
    expect(await onHand(product.id, store.id)).toBe(0);
  });

  it("requires the CSRF token for adjustments", async () => {
    const { agent, store, product } = await setup();
    await agent
      .post("/api/inventory/adjustments")
      .send({ storeId: store.id, productId: product.id, mode: "change", quantity: 5, reason: "RECEIVED" })
      .expect(403);
  });
});

describe("manual adjustments", () => {
  it("adds stock to a never-stocked product and records who did it", async () => {
    const { agent, csrf, store, product, user } = await setup();
    const res = await adjust(agent, csrf, {
      storeId: store.id,
      productId: product.id,
      mode: "change",
      quantity: 10,
      reason: "RECEIVED",
      note: "Delivery #42",
    }).expect(201);

    expect(res.body.level).toMatchObject({ quantity: 10, status: "OK" });
    expect(res.body.movement).toMatchObject({
      type: "ADJUSTMENT",
      reason: "RECEIVED",
      note: "Delivery #42",
      quantityChange: 10,
      quantityBefore: 0,
      quantityAfter: 10,
      createdBy: { id: user.id, name: user.name },
      product: { id: product.id, sku: "COLA" },
    });
    expect(await onHand(product.id, store.id)).toBe(10);
    expect(await ledgerTotal(product.id, store.id)).toBe(10);
  });

  it("removes stock", async () => {
    const { agent, csrf, store, product } = await setup();
    await seedStock(product.id, store.id, 10);
    const res = await adjust(agent, csrf, {
      storeId: store.id,
      productId: product.id,
      mode: "change",
      quantity: -3,
      reason: "DAMAGED",
    }).expect(201);
    expect(res.body.movement).toMatchObject({ quantityChange: -3, quantityBefore: 10, quantityAfter: 7 });
  });

  it("sets a counted quantity, recording the difference", async () => {
    const { agent, csrf, store, product } = await setup();
    await seedStock(product.id, store.id, 10);
    const res = await adjust(agent, csrf, {
      storeId: store.id,
      productId: product.id,
      mode: "set",
      quantity: 6,
      reason: "STOCK_COUNT",
    }).expect(201);
    expect(res.body.movement).toMatchObject({ quantityChange: -4, quantityBefore: 10, quantityAfter: 6 });
  });

  it("refuses to go below zero and leaves everything untouched", async () => {
    const { agent, csrf, store, product } = await setup();
    await seedStock(product.id, store.id, 2);
    const res = await adjust(agent, csrf, {
      storeId: store.id,
      productId: product.id,
      mode: "change",
      quantity: -3,
      reason: "LOST",
    }).expect(409);

    expect(res.body.error).toMatchObject({ code: "INSUFFICIENT_STOCK", details: { currentQuantity: 2, requested: -3 } });
    expect(await onHand(product.id, store.id)).toBe(2);
    expect(await prisma.stockMovement.count()).toBe(1); // only the seed
  });

  it("refuses an adjustment that changes nothing", async () => {
    const { agent, csrf, store, product } = await setup();
    await seedStock(product.id, store.id, 4);
    const res = await adjust(agent, csrf, {
      storeId: store.id,
      productId: product.id,
      mode: "set",
      quantity: 4,
      reason: "STOCK_COUNT",
    }).expect(409);
    expect(res.body.error.code).toBe("NO_STOCK_CHANGE");
  });

  it("refuses a decision based on a stale quantity", async () => {
    const { agent, csrf, store, product } = await setup();
    await seedStock(product.id, store.id, 8);
    const body = { storeId: store.id, productId: product.id, mode: "set", quantity: 5, reason: "STOCK_COUNT" };

    const stale = await adjust(agent, csrf, { ...body, expectedQuantity: 9 }).expect(409);
    expect(stale.body.error).toMatchObject({ code: "STOCK_CHANGED", details: { currentQuantity: 8 } });
    expect(await onHand(product.id, store.id)).toBe(8);

    await adjust(agent, csrf, { ...body, expectedQuantity: 8 }).expect(201);
  });

  it("keeps each store's stock separate", async () => {
    const { agent, csrf, store, product } = await setup();
    const other = await createStore();
    await seedStock(product.id, other.id, 50);

    await adjust(agent, csrf, { storeId: store.id, productId: product.id, mode: "change", quantity: 3, reason: "RECEIVED" }).expect(201);
    expect(await onHand(product.id, store.id)).toBe(3);
    expect(await onHand(product.id, other.id)).toBe(50);
  });

  it("refuses archived products and inactive stores", async () => {
    const { agent, csrf, store } = await setup();
    const archived = await createProduct({ archivedAt: new Date() });
    const closed = await createStore({ isActive: false });
    const active = await createProduct();

    const a = await adjust(agent, csrf, { storeId: store.id, productId: archived.id, mode: "change", quantity: 1, reason: "RECEIVED" });
    expect(a.status).toBe(409);
    expect(a.body.error.code).toBe("PRODUCT_ARCHIVED");
    const b = await adjust(agent, csrf, { storeId: closed.id, productId: active.id, mode: "change", quantity: 1, reason: "RECEIVED" });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe("STORE_INACTIVE");
  });

  it("rejects unknown products and stores", async () => {
    const { agent, csrf, store, product } = await setup();
    const missing = "00000000-0000-4000-8000-000000000000";
    const a = await adjust(agent, csrf, { storeId: store.id, productId: missing, mode: "change", quantity: 1, reason: "RECEIVED" }).expect(400);
    expect(a.body.error.details[0].path).toEqual(["productId"]);
    const b = await adjust(agent, csrf, { storeId: missing, productId: product.id, mode: "change", quantity: 1, reason: "RECEIVED" }).expect(400);
    expect(b.body.error.details[0].path).toEqual(["storeId"]);
  });

  it.each([
    ["a fraction", { quantity: 1.5 }, "quantity"],
    ["a numeric string", { quantity: "5" }, "quantity"],
    ["zero change", { quantity: 0 }, "quantity"],
    ["a huge quantity", { quantity: 1e9 }, "quantity"],
    ["no reason", { reason: undefined }, "reason"],
    ["an unknown reason", { reason: "GIFT" }, "reason"],
    ["adding stock as damaged", { quantity: 5, reason: "DAMAGED" }, "reason"],
    ["removing stock as received", { quantity: -5, reason: "RECEIVED" }, "reason"],
    ["a negative count", { mode: "set", quantity: -1, reason: "STOCK_COUNT" }, "quantity"],
    ["a count with a one-way reason", { mode: "set", quantity: 3, reason: "THEFT" }, "reason"],
    ['"other" without a note', { reason: "OTHER", note: "  " }, "note"],
    ["an unknown mode", { mode: "replace" }, "mode"],
    ["an unexpected field", { quantityAfter: 99 }, ""],
  ])("rejects %s", async (_label, override, field) => {
    const { agent, csrf, store, product } = await setup();
    const res = await adjust(agent, csrf, {
      storeId: store.id,
      productId: product.id,
      mode: "change",
      quantity: 2,
      reason: "RECEIVED",
      ...override,
    }).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    if (field) expect(res.body.error.details.some((issue: { path: string[] }) => issue.path[0] === field)).toBe(true);
    expect(await prisma.stockMovement.count()).toBe(0);
  });
});

describe("database guarantees", () => {
  it("rejects negative stock even when written directly", async () => {
    const store = await createStore();
    const product = await createProduct();
    await seedStock(product.id, store.id, 1);
    await expect(
      prisma.$executeRaw`UPDATE inventory_levels SET quantity = -1 WHERE product_id = ${product.id}::uuid`,
    ).rejects.toThrow();
  });

  it("keeps the movement ledger append-only", async () => {
    const store = await createStore();
    const product = await createProduct();
    await seedStock(product.id, store.id, 5);
    const movement = await prisma.stockMovement.findFirstOrThrow();

    await expect(prisma.stockMovement.update({ where: { id: movement.id }, data: { note: "edited" } })).rejects.toThrow();
    await expect(prisma.stockMovement.delete({ where: { id: movement.id } })).rejects.toThrow();
    expect((await prisma.stockMovement.findUniqueOrThrow({ where: { id: movement.id } })).note).toBe("test seed");
  });

  it("rejects internally inconsistent ledger rows", async () => {
    const store = await createStore();
    const product = await createProduct();
    await expect(
      prisma.stockMovement.create({
        data: { productId: product.id, storeId: store.id, type: "ADJUSTMENT", reason: "OTHER", quantityChange: 5, quantityBefore: 0, quantityAfter: 4 },
      }),
    ).rejects.toThrow();
  });
});

describe("concurrency", () => {
  it("never oversells: 20 simultaneous removals of 1 from a stock of 10", async () => {
    const { agent, csrf, store, product } = await setup();
    await seedStock(product.id, store.id, 10);

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        adjust(agent, csrf, { storeId: store.id, productId: product.id, mode: "change", quantity: -1, reason: "LOST" }),
      ),
    );

    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(10);
    expect(statuses.filter((s) => s === 409)).toHaveLength(10);
    for (const r of results.filter((r) => r.status === 409)) expect(r.body.error.code).toBe("INSUFFICIENT_STOCK");

    expect(await onHand(product.id, store.id)).toBe(0);
    expect(await ledgerTotal(product.id, store.id)).toBe(0);
    // Each successful removal saw a distinct, serialized "before" value: 10, 9, ..., 1.
    const befores = results.filter((r) => r.status === 201).map((r) => r.body.movement.quantityBefore as number);
    expect(befores.sort((a, b) => b - a)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it("loses no updates when a never-stocked product is increased concurrently", async () => {
    const { agent, csrf, store, product } = await setup();
    const results = await Promise.all(
      Array.from({ length: 15 }, () =>
        adjust(agent, csrf, { storeId: store.id, productId: product.id, mode: "change", quantity: 2, reason: "RECEIVED" }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(await onHand(product.id, store.id)).toBe(30);
    expect(await prisma.stockMovement.count()).toBe(15);
    expect(await ledgerTotal(product.id, store.id)).toBe(30);
  });

  it("stays consistent under a mix of concurrent additions and removals", async () => {
    const { agent, csrf, store, product } = await setup();
    await seedStock(product.id, store.id, 3);

    const results = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        adjust(agent, csrf, {
          storeId: store.id,
          productId: product.id,
          mode: "change",
          quantity: i % 2 === 0 ? 1 : -2,
          reason: i % 2 === 0 ? "RECEIVED" : "DAMAGED",
        }),
      ),
    );

    for (const r of results) expect([201, 409]).toContain(r.status);
    const succeeded = results.filter((r) => r.status === 201);
    const applied = succeeded.reduce((sum, r) => sum + (r.body.movement.quantityChange as number), 0);

    // Exactly the successful requests took effect, nothing more and nothing less.
    const final = await onHand(product.id, store.id);
    expect(final).toBe(3 + applied);
    expect(final).toBeGreaterThanOrEqual(0);
    expect(await ledgerTotal(product.id, store.id)).toBe(final);
    expect(await prisma.stockMovement.count()).toBe(1 + succeeded.length);
    // Rejections only ever happened because stock would have gone negative.
    for (const r of results.filter((r) => r.status === 409)) expect(r.body.error.code).toBe("INSUFFICIENT_STOCK");
  });

  it("lets only one of two counts based on the same quantity win", async () => {
    const { agent, csrf, store, product } = await setup();
    await seedStock(product.id, store.id, 10);
    const results = await Promise.all(
      [7, 8].map((quantity) =>
        adjust(agent, csrf, {
          storeId: store.id,
          productId: product.id,
          mode: "set",
          quantity,
          reason: "STOCK_COUNT",
          expectedQuantity: 10,
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.error.code).toBe("STOCK_CHANGED");
    expect([7, 8]).toContain(await onHand(product.id, store.id));
  });
});

describe("stock levels", () => {
  async function seedLevels() {
    const session = await signedInAgent(app, "MANAGER");
    const store = await createStore();
    const drinks = await createCategory("Drinks");
    const cola = await createProduct({ name: "Cola", sku: "COLA", barcode: "5000000000001", categoryId: drinks.id });
    const water = await createProduct({ name: "Water", sku: "WATER", categoryId: drinks.id });
    const gum = await createProduct({ name: "Gum", sku: "GUM" });
    const chips = await createProduct({ name: "Chips 50%_off", sku: "CHIPS" });
    await createProduct({ name: "Old Cola", sku: "OLD", archivedAt: new Date() });
    await prisma.product.updateMany({ data: { reorderThreshold: 5 } });
    await seedStock(cola.id, store.id, 40); // OK
    await seedStock(water.id, store.id, 3); // LOW
    await seedStock(chips.id, store.id, 5); // LOW (at threshold)
    // gum: never stocked -> OUT
    void gum;
    return { ...session, store };
  }

  const names = (res: request.Response) => res.body.items.map((item: { name: string }) => item.name);

  it("lists active products with on-hand quantities, statuses and a summary", async () => {
    const { agent, store } = await seedLevels();
    const res = await agent.get(`/api/inventory?storeId=${store.id}`).expect(200);

    expect(names(res)).toEqual(["Chips 50%_off", "Cola", "Gum", "Water"]);
    const gum = res.body.items.find((item: { name: string }) => item.name === "Gum");
    expect(gum).toMatchObject({ quantity: 0, status: "OUT", updatedAt: null });
    expect(res.body.items.find((item: { name: string }) => item.name === "Water")).toMatchObject({ quantity: 3, status: "LOW" });
    expect(res.body.summary).toEqual({ products: 4, units: 48, low: 2, out: 1 });
    expect(res.body).toMatchObject({ total: 4, page: 1, totalPages: 1 });
  });

  it("filters by stock status", async () => {
    const { agent, store } = await seedLevels();
    const q = (status: string) => agent.get(`/api/inventory?storeId=${store.id}&stockStatus=${status}`);
    expect(names(await q("low"))).toEqual(["Chips 50%_off", "Water"]);
    expect(names(await q("out"))).toEqual(["Gum"]);
    expect(names(await q("needs_reorder"))).toEqual(["Chips 50%_off", "Gum", "Water"]);
    expect(names(await q("ok"))).toEqual(["Cola"]);
  });

  it("searches name, SKU and barcode, treating % and _ literally", async () => {
    const { agent, store } = await seedLevels();
    const q = (search: string) => agent.get(`/api/inventory?storeId=${store.id}&search=${encodeURIComponent(search)}`);
    expect(names(await q("cola"))).toEqual(["Cola"]);
    expect(names(await q("5000000"))).toEqual(["Cola"]);
    expect(names(await q("50%_"))).toEqual(["Chips 50%_off"]);
    expect(names(await q("%"))).toEqual(["Chips 50%_off"]);
  });

  it("sorts by quantity and paginates", async () => {
    const { agent, store } = await seedLevels();
    const res = await agent.get(`/api/inventory?storeId=${store.id}&sort=quantity&order=desc&pageSize=2`).expect(200);
    expect(names(res)).toEqual(["Cola", "Chips 50%_off"]);
    expect(res.body.totalPages).toBe(2);
  });

  it("reports quantities for the requested store only", async () => {
    const { agent } = await seedLevels();
    const empty = await createStore();
    const res = await agent.get(`/api/inventory?storeId=${empty.id}`).expect(200);
    expect(res.body.summary).toEqual({ products: 4, units: 0, low: 0, out: 4 });
  });

  it("validates the query", async () => {
    const { agent, store } = await seedLevels();
    await agent.get("/api/inventory").expect(400);
    await agent.get("/api/inventory?storeId=00000000-0000-4000-8000-000000000000").expect(404);
    await agent.get(`/api/inventory?storeId=${store.id}&sort=quantity;DROP TABLE products`).expect(400);
    await agent.get(`/api/inventory?storeId=${store.id}&stockStatus=empty`).expect(400);
  });
});

describe("movement history", () => {
  it("lists movements newest first with product, store and staff name", async () => {
    const { agent, csrf, store, product, user } = await setup();
    await adjust(agent, csrf, { storeId: store.id, productId: product.id, mode: "change", quantity: 5, reason: "RECEIVED" }).expect(201);
    await adjust(agent, csrf, { storeId: store.id, productId: product.id, mode: "change", quantity: -1, reason: "DAMAGED", note: "Dropped" }).expect(201);

    const res = await agent.get("/api/inventory/movements").expect(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items[0]).toMatchObject({
      quantityChange: -1,
      quantityAfter: 4,
      reason: "DAMAGED",
      note: "Dropped",
      createdBy: { id: user.id, name: user.name },
      product: { name: "Cola 330ml", sku: "COLA" },
      store: { id: store.id },
    });
    expect(res.body.items[1].quantityChange).toBe(5);
  });

  it("filters by product, store, reason and date, and paginates", async () => {
    const { agent, csrf, store, product } = await setup();
    const other = await createProduct();
    const otherStore = await createStore();
    await seedStock(product.id, store.id, 5);
    await seedStock(other.id, store.id, 5);
    await seedStock(product.id, otherStore.id, 5);
    await adjust(agent, csrf, { storeId: store.id, productId: product.id, mode: "change", quantity: -1, reason: "THEFT" }).expect(201);

    const byProduct = await agent.get(`/api/inventory/movements?productId=${product.id}`).expect(200);
    expect(byProduct.body.total).toBe(3);
    const byStore = await agent.get(`/api/inventory/movements?storeId=${store.id}&productId=${product.id}`).expect(200);
    expect(byStore.body.total).toBe(2);
    const byReason = await agent.get("/api/inventory/movements?reason=THEFT").expect(200);
    expect(byReason.body.total).toBe(1);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    const none = await agent.get(`/api/inventory/movements?from=${encodeURIComponent(future)}`).expect(200);
    expect(none.body.total).toBe(0);

    const paged = await agent.get("/api/inventory/movements?pageSize=2&page=2").expect(200);
    expect(paged.body).toMatchObject({ total: 4, totalPages: 2 });
    expect(paged.body.items).toHaveLength(2);

    await agent.get("/api/inventory/movements?from=2026-02-01&to=2026-01-01").expect(400);
  });
});

describe("stores", () => {
  it("lists active stores for every role", async () => {
    const { agent } = await signedInAgent(app, "CASHIER");
    await createStore({ name: "Downtown", code: "DT" });
    await createStore({ name: "Closed", code: "CL", isActive: false });
    const res = await agent.get("/api/stores?includeInactive=true").expect(200);
    expect(res.body.stores.map((s: { code: string }) => s.code)).toEqual(["DT"]);
  });

  it("lets the owner create, rename and deactivate stores", async () => {
    const { agent, csrf } = await signedInAgent(app, "OWNER");
    const keep = await createStore();
    const created = await agent.post("/api/stores").set("X-CSRF-Token", csrf).send({ name: "Airport Kiosk", code: "air-1" }).expect(201);
    expect(created.body.store).toMatchObject({ name: "Airport Kiosk", code: "AIR-1", isActive: true });

    await agent.post("/api/stores").set("X-CSRF-Token", csrf).send({ name: "Dup", code: "AIR-1" }).expect(409);
    const updated = await agent
      .patch(`/api/stores/${created.body.store.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ name: "Airport", isActive: false })
      .expect(200);
    expect(updated.body.store).toMatchObject({ name: "Airport", isActive: false });

    const all = await agent.get("/api/stores?includeInactive=true").expect(200);
    expect(all.body.stores).toHaveLength(2);
    void keep;
  });

  it("keeps at least one store active", async () => {
    const { agent, csrf } = await signedInAgent(app, "OWNER");
    const only = await createStore();
    const res = await agent.patch(`/api/stores/${only.id}`).set("X-CSRF-Token", csrf).send({ isActive: false }).expect(409);
    expect(res.body.error.code).toBe("LAST_ACTIVE_STORE");
  });

  it("forbids managers from managing stores", async () => {
    const { agent, csrf } = await signedInAgent(app, "MANAGER");
    const store = await createStore();
    await agent.post("/api/stores").set("X-CSRF-Token", csrf).send({ name: "X store", code: "XS" }).expect(403);
    await agent.patch(`/api/stores/${store.id}`).set("X-CSRF-Token", csrf).send({ name: "Renamed" }).expect(403);
  });
});
