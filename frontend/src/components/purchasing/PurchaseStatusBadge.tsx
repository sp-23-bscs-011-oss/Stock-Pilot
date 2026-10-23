import type { PurchaseOrderStatus } from "../../types/purchasing";
import { statusLabels } from "./purchasingLabels";

export function PurchaseStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return <span className={`po-status po-status--${status.toLowerCase().replace("_", "-")}`}>{statusLabels[status]}</span>;
}
