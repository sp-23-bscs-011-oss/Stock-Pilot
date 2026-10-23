import { createHash, timingSafeEqual } from "node:crypto";
import { env } from "../config/env.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { prisma } from "../lib/prisma.js";
import { isUniqueViolation } from "../lib/prismaErrors.js";
import { AppError } from "../utils/AppError.js";
import {
  createSession,
  pruneUserSessions,
  revokeSession,
  revokeUserSessions,
  type ClientMeta,
  type IssuedSession,
} from "./session.service.js";
import type { User } from "../generated/prisma/client.js";

export interface AuthResult extends IssuedSession {
  user: User;
}

export async function getSetupStatus() {
  const userCount = await prisma.user.count();
  return { setupRequired: userCount === 0, setupEnabled: env.SETUP_TOKEN !== undefined };
}

function setupTokenMatches(candidate: string): boolean {
  if (!env.SETUP_TOKEN) return false;
  // Hash both sides so the comparison is constant-time regardless of input length.
  const expected = createHash("sha256").update(env.SETUP_TOKEN).digest();
  const actual = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expected, actual);
}

/**
 * Creates the first and only owner. Works once: it requires the SETUP_TOKEN from the
 * server environment and an empty users table, and the database's single-owner index
 * rejects a concurrent second attempt that slips past the count check.
 */
export async function setupOwner(
  input: { setupToken: string; name: string; email: string; password: string },
  meta: ClientMeta,
): Promise<AuthResult> {
  if (!env.SETUP_TOKEN) {
    throw AppError.forbidden("Owner setup is disabled on this server", "SETUP_DISABLED");
  }
  if ((await prisma.user.count()) > 0) {
    throw AppError.conflict("StockPilot has already been set up", "SETUP_ALREADY_COMPLETED");
  }
  if (!setupTokenMatches(input.setupToken)) {
    throw AppError.forbidden("The setup token is incorrect", "INVALID_SETUP_TOKEN");
  }

  const passwordHash = await hashPassword(input.password);
  let user: User;
  try {
    user = await prisma.$transaction(async (tx) => {
      if ((await tx.user.count()) > 0) {
        throw AppError.conflict("StockPilot has already been set up", "SETUP_ALREADY_COMPLETED");
      }
      return tx.user.create({
        data: { name: input.name, email: input.email, passwordHash, role: "OWNER", lastLoginAt: new Date() },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw AppError.conflict("StockPilot has already been set up", "SETUP_ALREADY_COMPLETED");
    }
    throw error;
  }

  return { user, ...(await createSession(user.id, meta)) };
}

export async function login(
  input: { email: string; password: string },
  meta: ClientMeta,
  previousSessionId?: string,
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const passwordOk = await verifyPassword(input.password, user?.passwordHash);

  if (!user || !passwordOk) {
    throw AppError.unauthorized("Incorrect email or password", "INVALID_CREDENTIALS");
  }
  // Only revealed to someone who knows the password.
  if (!user.isActive) {
    throw AppError.forbidden("This account has been deactivated. Ask the owner to reactivate it.", "ACCOUNT_DISABLED");
  }

  // A fresh session on every sign-in prevents session fixation.
  if (previousSessionId) await revokeSession(previousSessionId, "NEW_LOGIN");
  await pruneUserSessions(user.id);

  const issued = await createSession(user.id, meta);
  const updated = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { user: updated, ...issued };
}

/** Changes the password, signs out every session (including this one) and issues a new one. */
export async function changePassword(
  user: User,
  input: { currentPassword: string; newPassword: string },
  meta: ClientMeta,
): Promise<AuthResult> {
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw AppError.badRequest("Current password is incorrect", [
      { path: ["currentPassword"], message: "Current password is incorrect" },
    ]);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(input.newPassword),
      mustChangePassword: false,
      passwordChangedAt: new Date(),
    },
  });
  await revokeUserSessions(user.id, "PASSWORD_CHANGED");

  return { user: updated, ...(await createSession(user.id, meta)) };
}
