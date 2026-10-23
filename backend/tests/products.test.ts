import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createCategory, createProduct, productBody } from "./catalogHelpers.js";
import { buildApp, prisma, resetDatabase, signedInAgent } from "./helpers.js";

const app = buildApp();

beforeEach(resetDatabase);

const manager = () => signedInAgent(app, "MANAGER");

describe("product authorization", () => {
  it("requires authentication", async () => {
    await request(app).get("/api/products").expect(401);
  });

  it("lets cashiers browse but not change the catalog", async () => {
    const product = await createProduct();
    const { agent, csrf } = await signedInAgent(app, "CASHIER");

    await agent.get("/api/products").expect(200);
    await agent.get(`/api/products/${product.id}`).expect(200);

    for (const res of [
      await agent.post("/api/products").set("X-CSRF-Token", csrf).send(productBody()),
      await agent.patch(`/api/products/${product.id}`).set("X-CSRF-Token", csrf).send({ name: "Hacked" }),
      await agent.post(`/api/products/${product.id}/archive`).set("X-CSRF-Token", csrf),
      await agent.post(`/api/products/${product.id}/restore`).set("X-CSRF-Token", csrf),
    ]) {
      expect(res.status).toBe(403);
    }
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).name).toBe(product.name);
  });

  it("hides cost prices and archived products from cashiers", async () => {
    const active = await createProduct();
    const archived = await createProduct({ archivedAt: new Date() });
    const { agent } = await signedInAgent(app, "CASHIER");

    const list = await agent.get("/api/products").expect(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).not.toHaveProperty("costPrice");
    const one = await agent.get(`/api/products/${active.id}`).expect(200);
    expect(one.body.product).not.toHaveProperty("costPrice");

    await agent.get(`/api/products/${archived.id}`).expect(404);
    await agent.get("/api/products?status=archived").expect(403);
    await agent.get("/api/products?sort=costPrice").expect(403);
  });

  it("requires the CSRF token for writes", async () => {
    const { agent } = await manager();
    const res = await agent.post("/api/products").send(productBody()).expect(403);
    expect(res.body.error.code).toBe("CSRF_TOKEN_INVALID");
  });
});

