import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { PASSWORD, buildApp, createUser, newAgent, prisma, resetDatabase, signIn, signedInAgent } from "./helpers.js";

const app = buildApp();

const newStaff = { name: "Casey Cashier", email: "casey@example.com", role: "CASHIER", password: "Temp0rary-Pass" };

beforeEach(resetDatabase);

async function ownerSession() {
  return signedInAgent(app, "OWNER");
}

describe("authorization on /api/users", () => {
  it("requires authentication", async () => {
    await request(app).get("/api/users").expect(401);
    await newAgent(app).post("/api/users").send(newStaff).expect(401);
  });

  it.each(["MANAGER", "CASHIER"] as const)("forbids a %s from reading or managing staff", async (role) => {
    const { agent, csrf } = await signedInAgent(app, role);
    const target = await createUser("CASHIER");

    for (const res of [
      await agent.get("/api/users"),
      await agent.get(`/api/users/${target.id}`),
      await agent.post("/api/users").set("X-CSRF-Token", csrf).send(newStaff),
      await agent.patch(`/api/users/${target.id}`).set("X-CSRF-Token", csrf).send({ role: "MANAGER" }),
      await agent.post(`/api/users/${target.id}/deactivate`).set("X-CSRF-Token", csrf),
      await agent.post(`/api/users/${target.id}/reset-password`).set("X-CSRF-Token", csrf).send({ password: PASSWORD }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
    expect(await prisma.user.count()).toBe(2);
  });

  it("prevents a manager from promoting themselves", async () => {
    const { agent, csrf, user } = await signedInAgent(app, "MANAGER");
    await agent.patch(`/api/users/${user.id}`).set("X-CSRF-Token", csrf).send({ role: "OWNER" }).expect(403);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).role).toBe("MANAGER");
  });

  it("requires the CSRF token for owner writes", async () => {
    const { agent } = await ownerSession();
    const res = await agent.post("/api/users").send(newStaff).expect(403);
    expect(res.body.error.code).toBe("CSRF_TOKEN_INVALID");
  });
});

describe("staff management by the owner", () => {
  it("creates staff with a temporary password they must change", async () => {
    const { agent, csrf, user: owner } = await ownerSession();
    const res = await agent.post("/api/users").set("X-CSRF-Token", csrf).send(newStaff).expect(201);

    expect(res.body.user).toMatchObject({
      email: "casey@example.com",
      role: "CASHIER",
      isActive: true,
      mustChangePassword: true,
    });
    expect(res.body.user).not.toHaveProperty("passwordHash");
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: res.body.user.id } });
    expect(stored.createdById).toBe(owner.id);

    const login = await newAgent(app)
      .post("/api/auth/login")
      .send({ email: newStaff.email, password: newStaff.password })
      .expect(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it("can never create another owner", async () => {
    const { agent, csrf } = await ownerSession();
    const res = await agent
      .post("/api/users")
      .set("X-CSRF-Token", csrf)
      .send({ ...newStaff, role: "OWNER" })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(await prisma.user.count({ where: { role: "OWNER" } })).toBe(1);
  });

  it("rejects duplicate emails regardless of case", async () => {
    const { agent, csrf } = await ownerSession();
    await agent.post("/api/users").set("X-CSRF-Token", csrf).send(newStaff).expect(201);
    const res = await agent
      .post("/api/users")
      .set("X-CSRF-Token", csrf)
      .send({ ...newStaff, email: "CASEY@example.com" })
      .expect(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("lists users filtered by status without exposing password hashes", async () => {
    const { agent } = await ownerSession();
    await createUser("MANAGER");
    await createUser("CASHIER", { isActive: false });

    const all = await agent.get("/api/users").expect(200);
    expect(all.body.users).toHaveLength(3);
    for (const user of all.body.users) expect(user).not.toHaveProperty("passwordHash");

    const inactive = await agent.get("/api/users?status=inactive").expect(200);
    expect(inactive.body.users).toHaveLength(1);
    expect(inactive.body.users[0].role).toBe("CASHIER");
  });

  it("changes a staff member's role, effective on their next request", async () => {
    const { agent, csrf } = await ownerSession();
    const manager = await signedInAgent(app, "MANAGER");

    const res = await agent
      .patch(`/api/users/${manager.user.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ role: "CASHIER", name: "Demoted Dana" })
      .expect(200);
    expect(res.body.user).toMatchObject({ role: "CASHIER", name: "Demoted Dana" });

    const me = await manager.agent.get("/api/auth/me").expect(200);
    expect(me.body.user.role).toBe("CASHIER");
  });

  it("refuses to promote anyone to owner or accept unknown fields", async () => {
    const { agent, csrf } = await ownerSession();
    const cashier = await createUser("CASHIER");

    await agent.patch(`/api/users/${cashier.id}`).set("X-CSRF-Token", csrf).send({ role: "OWNER" }).expect(400);
    await agent.patch(`/api/users/${cashier.id}`).set("X-CSRF-Token", csrf).send({ isActive: false }).expect(400);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: cashier.id } });
    expect(stored).toMatchObject({ role: "CASHIER", isActive: true });
  });

  it("protects the owner account from staff management", async () => {
    const { agent, csrf, user: owner } = await ownerSession();

    for (const res of [
      await agent.patch(`/api/users/${owner.id}`).set("X-CSRF-Token", csrf).send({ role: "MANAGER" }),
      await agent.post(`/api/users/${owner.id}/deactivate`).set("X-CSRF-Token", csrf),
      await agent.post(`/api/users/${owner.id}/reset-password`).set("X-CSRF-Token", csrf).send({ password: PASSWORD }),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("OWNER_IMMUTABLE");
    }
  });

  it("deactivation ends the staff member's sessions immediately and blocks sign-in until reactivated", async () => {
    const { agent, csrf } = await ownerSession();
    const cashier = await signedInAgent(app, "CASHIER");
    await cashier.agent.get("/api/auth/me").expect(200);

    const res = await agent.post(`/api/users/${cashier.user.id}/deactivate`).set("X-CSRF-Token", csrf).expect(200);
    expect(res.body.user.isActive).toBe(false);

    await cashier.agent.get("/api/auth/me").expect(401);
    await newAgent(app).post("/api/auth/login").send({ email: cashier.user.email, password: PASSWORD }).expect(403);

    await agent.post(`/api/users/${cashier.user.id}/activate`).set("X-CSRF-Token", csrf).expect(200);
    await signIn(newAgent(app), cashier.user.email);
  });

  it("resets a staff password, ending their sessions and requiring a change", async () => {
    const { agent, csrf } = await ownerSession();
    const cashier = await signedInAgent(app, "CASHIER");

    const res = await agent
      .post(`/api/users/${cashier.user.id}/reset-password`)
      .set("X-CSRF-Token", csrf)
      .send({ password: "Res3t-Password" })
      .expect(200);
    expect(res.body.user.mustChangePassword).toBe(true);

    await cashier.agent.get("/api/auth/me").expect(401);
    await signIn(newAgent(app), cashier.user.email, "Res3t-Password");
  });

  it("answers 404 for unknown or malformed ids", async () => {
    const { agent, csrf } = await ownerSession();
    await agent.get("/api/users/not-a-uuid").expect(404);
    await agent
      .post("/api/users/00000000-0000-4000-8000-000000000000/deactivate")
      .set("X-CSRF-Token", csrf)
      .expect(404);
  });
});
