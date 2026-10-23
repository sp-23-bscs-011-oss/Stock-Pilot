import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import { formatDateTime, formatMoney } from "../../lib/format";
import { queryKeys } from "../../lib/queryKeys";
import { supplierPath } from "../../routes/paths";
import { toApiError } from "../../services/apiError";
import { supplierService } from "../../services/purchasingService";
import { ErrorState } from "../ErrorState";
import { PageLoader } from "../PageLoader";
import { dayBoundary } from "./purchasingLabels";

/**
 * Purchasing per supplier for a period: orders placed and their value, goods received, and
 * what is still due. Outstanding value is always as of now.
 */
export function SupplierReportView() {
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const params = { from: dayBoundary(fromDay, false), to: dayBoundary(toDay, true) };

  const query = useQuery({
    queryKey: queryKeys.suppliers.report(params),
    queryFn: ({ signal }) => supplierService.report(params, signal),
    placeholderData: keepPreviousData,
  });

  const data = query.data;
  return (
    <div>
      <div className="toolbar">
        <label className="toolbar__date">
          <span>From</span>
          <input type="date" value={fromDay} max={toDay || undefined} onChange={(event) => setFromDay(event.target.value)} />
        </label>
        <label className="toolbar__date">
          <span>To</span>
          <input type="date" value={toDay} min={fromDay || undefined} onChange={(event) => setToDay(event.target.value)} />
        </label>
        {(fromDay || toDay) && (
          <button
            type="button"
            className="button button--ghost button--sm"
            onClick={() => {
              setFromDay("");
              setToDay("");
            }}
          >
            All time
          </button>
        )}
      </div>

      {query.isPending ? (
        <PageLoader message="Building report…" />
      ) : query.isError ? (
        <ErrorState title="Couldn't load the report" message={toApiError(query.error).message} onRetry={() => void query.refetch()} />
      ) : data && data.rows.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">No supplier activity</p>
          <p className="empty-state__text">Add suppliers and place purchase orders to see them here.</p>
        </div>
      ) : data ? (
        <div className={query.isPlaceholderData ? "is-refreshing" : undefined} aria-busy={query.isFetching}>
          <div className="summary-tiles">
            <div className="summary-tile">
              <span className="summary-tile__label">Orders placed</span>
              <span className="summary-tile__value">{data.totals.orderCount.toLocaleString()}</span>
            </div>
            <div className="summary-tile">
              <span className="summary-tile__label">Ordered value</span>
              <span className="summary-tile__value">{formatMoney(data.totals.orderedValue)}</span>
            </div>
            <div className="summary-tile">
              <span className="summary-tile__label">Received value</span>
              <span className="summary-tile__value">{formatMoney(data.totals.receivedValue)}</span>
            </div>
            <div className="summary-tile">
              <span className="summary-tile__label">Outstanding now</span>
              <span className={`summary-tile__value${Number(data.totals.outstandingValue) > 0 ? " summary-tile__value--warn" : ""}`}>
                {formatMoney(data.totals.outstandingValue)}
              </span>
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table data-table--responsive">
              <thead>
                <tr>
                  <th scope="col">Supplier</th>
                  <th scope="col" className="align-end">
                    Orders
                  </th>
                  <th scope="col" className="align-end">
                    Ordered
                  </th>
                  <th scope="col" className="align-end">
                    Received
                  </th>
                  <th scope="col" className="align-end">
                    Outstanding
                  </th>
                  <th scope="col" className="align-end">
                    Avg. lead time
                  </th>
                  <th scope="col">Last order</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map(({ supplier, stats }) => (
                  <tr key={supplier.id} className={supplier.isActive ? undefined : "is-muted"}>
                    <td data-label="Supplier" className="data-table__primary">
                      <Link to={supplierPath(supplier.id)} className="cell-primary row-link">
                        {supplier.name}
                      </Link>
                      {!supplier.isActive && <div className="cell-secondary">Inactive</div>}
                    </td>
                    <td data-label="Orders" className="align-end">
                      {stats.orderCount}
                      {stats.openOrders > 0 && <div className="cell-secondary">{stats.openOrders} open</div>}
                    </td>
                    <td data-label="Ordered" className="align-end nowrap">
                      {formatMoney(stats.orderedValue)}
                    </td>
                    <td data-label="Received" className="align-end nowrap">
                      {formatMoney(stats.receivedValue)}
                      <div className="cell-secondary">{stats.unitsReceived.toLocaleString()} units</div>
                    </td>
                    <td data-label="Outstanding" className="align-end nowrap">
                      {formatMoney(stats.outstandingValue)}
                    </td>
                    <td data-label="Avg. lead time" className="align-end nowrap">
                      {stats.averageLeadTimeDays === null ? <span className="cell-secondary">—</span> : `${stats.averageLeadTimeDays.toFixed(1)} days`}
                    </td>
                    <td data-label="Last order" className="nowrap">
                      {formatDateTime(stats.lastOrderedAt, "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="empty-hint">
            Ordered value excludes cancelled orders. Lead time is the average from placing an order to its first delivery.
          </p>
        </div>
      ) : null}
    </div>
  );
}
