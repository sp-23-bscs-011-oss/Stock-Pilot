// Vite only exposes variables prefixed with VITE_ to client code.
export const env = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL?.trim() || "/api",
  apiTimeoutMs: Number(import.meta.env.VITE_API_TIMEOUT_MS) || 15_000,
  appName: import.meta.env.VITE_APP_NAME?.trim() || "StockPilot",
  /** ISO 4217 code used to display prices until store settings exist. */
  currency: import.meta.env.VITE_CURRENCY?.trim().toUpperCase() || "USD",
  isDev: import.meta.env.DEV,
} as const;
