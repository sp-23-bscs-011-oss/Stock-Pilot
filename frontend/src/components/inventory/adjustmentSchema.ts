import { z } from "zod";
import type { AdjustmentReason, AdjustStockInput } from "../../types/inventory";
import { reasonsByAction, type AdjustmentAction } from "./inventoryLabels";

const MAX_QUANTITY = 10_000_000;

export interface AdjustmentFormValues {
  action: AdjustmentAction;
  quantity: string;
  reason: AdjustmentReason;
  note: string;
}

/**
 * Client-side checks for quick feedback. The API repeats every one of them (and checks
 * stock under a row lock), so these are a convenience, not the safeguard.
 */
export function adjustmentFormSchema(onHand: number) {
  return z
    .object({
      action: z.enum(["add", "remove", "set"]),
      quantity: z
        .string()
        .trim()
        .min(1, "Enter a quantity")
        .regex(/^\d+$/, "Enter a whole number")
        .refine((value) => Number(value) <= MAX_QUANTITY, "That quantity is too large"),
      reason: z.string(),
      note: z.string().trim().max(500, "Note must be at most 500 characters"),
    })
    .superRefine((values, ctx) => {
      const quantity = Number(values.quantity);
      const issue = (path: keyof AdjustmentFormValues, message: string) =>
        ctx.addIssue({ code: "custom", path: [path], message });

      if (values.action !== "set" && quantity === 0) issue("quantity", "Enter at least 1");
      if (values.action === "remove" && quantity > onHand) {
        issue("quantity", `Only ${onHand} on hand`);
      }
      if (values.action === "set" && quantity === onHand) issue("quantity", `On hand is already ${onHand}`);
      if (!(reasonsByAction[values.action] as string[]).includes(values.reason)) issue("reason", "Choose a reason");
      if (values.reason === "OTHER" && !values.note.trim()) issue("note", "Describe what happened");
    });
}

export type AdjustmentFormErrors = Partial<Record<keyof AdjustmentFormValues, string>>;

export function validateAdjustment(
  values: AdjustmentFormValues,
  onHand: number,
): { ok: true } | { ok: false; errors: AdjustmentFormErrors } {
  const result = adjustmentFormSchema(onHand).safeParse(values);
  if (result.success) return { ok: true };
  const errors: AdjustmentFormErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof AdjustmentFormValues | undefined;
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}

/** Converts valid form values into the API payload. */
export function toAdjustmentInput(
  values: AdjustmentFormValues,
  context: { storeId: string; productId: string; onHand: number },
): AdjustStockInput {
  const quantity = Number(values.quantity);
  return {
    storeId: context.storeId,
    productId: context.productId,
    mode: values.action === "set" ? "set" : "change",
    quantity: values.action === "remove" ? -quantity : quantity,
    reason: values.reason,
    note: values.note.trim() || null,
    // Lets the server refuse if stock moved after this form was opened.
    expectedQuantity: context.onHand,
  };
}

/** The on-hand quantity the form would produce, or null if the quantity isn't a number yet. */
export function projectedQuantity(values: AdjustmentFormValues, onHand: number): number | null {
  if (!/^\d+$/.test(values.quantity.trim())) return null;
  const quantity = Number(values.quantity);
  if (values.action === "set") return quantity;
  return values.action === "add" ? onHand + quantity : onHand - quantity;
}
