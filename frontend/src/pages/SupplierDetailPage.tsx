import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { Alert } from "../components/Alert";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { PurchasingSkeleton as PageLoader } from "../components/purchasing/PurchasingSkeleton";
import { useNoticeToast } from "../hooks/useNoticeToast";
import { Pagination } from "../components/Pagination";
import { ActivityLog } from "../components/purchasing/ActivityLog";
import { PurchaseOrderTable } from "../components/purchasing/PurchaseOrderTable";
import { SupplierFormDialog } from "../components/purchasing/SupplierFormDialog";
import { usePageTitle } from "../hooks/usePageTitle";
import { formatDateTime, formatMoney } from "../lib/format";
import { queryKeys } from "../lib/queryKeys";
import { newPurchaseOrderPath, paths } from "../routes/paths";
import { toApiError } from "../services/apiError";
import { purchaseOrderService, supplierService } from "../services/purchasingService";
import type { PurchaseOrderListParams, SupplierDetail } from "../types/purchasing";

export default function SupplierDetailPage() {
  const { id = "" } = useParams();
  const query = useQuery({
    queryKey: queryKeys.suppliers.detail(id),
    queryFn: ({ signal }) => supplierService.get(id, signal),
  });
  usePageTitle(query.data?.name ?? "Supplier");

  if (query.isPending) return <PageLoader message="Loading supplier…" />;
  if (query.isError) {
    const error = toApiError(query.error);
    return (
      <ErrorState
        title={error.status === 404 ? "Supplier not found" : "Couldn't load supplier"}
        message={error.status === 404 ? "It may have been deleted." : error.message}
        onRetry={error.status === 404 ? undefined : () => void query.refetch()}
        actions={
          <Link className="button button--ghost" to={paths.suppliers}>
            Back to suppliers
          </Link>
        }
      />
    );
  }
  return <SupplierView supplier={query.data} />;
}

function SupplierView({ supplier }: { supplier: SupplierDetail }) {
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useNoticeToast(notice);
  const { stats } = supplier;

  const contact: [string, string | null][] = [
    ["Contact", supplier.contactName],
    ["Email", supplier.email],
    ["Phone", supplier.phone],
    ["Address", supplier.address],
    ["Payment terms", supplier.paymentTerms],
  ];

  return (
    <section>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link to={paths.suppliers}>Suppliers</Link>
      </nav>
      <PageHeader
        title={supplier.name}
        description={supplier.isActive ? `Supplier since ${formatDateTime(supplier.createdAt)}` : "Inactive supplier"}
        actions={
          <>
            <button type="button" className="button button--ghost" onClick={() => setEditing(true)}>
              Edit
            </button>
            {supplier.isActive && (
              <Link className="button" to={newPurchaseOrderPath(supplier.id)}>
                New purchase order
              </Link>
            )}
          </>
        }
      />
      {notice && <Alert tone="success">{notice}</Alert>}

      <div className="summary-tiles">
        <div className="summary-tile">
          <span className="summary-tile__label">Orders placed</span>
          <span className="summary-tile__value">{stats.orderCount}</span>
        </div>
        <div className="summary-tile">
          <span className="summary-tile__label">Ordered to date</span>
          <span className="summary-tile__value">{formatMoney(stats.orderedValue)}</span>
        </div>
        <div className="summary-tile">
          <span className="summary-tile__label">Received to date</span>
          <span className="summary-tile__value">{formatMoney(stats.receivedValue)}</span>
        </div>
        <div className="summary-tile">
          <span className="summary-tile__label">Goods still expected</span>
          <span className={`summary-tile__value${stats.openOrders > 0 ? " summary-tile__value--warn" : ""}`}>
            {formatMoney(stats.outstandingValue)}
          </span>
        </div>
        <div className="summary-tile">
          <span className="summary-tile__label">Payments recorded</span>
          <span className="summary-tile__value">{formatMoney(stats.paidTotal)}</span>
        </div>
        <div className="summary-tile">
          <span className="summary-tile__label">Balance due</span>
          <span className="summary-tile__value">{formatMoney(stats.balanceDue)}</span>
        </div>
      </div>

      <div className="detail-layout">
        <div className="detail-layout__main">
          <h2 className="section-title">Purchase history</h2>
          <SupplierOrders supplierId={supplier.id} />
        </div>
        <aside className="detail-layout__side">
          <div className="card">
            <h2 className="card__title">Contact details</h2>
            <dl className="details">
              {contact.map(([label, value]) => (
                <div key={label} className="details__row">
                  <dt>{label}</dt>
                  <dd>{value ?? <span className="cell-secondary">—</span>}</dd>
                </div>
              ))}
              <div className="details__row">
                <dt>Avg. lead time</dt>
                <dd>{stats.averageLeadTimeDays === null ? "—" : `${stats.averageLeadTimeDays.toFixed(1)} days`}</dd>
              </div>
            </dl>
            {supplier.notes && <p className="detail-note">{supplier.notes}</p>}
          </div>
          <div className="card">
            <h2 className="card__title">Activity</h2>
            <ActivityLog entries={supplier.activity} />
          </div>
        </aside>
      </div>

      <SupplierFormDialog
        open={editing}
        supplier={supplier}
        onClose={() => setEditing(false)}
        onSaved={(saved) => {
          setEditing(false);
          setNotice(`${saved.name} was updated.`);
        }}
      />
    </section>
  );
}

function SupplierOrders({ supplierId }: { supplierId: string }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const params: PurchaseOrderListParams = { supplierId, page, pageSize, sort: "number", order: "desc" };
  const query = useQuery({
    queryKey: queryKeys.purchaseOrders.list(params),
    queryFn: ({ signal }) => purchaseOrderService.list(params, signal),
    placeholderData: keepPreviousData,
  });

  if (query.isPending) return <PageLoader message="Loading orders…" />;
  if (query.isError) return <ErrorState title="Couldn't load orders" message={toApiError(query.error).message} onRetry={() => void query.refetch()} />;
  if (query.data.total === 0) {
    return (
      <div className="empty-state">
        <p className="empty-state__title">No purchase orders yet</p>
        <p className="empty-state__text">Orders raised with this supplier will be listed here.</p>
      </div>
    );
  }
  return (
    <div className={query.isPlaceholderData ? "is-refreshing" : undefined}>
      <PurchaseOrderTable orders={query.data.items} showSupplier={false} />
      <Pagination
        page={page}
        totalPages={query.data.totalPages}
        total={query.data.total}
        pageSize={pageSize}
        pageSizeOptions={[10, 25, 50]}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        busy={query.isPlaceholderData}
        itemLabel="orders"
      />
    </div>
  );
}
