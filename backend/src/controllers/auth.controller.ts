import type { Request, RequestHandler, Response } from "express";
import { getAuth } from "../middleware/authenticate.js";
import { clearSessionCookie, readSessionCookie, setSessionCookie } from "../lib/sessionCookie.js";
import * as authService from "../services/auth.service.js";
import { findActiveSession, revokeSession, revokeUserSessions, type ClientMeta } from "../services/session.service.js";
import { toPublicUser } from "../services/user.service.js";
import { changePasswordSchema, loginSchema, setupOwnerSchema } from "../validators/auth.schemas.js";
import type { Session, User } from "../generated/prisma/client.js";

function clientMeta(req: Request): ClientMeta {
  return { ipAddress: req.ip, userAgent: req.get("user-agent") };
}

// Every response that establishes or describes a session has this shape. The CSRF token
// is returned in the body (not a readable cookie) so it also works when the SPA is
// served from a different origin than the API.
function sessionBody(user: User, session: Session) {
  return {
    user: toPublicUser(user),
    csrfToken: session.csrfToken,
    session: { expiresAt: session.expiresAt },
  };
}

function startSession(res: Response, result: authService.AuthResult, status = 200) {
  setSessionCookie(res, result.token, result.session.expiresAt);
  res.status(status).json(sessionBody(result.user, result.session));
}

export const getSetupStatus: RequestHandler = async (_req, res) => {
  res.json(await authService.getSetupStatus());
};

export const setupOwner: RequestHandler = async (req, res) => {
  const input = setupOwnerSchema.parse(req.body);
  startSession(res, await authService.setupOwner(input, clientMeta(req)), 201);
};

export const login: RequestHandler = async (req, res) => {
  const input = loginSchema.parse(req.body);
  const existingToken = readSessionCookie(req);
  const existing = existingToken ? await findActiveSession(existingToken) : null;
  startSession(res, await authService.login(input, clientMeta(req), existing?.session.id));
};

export const logout: RequestHandler = async (req, res) => {
  await revokeSession(getAuth(req).session.id, "LOGOUT");
  clearSessionCookie(res);
  res.status(204).end();
};

export const logoutAll: RequestHandler = async (req, res) => {
  await revokeUserSessions(getAuth(req).user.id, "LOGOUT_ALL");
  clearSessionCookie(res);
  res.status(204).end();
};

export const me: RequestHandler = (req, res) => {
  const { user, session } = getAuth(req);
  res.set("Cache-Control", "no-store");
  res.json(sessionBody(user, session));
};

export const changePassword: RequestHandler = async (req, res) => {
  const input = changePasswordSchema.parse(req.body);
  startSession(res, await authService.changePassword(getAuth(req).user, input, clientMeta(req)));
};
