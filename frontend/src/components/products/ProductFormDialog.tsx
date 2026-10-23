import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { formatMoney, marginPercent } from "../../lib/format";
import { queryKeys } from "../../lib/queryKeys";
import { fieldErrorsFromApi, focusFirstInvalid, formErrorMessage } from "../../lib/validation";
import { productService } from "../../services/catalogService";
import type { Category, Product, ProductInput } from "../../types/catalog";
import { Alert } from "../Alert";
import { Dialog } from "../Dialog";
import { Field } from "../Field";
import { Spinner } from "../Spinner";
import { TextField } from "../TextField";
import {
  emptyProductForm,
  productToForm,
  validateProductForm,
  type ProductFormErrors,
  type ProductFormField,
  type ProductFormValues,
} from "./productFormSchema";

interface ProductFormDialogProps {
  open: boolean;
  /** The product to edit; omit to create a new one. */
  product?: Product | null;
  categories: Category[];
  onClose: () => void;
  onSaved: (product: Product, mode: "created" | "updated") => void;
}

export function ProductFormDialog({ open, product, categories, onClose, onSaved }: ProductFormDialogProps) {
  const [busy, setBusy] = useState(false);
  const editing = Boolean(product);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={editing ? "Edit product" : "New product"}
      description={editing ? `${product?.name} · ${product?.sku}` : "Add an item to your catalog."}
    >
      <ProductForm
        product={product ?? null}
        categories={categories}
        onBusyChange={setBusy}
        onCancel={onClose}
        onSaved={onSaved}
      />
    </Dialog>
  );
}

interface ProductFormProps {
  product: Product | null;
  categories: Category[];
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onSaved: ProductFormDialogProps["onSaved"];
}

function ProductForm({ product, categories, onBusyChange, onCancel, onSaved }: ProductFormProps) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<ProductFormValues>(() => (product ? productToForm(product) : emptyProductForm()));
  const [errors, setErrors] = useState<ProductFormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: (input: ProductInput) => (product ? productService.update(product.id, input) : productService.create(input)),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.products.all });
      // Category product counts change when products are added or moved.
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
      onSaved(saved, product ? "updated" : "created");
    },
    onError: (error) => {
      setErrors(fieldErrorsFromApi(error) as ProductFormErrors);
      focusFirstInvalid(formRef.current);
    },
  });

  function update(field: ProductFormField, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    if (submitted) {
      const result = validateProductForm(next);
      setErrors(result.ok ? {} : result.errors);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const result = validateProductForm(values);
    if (!result.ok) {
      setErrors(result.errors);
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors({});
    mutation.mutate(result.data);
  }

  const pending = mutation.isPending;
  const formError = formErrorMessage(mutation.error);
  const text = (field: ProductFormField) => ({
    name: field,
    value: values[field],
    onChange: (event: { target: { value: string } }) => update(field, event.target.value),
    error: errors[field],
    disabled: pending,
  });

  const margin = marginPercent(values.costPrice || undefined, values.sellingPrice);
  const priceHint =
    margin === null
      ? undefined
      : margin < 0
        ? `Selling below cost (${margin.toFixed(1)}% margin)`
        : `${margin.toFixed(1)}% margin · ${formatMoney(String(Number(values.sellingPrice) - Number(values.costPrice)))} per unit`;

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={pending}>
      <div className="dialog__content">
        {formError && <Alert tone="error">{formError}</Alert>}

        <fieldset className="form-section">
          <legend>Identification</legend>
          <div className="form-grid">
            <TextField label="Product name" autoFocus autoComplete="off" {...text("name")} />
            <TextField
              label="SKU"
              autoComplete="off"
              spellCheck={false}
              hint="Your internal code. Stored in capitals; never reused."
              className="input--mono"
              {...text("sku")}
            />
            <TextField
              label="Barcode (optional)"
              autoComplete="off"
              spellCheck={false}
              inputMode="numeric"
              hint="EAN/UPC or your own code. Scan it straight into this field."
              className="input--mono"
              {...text("barcode")}
            />
            <Field label="Category" error={errors.categoryId}>
              {(control) => (
                <select
                  {...control}
                  value={values.categoryId}
                  onChange={(event) => update("categoryId", event.target.value)}
                  disabled={pending}
                >
                  <option value="">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Pricing &amp; stock</legend>
          <div className="form-grid form-grid--3">
            <TextField label="Cost price" inputMode="decimal" autoComplete="off" placeholder="0.00" {...text("costPrice")} />
            <TextField
              label="Selling price"
              inputMode="decimal"
              autoComplete="off"
              placeholder="0.00"
              hint={errors.sellingPrice ? undefined : priceHint}
              {...text("sellingPrice")}
            />
            <TextField
              label="Reorder threshold"
              inputMode="numeric"
              autoComplete="off"
              hint="Flag for reorder at or below this stock level."
              {...text("reorderThreshold")}
            />
          </div>
        </fieldset>

        <Field label="Description (optional)" error={errors.description}>
          {(control) => (
            <textarea
              {...control}
              rows={3}
              value={values.description}
              onChange={(event) => update("description", event.target.value)}
              disabled={pending}
            />
          )}
        </Field>
      </div>

      <footer className="dialog__footer">
        <button type="button" className="button button--ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={pending}>
          {pending && <Spinner size={14} label="Saving" />}
          {pending ? "Saving…" : product ? "Save changes" : "Create product"}
        </button>
      </footer>
    </form>
  );
}
