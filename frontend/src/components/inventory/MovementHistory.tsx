import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { formatDateTime } from "../../lib/format";
import { purchaseOrderPath } from "../../routes/paths";
import { queryKeys } from "../../lib/queryKeys";
import { toApiError } from "../../services/apiError";
import { inventoryService } from "../../services/inventoryService";
import type { AdjustmentReason, MovementListParams } from "../../types/inventory";
import { ErrorState } from "../ErrorState";
import { PageLoader } from "../PageLoader";
import { Pagination } from "../Pagination";
import { formatQuantityChange, reasonLabels } from "./inventoryLabels";

interface MovementHistoryProps {
  storeId: string;
  /** Narrow the history to one product (e.g. from a row's "History" button). */
  product: { id: string; name: string } | null;
  onClearProduct: () => void;
}

/** Local midnight at the start (or end) of a yyyy-mm-dd day, as an ISO timestamp for the API. */
function dayBoundary(day: string, end: boolean): string | undefined {
  if (!day) return undefined;
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return undefined;
  const boundary = end ? new Date(year, month - 1, date, 23, 59, 59, 999) : new Date(year, month - 1, date);
  return boundary.toISOString();
}

export function MovementHistory({ storeId, product, onClearProduct }: MovementHistoryProps) {
  const [reason, setReason] = useState<AdjustmentReason | "">("");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const params: MovementListParams = {
    storeId,
    productId: product?.id,
    reason: reason || undefined,
    from: dayBoundary(fromDay, false),
    to: dayBoundary(toDay, true),
    page,
    pageSize,
  };

  const query = useQuery({
    queryKey: queryKeys.inventory.movements(params),
    queryFn: ({ signal }) => inventoryService.movements(params, signal),
    placeholderData: keepPreviousData,
  });

  // Any filter change starts again from the newest movements.
  const filter = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
  };
  const filtersActive = Boolean(reason || fromDay || toDay);

  return (
    <div>
      <div className="toolbar">
        {product && (
          <span className="filter-chip">
            {product.name}
            <button type="button" onClick={onClearProduct} aria-label={`Show all products instead of ${product.name}`}>
              ×
            </button>
          </span>
        )}
        <label className="toolbar__filter">
          <span className="visually-hidden">Reason</span>
          <select value={reason} onChange={(event) => filter(setReason)(event.target.value as AdjustmentReason | "")}>
            <option value="">All reasons</option>
            {(Object.keys(reasonLabels) as AdjustmentReason[]).map((code) => (
              <option key={code} value={code}>
                {reasonLabels[code]}
              </option>
            ))}
          </select>
        </label>
        <label className="toolbar__date">
          <span>From</span>
          <input type="date" value={fromDay} max={toDay || undefined} onChange={(event) => filter(setFromDay)(event.target.value)} />
        </label>
        <label className="toolbar__date">
          <span>To</span>
          <input type="date" value={toDay} min={fromDay || undefined} onChange={(event) => filter(setToDay)(event.target.value)} />
        </label>
        {filtersActive && (
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => {
              setReason("");
              setFromDay("");
              setToDay("");
              setPage(1);
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {query.isPending ? (
        <PageLoader message="Loading history…" />
      ) : query.isError ? (
        <ErrorState
          title="Couldn't load stock history"
          message={toApiError(query.error).message}
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        />
      ) : query.data.total === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">No stock movements{filtersActive || product ? " match these filters" : " yet"}</p>
          <p className="empty-state__text">Every adjustment and delivery is recorded here with who made it and why.</p>
        </div>
      ) : (
        <div className={query.isPlaceholderData ? "is-refreshing" : undefined} aria-busy={query.isFetching}>
          <div className="table-wrap">
            <table className="data-table data-table--responsive">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Product</th>
                  <th scope="col" className="align-end">
                    Change
                  </th>
                  <th scope="col" className="align-end">
                    On hand
                  </th>
                  <th scope="col">Reason</th>
                  <th scope="col">Staff</th>
                </tr>
              </thead>
              <tbody>
                {query.data.items.map((movement) => (
                  <tr key={movement.id}>
                    <td data-label="Date" className="nowrap">
                      {formatDateTime(movement.createdAt)}
                    </td>
                    <td data-label="Product" className="data-table__primary">
                      <div className="cell-primary">{movement.product.name}</div>
                      <div className="cell-secondary mono">{movement.product.sku}</div>
                    </td>
                    <td data-label="Change" className="align-end">
                      <span className={`stock-change ${movement.quantityChange > 0 ? "stock-change--up" : "stock-change--down"}`}>
                        {formatQuantityChange(movement.quantityChange)}
                      </span>
                    </td>
                    <td data-label="On hand" className="align-end nowrap">
                      <span className="cell-secondary">{movement.quantityBefore} → </span>
                      {movement.quantityAfter}
                    </td>
                    <td data-label="Reason">
                      {movement.purchaseOrder ? (
                        <div>
                          Purchase receipt ·{" "}
                          <Link to={purchaseOrderPath(movement.purchaseOrder.id)} className="mono">
                            {movement.purchaseOrder.number}
                          </Link>
                        </div>
                      ) : (
                        <>
                          <div>{movement.reason ? reasonLabels[movement.reason] : movement.type}</div>
                          {movement.note && <div className="cell-secondary movement-note">{movement.note}</div>}
                        </>
                      )}
                    </td>
                    <td data-label="Staff">{movement.createdBy?.name ?? <span className="cell-secondary">System</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            totalPages={query.data.totalPages}
            total={query.data.total}
            pageSize={pageSize}
            pageSizeOptions={[25, 50, 100]}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            busy={query.isPlaceholderData}
            itemLabel="movements"
          />
        </div>
      )}
    </div>
  );
}
