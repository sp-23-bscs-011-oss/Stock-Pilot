import type {
  ChangePasswordInput,
  LoginInput,
  SessionResponse,
  SetupOwnerInput,
  SetupStatus,
} from "../types/auth";
import { api, setCsrfToken } from "./apiClient";
import { ApiError } from "./apiError";

function remember(response: SessionResponse): SessionResponse {
  setCsrfToken(response.csrfToken);
  return response;
}

export const authService = {
  /** Resolves to null (rather than throwing) when nobody is signed in. */
  async me(signal?: AbortSignal): Promise<SessionResponse | null> {
    try {
      return remember(await api.get<SessionResponse>("/auth/me", { signal }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setCsrfToken(null);
        return null;
      }
      throw error;
    }
  },

  async login(input: LoginInput): Promise<SessionResponse> {
    return remember(await api.post<SessionResponse>("/auth/login", input));
  },

  async logout(): Promise<void> {
    try {
      await api.post("/auth/logout");
    } catch (error) {
      // Already signed out on the server; nothing left to do.
      if (!(error instanceof ApiError && error.status === 401)) throw error;
    } finally {
      setCsrfToken(null);
    }
  },

  async logoutAll(): Promise<void> {
    await api.post("/auth/logout-all");
    setCsrfToken(null);
  },

  async changePassword(input: ChangePasswordInput): Promise<SessionResponse> {
    return remember(await api.post<SessionResponse>("/auth/change-password", input));
  },

  getSetupStatus(signal?: AbortSignal): Promise<SetupStatus> {
    return api.get<SetupStatus>("/auth/setup", { signal });
  },

  async setupOwner(input: SetupOwnerInput): Promise<SessionResponse> {
    return remember(await api.post<SessionResponse>("/auth/setup", input));
  },
};
