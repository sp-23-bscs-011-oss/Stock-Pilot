import { Link } from "react-router";
import { formatDateTime, formatMoney } from "../../lib/format";
import { purchaseOrderPath } from "../../routes/paths";
import type { SortOrder } from "../../types/catalog";
import type { PurchaseOrderSortField, PurchaseOrderSummary } from "../../types/purchasing";
import { formatDay } from "./purchasingLabels";
import { PurchaseStatusBadge } from "./PurchaseStatusBadge";
import { PaymentStatusBadge } from "./PaymentStatusBadge";

interface PurchaseOrderTableProps {
  orders: PurchaseOrderSummary[];
  sort?: PurchaseOrderSortField;
  order?: SortOrder;
  /** Omit to render without sortable headers (e.g. inside a supplier's page). */
  onSort?: (field: PurchaseOrderSortField) => void;
  showSupplier?: boolean;
}

/** Received units against ordered, as a small bar plus figures. */
function ReceiptProgress({ order }: { order: PurchaseOrderSummary }) {
  if (order.status === "DRAFT" || order.unitsOrdered === 0) return <span className="cell-secondary">—</span>;
  const percent = Math.min(100, Math.round((order.unitsReceived / order.unitsOrdered) * 100));
  return (
    <div className="receipt-progress">
      <div
        className="receipt-progress__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={order.unitsOrdered}
        aria-valuenow={order.unitsReceived}
        aria-label={`${order.unitsReceived} of ${order.unitsOrdered} units received`}
      >
        <span style={{ width: `${percent}%` }} />
      </div>
      <span className="cell-secondary nowrap">
        {order.unitsReceived} / {order.unitsOrdered}
      </span>
    </div>
  );
}

export function PurchaseOrderTable({ orders, sort, order, onSort, showSupplier = true }: PurchaseOrderTableProps) {
  const header = (label: string, field?: PurchaseOrderSortField, align?: "end") => {
    const active = field !== undefined && field === sort;
    return (
      <th
        scope="col"
        className={align === "end" ? "align-end" : undefined}
        aria-sort={active ? (order === "asc" ? "ascending" : "descending") : undefined}
      >
        {field && onSort ? (
          <button type="button" className={`sort-button${active ? " is-active" : ""}`} onClick={() => onSort(field)}>
            {label}
            <span className="sort-button__icon" aria-hidden="true">
              {active ? (order === "asc" ? "▲" : "▼") : "↕"}
            </span>
          </button>
        ) : (
          label
        )}
      </th>
    );
  };

  return (
    <div className="table-wrap">
      <table className="data-table data-table--responsive">
        <thead>
          <tr>
            {header("Order", "number")}
            {showSupplier && header("Supplier")}
            {header("Status")}
            {header("Payment")}
            {header("Created", "createdAt")}
            {header("Expected", "expectedAt")}
            {header("Received")}
            {header("Total", "total", "end")}
          </tr>
        </thead>
        <tbody>
          {orders.map((po) => (
            <tr key={po.id} className={po.status === "CANCELLED" ? "is-muted" : undefined}>
              <td data-label="Order" className="data-table__primary">
                <Link to={purchaseOrderPath(po.id)} className="cell-primary row-link mono">
                  {po.number}
                </Link>
                <div className="cell-secondary">
                  {po.lineCount} line{po.lineCount === 1 ? "" : "s"} · {po.store.name}
                </div>
              </td>
              {showSupplier && (
                <td data-label="Supplier">
                  {po.supplier.name}
                  {!po.supplier.isActive && <div className="cell-secondary">Inactive</div>}
                </td>
              )}
              <td data-label="Status">
                <PurchaseStatusBadge status={po.status} />
              </td>
              <td data-label="Payment">
                <PaymentStatusBadge status={po.paymentStatus} />
                <div className="cell-secondary">{formatMoney(po.balanceDue)} due</div>
              </td>
              <td data-label="Created" className="nowrap">
                {formatDateTime(po.createdAt)}
              </td>
              <td data-label="Expected" className="nowrap">
                {formatDay(po.expectedAt)}
              </td>
              <td data-label="Received">
                <ReceiptProgress order={po} />
              </td>
              <td data-label="Total" className="align-end nowrap">
                <span className="cell-primary">{formatMoney(po.total)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
