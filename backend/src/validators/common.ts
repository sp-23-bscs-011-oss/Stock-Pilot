import { z } from "zod";

// bcrypt silently ignores everything after 72 bytes, so longer passwords are rejected outright.
const BCRYPT_MAX_BYTES = 72;

export const emailSchema = z
  .string({ error: "Email is required" })
  .trim()
  .toLowerCase()
  .max(254, "Email is too long")
  .pipe(z.email("Enter a valid email address"));

export const nameSchema = z
  .string({ error: "Name is required" })
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(100, "Name must be at most 100 characters");

export const newPasswordSchema = z
  .string({ error: "Password is required" })
  .min(10, "Password must be at least 10 characters")
  .refine((value) => Buffer.byteLength(value, "utf8") <= BCRYPT_MAX_BYTES, "Password must be at most 72 bytes")
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), "Password must contain a letter and a number");

/** For checking an existing password: no policy, just a sane bound. */
export const currentPasswordSchema = z
  .string({ error: "Password is required" })
  .min(1, "Password is required")
  .max(256, "Password is too long");

export const uuidParamSchema = z.object({ id: z.uuid() });