describe("creating products", () => {
  it("creates a product with normalized identifiers and exact money values", async () => {
    const { agent, csrf, user } = await manager();
    const category = await createCategory("Drinks");

    const res = await agent
      .post("/api/products")
      .set("X-CSRF-Token", csrf)
      .send(productBody({ sku: "  cola-330 ", barcode: "5449000000996", categoryId: category.id }))
      .expect(201);

    expect(res.body.product).toMatchObject({
      sku: "COLA-330",
      barcode: "5449000000996",
      costPrice: "4.20",
      sellingPrice: "7.50",
      reorderThreshold: 10,
      category: { id: category.id, name: "Drinks" },
      isArchived: false,
    });
    const stored = await prisma.product.findUniqueOrThrow({ where: { id: res.body.product.id } });
    expect(stored.createdById).toBe(user.id);
    expect(stored.costPrice.toString()).toBe("4.2");
  });

  it("treats blank optional fields as empty", async () => {
    const { agent, csrf } = await manager();
    const res = await agent
      .post("/api/products")
      .set("X-CSRF-Token", csrf)
      .send(productBody({ barcode: "", description: "   ", categoryId: null, reorderThreshold: undefined }))
      .expect(201);
    expect(res.body.product).toMatchObject({ barcode: null, description: null, category: null, reorderThreshold: 0 });
  });

  it.each([
    ["negative price", { sellingPrice: "-1" }, "sellingPrice"],
    ["three decimals", { costPrice: "1.005" }, "costPrice"],
    ["float noise", { costPrice: 0.1 + 0.2 }, "costPrice"],
    ["too large", { sellingPrice: "12345678901.00" }, "sellingPrice"],
    ["missing name", { name: "" }, "name"],
    ["bad SKU characters", { sku: "has space" }, "sku"],
    ["fractional threshold", { reorderThreshold: 2.5 }, "reorderThreshold"],
    ["string threshold", { reorderThreshold: "5" }, "reorderThreshold"],
    ["malformed category", { categoryId: "abc" }, "categoryId"],
  ])("rejects %s", async (_label, override, field) => {
    const { agent, csrf } = await manager();
    const res = await agent.post("/api/products").set("X-CSRF-Token", csrf).send(productBody(override)).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.some((issue: { path: string[] }) => issue.path[0] === field)).toBe(true);
  });

  it("rejects a category that doesn't exist", async () => {
    const { agent, csrf } = await manager();
    const res = await agent
      .post("/api/products")
      .set("X-CSRF-Token", csrf)
      .send(productBody({ categoryId: "00000000-0000-4000-8000-000000000000" }))
      .expect(400);
    expect(res.body.error.details[0].path).toEqual(["categoryId"]);
  });

  it("rejects an SKU already in use, ignoring case", async () => {
    const { agent, csrf } = await manager();
    await createProduct({ sku: "COLA-330" });
    const res = await agent.post("/api/products").set("X-CSRF-Token", csrf).send(productBody({ sku: "cola-330" })).expect(409);
    expect(res.body.error.code).toBe("DUPLICATE_VALUE");
    expect(res.body.error.details).toEqual([expect.objectContaining({ path: ["sku"] })]);
  });

  it("never reuses the SKU of an archived product", async () => {
    const { agent, csrf } = await manager();
    await createProduct({ sku: "OLD-1", archivedAt: new Date() });
    const res = await agent.post("/api/products").set("X-CSRF-Token", csrf).send(productBody({ sku: "OLD-1" })).expect(409);
    expect(res.body.error.details[0].message).toMatch(/archived/i);
  });

  it("rejects a barcode used by an active product, reporting both clashes at once", async () => {
    const { agent, csrf } = await manager();
    await createProduct({ sku: "A-1", barcode: "1234567890123" });
    const res = await agent
      .post("/api/products")
      .set("X-CSRF-Token", csrf)
      .send(productBody({ sku: "A-1", barcode: "1234567890123" }))
      .expect(409);
    expect(res.body.error.details.map((issue: { path: string[] }) => issue.path[0]).sort()).toEqual(["barcode", "sku"]);
  });

  it("allows a barcode that only an archived product used", async () => {
    const { agent, csrf } = await manager();
    await createProduct({ barcode: "1234567890123", archivedAt: new Date() });
    await agent.post("/api/products").set("X-CSRF-Token", csrf).send(productBody({ barcode: "1234567890123" })).expect(201);
  });

  it("lets many products have no barcode", async () => {
    const { agent, csrf } = await manager();
    await agent.post("/api/products").set("X-CSRF-Token", csrf).send(productBody({ barcode: null })).expect(201);
    await agent.post("/api/products").set("X-CSRF-Token", csrf).send(productBody({ barcode: null })).expect(201);
  });

  it("the database enforces both uniqueness rules when requests race", async () => {
    const { agent, csrf } = await manager();
    const sameSku = await Promise.all(
      Array.from({ length: 4 }, () =>
        agent.post("/api/products").set("X-CSRF-Token", csrf).send(productBody({ sku: "RACE-1", barcode: null })),
      ),
    );
    expect(sameSku.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);

    const sameBarcode = await Promise.all(
      Array.from({ length: 4 }, () =>
        agent.post("/api/products").set("X-CSRF-Token", csrf).send(productBody({ barcode: "9999999999999" })),
      ),
    );
    expect(sameBarcode.map((r) => r.status).sort()).toEqual([201, 409, 409, 409]);
    for (const res of sameBarcode.filter((r) => r.status === 409)) {
      expect(res.body.error.details[0].path).toEqual(["barcode"]);
    }
    expect(await prisma.product.count()).toBe(2);
  });

  it("the database rejects negative prices even when written directly", async () => {
    await expect(createProduct({ costPrice: "-1.00" })).rejects.toThrow();
  });
});

