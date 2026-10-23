import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { hashToken } from "../src/services/session.service.js";
import {
  ORIGIN,
  PASSWORD,
  SETUP_TOKEN,
  buildApp,
  createUser,
  getSetCookie,
  newAgent,
  prisma,
  resetDatabase,
  sessionCookieValue,
  signIn,
  signedInAgent,
} from "./helpers.js";

const app = buildApp();

const owner = { name: "Olivia Owner", email: "Owner@Example.com", password: PASSWORD };

beforeEach(resetDatabase);

describe("first-owner setup", () => {
  it("reports that setup is required on an empty database", async () => {
    const res = await request(app).get("/api/auth/setup").expect(200);
    expect(res.body).toEqual({ setupRequired: true, setupEnabled: true });
  });

  it("rejects a wrong setup token and creates nothing", async () => {
    const res = await newAgent(app)
      .post("/api/auth/setup")
      .send({ ...owner, setupToken: "wrong-token" })
      .expect(403);
    expect(res.body.error.code).toBe("INVALID_SETUP_TOKEN");
    expect(await prisma.user.count()).toBe(0);
  });

  it("creates the owner, signs them in with a hardened cookie, and never returns the hash", async () => {
    const agent = newAgent(app);
    const res = await agent
      .post("/api/auth/setup")
      .send({ ...owner, setupToken: SETUP_TOKEN })
      .expect(201);

    expect(res.body.user).toMatchObject({ email: "owner@example.com", role: "OWNER", isActive: true });
    expect(res.body.user).not.toHaveProperty("passwordHash");
    expect(res.body.csrfToken).toMatch(/^[0-9a-f]{64}$/);

    const cookie = getSetCookie(res).find((c) => c.startsWith("sp_session="));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Expires=/);

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.user.role).toBe("OWNER");
  });

  it("can only be completed once", async () => {
    await newAgent(app).post("/api/auth/setup").send({ ...owner, setupToken: SETUP_TOKEN }).expect(201);

    const again = await newAgent(app)
      .post("/api/auth/setup")
      .send({ ...owner, email: "second@example.com", setupToken: SETUP_TOKEN })
      .expect(409);
    expect(again.body.error.code).toBe("SETUP_ALREADY_COMPLETED");

    const status = await request(app).get("/api/auth/setup").expect(200);
    expect(status.body.setupRequired).toBe(false);
    expect(await prisma.user.count({ where: { role: "OWNER" } })).toBe(1);
  });

  it("yields exactly one owner when setup requests race", async () => {
    // A separate app, so concurrent in-flight requests don't trip the shared rate limiter.
    const raceApp = buildApp();
    const attempts = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        newAgent(raceApp)
          .post("/api/auth/setup")
          .send({ ...owner, email: `racer${i}@example.com`, setupToken: SETUP_TOKEN }),
      ),
    );
    const statuses = attempts.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(await prisma.user.count()).toBe(1);
  });

  it("enforces the password policy", async () => {
    const res = await newAgent(app)
      .post("/api/auth/setup")
      .send({ ...owner, password: "short", setupToken: SETUP_TOKEN })
      .expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("the database refuses a second owner even when inserted directly", async () => {
    await createUser("OWNER");
    await expect(createUser("OWNER")).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("login", () => {
  it("signs in with a case-insensitive email and stores only a hash of the session token", async () => {
    const user = await createUser("CASHIER", { email: "cashier@example.com" });
    const res = await newAgent(app)
      .post("/api/auth/login")
      .send({ email: "  Cashier@Example.COM ", password: PASSWORD })
      .expect(200);

    expect(res.body.user.id).toBe(user.id);
    const token = sessionCookieValue(res);
    expect(token).toBeDefined();

    const sessions = await prisma.session.findMany({ where: { userId: user.id } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.tokenHash).toBe(hashToken(token!));
    expect(sessions[0]?.tokenHash).not.toBe(token);

    const refreshed = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(refreshed.lastLoginAt).not.toBeNull();
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    await createUser("MANAGER", { email: "manager@example.com" });

    const wrongPassword = await newAgent(app)
      .post("/api/auth/login")
      .send({ email: "manager@example.com", password: "nope-nope-1" })
      .expect(401);
    const unknownEmail = await newAgent(app)
      .post("/api/auth/login")
      .send({ email: "ghost@example.com", password: "nope-nope-1" })
      .expect(401);

    expect(wrongPassword.body.error.code).toBe("INVALID_CREDENTIALS");
    expect(unknownEmail.body.error).toMatchObject({
      code: wrongPassword.body.error.code,
      message: wrongPassword.body.error.message,
    });
    expect(getSetCookie(wrongPassword)).toHaveLength(0);
  });

  it("rejects deactivated accounts", async () => {
    await createUser("CASHIER", { email: "gone@example.com", isActive: false });
    const res = await newAgent(app)
      .post("/api/auth/login")
      .send({ email: "gone@example.com", password: PASSWORD })
      .expect(403);
    expect(res.body.error.code).toBe("ACCOUNT_DISABLED");
  });

  it("rate-limits repeated failures for an account", async () => {
    await createUser("CASHIER", { email: "target@example.com" });
    const attempt = () =>
      newAgent(app).post("/api/auth/login").send({ email: "target@example.com", password: "wrong-pass-1" });

    // LOGIN_RATE_LIMIT_MAX=5 in .env.test
    for (let i = 0; i < 5; i++) {
      expect((await attempt()).status).toBe(401);
    }
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_ATTEMPTS");

    // Even the right password is refused while the limit is in force.
    await newAgent(app).post("/api/auth/login").send({ email: "target@example.com", password: PASSWORD }).expect(429);
  });

  it("rejects requests from a foreign Origin", async () => {
    const user = await createUser("CASHIER");
    const res = await request(app)
      .post("/api/auth/login")
      .set("Origin", "https://evil.example")
      .send({ email: user.email, password: PASSWORD })
      .expect(403);
    expect(res.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("validates the request body", async () => {
    const res = await newAgent(app).post("/api/auth/login").send({ email: "not-an-email" }).expect(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("replaces an existing session instead of reusing it (no session fixation)", async () => {
    const user = await createUser("CASHIER");
    const agent = newAgent(app);
    const first = await agent.post("/api/auth/login").send({ email: user.email, password: PASSWORD }).expect(200);
    const second = await agent.post("/api/auth/login").send({ email: user.email, password: PASSWORD }).expect(200);

    expect(sessionCookieValue(second)).not.toBe(sessionCookieValue(first));
    const oldSession = await prisma.session.findUniqueOrThrow({
      where: { tokenHash: hashToken(sessionCookieValue(first)!) },
    });
    expect(oldSession.revokedReason).toBe("NEW_LOGIN");
  });
});

describe("sessions", () => {
  it("requires a session for /me", async () => {
    const res = await request(app).get("/api/auth/me").expect(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects a forged cookie and clears it", async () => {
    const res = await request(app).get("/api/auth/me").set("Cookie", "sp_session=forged-token").expect(401);
    expect(res.body.error.code).toBe("SESSION_EXPIRED");
    expect(getSetCookie(res).some((c) => c.startsWith("sp_session=;"))).toBe(true);
  });

  it("returns the profile and CSRF token without caching", async () => {
    const { agent, user, csrf } = await signedInAgent(app, "MANAGER");
    const res = await agent.get("/api/auth/me").expect(200);
    expect(res.body.user).toMatchObject({ id: user.id, role: "MANAGER" });
    expect(res.body.csrfToken).toBe(csrf);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("requires the CSRF token to log out, then revokes the session", async () => {
    const { agent, csrf } = await signedInAgent(app, "CASHIER");

    const noToken = await agent.post("/api/auth/logout").expect(403);
    expect(noToken.body.error.code).toBe("CSRF_TOKEN_INVALID");
    await agent.post("/api/auth/logout").set("X-CSRF-Token", "0".repeat(64)).expect(403);

    await agent.post("/api/auth/logout").set("X-CSRF-Token", csrf).expect(204);
    await agent.get("/api/auth/me").expect(401);
  });

  it("does not accept a revoked session token even if replayed", async () => {
    const user = await createUser("CASHIER");
    const login = await newAgent(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD });
    const token = sessionCookieValue(login)!;
    await request(app)
      .post("/api/auth/logout")
      .set("Cookie", `sp_session=${token}`)
      .set("X-CSRF-Token", login.body.csrfToken)
      .expect(204);

    await request(app).get("/api/auth/me").set("Cookie", `sp_session=${token}`).expect(401);
  });

  it("expires sessions past their absolute lifetime", async () => {
    const { agent, user } = await signedInAgent(app, "CASHIER");
    await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await agent.get("/api/auth/me").expect(401);
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.revokedReason).toBe("EXPIRED");
  });

  it("expires idle sessions", async () => {
    const { agent, user } = await signedInAgent(app, "CASHIER");
    await prisma.session.updateMany({
      where: { userId: user.id },
      data: { lastSeenAt: new Date(Date.now() - 121 * 60_000) },
    });

    await agent.get("/api/auth/me").expect(401);
    const session = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(session.revokedReason).toBe("IDLE_TIMEOUT");
  });

  it("logs out everywhere", async () => {
    const user = await createUser("MANAGER");
    const laptop = newAgent(app);
    const tablet = newAgent(app);
    const csrf = await signIn(laptop, user.email);
    await signIn(tablet, user.email);

    await laptop.post("/api/auth/logout-all").set("X-CSRF-Token", csrf).expect(204);
    await laptop.get("/api/auth/me").expect(401);
    await tablet.get("/api/auth/me").expect(401);
  });
});

describe("change password", () => {
  it("rejects an incorrect current password", async () => {
    const { agent, csrf } = await signedInAgent(app, "CASHIER");
    const res = await agent
      .post("/api/auth/change-password")
      .set("X-CSRF-Token", csrf)
      .send({ currentPassword: "Wr0ngPassword", newPassword: "N3wPassword!!" })
      .expect(400);
    expect(res.body.error.details[0].path).toEqual(["currentPassword"]);
  });

  it("requires the CSRF token", async () => {
    const { agent } = await signedInAgent(app, "CASHIER");
    await agent
      .post("/api/auth/change-password")
      .send({ currentPassword: PASSWORD, newPassword: "N3wPassword!!" })
      .expect(403);
  });

  it("changes the password, revokes other sessions and rotates the current one", async () => {
    const user = await createUser("MANAGER");
    const current = newAgent(app);
    const other = newAgent(app);
    const csrf = await signIn(current, user.email);
    await signIn(other, user.email);

    const res = await current
      .post("/api/auth/change-password")
      .set("X-CSRF-Token", csrf)
      .send({ currentPassword: PASSWORD, newPassword: "N3wPassword!!" })
      .expect(200);

    expect(res.body.csrfToken).not.toBe(csrf);
    expect(sessionCookieValue(res)).toBeDefined();
    await current.get("/api/auth/me").expect(200);
    await other.get("/api/auth/me").expect(401);

    await newAgent(app).post("/api/auth/login").send({ email: user.email, password: PASSWORD }).expect(401);
    await newAgent(app).post("/api/auth/login").send({ email: user.email, password: "N3wPassword!!" }).expect(200);
  });

  it("blocks other endpoints until a temporary password is changed", async () => {
    // An owner with a temporary password is the only role that can reach /api/users,
    // which makes the gate observable.
    const { agent, csrf } = await signedInAgent(app, "OWNER", { mustChangePassword: true });

    const me = await agent.get("/api/auth/me").expect(200);
    expect(me.body.user.mustChangePassword).toBe(true);
    const blocked = await agent.get("/api/users").expect(403);
    expect(blocked.body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");

    const changed = await agent
      .post("/api/auth/change-password")
      .set("X-CSRF-Token", csrf)
      .send({ currentPassword: PASSWORD, newPassword: "N3wPassword!!" })
      .expect(200);
    expect(changed.body.user.mustChangePassword).toBe(false);

    await agent.get("/api/users").expect(200);
  });
});

// Keep last: it exhausts this file's setup rate limiter.
describe("setup token guessing", () => {
  it("is throttled after repeated wrong tokens, even for the right token", async () => {
    const guess = () =>
      newAgent(app)
        .post("/api/auth/setup")
        .send({ ...owner, setupToken: "guess-guess-guess" });

    // LOGIN_RATE_LIMIT_MAX=5; one wrong guess was already made earlier in this file.
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await guess()).status);
    expect(statuses.at(-1)).toBe(429);
    expect(statuses.filter((s) => s === 403).length).toBeLessThanOrEqual(4);

    await newAgent(app).post("/api/auth/setup").send({ ...owner, setupToken: SETUP_TOKEN }).expect(429);
    expect(await prisma.user.count()).toBe(0);
  });
});

describe("CORS", () => {
  it("allows the frontend origin with credentials and the CSRF header", async () => {
    const res = await request(app)
      .options("/api/auth/logout")
      .set("Origin", ORIGIN)
      .set("Access-Control-Request-Method", "POST")
      .set("Access-Control-Request-Headers", "content-type,x-csrf-token");
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
    expect(res.headers["access-control-allow-headers"]?.toLowerCase()).toContain("x-csrf-token");
  });
});
