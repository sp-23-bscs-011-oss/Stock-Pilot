import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { Alert } from "../components/Alert";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ErrorState } from "../components/ErrorState";
import { Field } from "../components/Field";
import { PageHeader } from "../components/PageHeader";
import { PurchasingSkeleton as PageLoader } from "../components/purchasing/PurchasingSkeleton";
import { useNoticeToast } from "../hooks/useNoticeToast";
import { ActivityLog } from "../components/purchasing/ActivityLog";
import { formatDay } from "../components/purchasing/purchasingLabels";
import { PurchaseStatusBadge } from "../components/purchasing/PurchaseStatusBadge";
import { usePageTitle } from "../hooks/usePageTitle";
import { formatDateTime, formatMoney } from "../lib/format";
import { queryKeys } from "../lib/queryKeys";
import { formErrorMessage } from "../lib/validation";
import { editPurchaseOrderPath, paths, supplierPath } from "../routes/paths";
import { toApiError } from "../services/apiError";
import { purchaseOrderService } from "../services/purchasingService";
import type { PurchaseOrderDetail } from "../types/purchasing";
import { PaymentPanel } from "../components/purchasing/PaymentPanel";
import { useCurrentUser } from "../auth/authContext";

export default function PurchaseOrderDetailPage() {
  const { id = "" } = useParams();
  const query = useQuery({
    queryKey: queryKeys.purchaseOrders.detail(id),
    queryFn: ({ signal }) => purchaseOrderService.get(id, signal),
  });
  usePageTitle(query.data?.number ?? "Purchase order");

  if (query.isPending) return <PageLoader message="Loading purchase order…" />;
  if (query.isError) {
    const error = toApiError(query.error);
    return (
      <ErrorState
        title={error.status === 404 ? "Purchase order not found" : "Couldn't load purchase order"}
        message={error.message}
        onRetry={error.status === 404 ? undefined : () => void query.refetch()}
        actions={
          <Link className="button button--ghost" to={paths.purchases}>
            Back to purchases
          </Link>
        }
      />
    );
  }
  return <OrderView order={query.data} />;
}

