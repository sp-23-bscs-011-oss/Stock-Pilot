import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  CORS_ORIGIN: z
    .string()
    .min(1, "CORS_ORIGIN must list at least one origin")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    ),
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .refine((value) => /^postgres(ql)?:\/\//.test(value), "DATABASE_URL must be a postgresql:// connection string"),

  // Authentication
  /** One-time secret required to create the first owner. Leave empty to disable the setup endpoint. */
  SETUP_TOKEN: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined)
    .refine((value) => value === undefined || value.length >= 32, "SETUP_TOKEN must be at least 32 characters"),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  /** Absolute session lifetime, regardless of activity. */
  SESSION_TTL_HOURS: z.coerce.number().positive().max(24 * 30).default(12),
  /** Sessions unused for this long are rejected. */
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(120),
  /** Defaults to true in production. Must be true when COOKIE_SAMESITE=none. */
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  COOKIE_SAMESITE: z.enum(["strict", "lax", "none"]).default("strict"),
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // The logger depends on env, so report configuration problems directly and stop.
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

const cookieSecure = parsed.data.COOKIE_SECURE ?? parsed.data.NODE_ENV === "production";

if (parsed.data.COOKIE_SAMESITE === "none" && !cookieSecure) {
  console.error("Invalid environment configuration:\n  - COOKIE_SAMESITE=none requires COOKIE_SECURE=true");
  process.exit(1);
}
if (parsed.data.NODE_ENV === "production" && parsed.data.BCRYPT_ROUNDS < 10) {
  console.error("Invalid environment configuration:\n  - BCRYPT_ROUNDS must be at least 10 in production");
  process.exit(1);
}

export const env = { ...parsed.data, COOKIE_SECURE: cookieSecure };
export const isProduction = env.NODE_ENV === "production";
