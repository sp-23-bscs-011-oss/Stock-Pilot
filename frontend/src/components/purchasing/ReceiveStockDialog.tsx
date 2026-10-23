import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { formatMoney } from "../../lib/format";
import { fromCents, multiplyCents, toCents } from "../../lib/money";
import { queryKeys } from "../../lib/queryKeys";
import { formErrorMessage } from "../../lib/validation";
import { ApiError } from "../../services/apiError";
import { purchaseOrderService } from "../../services/purchasingService";
import type { PurchaseOrderDetail, ReceiveResult } from "../../types/purchasing";
import { Alert } from "../Alert";
import { Dialog } from "../Dialog";
import { Field } from "../Field";
import { Spinner } from "../Spinner";

interface ReceiveStockDialogProps {
  order: PurchaseOrderDetail | null;
  onClose: () => void;
  onReceived: (result: ReceiveResult) => void;
}

export function ReceiveStockDialog({ order, onClose, onReceived }: ReceiveStockDialogProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={order !== null}
      onClose={onClose}
      busy={busy}
      size="lg"
      title={order ? `Receive stock · ${order.number}` : "Receive stock"}
      description={order ? `Into ${order.store.name}. Enter what actually arrived; anything not delivered stays outstanding.` : undefined}
    >
      {order && <ReceiveForm order={order} onBusyChange={setBusy} onCancel={onClose} onReceived={onReceived} />}
    </Dialog>
  );
}

function ReceiveForm({
  order,
  onBusyChange,
  onCancel,
  onReceived,
}: {
  order: PurchaseOrderDetail;
  onBusyChange: (busy: boolean) => void;
  onCancel: () => void;
  onReceived: ReceiveStockDialogProps["onReceived"];
}) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const openLines = order.lines.filter((line) => line.quantityOutstanding > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(openLines.map((line) => [line.id, ""])),
  );
  const [note, setNote] = useState("");
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  // One key per receiving attempt, created when the dialog opens. A retry after a timeout or a
  // double click sends the same key, so the server books the delivery at most once.
  const idempotencyKey = useRef(crypto.randomUUID());

  const mutation = useMutation({
    mutationFn: () =>
      purchaseOrderService.receive(order.id, {
        idempotencyKey: idempotencyKey.current,
        note: note.trim() || null,
        lines: openLines.map((line) => ({ lineId: line.id, quantity: Number(quantities[line.id] || 0) })),
      }),
    onMutate: () => onBusyChange(true),
    onSettled: () => onBusyChange(false),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.purchaseOrders.detail(order.id), result.order);
      void queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all });
      onReceived(result);
    },
    onError: (error) => {
      // A definite rejection (validation, over-receipt) means nothing was booked, so the next
      // attempt is a new request. Network failures keep the key: the first try may have landed.
      if (error instanceof ApiError && error.status !== null && error.status < 500) {
        idempotencyKey.current = crypto.randomUUID();
      }
      const errors: Record<string, string> = {};
      if (error instanceof ApiError && Array.isArray(error.details)) {
        for (const issue of error.details as { path?: unknown[]; message?: string }[]) {
          const [first, index] = issue.path ?? [];
          const line = first === "lines" && typeof index === "number" ? openLines[index] : undefined;
          if (line && issue.message) errors[line.id] = issue.message;
        }
      }
      setLineErrors(errors);
      setFormError(Object.keys(errors).length > 0 ? "Some quantities can't be received. See the highlighted lines." : formErrorMessage(error));
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    let any = false;
    for (const line of openLines) {
      const raw = (quantities[line.id] ?? "").trim();
      if (raw === "") continue;
      if (!/^\d+$/.test(raw)) errors[line.id] = "Enter a whole number";
      else if (Number(raw) > line.quantityOutstanding) errors[line.id] = `Only ${line.quantityOutstanding} outstanding`;
      else if (Number(raw) > 0) any = true;
    }
    setLineErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError("Some quantities can't be received. See the highlighted lines.");
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
      return;
    }
    if (!any) {
      setFormError("Enter the quantity received for at least one product.");
      return;
    }
    setFormError(null);
    mutation.mutate();
  }

  const pending = mutation.isPending;
  const receivingValue = openLines.reduce((sum, line) => {
    const quantity = Number(quantities[line.id] || 0);
    const cents = toCents(line.unitCost);
    return Number.isInteger(quantity) && quantity > 0 && cents !== null ? sum + multiplyCents(cents, quantity) : sum;
  }, 0n);
  const receivingUnits = openLines.reduce((sum, line) => {
    const quantity = Number(quantities[line.id] || 0);
    return Number.isInteger(quantity) && quantity > 0 ? sum + quantity : sum;
  }, 0);

  return (
    <form ref={formRef} onSubmit={handleSubmit} noValidate aria-busy={pending}>
      <div className="dialog__content">
        {formError && <Alert tone="error">{formError}</Alert>}

        <div className="receive-toolbar">
          <span className="cell-secondary">
            {openLines.length} product{openLines.length === 1 ? "" : "s"} outstanding
          </span>
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => {
              setQuantities(Object.fromEntries(openLines.map((line) => [line.id, String(line.quantityOutstanding)])));
              setLineErrors({});
            }}
            disabled={pending}
          >
            Fill all outstanding
          </button>
        </div>

        <div className="table-wrap table-wrap--flat">
          <table className="data-table data-table--responsive">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col" className="align-end">
                  Ordered
                </th>
                <th scope="col" className="align-end">
                  Already received
                </th>
                <th scope="col" className="align-end">
                  Receiving now
                </th>
              </tr>
            </thead>
            <tbody>
              {openLines.map((line) => (
                <tr key={line.id}>
                  <td data-label="Product" className="data-table__primary">
                    <div className="cell-primary">{line.productName}</div>
                    <div className="cell-secondary mono">{line.sku}</div>
                  </td>
                  <td data-label="Ordered" className="align-end">
                    {line.quantityOrdered}
                  </td>
                  <td data-label="Already received" className="align-end">
                    {line.quantityReceived}
                  </td>
                  <td data-label="Receiving now" className="align-end">
                    <input
                      className="line-input"
                      inputMode="numeric"
                      placeholder="0"
                      aria-label={`Quantity of ${line.productName} received, up to ${line.quantityOutstanding}`}
                      aria-invalid={lineErrors[line.id] ? true : undefined}
                      value={quantities[line.id] ?? ""}
                      onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
                      disabled={pending}
                    />
                    <div className="cell-secondary">of {line.quantityOutstanding} due</div>
                    {lineErrors[line.id] && <p className="form__error">{lineErrors[line.id]}</p>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Field label="Delivery note (optional)" hint="E.g. the supplier's delivery note number, or what was missing.">
          {(control) => (
            <input {...control} value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} disabled={pending} />
          )}
        </Field>
      </div>

      <footer className="dialog__footer">
        <span className="dialog__footer-summary">
          {receivingUnits > 0 ? `${receivingUnits.toLocaleString()} units · ${formatMoney(fromCents(receivingValue))}` : ""}
        </span>
        <button type="button" className="button button--ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </button>
        <button type="submit" className="button" disabled={pending}>
          {pending && <Spinner size={14} label="Receiving" />}
          {pending ? "Receiving…" : "Receive into stock"}
        </button>
      </footer>
    </form>
  );
}
