import { ApiError } from "../services/apiError";

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): string | undefined {
  if (!value.trim()) return "Enter your email address";
  if (!EMAIL_PATTERN.test(value.trim())) return "Enter a valid email address, like name@shop.com";
  return undefined;
}

export function validateRequired(value: string, label: string): string | undefined {
  return value.trim() ? undefined : `Enter ${label}`;
}

export function validateName(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length < 2) return "Name must be at least 2 characters";
  if (trimmed.length > 100) return "Name must be at most 100 characters";
  return undefined;
}

/** Mirrors the API's password policy so people see problems before submitting. */
export function validateNewPassword(value: string): string | undefined {
  if (value.length < 10) return "Use at least 10 characters";
  if (new TextEncoder().encode(value).length > 72) return "Password is too long";
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return "Include at least one letter and one number";
  return undefined;
}

export const PASSWORD_HINT = "At least 10 characters, including a letter and a number.";

export function hasErrors(errors: FieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

/** Maps the API's validation issues (`details: [{ path, message }]`) onto form fields. */
export function fieldErrorsFromApi(error: unknown): FieldErrors {
  if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
  const errors: FieldErrors = {};
  for (const issue of error.details as { path?: unknown[]; message?: string }[]) {
    const field = issue.path?.[0];
    if (typeof field === "string" && issue.message && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

/** A form-level message for a failed request. Field-level problems are shown on the fields instead. */
export function formErrorMessage(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.code === "VALIDATION_ERROR" || hasErrors(fieldErrorsFromApi(error))) {
      return "Please correct the highlighted fields.";
    }
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

/** Focuses the first invalid control so keyboard and screen-reader users land on the problem. */
export function focusFirstInvalid(form: HTMLFormElement | null) {
  requestAnimationFrame(() => form?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus());
}

/** A readable random password for temporary accounts, e.g. "hVk7-p2Rm-Q9xa". */
export function generateTemporaryPassword(): string {
  const letters = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const digits = "23456789";
  const alphabet = letters + digits;
  const bytes = crypto.getRandomValues(new Uint32Array(12));
  const chars = Array.from(bytes, (n) => alphabet[n % alphabet.length]);
  // Guarantee the policy: one letter and one digit in fixed positions.
  chars[0] = letters[bytes[0] % letters.length];
  chars[5] = digits[bytes[5] % digits.length];
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)].map((group) => group.join("")).join("-");
}
