import { useRef, useState } from "react";
import { useCurrentUser } from "../auth/authContext";
import { ApiError } from "../services/apiError";

/** Persist the exact request before sending it. Closing a dialog, refreshing, or a timeout
 * must never generate a fresh key for a delivery/payment whose outcome is unknown. */
export function usePendingSubmission<T extends { idempotencyKey: string }>(scope: string) {
  const user = useCurrentUser();
  const key = `stockpilot:pending:${user.id}:${scope}`;
  const [saved, setSaved] = useState<T | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(key) ?? "null") as T | null; }
    catch { return null; }
  });
  const current = useRef(saved);
  return {
    saved,
    prepare(input: T): T {
      if (current.current) return current.current;
      // Fail before sending if storage is unavailable; don't risk an untraceable retry.
      sessionStorage.setItem(key, JSON.stringify(input));
      current.current = input;
      setSaved(input);
      return input;
    },
    clear() {
      sessionStorage.removeItem(key);
      current.current = null;
      setSaved(null);
    },
  };
}

export function isDefiniteRejection(error: unknown) {
  // Authentication, CSRF, rate limits and gateway errors cannot tell us whether an earlier
  // attempt committed. Keep its key until the business handler resolves the request.
  return error instanceof ApiError && [400, 404, 409].includes(error.status ?? 0)
    && error.code !== "IDEMPOTENCY_KEY_REUSED";
}
