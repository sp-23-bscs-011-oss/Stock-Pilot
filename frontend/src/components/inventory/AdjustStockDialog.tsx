import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { queryKeys } from "../../lib/queryKeys";
import { fieldErrorsFromApi, focusFirstInvalid, formErrorMessage } from "../../lib/validation";
import { ApiError } from "../../services/apiError";
import { inventoryService } from "../../services/inventoryService";
import type { AdjustStockResult, InventoryItem, Store } from "../../types/inventory";
import { Alert } from "../Alert";
import { Dialog } from "../Dialog";
import { Field } from "../Field";
import { Spinner } from "../Spinner";
import { TextField } from "../TextField";
import {
  projectedQuantity,
  toAdjustmentInput,
  validateAdjustment,
  type AdjustmentFormErrors,
  type AdjustmentFormValues,
} from "./adjustmentSchema";
import { formatQuantityChange, reasonLabels, reasonsByAction, type AdjustmentAction } from "./inventoryLabels";

interface AdjustStockDialogProps {
  item: InventoryItem | null;
  store: Store;
  onClose: () => void;
  onAdjusted: (result: AdjustStockResult) => void;
}

export function AdjustStockDialog({ item, store, onClose, onAdjusted }: AdjustStockDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={item !== null}
      onClose={onClose}
      busy={busy}
      title="Adjust stock"
      description={item ? `${item.name} · ${item.sku} · ${store.name}` : undefined}
    >
      {item && <AdjustStockForm item={item} store={store} onBusyChange={setBusy} onCancel={onClose} onAdjusted={onAdjusted} />}
    </Dialog>
  );
}

const ACTIONS: { value: AdjustmentAction; label: string }[] = [
  { value: "add", label: "Add stock" },
  { value: "remove", label: "Remove stock" },
  { value: "set", label: "Set counted quantity" },
];

const DEFAULT_REASON = { add: "RECEIVED", remove: "DAMAGED", set: "STOCK_COUNT" } as const;

interface AdjustStockFormProps {
  item: InventoryItem;
  store: Store;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onAdjusted: (result: AdjustStockResult) => void;
}

function AdjustStockForm({ item, store, onBusyChange, onCancel, onAdjusted }: AdjustStockFormProps) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  // The quantity this form's decisions are based on. Updated if the server reports a change.
  const [onHand, setOnHand] = useState(item.quantity);
  const [staleNotice, setStaleNotice] = useState<string | null>(null);
  const [values, setValues] = useState<AdjustmentFormValues>({ action: "add", quantity: "", reason: "RECEIVED", note: "" });
  const [errors, setErrors] = useState<AdjustmentFormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: () => inventoryService.adjust(toAdjustmentInput(values, { storeId: store.id, productId: item.productId, onHand })),
    onMutate: () => {
      onBusyChange(true);
      setStaleNotice(null);
    },
    onSettled: () => onBusyChange(false),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
      onAdjusted(result);
    },
    onError: (error) => {
      // Someone else changed this stock meanwhile: show the real number and let the user decide again.
      if (error instanceof ApiError && (error.code === "STOCK_CHANGED" || error.code === "INSUFFICIENT_STOCK")) {
        const current = (error.details as { currentQuantity?: number } | undefined)?.currentQuantity;
        if (typeof current === "number") {
          setOnHand(current);
          setStaleNotice(`Stock changed to ${current} while this form was open. Check the numbers below and submit again.`);
          void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
          return;
        }
      }
      setErrors(fieldErrorsFromApi(error) as AdjustmentFormErrors);
      focusFirstInvalid(formRef.current);
    },
  });

  function update(next: AdjustmentFormValues) {
    setValues(next);
    if (submitted) {
      const result = validateAdjustment(next, onHand);
      setErrors(result.ok ? {} : result.errors);
    }
  }

  function chooseAction(action: AdjustmentAction) {
    const reason = reasonsByAction[action].includes(values.reason) ? values.reason : DEFAULT_REASON[action];
    update({ ...values, action, reason });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const result = validateAdjustment(values, onHand);
    if (!result.ok) {
      setErrors(result.errors);
      focusFirstInvalid(formRef.current);
      return;
    }
    setErrors({});
    mutation.mutate();
  }

  const pending = mutation.isPending;
  const projected = projectedQuantity(values, onHand);
  const change = projected === null ? null : projected - onHand;
  const formError = staleNotice ? null : formErrorMessage(mutation.error);

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={pending}>
      <div className="dialog__content">
        {staleNotice && <Alert tone="warn">{staleNotice}</Alert>}
        {formError && <Alert tone="error">{formError}</Alert>}

        <div className="stock-preview" aria-live="polite">
          <div>
            <span className="stock-preview__label">On hand</span>
            <span className="stock-preview__value">{onHand}</span>
          </div>
          <span className="stock-preview__arrow" aria-hidden="true">
            →
          </span>
          <div>
            <span className="stock-preview__label">After</span>
            <span className={`stock-preview__value${projected !== null && projected < 0 ? " text-danger" : ""}`}>
              {projected ?? "–"}
            </span>
          </div>
          {change !== null && change !== 0 && (
            <span className={`stock-change ${change > 0 ? "stock-change--up" : "stock-change--down"}`}>
              {formatQuantityChange(change)}
            </span>
          )}
        </div>

        <fieldset className="segmented" disabled={pending}>
          <legend className="visually-hidden">Adjustment type</legend>
          {ACTIONS.map((action) => (
            <label key={action.value} className="segmented__option">
              <input
                type="radio"
                name="action"
                value={action.value}
                checked={values.action === action.value}
                onChange={() => chooseAction(action.value)}
              />
              <span>{action.label}</span>
            </label>
          ))}
        </fieldset>

        <div className="form-grid">
          <TextField
            label={values.action === "set" ? "Counted quantity" : values.action === "add" ? "Quantity to add" : "Quantity to remove"}
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={values.quantity}
            onChange={(event) => update({ ...values, quantity: event.target.value })}
            error={errors.quantity}
            disabled={pending}
          />
          <Field label="Reason" error={errors.reason}>
            {(control) => (
              <select
                {...control}
                value={values.reason}
                onChange={(event) => update({ ...values, reason: event.target.value as AdjustmentFormValues["reason"] })}
                disabled={pending}
              >
                {reasonsByAction[values.action].map((reason) => (
                  <option key={reason} value={reason}>
                    {reasonLabels[reason]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>

        <Field
          label={values.reason === "OTHER" ? "Note" : "Note (optional)"}
          error={errors.note}
          hint="Saved in the movement history, e.g. a delivery number or what was damaged."
        >
          {(control) => (
            <textarea
              {...control}
              rows={2}
              value={values.note}
              onChange={(event) => update({ ...values, note: event.target.value })}
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
          {pending ? "Saving…" : "Save adjustment"}
        </button>
      </footer>
    </form>
  );
}
