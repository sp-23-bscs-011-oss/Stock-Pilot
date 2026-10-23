import { PageHeader } from "../components/PageHeader";
import { QueryState } from "../components/QueryState";
import { useHealth } from "../hooks/useHealth";
import { usePageTitle } from "../hooks/usePageTitle";
import type { HealthResponse } from "../types/api";

export default function DashboardPage() {
  usePageTitle("Dashboard");
  const healthQuery = useHealth();

  return (
    <section>
      <PageHeader
        title="Dashboard"
        description="Business metrics will appear here once products, inventory and sales are recorded."
        actions={
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void healthQuery.refetch()}
            disabled={healthQuery.isFetching}
          >
            {healthQuery.isFetching ? "Refreshing…" : "Refresh status"}
          </button>
        }
      />

      <h2 className="section-title">System status</h2>
      <QueryState query={healthQuery} loadingMessage="Checking system status…" errorTitle="API unreachable">
        {(health) => <SystemStatus health={health} />}
      </QueryState>
    </section>
  );
}

function SystemStatus({ health }: { health: HealthResponse }) {
  const { api, database } = health.services;

  return (
    <div className="status-grid">
      <StatusCard label="API server" up={api.status === "up"} detail={`Uptime ${formatUptime(health.uptimeSeconds)}`} />
      <StatusCard
        label="PostgreSQL database"
        up={database.status === "up"}
        detail={
          database.status === "up"
            ? `Responded in ${database.latencyMs ?? "–"} ms`
            : (database.error ?? "Database is not reachable")
        }
      />
      <StatusCard
        label="Last checked"
        detail={new Date(health.timestamp).toLocaleTimeString()}
        up={health.status === "ok"}
        statusText={health.status === "ok" ? "Healthy" : "Degraded"}
      />
    </div>
  );
}

interface StatusCardProps {
  label: string;
  up: boolean;
  detail: string;
  statusText?: string;
}

function StatusCard({ label, up, detail, statusText }: StatusCardProps) {
  return (
    <div className="status-card">
      <p className="status-card__label">{label}</p>
      <p className={`status-card__value ${up ? "is-up" : "is-down"}`}>{statusText ?? (up ? "Operational" : "Down")}</p>
      <p className="status-card__detail">{detail}</p>
    </div>
  );
}

function formatUptime(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
