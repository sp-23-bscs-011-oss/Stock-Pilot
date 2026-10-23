import { formatDateTime, formatMoney } from "../../lib/format";
import type { AuditEntry } from "../../types/purchasing";
import { auditActionLabel } from "./purchasingLabels";

/** A one-line summary of the facts recorded with an event, when there are useful ones. */
function describe(entry: AuditEntry): string | null {
  const d = entry.details ?? {};
  switch (entry.action) {
    case "purchase_order.created":
      return `${d["lineCount"]} line${d["lineCount"] === 1 ? "" : "s"} · ${formatMoney(String(d["total"]))}`;
    case "purchase_order.updated": {
      const total = d["total"] as { from: string; to: string } | undefined;
      return total && total.from !== total.to ? `Total ${formatMoney(total.from)} → ${formatMoney(total.to)}` : null;
    }
    case "purchase_order.ordered":
      return formatMoney(String(d["total"]));
    case "purchase_order.received":
      return `${d["units"]} unit${d["units"] === 1 ? "" : "s"} · ${formatMoney(String(d["value"]))}`;
    case "purchase_order.cancelled":
      return [d["unitsCancelled"] ? `${d["unitsCancelled"]} units not delivered` : null, d["reason"] as string | null]
        .filter(Boolean)
        .join(" · ") || null;
    case "supplier.updated": {
      const changes = d["changes"] as Record<string, unknown> | undefined;
      return changes ? `Changed: ${Object.keys(changes).join(", ")}` : null;
    }
    default:
      return null;
  }
}

/** A chronological event list for one record, from its audit log. */
export function ActivityLog({ entries }: { entries: AuditEntry[] }) {
  if (entries.length === 0) return <p className="empty-hint">No activity recorded yet.</p>;
  return (
    <ol className="activity-log">
      {entries.map((entry) => {
        const detail = describe(entry);
        return (
          <li key={entry.id} className="activity-log__item">
            <div className="activity-log__title">{auditActionLabel(entry)}</div>
            {detail && <div className="activity-log__detail">{detail}</div>}
            <div className="activity-log__meta">
              {formatDateTime(entry.createdAt)} · {entry.actor?.name ?? "System"}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
