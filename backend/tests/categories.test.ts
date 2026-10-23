import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createCategory, createProduct } from "./catalogHelpers.js";
import { buildApp, prisma, resetDatabase, signedInAgent } from "./helpers.js";

const app = buildApp();

beforeEach(resetDatabase);

describe("categories", () => {
  it("requires authentication", async () => {
    await request(app).get("/api/categories").expect(401);
  });

  it("lets every role list categories with active and total product counts", async () => {
    const drinks = await createCategory("Drinks");
    await createCategory("Snacks");
    await createProduct({ categoryId: drinks.id });
    await createProduct({ categoryId: drinks.id, archivedAt: new Date() });

    const { agent } = await signedInAgent(app, "CASHIER");
    const res = await agent.get("/api/categories").expect(200);

    expect(res.body.categories.map((c: { name: string }) => c.name)).toEqual(["Drinks", "Snacks"]);
    expect(res.body.categories[0]).toMatchObject({ productCount: 1, totalProductCount: 2 });
    expect(res.body.categories[1]).toMatchObject({ productCount: 0, totalProductCount: 0 });
  });

  it("forbids cashiers from changing categories", async () => {
    const { agent, csrf } = await signedInAgent(app, "CASHIER");
    const category = await createCategory();

    await agent.post("/api/categories").set("X-CSRF-Token", csrf).send({ name: "Nope" }).expect(403);
    await agent.patch(`/api/categories/${category.id}`).set("X-CSRF-Token", csrf).send({ name: "Nope" }).expect(403);
    await agent.delete(`/api/categories/${category.id}`).set("X-CSRF-Token", csrf).expect(403);
    expect(await prisma.category.count()).toBe(1);
  });

  it("lets managers create categories, collapsing whitespace", async () => {
    const { agent, csrf } = await signedInAgent(app, "MANAGER");
    const res = await agent
      .post("/api/categories")
      .set("X-CSRF-Token", csrf)
      .send({ name: "  Soft   Drinks ", description: "Fizzy" })
      .expect(201);
    expect(res.body.category).toMatchObject({ name: "Soft Drinks", description: "Fizzy", productCount: 0 });
  });

  it("rejects duplicate names regardless of case and spacing", async () => {
    const { agent, csrf } = await signedInAgent(app, "OWNER");
    await createCategory("Soft Drinks");

    const res = await agent.post("/api/categories").set("X-CSRF-Token", csrf).send({ name: "soft  DRINKS" }).expect(409);
    expect(res.body.error.code).toBe("DUPLICATE_VALUE");
    expect(res.body.error.details[0].path).toEqual(["name"]);
  });

  it("renames, but not onto another category's name", async () => {
    const { agent, csrf } = await signedInAgent(app, "MANAGER");
    const drinks = await createCategory("Drinks");
    await createCategory("Snacks");

    const renamed = await agent
      .patch(`/api/categories/${drinks.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ name: "Beverages" })
      .expect(200);
    expect(renamed.body.category.name).toBe("Beverages");

    // Changing only the case of its own name is fine.
    await agent.patch(`/api/categories/${drinks.id}`).set("X-CSRF-Token", csrf).send({ name: "BEVERAGES" }).expect(200);
    await agent.patch(`/api/categories/${drinks.id}`).set("X-CSRF-Token", csrf).send({ name: "snacks" }).expect(409);
  });

  it("deletes an empty category", async () => {
    const { agent, csrf } = await signedInAgent(app, "MANAGER");
    const category = await createCategory();
    await agent.delete(`/api/categories/${category.id}`).set("X-CSRF-Token", csrf).expect(204);
    expect(await prisma.category.count()).toBe(0);
  });

  it("refuses to delete a category still used by products, even archived ones", async () => {
    const { agent, csrf } = await signedInAgent(app, "OWNER");
    const category = await createCategory();
    await createProduct({ categoryId: category.id, archivedAt: new Date() });

    const res = await agent.delete(`/api/categories/${category.id}`).set("X-CSRF-Token", csrf).expect(409);
    expect(res.body.error.code).toBe("CATEGORY_IN_USE");
    expect(await prisma.category.count()).toBe(1);
  });

  it("the foreign key blocks deleting a used category at the database level", async () => {
    const category = await createCategory();
    await createProduct({ categoryId: category.id });
    await expect(prisma.category.delete({ where: { id: category.id } })).rejects.toThrow();
  });

  it("answers 404 for unknown ids", async () => {
    const { agent, csrf } = await signedInAgent(app, "OWNER");
    await agent
      .patch("/api/categories/00000000-0000-4000-8000-000000000000")
      .set("X-CSRF-Token", csrf)
      .send({ name: "X" })
      .expect(404);
    await agent.delete("/api/categories/nope").set("X-CSRF-Token", csrf).expect(404);
  });
});