describe("updating products", () => {
  it("applies a partial update and records who made it", async () => {
    const { agent, csrf, user } = await manager();
    const product = await createProduct({ barcode: "1111111111111" });

    const res = await agent
      .patch(`/api/products/${product.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ sellingPrice: "12.00", barcode: null })
      .expect(200);
    expect(res.body.product).toMatchObject({ sellingPrice: "12.00", barcode: null, name: product.name });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).updatedById).toBe(user.id);
  });

  it("allows keeping its own SKU and barcode but not taking another product's", async () => {
    const { agent, csrf } = await manager();
    const product = await createProduct({ sku: "MINE", barcode: "1111111111111" });
    await createProduct({ sku: "THEIRS", barcode: "2222222222222" });

    await agent
      .patch(`/api/products/${product.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ sku: "mine", barcode: "1111111111111" })
      .expect(200);
    await agent.patch(`/api/products/${product.id}`).set("X-CSRF-Token", csrf).send({ sku: "theirs" }).expect(409);
    await agent.patch(`/api/products/${product.id}`).set("X-CSRF-Token", csrf).send({ barcode: "2222222222222" }).expect(409);
  });

  it("rejects unknown fields and empty updates", async () => {
    const { agent, csrf } = await manager();
    const product = await createProduct();
    await agent.patch(`/api/products/${product.id}`).set("X-CSRF-Token", csrf).send({ archivedAt: null }).expect(400);
    await agent.patch(`/api/products/${product.id}`).set("X-CSRF-Token", csrf).send({}).expect(400);
  });

  it("refuses to edit an archived product", async () => {
    const { agent, csrf } = await manager();
    const product = await createProduct({ archivedAt: new Date() });
    const res = await agent.patch(`/api/products/${product.id}`).set("X-CSRF-Token", csrf).send({ name: "X" }).expect(409);
    expect(res.body.error.code).toBe("PRODUCT_ARCHIVED");
  });
});