function OrderView({ order }: { order: PurchaseOrderDetail }) {
  const user = useCurrentUser();
  let pendingReceipt = false;
  try { pendingReceipt = !!sessionStorage.getItem(`stockpilot:pending:${user.id}:receipt:${order.id}`); } catch { /* Storage can be disabled. */ }
  const queryClient = useQueryClient();
  const location = useLocation();
  const [notice, setNotice] = useState<string | null>((location.state as { notice?: string } | null)?.notice ?? null);
  useNoticeToast(notice);
  const [confirm, setConfirm] = useState<"place" | "cancel" | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const isOpen = order.status === "ORDERED" || order.status === "PARTIALLY_RECEIVED";
  const refresh = (updated: PurchaseOrderDetail) => {
    queryClient.setQueryData(queryKeys.purchaseOrders.detail(updated.id), updated);
    void queryClient.invalidateQueries({ queryKey: queryKeys.purchaseOrders.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
  };

  const statusChange = useMutation({
    mutationFn: (kind: "place" | "cancel") =>
      kind === "place" ? purchaseOrderService.place(order.id) : purchaseOrderService.cancel(order.id, cancelReason.trim() || null),
    onSuccess: (updated, kind) => {
      refresh(updated);
      setConfirm(null);
      setNotice(kind === "place" ? `${updated.number} is now ordered. Receive the stock when it arrives.` : `${updated.number} was cancelled.`);
    },
  });

  const percent = order.unitsOrdered > 0 ? Math.round((order.unitsReceived / order.unitsOrdered) * 100) : 0;

  return (
    <section>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={paths.purchases}>Purchases</Link>
      </nav>
      <PageHeader
        title={order.number}
        description={`${order.supplier.name} → ${order.store.name}`}
        actions={
          <>
            {order.status === "DRAFT" && (
              <Link className="button button--ghost" to={editPurchaseOrderPath(order.id)}>
                Edit draft
              </Link>
            )}
            {(order.status === "DRAFT" || isOpen) && (
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  statusChange.reset();
                  setCancelReason("");
                  setConfirm("cancel");
                }}
              >
                Cancel order
              </button>
            )}
            {order.status === "DRAFT" && (
              <button
                type="button"
                className="button"
                onClick={() => {
                  statusChange.reset();
                  setConfirm("place");
                }}
                disabled={order.lineCount === 0}
                title={order.lineCount === 0 ? "Add products before placing the order" : undefined}
              >
                Mark as ordered
              </button>
            )}
            {(isOpen || pendingReceipt) && (
              <Link
                className="button"
                to={`/purchases/${order.id}/receive`}
              >
                {pendingReceipt ? "Confirm saved delivery" : "Receive stock"}
              </Link>
            )}
          </>
        }
      />

      {notice && <Alert tone="success">{notice}</Alert>}
      {order.status === "CANCELLED" && (
        <Alert tone="warn">
          Cancelled {formatDateTime(order.cancelledAt)} by {order.cancelledBy?.name ?? "a former user"}
          {order.cancelReason ? `: ${order.cancelReason}` : "."}
          {order.unitsReceived > 0 && ` ${order.unitsReceived} units received before cancellation remain in stock.`}
        </Alert>
      )}

      <div className="po-header card card--spaced">
        <div className="po-header__status">
          <PurchaseStatusBadge status={order.status} />
          {order.status !== "DRAFT" && (
            <div className="receipt-progress receipt-progress--wide">
              <div
                className="receipt-progress__bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={order.unitsOrdered}
                aria-valuenow={order.unitsReceived}
                aria-label="Units received"
              >
                <span style={{ width: `${percent}%` }} />
              </div>
              <span className="cell-secondary nowrap">
                {order.unitsReceived} of {order.unitsOrdered} units received
              </span>
            </div>
          )}
        </div>
        <dl className="po-facts">
          <div>
            <dt>Supplier</dt>
            <dd>
              <Link to={supplierPath(order.supplier.id)}>{order.supplier.name}</Link>
              {order.supplier.paymentTerms && <div className="cell-secondary">Terms: {order.supplier.paymentTerms}</div>}
            </dd>
          </div>
          <div>
            <dt>Deliver to</dt>
            <dd>{order.store.name}</dd>
          </div>
          <div>
            <dt>Expected</dt>
            <dd>{formatDay(order.expectedAt, "Not set")}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>
              {formatDateTime(order.createdAt)}
              <div className="cell-secondary">{order.createdBy?.name ?? "—"}</div>
            </dd>
          </div>
          {order.orderedAt && (
            <div>
              <dt>Ordered</dt>
              <dd>
                {formatDateTime(order.orderedAt)}
                <div className="cell-secondary">{order.orderedBy?.name ?? "—"}</div>
              </dd>
            </div>
          )}
          {order.receivedAt && (
            <div>
              <dt>Fully received</dt>
              <dd>{formatDateTime(order.receivedAt)}</dd>
            </div>
          )}
        </dl>
        {order.note && <p className="detail-note">{order.note}</p>}
      </div>

      <div className="detail-layout">
        <div className="detail-layout__main">
          <h2 className="section-title">Lines</h2>
          {order.lines.length === 0 ? (
            <div className="empty-state">
              <p className="empty-state__title">No products on this draft</p>
              <Link className="button button--ghost" to={editPurchaseOrderPath(order.id)}>
                Add products
              </Link>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table data-table--responsive">
                <thead>
                  <tr>
                    <th scope="col">Product</th>
                    <th scope="col" className="align-end">
                      Ordered
                    </th>
                    <th scope="col" className="align-end">
                      Received
                    </th>
                    <th scope="col" className="align-end">
                      Unit cost
                    </th>
                    <th scope="col" className="align-end">
                      Line total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => (
                    <tr key={line.id}>
                      <td data-label="Product" className="data-table__primary">
                        <div className="cell-primary">{line.productName}</div>
                        <div className="cell-secondary mono">{line.sku}</div>
                      </td>
                      <td data-label="Ordered" className="align-end">
                        {line.quantityOrdered}
                      </td>
                      <td data-label="Received" className="align-end">
                        {order.status === "DRAFT" ? (
                          <span className="cell-secondary">—</span>
                        ) : (
                          <>
                            <span className={line.quantityReceived >= line.quantityOrdered ? "text-ok" : undefined}>
                              {line.quantityReceived}
                            </span>
                            {line.quantityOutstanding > 0 && <div className="cell-secondary">{line.quantityOutstanding} due</div>}
                          </>
                        )}
                      </td>
                      <td data-label="Unit cost" className="align-end nowrap">
                        {formatMoney(line.unitCost)}
                      </td>
                      <td data-label="Line total" className="align-end nowrap cell-primary">
                        {formatMoney(line.lineTotal)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <dl className="order-totals">
            <div>
              <dt>Received value</dt>
              <dd>{formatMoney(order.receivedValue)}</dd>
            </div>
            {isOpen && (
              <div>
                <dt>Goods still expected</dt>
                <dd>{formatMoney(order.outstandingValue)}</dd>
              </div>
            )}
            <div className="order-totals__grand">
              <dt>Order total</dt>
              <dd>{formatMoney(order.total)}</dd>
            </div>
          </dl>

          <PaymentPanel order={order} onNotice={setNotice} />

          <h2 className="section-title">Deliveries</h2>
          {order.receipts.length === 0 ? (
            <p className="empty-hint">
              {isOpen ? "Nothing received yet. Use “Receive stock” when the delivery arrives." : "No deliveries recorded."}
            </p>
          ) : (
            <div className="receipt-list">
              {order.receipts.map((receipt, index) => (
                <article key={receipt.id} className="card receipt-card">
                  <header className="receipt-card__header">
                    <div>
                      <h3 className="receipt-card__title">Delivery {index + 1}</h3>
                      <div className="cell-secondary">
                        {formatDateTime(receipt.receivedAt)} · {receipt.receivedBy?.name ?? "a former user"}
                      </div>
                    </div>
                    <div className="align-end">
                      <div className="cell-primary">{formatMoney(receipt.value)}</div>
                      <div className="cell-secondary">{receipt.units} units</div>
                    </div>
                  </header>
                  <ul className="receipt-card__lines">
                    {receipt.lines.map((line) => (
                      <li key={line.lineId}>
                        <span>
                          {line.productName} <span className="cell-secondary mono">{line.sku}</span>
                        </span>
                        <span className="stock-change stock-change--up">+{line.quantity}</span>
                      </li>
                    ))}
                  </ul>
                  {receipt.note && <p className="detail-note">{receipt.note}</p>}
                </article>
              ))}
            </div>
          )}
        </div>

        <aside className="detail-layout__side">
          <div className="card">
            <h2 className="card__title">Activity</h2>
            <ActivityLog entries={[...order.activity].reverse()} />
          </div>
        </aside>
      </div>

      <ConfirmDialog
        open={confirm === "place"}
        title={`Mark ${order.number} as ordered?`}
        confirmLabel="Mark as ordered"
        pendingLabel="Placing…"
        pending={statusChange.isPending}
        error={formErrorMessage(statusChange.error)}
        onConfirm={() => statusChange.mutate("place")}
        onClose={() => setConfirm(null)}
      >
        <p>
          Confirm you've sent this order to <strong>{order.supplier.name}</strong> for {formatMoney(order.total)}. Its lines can't be
          changed afterwards. Stock is added only when you receive the goods.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirm === "cancel"}
        title={`Cancel ${order.number}?`}
        confirmLabel="Cancel order"
        pendingLabel="Cancelling…"
        tone="danger"
        pending={statusChange.isPending}
        error={formErrorMessage(statusChange.error)}
        onConfirm={() => statusChange.mutate("cancel")}
        onClose={() => setConfirm(null)}
      >
        <p>
          {order.status === "PARTIALLY_RECEIVED"
            ? `The ${order.unitsOrdered - order.unitsReceived} units still due will no longer be expected. Stock already received stays in inventory.`
            : "This order will no longer be expected. This can't be undone."}
        </p>
        <Field label="Reason (optional)">
          {(control) => (
            <input
              {...control}
              value={cancelReason}
              maxLength={500}
              onChange={(event) => setCancelReason(event.target.value)}
              disabled={statusChange.isPending}
            />
          )}
        </Field>
      </ConfirmDialog>
    </section>
  );
}
