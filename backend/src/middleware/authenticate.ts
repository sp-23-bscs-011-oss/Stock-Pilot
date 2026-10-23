import type { Request, RequestHandler } from "express";
import { clearSessionCookie, readSessionCookie } from "../lib/sessionCookie.js";
import { findActiveSession } from "../services/session.service.js";
import { AppError } from "../utils/AppError.js";
import type { Role } from "../generated/prisma/client.js";

/** Rejects requests without a valid, unexpired session and attaches `req.auth`. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = readSessionCookie(req);
  if (!token) {
    throw AppError.unauthorized();
  }

  const active = await findActiveSession(token);
  if (!active) {
    clearSessionCookie(res);
    throw AppError.unauthorized("Your session has ended. Please sign in again.", "SESSION_EXPIRED");
  }

  req.auth = active;
  next();
};

/** Narrows `req.auth` in handlers mounted behind `requireAuth`. */
export function getAuth(req: Request) {
  if (!req.auth) throw new Error("getAuth() called on a route without requireAuth");
  return req.auth;
}

/**
 * Accounts created by the owner start with a temporary password. Until it's changed,
 * they may only use the auth endpoints (profile, change password, logout).
 */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  if (getAuth(req).user.mustChangePassword) {
    throw AppError.forbidden("You must change your temporary password before continuing", "PASSWORD_CHANGE_REQUIRED");
  }
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!roles.includes(getAuth(req).user.role)) {
      throw AppError.forbidden();
    }
    next();
  };
}
