import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useCurrentUser } from "../auth/authContext";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { PurchasingSkeleton } from "../components/purchasing/PurchasingSkeleton";
import { ReceiveForm } from "../components/purchasing/ReceiveStockDialog";
import { usePageTitle } from "../hooks/usePageTitle";
import { queryKeys } from "../lib/queryKeys";
import { purchaseOrderPath } from "../routes/paths";
import { toApiError } from "../services/apiError";
import { purchaseOrderService } from "../services/purchasingService";

export default function ReceiveStockPage() {
  usePageTitle("Receive stock");
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: queryKeys.purchaseOrders.detail(id), queryFn: ({ signal }) => purchaseOrderService.get(id, signal) });
  if (query.isPending) return <PurchasingSkeleton message="Loading outstanding quantities…" />;
  if (query.isError) return <ErrorState title="Couldn't load purchase order" message={toApiError(query.error).message} onRetry={() => void query.refetch()} />;
  const order = query.data;
  let pending = false;
  try { pending = !!sessionStorage.getItem(`stockpilot:pending:${user.id}:receipt:${id}`); } catch { /* Storage may be disabled. */ }
  const canReceive = order.status === "ORDERED" || order.status === "PARTIALLY_RECEIVED" || pending;
  return <section aria-busy={busy}>
    <nav className="breadcrumb" aria-label="Breadcrumb"><Link to={purchaseOrderPath(id)}>{order.number}</Link></nav>
    <PageHeader title="Receive stock" description={`${order.number} · ${order.supplier.name} → ${order.store.name}`} />
    <p className="empty-hint">Enter only the goods in this delivery. Remaining items can be received later.</p>
    {canReceive ? <div className="card">
      <ReceiveForm order={order} onBusyChange={setBusy} onCancel={() => void navigate(purchaseOrderPath(id))} onReceived={(result) => {
        void navigate(purchaseOrderPath(id), { replace: true, state: { notice: result.replayed
          ? "The saved delivery was confirmed. Inventory was not increased again."
          : `Delivery received into ${result.order.store.name}. ${result.order.status === "RECEIVED" ? "The order is fully received." : "Remaining goods are still outstanding."}` } });
      }} />
    </div> : <div className="empty-state"><p>This order is not awaiting a delivery.</p><Link className="button button--ghost" to={purchaseOrderPath(id)}>View purchase order</Link></div>}
  </section>;
}
