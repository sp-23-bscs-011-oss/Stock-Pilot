import { z } from "zod";

export const listAuditLogsQuerySchema = z
  .object({
    entityType: z.enum(["supplier", "purchase_order"]).optional(),
    entityId: z.uuid().optional(),
    action: z
      .string()
      .trim()
      .regex(/^[a-z_]+\.[a-z_]+$/, "Use an action name such as purchase_order.received")
      .optional(),
    actorId: z.uuid().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    path: ["to"],
    message: "The end date must be after the start date",
  });

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
