import type { CookieOptions, Request, Response } from "express";
import { env } from "../config/env.js";

// The __Host- prefix makes browsers refuse the cookie unless it is Secure, host-only and Path=/,
// which blocks subdomains from planting or overwriting it. Plain HTTP (local dev) can't use it.
export const SESSION_COOKIE_NAME = env.COOKIE_SECURE ? "__Host-sp_session" : "sp_session";

const baseOptions: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: env.COOKIE_SAMESITE,
  path: "/",
};

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE_NAME, token, { ...baseOptions, expires: expiresAt });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, baseOptions);
}

export function readSessionCookie(req: Request): string | undefined {
  const value: unknown = req.cookies?.[SESSION_COOKIE_NAME];
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : undefined;
}