describe("archiving products", () => {
  it("archives instead of deleting, keeping the row for historical records", async () => {
    const { agent, csrf, user } = await manager();
    const product = await createProduct();

    const res = await agent.post(`/api/products/${product.id}/archive`).set("X-CSRF-Token", csrf).expect(200);
    expect(res.body.product.isArchived).toBe(true);

    const stored = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    expect(stored.archivedAt).not.toBeNull();
    expect(stored.archivedById).toBe(user.id);

    const active = await agent.get("/api/products").expect(200);
    expect(active.body.items).toHaveLength(0);
    const archived = await agent.get("/api/products?status=archived").expect(200);
    expect(archived.body.items.map((p: { id: string }) => p.id)).toEqual([product.id]);
  });

  it("is idempotent", async () => {
    const { agent, csrf } = await manager();
    const product = await createProduct();
    const first = await agent.post(`/api/products/${product.id}/archive`).set("X-CSRF-Token", csrf).expect(200);
    const second = await agent.post(`/api/products/${product.id}/archive`).set("X-CSRF-Token", csrf).expect(200);
    expect(second.body.product.archivedAt).toBe(first.body.product.archivedAt);
  });

  it("offers no way to delete a product through the API", async () => {
    const { agent, csrf } = await signedInAgent(app, "OWNER");
    const product = await createProduct();
    await agent.delete(`/api/products/${product.id}`).set("X-CSRF-Token", csrf).expect(404);
    expect(await prisma.product.count()).toBe(1);
  });

  it("the database refuses to delete products, whoever asks", async () => {
    const product = await createProduct();
    // The trigger raises restrict_violation (SQLSTATE 23001) with an "archive instead" message.
    const blockedByTrigger = {
      meta: {
        driverAdapterError: {
          cause: { originalCode: "23001", originalMessage: expect.stringMatching(/archive them instead/) },
        },
      },
    };
    await expect(prisma.product.delete({ where: { id: product.id } })).rejects.toMatchObject(blockedByTrigger);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "products"`)).rejects.toMatchObject(blockedByTrigger);
    expect(await prisma.product.count()).toBe(1);
  });

  it("restores an archived product", async () => {
    const { agent, csrf } = await manager();
    const product = await createProduct({ archivedAt: new Date() });
    const res = await agent.post(`/api/products/${product.id}/restore`).set("X-CSRF-Token", csrf).expect(200);
    expect(res.body.product.isArchived).toBe(false);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: product.id } })).archivedById).toBeNull();
  });

  it("won't restore a product whose barcode now belongs to another active product", async () => {
    const { agent, csrf } = await manager();
    const old = await createProduct({ barcode: "1234567890123", archivedAt: new Date() });
    await createProduct({ barcode: "1234567890123" });

    const res = await agent.post(`/api/products/${old.id}/restore`).set("X-CSRF-Token", csrf).expect(409);
    expect(res.body.error.code).toBe("DUPLICATE_VALUE");
    expect(res.body.error.details[0].path).toEqual(["barcode"]);
  });
});

describe("listing products", () => {
  async function seedCatalog() {
    const drinks = await createCategory("Drinks");
    const snacks = await createCategory("Snacks");
    await createProduct({ sku: "COLA", name: "Cola 330ml", barcode: "5000000000001", sellingPrice: "1.50", categoryId: drinks.id });
    await createProduct({ sku: "WATER", name: "Still Water", sellingPrice: "0.90", categoryId: drinks.id });
    await createProduct({ sku: "CHIPS", name: "Salted Crisps", sellingPrice: "2.10", categoryId: snacks.id });
    await createProduct({ sku: "GUM", name: "Mint Gum", sellingPrice: "0.60", categoryId: null });
    await createProduct({ sku: "OLD-COLA", name: "Cola Classic", sellingPrice: "1.20", categoryId: drinks.id, archivedAt: new Date() });
    return { drinks, snacks };
  }

  const names = (res: request.Response) => res.body.items.map((p: { name: string }) => p.name);

  it("paginates with totals and stable ordering", async () => {
    await seedCatalog();
    const { agent } = await manager();

    const page1 = await agent.get("/api/products?pageSize=3&page=1").expect(200);
    expect(page1.body).toMatchObject({ page: 1, pageSize: 3, total: 4, totalPages: 2 });
    expect(names(page1)).toEqual(["Cola 330ml", "Mint Gum", "Salted Crisps"]);
    const page2 = await agent.get("/api/products?pageSize=3&page=2").expect(200);
    expect(names(page2)).toEqual(["Still Water"]);

    const beyond = await agent.get("/api/products?pageSize=3&page=9").expect(200);
    expect(beyond.body.items).toEqual([]);
  });

  it("searches name, SKU and barcode case-insensitively", async () => {
    await seedCatalog();
    const { agent } = await manager();
    expect(names(await agent.get("/api/products?search=cola"))).toEqual(["Cola 330ml"]);
    expect(names(await agent.get("/api/products?search=chip"))).toEqual(["Salted Crisps"]);
    expect(names(await agent.get("/api/products?search=500000000"))).toEqual(["Cola 330ml"]);
    expect(names(await agent.get("/api/products?search=cola&status=all"))).toEqual(["Cola 330ml", "Cola Classic"]);
  });

  it("filters by category, uncategorized, and price range", async () => {
    const { drinks } = await seedCatalog();
    const { agent } = await manager();
    expect(names(await agent.get(`/api/products?categoryId=${drinks.id}`))).toEqual(["Cola 330ml", "Still Water"]);
    expect(names(await agent.get("/api/products?categoryId=none"))).toEqual(["Mint Gum"]);
    expect(names(await agent.get("/api/products?minPrice=0.90&maxPrice=1.50"))).toEqual(["Cola 330ml", "Still Water"]);
  });

  it("sorts by any allowed field in either direction", async () => {
    await seedCatalog();
    const { agent } = await manager();
    expect(names(await agent.get("/api/products?sort=sellingPrice&order=desc"))).toEqual([
      "Salted Crisps",
      "Cola 330ml",
      "Still Water",
      "Mint Gum",
    ]);
    expect(names(await agent.get("/api/products?sort=sku"))).toEqual(["Salted Crisps", "Cola 330ml", "Mint Gum", "Still Water"]);
  });

  it("validates query parameters", async () => {
    const { agent } = await manager();
    for (const query of ["sort=password_hash", "pageSize=500", "page=0", "order=sideways", "minPrice=5&maxPrice=1", "categoryId=drinks"]) {
      const res = await agent.get(`/api/products?${query}`);
      expect(res.status, query).toBe(400);
    }
  });
});
