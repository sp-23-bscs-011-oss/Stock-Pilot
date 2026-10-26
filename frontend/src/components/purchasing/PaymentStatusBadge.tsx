import type { PaymentStatus } from "../../types/purchasing";
import { Badge } from "../ui/badge";

const labels: Record<PaymentStatus, string> = {
  NOT_DUE: "Not due", UNPAID: "Unpaid", PARTIALLY_PAID: "Partially paid", PAID: "Paid",
};

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  return <Badge variant={status === "PAID" ? "success" : status === "PARTIALLY_PAID" ? "warning" : "secondary"}>{labels[status]}</Badge>;
}
