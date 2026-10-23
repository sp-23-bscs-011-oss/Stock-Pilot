import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { getAuth } from "./authenticate.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const CSRF_HEADER = "x-csrf-token";

/**
 * First CSRF layer, applied to every state-changing request (including login and setup,
 * which have no session yet): browsers always send Origin on cross-origin writes, so
 * reject any write whose Origin isn't one of ours. Non-browser clients send no Origin.
 */
export const verifyOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.get("origin");
  if (origin !== undefined && !env.CORS_ORIGIN.includes(origin)) {
    throw AppError.forbidden("Cross-origin request rejected", "ORIGIN_NOT_ALLOWED");
  }
  next();
};

/**
 * Second layer for authenticated writes: a synchronizer token bound to the session must be
 * echoed in the X-CSRF-Token header. A forged cross-site request can't read it.
 * Must run after `requireAuth`.
 */
export const requireCsrf: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const provided = req.get(CSRF_HEADER);
  const expected = getAuth(req).session.csrfToken;
  if (
    !provided ||
    provided.length !== expected.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  ) {
    throw AppError.forbidden("Missing or invalid CSRF token. Refresh the page and try again.", "CSRF_TOKEN_INVALID");
  }
  next();
};
