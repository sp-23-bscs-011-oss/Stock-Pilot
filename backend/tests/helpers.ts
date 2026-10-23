import request from "supertest";
import { createApp } from "../src/app.js";
import { hashPassword } from "../src/lib/password.js";
import { prisma } from "../src/lib/prisma.js";
import type { Role } from "../src/generated/prisma/client.js";

export const ORIGIN = "http://localhost:5173";
export const SETUP_TOKEN = process.env["SETUP_TOKEN"] ?? "";
export const PASSWORD = "Str0ngPassw0rd";

export type Agent = ReturnType<typeof request.agent>;

export { prisma };

export async function resetDatabase() {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "audit_logs", "purchase_receipt_lines", "purchase_receipts", "purchase_order_lines", "purchase_orders", "suppliers", "stock_movements", "inventory_levels", "stores", "products", "categories", "sessions", "users" RESTART IDENTITY CASCADE');
}

/** A fresh app per test file, so in-memory rate limits never leak between files. */
export function buildApp() {
  return createApp();
}

/** A cookie-keeping client that sends the frontend's Origin, like a browser would. */
export function newAgent(app: ReturnType<typeof createApp>): Agent {
  return request.agent(app).set("Origin", ORIGIN);
}

let counter = 0;

export async function createUser(
  role: Role,
  overrides: { email?: string; password?: string; isActive?: boolean; mustChangePassword?: boolean } = {},
) {
  counter += 1;
  return prisma.user.create({
    data: {
      name: `${role.toLowerCase()} ${counter}`,
      email: overrides.email ?? `${role.toLowerCase()}${counter}@example.com`,
      passwordHash: await hashPassword(overrides.password ?? PASSWORD),
      role,
      isActive: overrides.isActive ?? true,
      mustChangePassword: overrides.mustChangePassword ?? false,
    },
  });
}

/** Signs the agent in and returns the CSRF token for subsequent writes. */
export async function signIn(agent: Agent, email: string, password = PASSWORD): Promise<string> {
  const res = await agent.post("/api/auth/login").send({ email, password }).expect(200);
  return res.body.csrfToken as string;
}

export async function signedInAgent(app: ReturnType<typeof createApp>, role: Role, options?: Parameters<typeof createUser>[1]) {
  const user = await createUser(role, options);
  const agent = newAgent(app);
  const csrf = await signIn(agent, user.email, options?.password);
  return { user, agent, csrf };
}

export function getSetCookie(res: request.Response): string[] {
  const header = res.headers["set-cookie"] as unknown;
  if (Array.isArray(header)) return header as string[];
  return typeof header === "string" ? [header] : [];
}

export function sessionCookieValue(res: request.Response): string | undefined {
  const cookie = getSetCookie(res).find((c) => c.startsWith("sp_session="));
  return cookie?.split(";")[0]?.slice("sp_session=".length);
}
