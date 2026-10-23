import { formatDateTime } from "../../lib/format";
import type { SortOrder } from "../../types/catalog";
import type { InventoryItem, InventorySortField, StockStatus } from "../../types/inventory";
import { stockStatusLabels } from "./inventoryLabels";

export function StockStatusBadge({ status }: { status: StockStatus }) {
  const tone = status === "OK" ? "ok" : status === "LOW" ? "warn" : "error";
  return (
    <span className={`status-badge status-badge--${tone}`}>
      <span className="status-badge__dot" aria-hidden="true" />
      {stockStatusLabels[status]}
    </span>
  );
}

interface StockTableProps {
  items: InventoryItem[];
  sort: InventorySortField;
  order: SortOrder;
  onSort: (field: InventorySortField) => void;
  canManage: boolean;
  onAdjust: (item: InventoryItem) => void;
  onHistory: (item: InventoryItem) => void;
}

export function StockTable({ items, sort, order, onSort, canManage, onAdjust, onHistory }: StockTableProps) {
  const header = (label: string, field?: InventorySortField, align?: "end") => {
    const active = field === sort;
    return (
      <th
        scope="col"
        className={align === "end" ? "align-end" : undefined}
        aria-sort={active ? (order === "asc" ? "ascending" : "descending") : undefined}
      >
        {field ? (
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
            {header("Product", "name")}
            {header("SKU", "sku")}
            {header("Category")}
            {header("On hand", "quantity", "end")}
            {header("Reorder at", "reorderThreshold", "end")}
            {header("Status")}
            {header("Last change", "updatedAt")}
            {canManage && (
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.productId}>
              <td data-label="Product" className="data-table__primary">
                <div className="cell-primary">{item.name}</div>
                {item.barcode && <div className="cell-secondary mono">{item.barcode}</div>}
              </td>
              <td data-label="SKU" className="mono">
                {item.sku}
              </td>
              <td data-label="Category">
                {item.category ? item.category.name : <span className="cell-secondary">Uncategorized</span>}
              </td>
              <td data-label="On hand" className={`align-end quantity-cell quantity-cell--${item.status.toLowerCase()}`}>
                {item.quantity.toLocaleString()}
              </td>
              <td data-label="Reorder at" className="align-end">
                {item.reorderThreshold}
              </td>
              <td data-label="Status">
                <StockStatusBadge status={item.status} />
              </td>
              <td data-label="Last change" className="nowrap cell-secondary">
                {formatDateTime(item.updatedAt, "Never stocked")}
              </td>
              {canManage && (
                <td className="align-end data-table__actions">
                  <div className="table-actions">
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => onAdjust(item)}
                      aria-label={`Adjust stock of ${item.name}`}
                    >
                      Adjust
                    </button>
                    <button
                      type="button"
                      className="button button--ghost button--sm"
                      onClick={() => onHistory(item)}
                      aria-label={`Stock history of ${item.name}`}
                    >
                      History
                    </button>
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
