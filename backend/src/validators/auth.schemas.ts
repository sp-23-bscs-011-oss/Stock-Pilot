import { z } from "zod";
import { currentPasswordSchema, emailSchema, nameSchema, newPasswordSchema } from "./common.js";

export const loginSchema = z.object({
  email: emailSchema,
  password: currentPasswordSchema,
});

export const setupOwnerSchema = z.object({
  setupToken: z.string({ error: "Setup token is required" }).min(1, "Setup token is required").max(512),
  name: nameSchema,
  email: emailSchema,
  password: newPasswordSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: currentPasswordSchema,
    newPassword: newPasswordSchema,
  })
  .refine((body) => body.currentPassword !== body.newPassword, {
    path: ["newPassword"],
    message: "New password must be different from the current one",
  });
