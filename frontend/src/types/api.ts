/** Error envelope produced by the backend's centralized error handler. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export type ServiceStatus = "up" | "down";

export interface HealthResponse {
  status: "ok" | "degraded";
  timestamp: string;
  uptimeSeconds: number;
  services: {
    api: { status: ServiceStatus };
    database: { status: ServiceStatus; latencyMs?: number; error?: string };
  };
}
