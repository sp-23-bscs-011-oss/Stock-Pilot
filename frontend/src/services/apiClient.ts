import axios, { type AxiosRequestConfig } from "axios";
import { env } from "../config/env";
import { ApiError, toApiError } from "./apiError";

export const httpClient = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: env.apiTimeoutMs,
  withCredentials: true,
  headers: { Accept: "application/json" },
});

// The session's CSRF token is kept in memory only (never storage) and attached to every
// state-changing request. The auth service refreshes it whenever a session response arrives.
let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

const SAFE_METHODS = new Set(["get", "head", "options"]);

httpClient.interceptors.request.use((config) => {
  if (csrfToken && !SAFE_METHODS.has((config.method ?? "get").toLowerCase())) {
    config.headers.set("X-CSRF-Token", csrfToken);
  }
  return config;
});

type ApiErrorListener = (error: ApiError) => void;
let onAuthError: ApiErrorListener | null = null;

/** Lets the auth provider react when any request reveals the session has ended. */
export function setAuthErrorListener(listener: ApiErrorListener | null) {
  onAuthError = listener;
}

httpClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    const apiError = toApiError(error);
    if (apiError.status === 401 || apiError.code === "PASSWORD_CHANGE_REQUIRED") {
      onAuthError?.(apiError);
    }
    return Promise.reject(apiError);
  },
);

/**
 * Thin typed wrappers around the shared client. Feature services build on these
 * so request configuration and error normalization live in one place.
 */
export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig) => httpClient.get<T>(url, config).then((res) => res.data),
  post: <T, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig) =>
    httpClient.post<T>(url, body, config).then((res) => res.data),
  put: <T, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig) =>
    httpClient.put<T>(url, body, config).then((res) => res.data),
  patch: <T, B = unknown>(url: string, body?: B, config?: AxiosRequestConfig) =>
    httpClient.patch<T>(url, body, config).then((res) => res.data),
  delete: <T>(url: string, config?: AxiosRequestConfig) => httpClient.delete<T>(url, config).then((res) => res.data),
};
