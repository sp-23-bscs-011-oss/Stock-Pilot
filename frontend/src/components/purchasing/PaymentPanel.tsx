import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { useCurrentUser } from "../../auth/authContext";
import { isDefiniteRejection, usePendingSubmission } from "../../hooks/usePendingSubmission";
import { formatDateTime, formatMoney } from "../../lib/format";
import { queryKeys } from "../../lib/queryKeys";
import { formErrorMessage } from "../../lib/validation";
import { purchaseOrderService } from "../../services/purchasingService";
import type { PaymentMethod, PurchaseOrderDetail, PurchasePaymentInput } from "../../types/purchasing";
import { Alert } from "../Alert";
import { Dialog } from "../Dialog";
import { Field } from "../Field";
import { Spinner } from "../Spinner";
import { PaymentStatusBadge } from "./PaymentStatusBadge";
import { formatDay } from "./purchasingLabels";

const methods: Record<PaymentMethod, string> = {
  CASH: "Cash", BANK_TRANSFER: "Bank transfer", CARD: "Card", CHEQUE: "Cheque", OTHER: "Other",
};

const paymentSchema = z.object({
  amount: z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount with at most two decimal places")
    .refine((value) => /[1-9]/.test(value), "Enter an amount greater than zero"),
  paidAt: z.iso.date("Choose the payment date"),
  method: z.enum(["CASH", "BANK_TRANSFER", "CARD", "CHEQUE", "OTHER"]),
  reference: z.string().trim().max(160),
});

const cents = (amount: string) => {
  const [whole = "0", fraction = ""] = amount.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
};

