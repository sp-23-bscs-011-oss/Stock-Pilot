import { isAxiosError } from "axios";
import type { ApiErrorBody } from "../types/api";

/** Normalized error thrown by every API service so UI code handles one shape. */
export class ApiError extends Error {
  readonly status: number | null;
  readonly code: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(options: { message: string; status: number | null; code: string; details?: unknown; requestId?: string }) {
    super(options.message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code;
    this.details = options.details;
    this.requestId = options.requestId;
  }

  get isNetworkError() {
    return this.status === null;
  }
}

function isApiErrorBody(data: unknown): data is ApiErrorBody {
  return (
    typeof data === "object" &&
    data !== null &&
    "error" in data &&
    typeof (data as ApiErrorBody).error?.message === "string"
  );
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (isAxiosError(error)) {
    if (error.code === "ECONNABORTED" || error.code === "ETIMEDOUT") {
      return new ApiError({ message: "The server took too long to respond.", status: null, code: "TIMEOUT" });
    }

    if (!error.response) {
      return new ApiError({
        message: "Unable to reach the StockPilot server. Check that the API is running.",
        status: null,
        code: "NETWORK_ERROR",
      });
    }

    const { status, data } = error.response;
    if (isApiErrorBody(data)) {
      return new ApiError({ status, ...data.error });
    }
    // A proxy or load balancer answering for an unreachable API.
    if (status === 502 || status === 503 || status === 504) {
      return new ApiError({
        message: "Unable to reach the StockPilot server. Check that the API is running.",
        status,
        code: "UPSTREAM_UNAVAILABLE",
      });
    }
    return new ApiError({ message: `Request failed with status ${status}.`, status, code: "HTTP_ERROR" });
  }

  return new ApiError({
    message: error instanceof Error ? error.message : "An unexpected error occurred.",
    status: null,
    code: "UNKNOWN_ERROR",
  });
}
