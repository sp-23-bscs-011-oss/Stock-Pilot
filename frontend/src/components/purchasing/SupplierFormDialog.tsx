import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { z } from "zod";
import { queryKeys } from "../../lib/queryKeys";
import { fieldErrorsFromApi, focusFirstInvalid, formErrorMessage } from "../../lib/validation";
import { supplierService } from "../../services/purchasingService";
import type { Supplier, SupplierInput } from "../../types/purchasing";
import { Alert } from "../Alert";
import { Dialog } from "../Dialog";
import { Field } from "../Field";
import { Spinner } from "../Spinner";
import { TextField } from "../TextField";

// Mirrors backend/src/validators/purchasing.schemas.ts; the API re-validates everything.
const optional = (max: number, label: string) => z.string().trim().max(max, `${label} must be at most ${max} characters`);

const supplierFormSchema = z
  .object({
    name: z.string().trim().min(2, "Enter the supplier's name (at least 2 characters)").max(120, "Name must be at most 120 characters"),
    contactName: optional(100, "Contact name"),
    email: z
      .string()
      .trim()
      .max(254, "Email is too long")
      .refine((value) => value === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), "Enter a valid email address"),
    phone: z.string().trim().regex(/^$|^[+0-9(][0-9 ()./x-]{3,39}$/i, "Use digits, spaces and + ( ) - ."),
    address: optional(500, "Address"),
    paymentTerms: optional(120, "Payment terms"),
    notes: optional(2000, "Notes"),
  })
  .transform(
    (values): SupplierInput => ({
      name: values.name,
      contactName: values.contactName || null,
      email: values.email || null,
      phone: values.phone || null,
      address: values.address || null,
      paymentTerms: values.paymentTerms || null,
      notes: values.notes || null,
    }),
  );

type FormValues = z.input<typeof supplierFormSchema>;
type FormField = keyof FormValues;
type FormErrors = Partial<Record<FormField, string>>;

function toForm(supplier: Supplier | null): FormValues {
  return {
    name: supplier?.name ?? "",
    contactName: supplier?.contactName ?? "",
    email: supplier?.email ?? "",
    phone: supplier?.phone ?? "",
    address: supplier?.address ?? "",
    paymentTerms: supplier?.paymentTerms ?? "",
    notes: supplier?.notes ?? "",
  };
}

function validate(values: FormValues): { ok: true; data: SupplierInput } | { ok: false; errors: FormErrors } {
  const result = supplierFormSchema.safeParse(values);
  if (result.success) return { ok: true, data: result.data };
  const errors: FormErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as FormField | undefined;
    if (field && !errors[field]) errors[field] = issue.message;
  }
  return { ok: false, errors };
}

interface SupplierFormDialogProps {
  open: boolean;
  /** The supplier to edit; omit to add a new one. */
  supplier?: Supplier | null;
  onClose: () => void;
  onSaved: (supplier: Supplier, mode: "created" | "updated") => void;
}

export function SupplierFormDialog({ open, supplier, onClose, onSaved }: SupplierFormDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={supplier ? "Edit supplier" : "New supplier"}
      description={supplier ? supplier.name : "Add a vendor you buy stock from."}
    >
      <SupplierForm supplier={supplier ?? null} onBusyChange={setBusy} onCancel={onClose} onSaved={onSaved} />
    </Dialog>
  );
}

function SupplierForm({
  supplier,
  onBusyChange,
  onCancel,
  onSaved,
}: {
  supplier: Supplier | null;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onSaved: SupplierFormDialogProps["onSaved"];
}) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<FormValues>(() => toForm(supplier));
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: (input: SupplierInput) => (supplier ? supplierService.update(supplier.id, input) : supplierService.create(input)),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      // Order lists show supplier names.
      void queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
      onSaved(saved, supplier ? "updated" : "created");
    },
    onError: (error) => {
      setErrors(fieldErrorsFromApi(error) as FormErrors);
      focusFirstInvalid(formRef.current);
    },
  });

  function update(field: FormField, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    if (submitted) {
      const result = validate(next);
      setErrors(result.ok ? {} : result.errors);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const result = validate(values);
    if (!result.ok) {
      setErrors(result.errors);
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors({});
    mutation.mutate(result.data);
  }

  const pending = mutation.isPending;
  const text = (field: FormField) => ({
    name: field,
    value: values[field],
    onChange: (event: { target: { value: string } }) => update(field, event.target.value),
    error: errors[field],
    disabled: pending,
  });
  const textarea = (field: FormField, label: string, rows: number) => (
    <Field label={label} error={errors[field]}>
      {(control) => (
        <textarea {...control} rows={rows} value={values[field]} onChange={(event) => update(field, event.target.value)} disabled={pending} />
      )}
    </Field>
  );

  const formError = formErrorMessage(mutation.error);

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={pending}>
      <div className="dialog__content">
        {formError && <Alert tone="error">{formError}</Alert>}

        <fieldset className="form-section">
          <legend>Company</legend>
          <div className="form-grid">
            <TextField label="Supplier name" autoFocus autoComplete="organization" {...text("name")} />
            <TextField
              label="Payment terms (optional)"
              autoComplete="off"
              placeholder="e.g. Net 30"
              hint="Shown on every purchase order for this supplier."
              {...text("paymentTerms")}
            />
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Contact</legend>
          <div className="form-grid">
            <TextField label="Contact person (optional)" autoComplete="off" {...text("contactName")} />
            <TextField label="Phone (optional)" type="tel" autoComplete="off" {...text("phone")} />
            <TextField label="Email (optional)" type="email" autoComplete="off" spellCheck={false} {...text("email")} />
          </div>
          {textarea("address", "Address (optional)", 2)}
        </fieldset>

        {textarea("notes", "Notes (optional)", 3)}
      </div>

      <footer className="dialog__footer">
        <button type="button" className="button button--ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={pending}>
          {pending && <Spinner size={14} label="Saving" />}
          {pending ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
        </button>
      </footer>
    </form>
  );
}
