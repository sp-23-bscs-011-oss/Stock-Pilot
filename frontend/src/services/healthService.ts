import type { HealthResponse } from "../types/api";
import { httpClient } from "./apiClient";

export const healthService = {
  /**
   * The health endpoint answers 503 with a full body when the database is down,
   * so treat both 200 and 503 as a readable status rather than a failure.
   */
  async getHealth(signal?: AbortSignal): Promise<HealthResponse> {
    const response = await httpClient.get<HealthResponse>("/health", {
      signal,
      validateStatus: (status) => status === 200 || status === 503,
    });
    return response.data;
  },
};
