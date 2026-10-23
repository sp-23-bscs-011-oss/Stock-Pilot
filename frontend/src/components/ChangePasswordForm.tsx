import { useMutation } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { useAuth } from "../auth/authContext";
import {
  PASSWORD_HINT,
  fieldErrorsFromApi,
  focusFirstInvalid,
  formErrorMessage,
  hasErrors,
  validateNewPassword,
  validateRequired,
  type FieldErrors,
} from "../lib/validation";
import { Alert } from "./Alert";
import { Spinner } from "./Spinner";
import { TextField } from "./TextField";

type Field = "currentPassword" | "newPassword" | "confirmPassword";
type Values = Record<Field, string>;

const EMPTY: Values = { currentPassword: "", newPassword: "", confirmPassword: "" };

function validate(values: Values): FieldErrors<Field> {
  return {
    currentPassword: validateRequired(values.currentPassword, "your current password"),
    newPassword:
      validateNewPassword(values.newPassword) ??
      (values.newPassword === values.currentPassword ? "Choose a password different from the current one" : undefined),
    confirmPassword: values.confirmPassword === values.newPassword ? undefined : "Passwords don't match",
  };
}

interface ChangePasswordFormProps {
  currentPasswordLabel?: string;
  submitLabel?: string;
  onSuccess?: () => void;
}

export function ChangePasswordForm({
  currentPasswordLabel = "Current password",
  submitLabel = "Change password",
  onSuccess,
}: ChangePasswordFormProps) {
  const { changePassword } = useAuth();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setValues(EMPTY);
      setSubmitted(false);
      setErrors({});
      onSuccess?.();
    },
    onError: (error) => {
      setErrors(fieldErrorsFromApi(error));
      focusFirstInvalid(formRef.current);
    },
  });

  function update(field: Field, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    if (submitted) setErrors(validate(next));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) {
      focusFirstInvalid(formRef.current);
      return;
    }
    mutation.mutate({ currentPassword: values.currentPassword, newPassword: values.newPassword });
  }

  const pending = mutation.isPending;
  const formError = formErrorMessage(mutation.error);
  const field = (name: Field) => ({
    name,
    type: "password",
    value: values[name],
    onChange: (event: { target: { value: string } }) => update(name, event.target.value),
    error: errors[name],
    disabled: pending,
  });

  return (
    <form ref={formRef} className="form" onSubmit={handleSubmit} noValidate aria-busy={pending}>
      {formError && <Alert tone="error">{formError}</Alert>}
      {mutation.isSuccess && (
        <Alert tone="success">Password changed. Other devices have been signed out.</Alert>
      )}
      <TextField label={currentPasswordLabel} autoComplete="current-password" revealable {...field("currentPassword")} />
      <TextField label="New password" autoComplete="new-password" revealable hint={PASSWORD_HINT} {...field("newPassword")} />
      <TextField label="Confirm new password" autoComplete="new-password" {...field("confirmPassword")} />
      <div>
        <button type="submit" className="button" disabled={pending}>
          {pending && <Spinner size={14} label="Saving" />}
          {pending ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