export function PaymentPanel({ order, onNotice }: { order: PurchaseOrderDetail; onNotice: (notice: string) => void }) {
  const user = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  let pendingPayment = false;
  try { pendingPayment = !!sessionStorage.getItem(`stockpilot:pending:${user.id}:payment:${order.id}`); } catch { /* Storage may be disabled. */ }
  const canPay = user.role === "OWNER" && order.status !== "DRAFT" && (order.balanceDue !== "0.00" || pendingPayment);
  return (
    <section className="card card--spaced payment-panel" aria-labelledby="payments-title">
      <div className="payment-panel__heading">
        <h2 id="payments-title" className="section-title">Supplier payments</h2>
        <PaymentStatusBadge status={order.paymentStatus} />
      </div>
      <dl className="payment-summary">
        <div><dt>Payable</dt><dd>{formatMoney(order.payableTotal)}</dd></div>
        <div><dt>Paid</dt><dd>{formatMoney(order.paidTotal)}</dd></div>
        <div><dt>Balance due</dt><dd>{formatMoney(order.balanceDue)}</dd></div>
      </dl>
      {order.status === "DRAFT" && <p className="empty-hint">Submit this order before recording a payment.</p>}
      {order.status === "CANCELLED" && <p className="empty-hint">Only goods received before cancellation remain payable.</p>}
      {user.role !== "OWNER" && <p className="empty-hint">Only the owner can record supplier payments.</p>}
      {canPay && <button className="button button--ghost" type="button" onClick={() => setOpen(true)}>
        {order.balanceDue === "0.00" ? "Check payment confirmation" : "Record payment"}
      </button>}
      {order.payments.length === 0 ? <p className="empty-hint">No payments recorded.</p> : (
        <div className="table-wrap table-wrap--flat">
          <table className="data-table data-table--responsive">
            <thead><tr><th scope="col">Payment date</th><th scope="col">Method / reference</th><th scope="col">Recorded by</th><th scope="col" className="align-end">Amount</th></tr></thead>
            <tbody>{order.payments.map((payment) => (
              <tr key={payment.id}>
                <td data-label="Payment date">{formatDay(payment.paidAt)}</td>
                <td data-label="Method / reference">{methods[payment.method]}<div className="cell-secondary">{payment.reference ?? "No reference"}</div></td>
                <td data-label="Recorded by">{payment.recordedBy?.name ?? "Former user"}<div className="cell-secondary">{formatDateTime(payment.createdAt)}</div></td>
                <td data-label="Amount" className="align-end cell-primary">{formatMoney(payment.amount)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Dialog open={open} title={`Record payment · ${order.number}`} description="Record a payment already made to this supplier." busy={busy} onClose={() => setOpen(false)}>
        <PaymentForm order={order} onBusy={setBusy} onClose={() => setOpen(false)} onSaved={(replayed) => {
          setOpen(false);
          onNotice(replayed ? "The original payment was confirmed. No additional payment was recorded." : "Supplier payment recorded.");
        }} />
      </Dialog>
    </section>
  );
}

function PaymentForm({ order, onBusy, onClose, onSaved }: {
  order: PurchaseOrderDetail; onBusy: (busy: boolean) => void; onClose: () => void; onSaved: (replayed: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const submission = usePendingSubmission<PurchasePaymentInput>(`payment:${order.id}`);
  const [amount, setAmount] = useState(submission.saved?.amount ?? order.balanceDue);
  const [method, setMethod] = useState<PaymentMethod>(submission.saved?.method ?? "BANK_TRANSFER");
  const [reference, setReference] = useState(submission.saved?.reference ?? "");
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const [paidAt, setPaidAt] = useState(submission.saved?.paidAt ?? today);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationFn: (input: PurchasePaymentInput) => purchaseOrderService.pay(order.id, submission.prepare(input)),
    onMutate: () => onBusy(true),
    onSettled: () => onBusy(false),
    onSuccess: (result) => {
      submission.clear();
      queryClient.setQueryData(queryKeys.purchaseOrders.detail(order.id), result.order);
      void queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      onSaved(result.replayed);
    },
    onError: (error) => { if (isDefiniteRejection(error)) submission.clear(); },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (mutation.isPending) return;
    if (submission.saved) { mutation.mutate(submission.saved); return; }
    const parsed = paymentSchema.safeParse({ amount, paidAt, method, reference });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    if (cents(parsed.data.amount) > cents(order.balanceDue)) { setErrors({ amount: `Only ${formatMoney(order.balanceDue)} remains payable` }); return; }
    if (paidAt > new Date().toISOString().slice(0, 10)) { setErrors({ paidAt: "Payment date cannot be in the future" }); return; }
    setErrors({});
    mutation.mutate({ ...parsed.data, reference: parsed.data.reference || null, idempotencyKey: crypto.randomUUID() });
  }
  const disabled = mutation.isPending || !!submission.saved;
  return (
    <form onSubmit={submit} noValidate aria-busy={mutation.isPending}>
      <div className="dialog__content">
        {mutation.isError && <Alert tone="error">{formErrorMessage(mutation.error)}</Alert>}
        {submission.saved && !mutation.isPending && <Alert tone="warn">A payment request is awaiting confirmation. Retry the saved request to recover its result safely.</Alert>}
        <Field label="Amount" error={errors.amount} hint={`Outstanding balance: ${formatMoney(order.balanceDue)}`}>
          {(control) => <input {...control} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={disabled} />}
        </Field>
        <Field label="Payment date" error={errors.paidAt}>
          {(control) => <input {...control} type="date" max={today} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} disabled={disabled} />}
        </Field>
        <Field label="Method" error={errors.method}>
          {(control) => <select {...control} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)} disabled={disabled}>
            {Object.entries(methods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>}
        </Field>
        <Field label="Reference (optional)" error={errors.reference}>
          {(control) => <input {...control} value={reference} maxLength={160} onChange={(e) => setReference(e.target.value)} disabled={disabled} />}
        </Field>
      </div>
      <footer className="dialog__footer">
        <button type="button" className="button button--ghost" onClick={onClose} disabled={mutation.isPending}>Close</button>
        <button type="submit" className="button" disabled={mutation.isPending || (!submission.saved && order.balanceDue === "0.00")}>
          {mutation.isPending && <Spinner size={14} label="Saving payment" />}
          {submission.saved ? "Confirm saved payment" : "Record payment"}
        </button>
      </footer>
    </form>
  );
}
