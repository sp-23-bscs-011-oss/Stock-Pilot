import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/authContext";
import { Alert } from "../components/Alert";
import { Spinner } from "../components/Spinner";
import { TextField } from "../components/TextField";
import { usePageTitle } from "../hooks/usePageTitle";
import { queryKeys } from "../lib/queryKeys";
import {
  fieldErrorsFromApi,
  focusFirstInvalid,
  formErrorMessage,
  hasErrors,
  validateEmail,
  validateRequired,
  type FieldErrors,
} from "../lib/validation";
import { paths } from "../routes/paths";
import { ApiError } from "../services/apiError";
import { authService } from "../services/authService";

type Field = "email" | "password";

function validate(values: Record<Field, string>): FieldErrors<Field> {
  return { email: validateEmail(values.email), password: validateRequired(values.password, "your password") };
}

export default function LoginPage() {
  usePageTitle("Sign in");
  const { login, sessionEnded } = useAuth();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [submitted, setSubmitted] = useState(false);

  const setupStatus = useQuery({
    queryKey: queryKeys.auth.setupStatus,
    queryFn: ({ signal }) => authService.getSetupStatus(signal),
  });

  // On success the auth state updates and <GuestOnly> redirects to the intended page.
  const loginMutation = useMutation({
    mutationFn: login,
    onError: (error) => {
      setErrors(fieldErrorsFromApi(error));
      if (error instanceof ApiError && error.code === "INVALID_CREDENTIALS") {
        setValues((current) => ({ ...current, password: "" }));
      }
    },
  });

  function update(field: Field, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    // Re-validate live only after the first submit attempt, so typing isn't nagged.
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
    loginMutation.mutate({ email: values.email.trim(), password: values.password });
  }

  const formError = formErrorMessage(loginMutation.error);
  const pending = loginMutation.isPending;

  return (
    <div className="login">
      <h1 className="login__title">Sign in</h1>
      <p className="login__subtitle">Use your staff account to access StockPilot.</p>

      {sessionEnded && !formError && <Alert tone="warn">Your session has ended. Please sign in again.</Alert>}
      {setupStatus.data?.setupRequired && (
        <Alert tone="info">
          StockPilot hasn't been set up yet. <Link to={paths.setup}>Create the owner account</Link> to get started.
        </Alert>
      )}
      {formError && <Alert tone="error">{formError}</Alert>}

      <form ref={formRef} className="form" onSubmit={handleSubmit} noValidate aria-busy={pending}>
        <TextField
          label="Email"
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoFocus
          value={values.email}
          onChange={(event) => update("email", event.target.value)}
          error={errors.email}
          disabled={pending}
        />
        <TextField
          label="Password"
          type="password"
          name="password"
          autoComplete="current-password"
          revealable
          value={values.password}
          onChange={(event) => update("password", event.target.value)}
          error={errors.password}
          disabled={pending}
        />
        <button type="submit" className="button button--block" disabled={pending}>
          {pending && <Spinner size={14} label="Signing in" />}
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="login__footnote">Forgot your password? Ask the store owner to reset it.</p>
    </div>
  );
}
