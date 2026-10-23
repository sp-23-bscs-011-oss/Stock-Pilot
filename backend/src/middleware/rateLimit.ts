import { ipKeyGenerator, rateLimit, type Options } from "express-rate-limit";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

const retryHint = `Try again in ${env.LOGIN_RATE_LIMIT_WINDOW_MINUTES} minutes.`;

function limiter(limit: number, message: string, options: Partial<Options> = {}) {
  return rateLimit({
    windowMs: env.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, _res, next) => next(AppError.tooManyRequests(`${message} ${retryHint}`, "TOO_MANY_ATTEMPTS")),
    ...options,
  });
}

/**
 * Two limiters guard sign-in: failed attempts per (IP, email) stop guessing one account's
 * password, and a looser per-IP cap stops spraying many accounts. Successful sign-ins don't count.
 * Created per app instance so each test app starts with a clean slate.
 */
export function createLoginRateLimiters() {
  const perIp = limiter(env.LOGIN_RATE_LIMIT_MAX * 5, "Too many failed sign-in attempts.", {
    skipSuccessfulRequests: true,
  });

  const perAccount = limiter(env.LOGIN_RATE_LIMIT_MAX, "Too many failed sign-in attempts for this account.", {
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const body: unknown = req.body;
      const email =
        typeof body === "object" && body !== null && "email" in body && typeof body.email === "string"
          ? body.email.trim().toLowerCase().slice(0, 254)
          : "";
      return `${ipKeyGenerator(req.ip ?? "")}|${email}`;
    },
  });

  return [perIp, perAccount];
}

/**
 * The setup token is a long random secret, but there's no reason to allow guessing it quickly.
 * Only rejected tokens (403) count; validation errors and "already set up" responses don't.
 */
export function createSetupRateLimiter() {
  return limiter(env.LOGIN_RATE_LIMIT_MAX, "Too many setup attempts.", {
    skipSuccessfulRequests: true,
    requestWasSuccessful: (_req, res) => res.statusCode !== 403,
  });
}
