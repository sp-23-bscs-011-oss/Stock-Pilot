import { createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import type { Session, User } from "../generated/prisma/client.js";

export type SessionRevokedReason =
  | "LOGOUT"
  | "LOGOUT_ALL"
  | "NEW_LOGIN"
  | "PASSWORD_CHANGED"
  | "PASSWORD_RESET"
  | "ACCOUNT_DEACTIVATED"
  | "EXPIRED"
  | "IDLE_TIMEOUT";

export interface ClientMeta {
  ipAddress?: string;
  userAgent?: string;
}

export interface IssuedSession {
  /** Raw token for the cookie. Only its hash is persisted. */
  token: string;
  session: Session;
}

// Avoid a database write on every request; idle-timeout precision of a minute is plenty.
const TOUCH_INTERVAL_MS = 60_000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, meta: ClientMeta): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      csrfToken: randomBytes(32).toString("hex"),
      ipAddress: meta.ipAddress?.slice(0, 45),
      userAgent: meta.userAgent?.slice(0, 512),
      expiresAt: new Date(Date.now() + env.SESSION_TTL_HOURS * 3_600_000),
    },
  });
  return { token, session };
}

/** Resolves a cookie token to a live session, revoking it if it has expired. */
export async function findActiveSession(token: string): Promise<{ session: Session; user: User } | null> {
  const record = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!record || record.revokedAt) return null;

  const { user, ...session } = record;
  const now = Date.now();

  if (session.expiresAt.getTime() <= now) {
    await revokeSession(session.id, "EXPIRED");
    return null;
  }
  if (session.lastSeenAt.getTime() + env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000 <= now) {
    await revokeSession(session.id, "IDLE_TIMEOUT");
    return null;
  }
  // Deactivation revokes sessions too; this check covers anything that slipped past.
  if (!user.isActive) return null;

  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    session.lastSeenAt = new Date(now);
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: session.lastSeenAt } });
  }

  return { session, user };
}

export async function revokeSession(sessionId: string, reason: SessionRevokedReason): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
}

export async function revokeUserSessions(userId: string, reason: SessionRevokedReason): Promise<number> {
  const { count } = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  });
  return count;
}

/** Drops a user's dead sessions so the table doesn't grow without bound. */
export async function pruneUserSessions(userId: string): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 24 * 3_600_000);
  await prisma.session.deleteMany({
    where: { userId, OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] },
  });
}
