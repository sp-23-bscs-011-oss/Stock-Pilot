import { useHealth } from "../hooks/useHealth";

export function ApiStatusBadge() {
  const { data, isPending, isError } = useHealth();

  let tone: "ok" | "warn" | "error" | "pending" = "pending";
  let label = "Checking API…";

  if (isError) {
    tone = "error";
    label = "API offline";
  } else if (data) {
    const dbUp = data.services.database.status === "up";
    tone = dbUp ? "ok" : "warn";
    label = dbUp ? "All systems operational" : "Database unavailable";
  } else if (!isPending) {
    tone = "error";
    label = "API status unknown";
  }

  return (
    <span className={`status-badge status-badge--${tone}`} role="status" aria-live="polite">
      <span className="status-badge__dot" aria-hidden="true" />
      {label}
    </span>
  );
}
