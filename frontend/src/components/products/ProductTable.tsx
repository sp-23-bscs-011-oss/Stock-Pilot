import { formatMoney, marginPercent } from "../../lib/format";
import type { Product, ProductSortField, SortOrder } from "../../types/catalog";

interface ProductTableProps {
  products: Product[];
  sort: ProductSortField;
  order: SortOrder;
  onSort: (field: ProductSortField) => void;
  showCost: boolean;
  showStatus: boolean;
  canManage: boolean;
  onEdit: (product: Product) => void;
  onArchive: (product: Product) => void;
  onRestore: (product: Product) => void;
  restoringId?: string | null;
}

/** A table on wide screens; below 760px each row collapses into a card (see .data-table--responsive). */
export function ProductTable({
  products,
  sort,
  order,
  onSort,
  showCost,
  showStatus,
  canManage,
  onEdit,
  onArchive,
  onRestore,
  restoringId,
}: ProductTableProps) {
  const header = (label: string, field?: ProductSortField, align?: "end") => {
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
            {header("Price", "sellingPrice", "end")}
            {showCost && header("Cost", "costPrice", "end")}
            {header("Reorder at", "reorderThreshold", "end")}
            {showStatus && header("Status")}
            {canManage && (
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const margin = marginPercent(product.costPrice, product.sellingPrice);
            return (
              <tr key={product.id} className={product.isArchived ? "is-muted" : undefined}>
                <td data-label="Product" className="data-table__primary">
                  <div className="cell-primary">{product.name}</div>
                  {product.barcode && <div className="cell-secondary mono">{product.barcode}</div>}
                </td>
                <td data-label="SKU" className="mono">
                  {product.sku}
                </td>
                <td data-label="Category">
                  {product.category ? product.category.name : <span className="cell-secondary">Uncategorized</span>}
                </td>
                <td data-label="Price" className="align-end nowrap">
                  {formatMoney(product.sellingPrice)}
                </td>
                {showCost && (
                  <td data-label="Cost" className="align-end nowrap">
                    <div>{formatMoney(product.costPrice)}</div>
                    {margin !== null && (
                      <div className={`cell-secondary${margin < 0 ? " text-danger" : ""}`}>{margin.toFixed(0)}% margin</div>
                    )}
                  </td>
                )}
                <td data-label="Reorder at" className="align-end">
                  {product.reorderThreshold}
                </td>
                {showStatus && (
                  <td data-label="Status">
                    <span className={`status-badge ${product.isArchived ? "status-badge--pending" : "status-badge--ok"}`}>
                      <span className="status-badge__dot" aria-hidden="true" />
                      {product.isArchived ? "Archived" : "Active"}
                    </span>
                  </td>
                )}
                {canManage && (
                  <td className="align-end data-table__actions">
                    <div className="table-actions">
                      {product.isArchived ? (
                        <button
                          type="button"
                          className="button button--ghost button--sm"
                          onClick={() => onRestore(product)}
                          disabled={restoringId === product.id}
                        >
                          {restoringId === product.id ? "Restoring…" : "Restore"}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            className="button button--ghost button--sm"
                            onClick={() => onEdit(product)}
                            aria-label={`Edit ${product.name}`}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="button button--ghost button--sm button--danger"
                            onClick={() => onArchive(product)}
                            aria-label={`Archive ${product.name}`}
                          >
                            Archive
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
