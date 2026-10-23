import { z } from "zod";
import { emailSchema, nameSchema, newPasswordSchema } from "./common.js";

// OWNER is deliberately absent: the API can never create or promote anyone to owner.
export const staffRoleSchema = z.enum(["MANAGER", "CASHIER"], { error: "Role must be MANAGER or CASHIER" });

export const listUsersQuerySchema = z.object({
  status: z.enum(["active", "inactive", "all"]).default("all"),
  role: z.enum(["OWNER", "MANAGER", "CASHIER"]).optional(),
});

export const createStaffSchema = z.object({
  name: nameSchema,
  email: emailSchema,
  role: staffRoleSchema,
  /** Temporary password; the staff member must change it at first sign-in. */
  password: newPasswordSchema,
});

export const updateStaffSchema = z
  .object({
    name: nameSchema.optional(),
    role: staffRoleSchema.optional(),
  })
  .strict()
  .refine((body) => body.name !== undefined || body.role !== undefined, "Provide name or role to update");

export const resetPasswordSchema = z.object({
  password: newPasswordSchema,
});
